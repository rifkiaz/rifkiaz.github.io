---
title: "Zypper"
description: "Contekan zypper untuk mengelola paket dan repositori di openSUSE."
date: 2026-10-09
weight: 10
tags: ["openSUSE", "zypper"]
---

`zypper` adalah package manager bawaan openSUSE. Hampir semua perintahnya punya singkatan, jadi di tabel ini saya tulis keduanya. Perintah yang mengubah sistem perlu `sudo`.

## Update sistem

| Perintah | Fungsi |
|---|---|
| `zypper refresh` / `zypper ref` | Perbarui metadata semua repositori |
| `zypper dup` | Upgrade penuh. **Cara yang benar untuk Tumbleweed** |
| `zypper update` / `zypper up` | Update paket terpasang. Dipakai di Leap |
| `zypper patch` | Pasang patch resmi (Leap) |
| `zypper list-updates` / `zypper lu` | Lihat paket yang bisa di-update |
| `zypper list-patches` / `zypper lp` | Lihat patch yang tersedia |
| `zypper ps -s` | Lihat proses yang masih memakai file lama setelah update |
| `zypper needs-rebooting` | Cek apakah perlu reboot |

```bash
# Rutinitas update di Tumbleweed
sudo zypper ref && sudo zypper dup
```

## Cari dan pasang paket

| Perintah | Fungsi |
|---|---|
| `zypper search nama` / `zypper se nama` | Cari paket |
| `zypper se -i nama` | Cari di antara paket yang sudah terpasang |
| `zypper se --provides /usr/bin/dig` | Cari paket yang menyediakan file tertentu |
| `zypper info nama` / `zypper if nama` | Detail paket |
| `zypper install nama` / `zypper in nama` | Pasang paket |
| `zypper in ./paket.rpm` | Pasang file RPM lokal beserta dependensinya |
| `zypper in -t pattern devel_basis` | Pasang pattern (kumpulan paket) |
| `zypper remove nama` / `zypper rm nama` | Hapus paket |
| `zypper rm -u nama` | Hapus paket sekaligus dependensi yang tidak lagi dipakai |
| `zypper in -f nama` | Pasang ulang paket (force) |

## Repositori

| Perintah | Fungsi |
|---|---|
| `zypper repos -d` / `zypper lr -d` | Daftar repositori beserta URL |
| `zypper addrepo -f URL alias` / `zypper ar -f URL alias` | Tambah repo dengan auto-refresh |
| `zypper removerepo alias` / `zypper rr alias` | Hapus repo |
| `zypper modifyrepo -d alias` / `zypper mr -d alias` | Nonaktifkan repo |
| `zypper mr -e alias` | Aktifkan lagi repo |
| `zypper mr -p 90 alias` | Ubah prioritas (angka kecil = prioritas lebih tinggi) |
| `zypper dup --from alias` | Upgrade/ganti vendor paket dari repo tertentu |

Untuk memasang paket dari Open Build Service (OBS) dengan lebih mudah, coba `opi`:

```bash
sudo zypper in opi
opi nama-paket
```

## Kunci paket (lock)

| Perintah | Fungsi |
|---|---|
| `zypper addlock nama` / `zypper al nama` | Kunci paket supaya tidak di-update atau dihapus |
| `zypper locks` / `zypper ll` | Daftar lock |
| `zypper removelock nama` / `zypper rl nama` | Lepas lock |

## Perawatan

| Perintah | Fungsi |
|---|---|
| `zypper clean -a` | Bersihkan cache paket dan metadata |
| `zypper packages --orphaned` | Paket yang tidak lagi ada di repo mana pun |
| `zypper packages --unneeded` | Paket yang tidak dibutuhkan paket lain |
| `zypper verify` / `zypper ve` | Cek dan perbaiki dependensi yang rusak |
| `zypper -n in nama` | Mode non-interaktif, cocok untuk script |

## Upgrade versi Leap

```bash
# Contoh: naik ke Leap 15.6. Pastikan semua repo pakai variabel $releasever dulu.
sudo zypper --releasever=15.6 ref
sudo zypper --releasever=15.6 dup
```

> Sebelum `dup`, pastikan snapper aktif supaya kamu bisa rollback kalau ada yang rusak. Lihat [cheat sheet Snapper dan Btrfs](/cheatsheet/snapper-btrfs/).
