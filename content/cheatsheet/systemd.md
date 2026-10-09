---
title: "systemd dan journalctl"
description: "Contekan mengelola service, log, dan pengaturan dasar sistem dengan systemd."
date: 2026-10-09
weight: 30
tags: ["openSUSE", "systemd", "Linux"]
---

openSUSE memakai systemd, jadi contekan ini juga berlaku di hampir semua distro modern.

## Service

| Perintah | Fungsi |
|---|---|
| `systemctl status sshd` | Status service beserta potongan log terakhir |
| `systemctl start sshd` | Jalankan service |
| `systemctl stop sshd` | Hentikan service |
| `systemctl restart sshd` | Restart service |
| `systemctl reload sshd` | Muat ulang konfigurasi tanpa restart (kalau didukung) |
| `systemctl enable --now sshd` | Aktifkan saat boot sekaligus jalankan sekarang |
| `systemctl disable --now sshd` | Matikan saat boot sekaligus hentikan |
| `systemctl mask nama` | Blokir service supaya tidak bisa dijalankan sama sekali |
| `systemctl is-active sshd` | Cek cepat, cocok untuk script |
| `systemctl is-enabled sshd` | Cek apakah aktif saat boot |

## Melihat dan mengubah unit

| Perintah | Fungsi |
|---|---|
| `systemctl list-units --type=service` | Service yang sedang dimuat |
| `systemctl --failed` | Unit yang gagal |
| `systemctl list-unit-files --state=enabled` | Unit yang aktif saat boot |
| `systemctl list-timers` | Daftar timer (pengganti cron) |
| `systemctl cat sshd` | Lihat isi file unit |
| `systemctl edit sshd` | Buat override tanpa mengubah file aslinya |
| `systemctl daemon-reload` | Muat ulang unit setelah mengubah file secara manual |

## Log dengan journalctl

| Perintah | Fungsi |
|---|---|
| `journalctl -u sshd` | Log satu service |
| `journalctl -u sshd -f` | Ikuti log secara live |
| `journalctl -b` | Log sejak boot terakhir |
| `journalctl -b -1` | Log boot sebelumnya, berguna setelah crash |
| `journalctl -p err -b` | Hanya error ke atas sejak boot |
| `journalctl --since "1 hour ago"` | Log satu jam terakhir |
| `journalctl -k` | Log kernel (seperti `dmesg`) |
| `journalctl --disk-usage` | Ukuran journal di disk |
| `journalctl --vacuum-time=2weeks` | Hapus log yang lebih lama dari dua minggu |

## Pengaturan sistem

| Perintah | Fungsi |
|---|---|
| `hostnamectl set-hostname nama-host` | Ganti hostname |
| `timedatectl set-timezone Asia/Jakarta` | Ganti zona waktu |
| `timedatectl` | Cek waktu dan status sinkronisasi NTP |
| `localectl set-keymap us` | Ganti layout keyboard di konsol |
| `systemctl reboot` / `systemctl poweroff` | Reboot / matikan |

## Diagnosis boot

| Perintah | Fungsi |
|---|---|
| `systemd-analyze` | Total waktu boot |
| `systemd-analyze blame` | Service yang paling lama saat boot |
| `systemd-analyze critical-chain` | Rantai service yang memperlambat boot |

## Contoh override

Misalnya kamu ingin service otomatis restart kalau mati:

```bash
sudo systemctl edit nama-service
```

```ini
[Service]
Restart=on-failure
RestartSec=5
```

Simpan, lalu `sudo systemctl restart nama-service`. Override disimpan di `/etc/systemd/system/nama-service.service.d/override.conf`, jadi aman dari update paket.
