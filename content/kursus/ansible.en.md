---
title: "Ansible Short Course"
linkTitle: "Ansible"
description: "Learn Ansible hands-on against five lab servers: inventory, ad-hoc commands, your first playbook, idempotency, dry runs with --check --diff, --limit, and a playbook that works on both Ubuntu and Rocky Linux."
summary: "Inventory, ad-hoc commands, playbooks, handlers, idempotency, --check --diff, --limit, and cross-distro playbooks."
url: "/en/courses/ansible/"
sim: ansible
layout: "kursus"
weight: 8
minutes: 25
level: "beginner"
next: "/kursus/gitops/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Inventory and ad-hoc commands"
    missions: [1]
    body: |
      Ansible manages many servers at once over **plain SSH**. No agent to install on the servers, just Python and SSH access.

      The list of servers lives in the **inventory**. Open the `inventory.ini` tab in the lab:

      - `[web]` and `[db]` are **groups**. You can target a group, a single host, or `all`.
      - `[all:vars]` holds variables for every host, like the SSH user.

      **Ad-hoc** commands are for quick one-off jobs: `ansible <target> -m <module> -a <arguments>`. The `ping` module isn't an ICMP ping, it's a test of "can I SSH in and is Python there?".
    steps:
      - text: "Show the inventory as a tree."
        cmd: "ansible-inventory --graph"
      - text: "Test the connection to every host."
        cmd: "ansible all -m ping"
        wait: 2500
      - text: "Run a command on the web group only."
        cmd: 'ansible web -a "uptime"'
        wait: 2000
    quiz:
      q: "What must be installed on a server for Ansible to manage it?"
      options:
        - "An Ansible agent running as a service"
        - "Just SSH and Python"
        - "Docker"
      answer: 1
      why: "Ansible is *agentless*. It SSHes in, sends a small module, runs it with Python, then cleans up."

  - title: "Your first playbook"
    missions: [2]
    body: |
      For repeatable work, write a **playbook** (YAML). Open the `site.yml` tab:

      - One **play** = a target (`hosts: web`) + a list of **tasks**.
      - Each task calls one **module**: `apt` installs packages, `template` writes a file from a Jinja2 template, `service` manages services.
      - `become: true` means run as root (sudo).
      - `notify: restart nginx` triggers a **handler**. Handlers only run if the task that notified them actually changed something, and they run once at the end of the play.

      As the playbook runs, each task reports per host: `ok` (already right), `changed` (modified), or `failed`.
    steps:
      - cmd: "ansible-playbook site.yml"
        wait: 9000
      - text: "Check the page deployed from the template."
        cmd: "curl web1"
    quiz:
      q: "When does the `restart nginx` handler run?"
      options:
        - "Every time the playbook runs"
        - "Only when the task that notifies it reports changed"
        - "Before all tasks"
      answer: 1
      why: "Handlers are triggered by change. If the template didn't change, nginx doesn't need a restart."

  - title: "Idempotent: run it again and again, same result"
    missions: [3]
    body: |
      A good playbook is **idempotent**: run it once or ten times, the end result is the same, and the second run reports `changed=0`. Modules like `apt` and `service` are already idempotent: they check first and only act if needed.

      `shell` and `command` are different. Ansible doesn't know what your command does, so it always counts it as `changed`. In the lab, the "Record deploy time" task keeps showing `changed`.

      The fix: tell Ansible when the command doesn't need to run, for example `creates=/path` (skip if that file already exists). Another option is `changed_when: false` for commands that only read.
    steps:
      - text: "Run it again. There's still a `changed` from the shell task."
        cmd: "ansible-playbook site.yml"
        wait: 8000
      - text: "Add `creates` to the shell task."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: "shell: date > /etc/deploy-time"
          replace: "shell: date > /etc/deploy-time creates=/etc/deploy-time"
      - text: "Run once more. Now it's `changed=0` on every host."
        cmd: "ansible-playbook site.yml"
        wait: 8000
    quiz:
      q: "Why is a `shell` task always reported as `changed`?"
      options:
        - "Because shell always fails"
        - "Because Ansible can't tell whether the command really changed anything"
        - "Because shell needs become"
      answer: 1
      why: "The shell module just runs a command. Without hints like `creates`, `removes`, or `changed_when`, Ansible treats every run as a change."

  - title: "Look first: --check --diff"
    missions: [4]
    body: |
      Before changing production servers, it's safer to see what *will* change:

      - `--check` runs the playbook as a **dry run**. Modules report what they'd do, but servers aren't touched.
      - `--diff` shows file contents before and after, for example for `template` tasks.

      Put them together and you get something like a Terraform "plan" for server configuration.
    steps:
      - text: "Change the message variable in the playbook."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: 'message: "Hello from Ansible"'
          replace: 'message: "Hello from the Ansible course"'
      - text: "Dry run. Look at the diff; the servers haven't changed."
        cmd: "ansible-playbook site.yml --check --diff"
        wait: 8000
      - cmd: "curl web1"
      - text: "Happy with it? Run it for real. The restart nginx handler fires too."
        cmd: "ansible-playbook site.yml"
        wait: 8000
      - cmd: "curl web1"
    quiz:
      q: "You run with `--check`. What happens to the servers?"
      options:
        - "Nothing changes, Ansible only reports its plan"
        - "Changes are applied but can be rolled back"
        - "Servers are restarted for checking"
      answer: 0
      why: "Check mode is a dry run. Careful though: shell/command tasks are usually skipped in check mode because Ansible can't predict their result."

  - title: "A new host and --limit"
    missions: [5]
    body: |
      Adding a server is as simple as adding it to the inventory. But you might not want to rerun the playbook on every server just for one new host.

      `--limit` restricts the playbook to certain hosts or groups, like `--limit web3` or `--limit 'web:!web1'`. Plays whose targets don't overlap the limit are skipped.

      The new lab host, `web3`, turns out to run **Rocky Linux**. Watch what happens.
    steps:
      - text: "Add web3 to the web group."
        edit:
          file: "inventory.ini"
          tab: '[data-act="tab"][data-f="inventory.ini"]'
          find: |-
            web1
            web2
          replace: |-
            web1
            web2
            web3
      - cmd: "ansible-inventory --graph"
      - text: "Run on web3 only. The `apt` task is going to fail."
        cmd: "ansible-playbook site.yml --limit web3"
        wait: 6000
    quiz:
      q: "Which command runs the playbook on every host in the web group **except** web1?"
      options:
        - "`ansible-playbook site.yml --limit web1`"
        - "`ansible-playbook site.yml --limit 'web:!web1'`"
        - "`ansible-playbook site.yml --skip web1`"
      answer: 1
      why: "Ansible host patterns support `:` (union), `:&` (intersection), and `:!` (exclusion)."

  - title: "One playbook, different distros"
    missions: [6]
    body: |
      `apt` only exists on the Debian/Ubuntu family. Rocky Linux (the RedHat family) uses `dnf`. There are two common approaches:

      - Use the generic **`package`** module, which picks the right package manager per host. Great when the package name is the same on every distro, like `nginx`.
      - Use **facts** and `when:`. Ansible gathers facts about each host at the start (*gathering facts*), like `ansible_os_family`. Then a task can be limited with `when: ansible_os_family == "RedHat"`.

      Here we'll use the first approach since it's the shortest.
    steps:
      - text: "Change `apt` in the install nginx task to `package`."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: |-
            apt:
                    name: nginx
          replace: |-
            package:
                    name: nginx
      - cmd: "ansible-playbook site.yml --limit web3"
        wait: 8000
      - text: "The page on web3 names its distro, filled in from facts."
        cmd: "curl web3"
    quiz:
      q: "Where does the `ansible_os_family` variable come from?"
      options:
        - "You have to write it in the inventory by hand"
        - "Ansible gathers it automatically from each host (facts)"
        - "From ansible.cfg"
      answer: 1
      why: "At the start of each play, Ansible runs the `setup` module (gathering facts), which collects OS, IP, CPU, and more per host."
recap: |
  What you can do now:

  - Inventory, groups, and ad-hoc commands.
  - Playbooks, modules, `become`, and handlers.
  - Idempotency and how to tame `shell` tasks.
  - `--check --diff`, `--limit`, and cross-distro playbooks with `package` or facts.

  Next step: deploy an app to Kubernetes the GitOps way with Argo CD.
---
Ansible configures many servers at once from a single playbook. The lab has five pretend servers (Ubuntu, Debian, and one Rocky Linux) that you can ping, install nginx on, and break as much as you like.
