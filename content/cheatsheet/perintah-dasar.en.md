---
title: "Basic Linux Commands"
description: "Everyday Linux commands: files, permissions, processes, disks, and archives."
date: 2026-10-09
weight: 60
slug: "basic-commands"
tags: ["Linux"]
---

General commands that work on almost every distro, not just openSUSE.

## Files and directories

| Command | What it does |
|---|---|
| `ls -lah` | Full file list with human-readable sizes |
| `cd -` | Go back to the previous directory |
| `cp -a source dest` | Copy while keeping permissions and timestamps |
| `mv old new` | Move or rename |
| `rm -ri folder` | Delete a folder with confirmation |
| `mkdir -p a/b/c` | Create nested directories |
| `find /etc -name "*.conf" -mtime -1` | Find `.conf` files changed in the last day |
| `grep -rn "text" /etc` | Search for text inside files recursively |
| `tail -f /var/log/file.log` | Follow a log file |
| `less file` | Read a long file (`/` to search, `q` to quit) |

## Permissions and ownership

| Command | What it does |
|---|---|
| `chmod 644 file` | rw for the owner, r for everyone else |
| `chmod 755 script.sh` | Executable by everyone, only the owner can modify |
| `chmod +x script.sh` | Add execute permission |
| `chown user:group file` | Change the owner |
| `chown -R user:group folder` | Change the owner recursively |
| `sudo -i` | Open a root shell |
| `id` | Show the user's UID, GID, and groups |

## Processes and resources

| Command | What it does |
|---|---|
| `htop` / `top` | Interactive process monitor |
| `ps aux \| grep name` | Find a process |
| `pgrep -a name` | Find PIDs along with their commands |
| `kill PID` / `kill -9 PID` | Stop a process (gracefully / forcefully) |
| `free -h` | RAM usage |
| `uptime` | Uptime and load average |
| `lscpu` | CPU info |

## Disk

| Command | What it does |
|---|---|
| `df -h` | Usage per filesystem (on Btrfs, use `btrfs filesystem usage /`) |
| `du -sh *` | Size of each item in a directory |
| `du -h --max-depth=1 / \| sort -h` | Find the biggest directories |
| `lsblk -f` | List disks, partitions, filesystems, and UUIDs |
| `mount \| column -t` | Currently mounted filesystems |

## Archives and compression

| Command | What it does |
|---|---|
| `tar czf archive.tar.gz folder/` | Create a gzip archive |
| `tar xzf archive.tar.gz` | Extract a gzip archive |
| `tar tf archive.tar.gz` | List an archive's contents without extracting |
| `zstd -19 file` | Compress with zstd |
| `unzip file.zip -d dest` | Extract a zip into a specific folder |

## Remote

| Command | What it does |
|---|---|
| `ssh user@host` | SSH login |
| `ssh-keygen -t ed25519` | Create a new SSH key |
| `ssh-copy-id user@host` | Install your public key on a server |
| `scp file user@host:/dest/` | Copy a file to a server |
| `rsync -avh --progress source/ user@host:/dest/` | Sync folders, resumable if the connection drops |
