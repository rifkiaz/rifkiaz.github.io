---
title: "systemd and journalctl"
description: "Cheat sheet for managing services, logs, and basic system settings with systemd."
date: 2026-10-09
weight: 30
tags: ["openSUSE", "systemd", "Linux"]
---

openSUSE uses systemd, so this cheat sheet works on almost every modern distro too.

## Services

| Command | What it does |
|---|---|
| `systemctl status sshd` | Service status plus the latest log lines |
| `systemctl start sshd` | Start a service |
| `systemctl stop sshd` | Stop a service |
| `systemctl restart sshd` | Restart a service |
| `systemctl reload sshd` | Reload config without restarting (if supported) |
| `systemctl enable --now sshd` | Enable at boot and start right now |
| `systemctl disable --now sshd` | Disable at boot and stop right now |
| `systemctl mask name` | Block a service so it can't be started at all |
| `systemctl is-active sshd` | Quick check, handy in scripts |
| `systemctl is-enabled sshd` | Check whether it starts at boot |

## Viewing and changing units

| Command | What it does |
|---|---|
| `systemctl list-units --type=service` | Currently loaded services |
| `systemctl --failed` | Failed units |
| `systemctl list-unit-files --state=enabled` | Units enabled at boot |
| `systemctl list-timers` | List timers (the cron replacement) |
| `systemctl cat sshd` | Show a unit file |
| `systemctl edit sshd` | Create an override without touching the original file |
| `systemctl daemon-reload` | Reload units after editing files by hand |

## Logs with journalctl

| Command | What it does |
|---|---|
| `journalctl -u sshd` | Logs for one service |
| `journalctl -u sshd -f` | Follow logs live |
| `journalctl -b` | Logs since the last boot |
| `journalctl -b -1` | Logs from the previous boot, useful after a crash |
| `journalctl -p err -b` | Only errors and above since boot |
| `journalctl --since "1 hour ago"` | Logs from the last hour |
| `journalctl -k` | Kernel logs (like `dmesg`) |
| `journalctl --disk-usage` | Journal size on disk |
| `journalctl --vacuum-time=2weeks` | Delete logs older than two weeks |

## System settings

| Command | What it does |
|---|---|
| `hostnamectl set-hostname host-name` | Change the hostname |
| `timedatectl set-timezone Asia/Jakarta` | Change the time zone |
| `timedatectl` | Check the time and NTP sync status |
| `localectl set-keymap us` | Change the console keyboard layout |
| `systemctl reboot` / `systemctl poweroff` | Reboot / power off |

## Boot diagnosis

| Command | What it does |
|---|---|
| `systemd-analyze` | Total boot time |
| `systemd-analyze blame` | Services that took longest at boot |
| `systemd-analyze critical-chain` | The chain of services slowing down boot |

## Override example

Say you want a service to restart automatically when it dies:

```bash
sudo systemctl edit service-name
```

```ini
[Service]
Restart=on-failure
RestartSec=5
```

Save, then `sudo systemctl restart service-name`. The override is stored in `/etc/systemd/system/service-name.service.d/override.conf`, so it survives package updates.

{{< telegram-opensuse >}}
