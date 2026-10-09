---
title: "Proyek"
description: "Ringkasan proyek infrastruktur dan otomasi yang pernah saya kerjakan."
url: "/proyek/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
---

Beberapa proyek infrastruktur dan otomasi yang pernah saya kerjakan. Detail yang spesifik ke organisasi sengaja tidak disertakan; yang saya tulis adalah pendekatan dan pelajarannya.

## Otomasi MongoDB Replica Set dengan Ansible

Role Ansible untuk memasang MongoDB replica set tiga node dengan keyfile, autentikasi aktif, dan inisialisasi yang idempoten. Rahasia dikelola dengan Ansible Vault.

**Stack:** Ansible, MongoDB, Ansible Vault, Ubuntu · [Baca tulisannya →](/posts/ansible-mongodb-replica-set/)

## Deploy Prometheus Exporter dengan Ansible

Role Ansible untuk memasang exporter Prometheus sebagai service systemd yang di-hardening, dengan verifikasi checksum dan daftar target scrape yang dibuat otomatis dari inventory.

**Stack:** Ansible, Prometheus, node_exporter, systemd · [Baca tulisannya →](/posts/ansible-prometheus-exporter/)

## Automation Tools Internal

Merapikan kumpulan script operasional menjadi satu CLI internal dengan subcommand, mode dry-run, output JSON, dan exit code yang konsisten supaya aman dipakai tim dan mudah dirangkai di pipeline.

**Stack:** Python, CLI, CI · [Baca tulisannya →](/posts/automation-tools-internal/)

## Layanan Paste Internal

Pastebin internal untuk tim teknis sebagai pengganti pastebin publik: enkripsi di sisi klien, expiry, burn after reading, di belakang reverse proxy dengan autentikasi.

**Stack:** Docker, Nginx, PrivateBin · [Baca tulisannya →](/posts/paste-internal-yang-aman/)

---

Tertarik berdiskusi soal proyek serupa? Hubungi saya lewat [GitHub](https://github.com/rifkiaz) atau [X/Twitter](https://x.com/rifkiiaz).
