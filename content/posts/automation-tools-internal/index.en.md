---
title: "Building Internal Automation Tools for Ops Work"
slug: "internal-automation-tools"
date: 2026-07-05T19:47:00+07:00
description: "Principles and a practical skeleton for turning a pile of ops scripts into an internal automation tool that's safe, testable, and pleasant for the team to use."
categories: [projects]
tags: [automation, python, cli, devops, tooling]
---
### Introduction
Pretty much every ops person has that one folder full of little scripts: checking disks, rotating logs, restarting services, pulling reports, and so on. Me too. The trouble only shows up once other people on the team start using them. Every script takes parameters differently, there's no way to do a trial run, the output is hard to read, and one typo can hit production straight away (knock on wood).

So in this post I'll share the principles I use to clean those scripts up into a single **internal automation tool** that the team can trust.

### Design Principles
1. **One entry point, many subcommands.** Instead of a dozen scripts each with its own style, one CLI with a few subcommands is much easier to learn. You only need to remember one name, and `opsctl --help` automatically becomes documentation that's always up to date.
````
opsctl disk-report --host web-01
opsctl service restart nginx --host web-01 --dry-run
opsctl backup verify --target db
````
2. **Dry-run for every action that changes something.** Every command that changes something must have `--dry-run`, which shows what it *would* do without actually doing it. For risky actions, ask for confirmation first, and provide `--yes` for use in pipelines.
3. **Idempotent.** Running the same command twice has to stay safe. Check the current state first, and only change things if they need changing. Same idea as Ansible, because automation will get re-run, whether it's a retry, a timeout, or a misclick.
4. **No secrets in the code.** Credentials are read from environment variables or a secret manager, never hardcoded, let alone committed. Add a secret scanner to CI too, just to be safe.
5. **Output for humans and machines.** The default output is short and easy to read, plus there's `--output json` so other tools can process the result. Logs go to stderr, results go to stdout.
6. **Honest exit codes.** `0` means success, anything else means failure. Sounds trivial, but this is exactly what lets the tool be chained in cron, CI, or other automation.

### A Minimal Skeleton in Python
Here's an example skeleton, using nothing but Python's standard library:
```
vim opsctl.py

............
#!/usr/bin/env python3
"""opsctl: internal automation tool for ops tasks."""
import argparse
import json
import logging
import shutil
import sys

log = logging.getLogger("opsctl")


def disk_report(args):
    usage = shutil.disk_usage(args.path)
    percent = round(usage.used / usage.total * 100, 1)
    result = {"path": args.path, "used_percent": percent}
    if args.output == "json":
        print(json.dumps(result))
    else:
        print(f"{args.path}: {percent}% used")
    return 1 if percent >= args.threshold else 0


def clean_tmp(args):
    log.info("Looking for old files in %s", args.path)
    # ... collect the candidate files to delete ...
    candidates = []
    for f in candidates:
        if args.dry_run:
            print(f"[dry-run] would delete {f}")
        else:
            log.info("Deleting %s", f)
            # f.unlink()
    return 0


def main():
    parser = argparse.ArgumentParser(prog="opsctl")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--output", choices=["text", "json"], default="text")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("disk-report", help="Disk usage report")
    p.add_argument("--path", default="/")
    p.add_argument("--threshold", type=float, default=90.0)
    p.set_defaults(func=disk_report)

    p = sub.add_parser("clean-tmp", help="Clean up old temporary files")
    p.add_argument("--path", default="/tmp")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=clean_tmp)

    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
```
The skeleton is kept simple on purpose. Each subcommand is just a regular function that takes `args` and returns an exit code, so it's easy to test with `pytest`.

Try running
```
python3 opsctl.py disk-report --path /
```
If it works, you'll see output like this:
````
/: 42.5% used
````

### Repository Layout
````
opsctl/
├── opsctl/
│   ├── __init__.py
│   ├── cli.py
│   └── commands/
│       ├── disk.py
│       └── cleanup.py
├── tests/
├── pyproject.toml
└── README.md
````
Once the entry point is defined in `pyproject.toml`, the tool can be installed with the command below and called as `opsctl` straight away on anyone's laptop on the team.
```
pipx install .
```

### When to Use Ansible, When to Use Your Own Tool
- **Ansible** is a good fit for managing the *state* of servers: packages, config, services. You can see an example in [deploying a MongoDB replica set with Ansible](/en/posts/ansible-mongodb-replica-set/).
- An **internal tool** is a good fit for tasks that are *actions* or *reports*: quick checks, cleanups, integrating with internal APIs, or wrapping a few steps that are often done together.

The two complement each other. An internal tool can even call an Ansible playbook as one of its subcommands.

### Checklist Before Sharing It With the Team
- [ ] Every subcommand has a clear `--help`
- [ ] Every action that changes state has `--dry-run`
- [ ] No secrets in the code or in the git history
- [ ] There are tests for the core logic
- [ ] CI runs lint and tests on every pull request
- [ ] The README covers how to install it and usage examples

A good automation tool doesn't have to be big. What matters is that the team feels safe and confident running it, and that trust is built from the small things above.

That's it, hope it helps.

References:
- [argparse - Python Documentation](https://docs.python.org/3/library/argparse.html)
