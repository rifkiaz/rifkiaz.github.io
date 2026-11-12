---
title: "Zypper"
description: "Zypper cheat sheet for managing packages and repositories on openSUSE."
date: 2026-10-09
weight: 10
tags: ["openSUSE", "zypper"]
---

`zypper` is openSUSE's built-in package manager. Almost every command has a short form, so I list both in the tables below. Commands that change the system need `sudo`.

## Updating the system

| Command | What it does |
|---|---|
| `zypper refresh` / `zypper ref` | Refresh metadata for all repositories |
| `zypper dup` | Full upgrade. **The right way to update Tumbleweed** |
| `zypper update` / `zypper up` | Update installed packages. Used on Leap |
| `zypper patch` | Install official patches (Leap) |
| `zypper list-updates` / `zypper lu` | Show packages that can be updated |
| `zypper list-patches` / `zypper lp` | Show available patches |
| `zypper ps -s` | Show processes still using old files after an update |
| `zypper needs-rebooting` | Check whether a reboot is needed |

```bash
# Routine update on Tumbleweed
sudo zypper ref && sudo zypper dup
```

## Searching and installing packages

| Command | What it does |
|---|---|
| `zypper search name` / `zypper se name` | Search for a package |
| `zypper se -i name` | Search among installed packages |
| `zypper se --provides /usr/bin/dig` | Find the package that provides a file |
| `zypper info name` / `zypper if name` | Package details |
| `zypper install name` / `zypper in name` | Install a package |
| `zypper in ./package.rpm` | Install a local RPM plus its dependencies |
| `zypper in -t pattern devel_basis` | Install a pattern (a group of packages) |
| `zypper remove name` / `zypper rm name` | Remove a package |
| `zypper rm -u name` | Remove a package and dependencies nothing else uses |
| `zypper in -f name` | Reinstall a package (force) |

## Repositories

| Command | What it does |
|---|---|
| `zypper repos -d` / `zypper lr -d` | List repositories with their URLs |
| `zypper addrepo -f URL alias` / `zypper ar -f URL alias` | Add a repo with auto-refresh |
| `zypper removerepo alias` / `zypper rr alias` | Remove a repo |
| `zypper modifyrepo -d alias` / `zypper mr -d alias` | Disable a repo |
| `zypper mr -e alias` | Enable a repo again |
| `zypper mr -p 90 alias` | Change priority (lower number = higher priority) |
| `zypper dup --from alias` | Upgrade/switch package vendor from a specific repo |

To install packages from the Open Build Service (OBS) more easily, try `opi`:

```bash
sudo zypper in opi
opi package-name
```

## Indonesian local mirror

The openSUSE Indonesia community ([opensuse.id](https://opensuse.id)) runs a local repository mirror at [download.opensuse.id](https://download.opensuse.id). If you're in Indonesia, pulling packages from here is usually much faster than from servers abroad.

The folder layout is the same as the official download.opensuse.org: `distribution`, `tumbleweed`, `slowroll`, `update`, and `repositories` (OBS repos), plus `packman`. So the easiest way is to swap the host in your existing repo files:

```bash
# Back up the repo config first
sudo cp -a /etc/zypp/repos.d /etc/zypp/repos.d.bak

# See the currently active repo URLs
zypper lr -u

# Swap the download.opensuse.org host for the local mirror
sudo sed -i 's|download.opensuse.org|download.opensuse.id|g' /etc/zypp/repos.d/*.repo

# Make sure every repo refreshes
sudo zypper ref
```

If a repo fails to refresh, that folder probably isn't mirrored. Just restore that repo file from `/etc/zypp/repos.d.bak`.

Note: on newer installs, the default repos are sometimes managed by the `openSUSE-repos` package and use `cdn.opensuse.org` URLs. If `zypper lr -u` shows that, the `sed` above may get overwritten again when the repos refresh. In that case, add the mirror repos manually, for example on Tumbleweed:

```bash
sudo zypper ar -f https://download.opensuse.id/tumbleweed/repo/oss/ id-oss
sudo zypper ar -f https://download.opensuse.id/tumbleweed/repo/non-oss/ id-non-oss
sudo zypper ref
```

The mirror also carries **Packman** (multimedia codecs and packages that aren't in the official repos). Browse the [packman](https://download.opensuse.id/packman/) folder to find the path for your openSUSE version, then add it with a higher priority:

```bash
sudo zypper ar -cfp 90 https://download.opensuse.id/packman/<path-for-your-version>/ packman
sudo zypper dup --from packman --allow-vendor-change
```

## Package locks

| Command | What it does |
|---|---|
| `zypper addlock name` / `zypper al name` | Lock a package so it isn't updated or removed |
| `zypper locks` / `zypper ll` | List locks |
| `zypper removelock name` / `zypper rl name` | Remove a lock |

## Maintenance

| Command | What it does |
|---|---|
| `zypper clean -a` | Clean the package and metadata cache |
| `zypper packages --orphaned` | Packages that are no longer in any repo |
| `zypper packages --unneeded` | Packages no other package needs |
| `zypper verify` / `zypper ve` | Check and fix broken dependencies |
| `zypper -n in name` | Non-interactive mode, good for scripts |

## Upgrading Leap versions

```bash
# Example: move to Leap 15.6. Make sure every repo uses the $releasever variable first.
sudo zypper --releasever=15.6 ref
sudo zypper --releasever=15.6 dup
```

> Before `dup`, make sure snapper is enabled so you can roll back if something breaks. See the [Snapper and Btrfs cheat sheet](/en/cheatsheet/snapper-btrfs/).

{{< telegram-opensuse >}}
