---
title: "Projects"
description: "A summary of infrastructure and automation projects I've worked on."
url: "/en/projects/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
---

Here are some of the infrastructure, automation, and Linux desktop projects I've worked on. Workplace-specific details are left out on purpose. What I write about is the approach and the lessons learned.

## Skema (ddl-drawing)

An open source database design tool in the spirit of dbdiagram.io, except it handles SQL tables and MongoDB collections (including nested objects and arrays of objects) in one diagram. Edit through code or directly on the canvas, then export to PostgreSQL/MySQL DDL, a MongoDB `$jsonSchema` validator, PNG, and SVG.

**Stack:** TypeScript, React, CodeMirror, React Flow, ELK.js, Vercel · [Read the write-up →](/en/posts/skema-database-design-sql-mongodb/)

## PhoneShare

A desktop app (Windows and Linux) plus an Android app for sending files and folders both ways over Wi-Fi: the phone is detected automatically, pairing uses a PIN, transfers run in parallel, they resume when Wi-Fi drops, and identical files are skipped when you send again.

**Stack:** .NET 8, Avalonia, Android, GitHub Actions · [Read the write-up →](/en/posts/phoneshare-send-files-pc-android/)

## macOS Battery for KDE Plasma 6

A macOS-style battery widget for KDE Plasma 6, pure QML: the percentage inside, left, or right of the battery, adjustable size, a lightning icon while charging, and a popup with other devices' batteries. Released as a `.plasmoid` through GitHub Actions.

**Stack:** QML, KDE Plasma 6, GitHub Actions · [Read the write-up →](/en/posts/macos-battery-widget-kde-plasma-6/)

## Single-Node ClickHouse with Ansible

An Ansible role that installs ClickHouse LTS on EC2 Ubuntu 24.04: a separate EBS volume for data that's safe to re-run, OS tuning, config through overrides that are validated before restarting, users from Ansible Vault, and monitoring in Grafana.

**Stack:** Ansible, ClickHouse, AWS EC2/EBS, Ansible Vault, Grafana · [Read the write-up →](/en/posts/ansible-clickhouse-single-node/)

## Elasticsearch Cluster in Docker with Ansible

An Ansible role that builds a three-node, container-based Elasticsearch cluster: host kernel tuning, TLS between nodes with its own CA, passwords from Ansible Vault, a cluster bootstrap that's safe to re-run, and rolling upgrades one node at a time.

**Stack:** Ansible, Elasticsearch, Docker, Ansible Vault · [Read the write-up →](/en/posts/ansible-elasticsearch-cluster-docker/)

## Automating a MongoDB Replica Set with Ansible

An Ansible role that installs a three-node MongoDB replica set with a keyfile, authentication turned on, and idempotent initialization. Secrets are managed with Ansible Vault.

**Stack:** Ansible, MongoDB, Ansible Vault, Ubuntu · [Read the write-up →](/en/posts/ansible-mongodb-replica-set/)

## Deploying Prometheus Exporters with Ansible

An Ansible role that installs Prometheus exporters as hardened systemd services, with checksum verification and a scrape target list generated automatically from the inventory.

**Stack:** Ansible, Prometheus, node_exporter, systemd · [Read the write-up →](/en/posts/ansible-prometheus-exporter/)

## Internal Automation Tools

Turning a pile of ops scripts into one internal CLI with subcommands, a dry-run mode, JSON output, and consistent exit codes, so it's safe for the team to use and easy to chain in pipelines.

**Stack:** Python, CLI, CI · [Read the write-up →](/en/posts/internal-automation-tools/)

## Internal Paste Service

An internal pastebin for technical teams instead of public pastebins: client-side encryption, expiry, burn after reading, behind a reverse proxy with authentication.

**Stack:** Docker, Nginx, PrivateBin · [Read the write-up →](/en/posts/secure-internal-paste-service/)

---

Want to talk about a similar project? Say hi on [GitHub](https://github.com/rifkiaz) or [X/Twitter](https://x.com/rifkiiaz).
