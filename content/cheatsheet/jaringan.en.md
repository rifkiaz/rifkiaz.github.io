---
title: "Networking and Firewall"
description: "Cheat sheet for NetworkManager, wicked, firewalld, and basic networking commands on openSUSE."
date: 2026-10-09
weight: 40
slug: "networking"
tags: ["openSUSE", "networking", "firewalld"]
---

openSUSE has two network managers. Tumbleweed desktops and Leap 16 use **NetworkManager**, while Leap 15 servers usually use **wicked**. Check which one is active:

```bash
systemctl is-active NetworkManager wicked
```

> The example IPs below use the documentation range `192.0.2.0/24`. Replace them with addresses from your own network.

## Basic commands

| Command | What it does |
|---|---|
| `ip a` | List interfaces and IP addresses |
| `ip r` | Routing table |
| `ip -s link` | Packet stats per interface |
| `ss -tulpn` | Listening ports and their processes |
| `ping -c 4 opensuse.org` | Test connectivity |
| `tracepath opensuse.org` | Show the route to a destination |
| `dig opensuse.org` | Test DNS (`bind-utils` package) |
| `curl -I https://opensuse.org` | Check the HTTP response |

## NetworkManager (nmcli)

| Command | What it does |
|---|---|
| `nmcli device status` | Status of all devices |
| `nmcli connection show` | List saved connections |
| `nmcli connection up "name"` | Bring a connection up |
| `nmcli connection down "name"` | Bring a connection down |
| `nmcli device wifi list` | List nearby Wi-Fi networks |
| `nmcli device wifi connect SSID --ask` | Connect to Wi-Fi, prompting for the password |
| `nmtui` | A friendlier text interface |

Set a static IP:

```bash
sudo nmcli connection modify "Wired connection 1" \
  ipv4.method manual \
  ipv4.addresses 192.0.2.10/24 \
  ipv4.gateway 192.0.2.1 \
  ipv4.dns "1.1.1.1 9.9.9.9"
sudo nmcli connection up "Wired connection 1"
```

## wicked

| Command | What it does |
|---|---|
| `wicked show all` | Status of all interfaces |
| `wicked ifup eth0` | Bring an interface up |
| `wicked ifdown eth0` | Bring an interface down |
| `wicked ifreload all` | Apply config changes |

The config lives in `/etc/sysconfig/network/ifcfg-<interface>`. A static IP example:

```ini
BOOTPROTO='static'
STARTMODE='auto'
IPADDR='192.0.2.10/24'
```

The gateway is set in `/etc/sysconfig/network/routes`:

```text
default 192.0.2.1 - -
```

DNS on openSUSE is managed by `netconfig`, so don't edit `/etc/resolv.conf` directly. Set `NETCONFIG_DNS_STATIC_SERVERS` in `/etc/sysconfig/network/config`, then run `sudo netconfig update -f`.

## firewalld

| Command | What it does |
|---|---|
| `firewall-cmd --state` | Check the firewall is running |
| `firewall-cmd --get-active-zones` | Active zones and their interfaces |
| `firewall-cmd --list-all` | Rules in the default zone |
| `firewall-cmd --add-service=http --permanent` | Open a service permanently |
| `firewall-cmd --add-port=8080/tcp --permanent` | Open a specific port |
| `firewall-cmd --remove-service=http --permanent` | Close a service again |
| `firewall-cmd --reload` | Apply permanent rules |
| `firewall-cmd --get-services` | List known service names |

Rules without `--permanent` take effect immediately but disappear after a reload or reboot. The safe way: test without `--permanent` first, and once it's right run `firewall-cmd --runtime-to-permanent`.

{{< telegram-opensuse >}}
