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

## Mirror lokal Indonesia

Komunitas openSUSE Indonesia ([opensuse.id](https://opensuse.id)) mengelola mirror repositori lokal di [download.opensuse.id](https://download.opensuse.id). Kalau kamu di Indonesia, mengambil paket dari sini biasanya jauh lebih cepat daripada server luar.

Struktur foldernya sama dengan server resmi download.opensuse.org: ada `distribution`, `tumbleweed`, `slowroll`, `update`, dan `repositories` (repo OBS), ditambah `packman`. Jadi cara paling gampang adalah mengganti host di file repo yang sudah ada:

```bash
# Cadangkan dulu konfigurasi repo
sudo cp -a /etc/zypp/repos.d /etc/zypp/repos.d.bak

# Lihat URL repo yang aktif sekarang
zypper lr -u

# Ganti host download.opensuse.org ke mirror lokal
sudo sed -i 's|download.opensuse.org|download.opensuse.id|g' /etc/zypp/repos.d/*.repo

# Pastikan semua repo bisa di-refresh
sudo zypper ref
```

Kalau ada repo yang gagal di-refresh, kemungkinan folder itu tidak ikut di-mirror. Kembalikan saja file repo-nya dari `/etc/zypp/repos.d.bak`.

Catatan: di instalasi yang lebih baru, repo bawaan kadang dikelola oleh paket `openSUSE-repos` dan URL-nya memakai `cdn.opensuse.org`. Kalau `zypper lr -u` menunjukkan itu, hasil `sed` di atas bisa tertimpa lagi saat repo di-refresh. Untuk kasus ini, tambahkan repo mirror secara manual, misalnya untuk Tumbleweed:

```bash
sudo zypper ar -f https://download.opensuse.id/tumbleweed/repo/oss/ id-oss
sudo zypper ar -f https://download.opensuse.id/tumbleweed/repo/non-oss/ id-non-oss
sudo zypper ref
```

Mirror ini juga menyediakan **Packman** (codec multimedia dan paket yang tidak ada di repo resmi). Buka folder [packman](https://download.opensuse.id/packman/) untuk mencari path yang sesuai dengan versi openSUSE-mu, lalu tambahkan dengan prioritas lebih tinggi:

```bash
sudo zypper ar -cfp 90 https://download.opensuse.id/packman/<path-sesuai-versi>/ packman
sudo zypper dup --from packman --allow-vendor-change
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

{{< telegram-opensuse >}}
