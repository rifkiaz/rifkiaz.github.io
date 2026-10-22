---
title: "Proyek"
description: "Ringkasan proyek infrastruktur dan otomasi yang pernah saya kerjakan."
url: "/proyek/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
---

Ini beberapa proyek infrastruktur, otomasi, dan desktop Linux yang pernah saya kerjakan. Detail yang spesifik ke kantor sengaja nggak saya sertakan. Yang saya tulis adalah pendekatan dan pelajarannya.

## Skema (ddl-drawing)

Alat open-source untuk mendesain database ala dbdiagram.io, tapi bisa tabel SQL dan koleksi MongoDB (termasuk objek bersarang dan array of object) dalam satu diagram. Edit lewat kode atau langsung di kanvas, lalu ekspor ke DDL PostgreSQL/MySQL, validator `$jsonSchema` MongoDB, PNG, dan SVG.

**Stack:** TypeScript, React, CodeMirror, React Flow, ELK.js, Vercel · [Baca tulisannya →](/posts/skema-desain-database-sql-nosql/)

## PhoneShare

Aplikasi desktop (Windows dan Linux) plus aplikasi Android untuk kirim file dan folder dua arah lewat Wi-Fi: HP terdeteksi otomatis, pairing pakai PIN, transfer paralel, resume saat Wi-Fi putus, dan file identik dilewati saat kirim ulang.

**Stack:** .NET 8, Avalonia, Android, GitHub Actions · [Baca tulisannya →](/posts/phoneshare-kirim-file-pc-android/)

## macOS Battery untuk KDE Plasma 6

Widget baterai bergaya macOS untuk KDE Plasma 6, murni QML: persentase di dalam, kiri, atau kanan baterai, ukuran yang bisa diatur, ikon petir saat dicas, dan popup berisi baterai perangkat lain. Dirilis sebagai `.plasmoid` lewat GitHub Actions.

**Stack:** QML, KDE Plasma 6, GitHub Actions · [Baca tulisannya →](/posts/widget-baterai-ala-macos-kde-plasma-6/)

## ClickHouse Single Node dengan Ansible

Role Ansible untuk memasang ClickHouse LTS di EC2 Ubuntu 24.04: EBS terpisah untuk data yang aman dijalankan ulang, tuning OS, konfigurasi lewat override yang divalidasi sebelum restart, user dari Ansible Vault, dan monitoring di Grafana.

**Stack:** Ansible, ClickHouse, AWS EC2/EBS, Ansible Vault, Grafana · [Baca tulisannya →](/posts/ansible-clickhouse-single-node/)

## Cluster Elasticsearch di Docker dengan Ansible

Role Ansible untuk membangun cluster Elasticsearch tiga node berbasis container: tuning kernel host, TLS antar-node dengan CA sendiri, password dari Ansible Vault, bootstrap cluster yang aman dijalankan ulang, dan rolling upgrade satu node per satu.

**Stack:** Ansible, Elasticsearch, Docker, Ansible Vault · [Baca tulisannya →](/posts/ansible-elasticsearch-cluster-docker/)

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

Mau ngobrol soal proyek serupa? Sapa saja saya lewat [GitHub](https://github.com/rifkiaz) atau [X/Twitter](https://x.com/rifkiiaz).
