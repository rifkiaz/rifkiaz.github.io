---
title: "YaST"
description: "Cheat sheet for the YaST modules I use most, from the terminal or the GUI."
date: 2026-10-09
weight: 50
tags: ["openSUSE", "YaST"]
---

YaST is openSUSE's own administration tool. Its big plus: almost every module also runs in the terminal (ncurses), so it's still comfortable to use over SSH.

> YaST is no longer shipped in Leap 16. openSUSE moved to **Cockpit** for browser-based administration and **Agama** as the installer. This cheat sheet applies to Tumbleweed and Leap 15.x.

## Basics

| Command | What it does |
|---|---|
| `sudo yast` | Text-mode YaST control center |
| `sudo yast2` | GUI control center (if you have a desktop) |
| `yast -l` | List all installed modules |
| `sudo yast module_name` | Open a specific module directly |

In text mode, move between elements with `Tab`, select with `Enter` or `Space`, and use function keys like `F10` (OK) or `F9` (quit). If the terminal grabs the `F` keys, use `Alt` + the highlighted letter.

## Modules I use most

| Module | What it does |
|---|---|
| `sudo yast sw_single` | Search, install, and remove packages |
| `sudo yast online_update` | Install patches (Leap) |
| `sudo yast repositories` | Manage repositories |
| `sudo yast lan` | Network settings (wicked) |
| `sudo yast firewall` | firewalld settings |
| `sudo yast users` | Manage users and groups |
| `sudo yast bootloader` | GRUB and kernel parameter settings |
| `sudo yast services-manager` | Enable/disable systemd services |
| `sudo yast timezone` | Time zone |
| `sudo yast disk` | Partitions and Btrfs (Expert Partitioner) |
| `sudo yast snapper` | View and compare snapshots |
| `sudo yast sysconfig` | `/etc/sysconfig` editor |

## Cockpit as an alternative

If you prefer a web interface, especially on Leap 16:

```bash
sudo zypper in cockpit
sudo systemctl enable --now cockpit.socket
sudo firewall-cmd --add-service=cockpit --permanent && sudo firewall-cmd --reload
```

Then open `https://server-address:9090` and log in with a system user.

{{< telegram-opensuse >}}
