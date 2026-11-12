---
title: "Snapper and Btrfs"
description: "Cheat sheet for snapshots, rollbacks, and Btrfs maintenance on openSUSE."
date: 2026-10-09
weight: 20
tags: ["openSUSE", "snapper", "btrfs"]
---

A default openSUSE install uses Btrfs for root and Snapper for snapshots. Every time you run `zypper` or YaST, *pre* and *post* snapshots are created automatically. That's what makes rolling back on openSUSE so easy.

## Snapshots

| Command | What it does |
|---|---|
| `snapper list` | List snapshots |
| `snapper create -d "before kernel swap"` | Create a manual snapshot with a description |
| `snapper status 10..12` | Which files changed between two snapshots |
| `snapper diff 10..12 /etc/hosts` | Diff a file's contents between two snapshots |
| `snapper undochange 10..12 /etc/hosts` | Restore a specific file to its state in snapshot 10 |
| `snapper delete 15` | Delete one snapshot |
| `snapper delete 15-20` | Delete a range of snapshots |

## Rolling back the system

If the system won't boot after an update:

1. In the GRUB menu, choose **Start bootloader from a read-only snapshot**.
2. Pick the snapshot from before the update, then boot.
3. Once you're in and everything works, make it permanent:

```bash
sudo snapper rollback
sudo reboot
```

If the system still boots, you can also roll back straight to a specific snapshot number:

```bash
sudo snapper rollback 42
sudo reboot
```

## Configuration

| Command | What it does |
|---|---|
| `snapper list-configs` | List configs (usually just `root`) |
| `snapper -c home create-config /home` | Create a snapshot config for `/home` (must be a Btrfs subvolume) |
| `snapper -c home list` | List snapshots for the `home` config |
| `snapper get-config` | Show the `root` config |

The config lives in `/etc/snapper/configs/root`. A few options people often change:

```ini
NUMBER_LIMIT="2-10"           # number of pre/post snapshots to keep
NUMBER_LIMIT_IMPORTANT="4-10"
TIMELINE_CREATE="no"          # hourly snapshots; turn off on small disks
```

Automatic cleanup runs via `snapper-cleanup.timer`. Check it with `systemctl status snapper-cleanup.timer`.

## Btrfs

| Command | What it does |
|---|---|
| `btrfs filesystem usage /` | Accurate disk usage (more honest than `df`) |
| `btrfs subvolume list /` | List subvolumes |
| `btrfs filesystem df /` | Usage summary per type (data, metadata) |
| `btrfs balance start -dusage=50 /` | Compact data blocks that are less than 50% full |
| `btrfs scrub start /` | Check data integrity in the background |
| `btrfs scrub status /` | Show scrub progress and results |
| `btrfs device stats /` | Device error stats |

The `btrfsmaintenance` package runs balance and scrub on a schedule. Its settings are in `/etc/sysconfig/btrfsmaintenance`.

## Disk full because of snapshots?

```bash
sudo snapper list                       # see old snapshots
sudo snapper delete 100-150             # delete the ones you don't need
sudo btrfs balance start -dusage=50 /   # reclaim space
sudo btrfs filesystem usage /
```

{{< telegram-opensuse >}}
