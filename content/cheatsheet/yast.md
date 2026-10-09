---
title: "YaST"
description: "Contekan modul YaST yang sering dipakai, dari terminal maupun GUI."
date: 2026-10-09
weight: 50
tags: ["openSUSE", "YaST"]
---

YaST adalah alat administrasi khas openSUSE. Kelebihannya: hampir semua modulnya bisa dibuka di terminal (ncurses), jadi tetap enak dipakai lewat SSH.

> Di Leap 16, YaST tidak lagi disertakan. openSUSE beralih ke **Cockpit** untuk administrasi lewat browser dan **Agama** sebagai installer. Contekan ini berlaku untuk Tumbleweed dan Leap 15.x.

## Dasar

| Perintah | Fungsi |
|---|---|
| `sudo yast` | Pusat kontrol YaST versi teks |
| `sudo yast2` | Pusat kontrol versi GUI (kalau ada desktop) |
| `yast -l` | Daftar semua modul yang terpasang |
| `sudo yast nama_modul` | Langsung buka modul tertentu |

Di mode teks, pindah antar-elemen pakai `Tab`, pilih pakai `Enter` atau `Spasi`, dan tombol fungsi seperti `F10` (OK) atau `F9` (keluar). Kalau `F` key ditangkap terminal, pakai `Alt` + huruf yang disorot.

## Modul yang sering dipakai

| Modul | Fungsi |
|---|---|
| `sudo yast sw_single` | Cari, pasang, dan hapus paket |
| `sudo yast online_update` | Pasang patch (Leap) |
| `sudo yast repositories` | Kelola repositori |
| `sudo yast lan` | Pengaturan jaringan (wicked) |
| `sudo yast firewall` | Pengaturan firewalld |
| `sudo yast users` | Kelola user dan grup |
| `sudo yast bootloader` | Pengaturan GRUB dan parameter kernel |
| `sudo yast services-manager` | Aktif/nonaktifkan service systemd |
| `sudo yast timezone` | Zona waktu |
| `sudo yast disk` | Partisi dan Btrfs (Expert Partitioner) |
| `sudo yast snapper` | Lihat dan bandingkan snapshot |
| `sudo yast sysconfig` | Editor `/etc/sysconfig` |

## Cockpit sebagai alternatif

Kalau kamu lebih suka antarmuka web, terutama di Leap 16:

```bash
sudo zypper in cockpit
sudo systemctl enable --now cockpit.socket
sudo firewall-cmd --add-service=cockpit --permanent && sudo firewall-cmd --reload
```

Lalu buka `https://alamat-server:9090` dan login dengan user sistem.
