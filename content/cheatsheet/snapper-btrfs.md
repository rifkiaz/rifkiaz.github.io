---
title: "Snapper dan Btrfs"
description: "Contekan snapshot, rollback, dan perawatan Btrfs di openSUSE."
date: 2026-10-09
weight: 20
tags: ["openSUSE", "snapper", "btrfs"]
---

Instalasi default openSUSE memakai Btrfs untuk root dan Snapper untuk snapshot. Setiap kali kamu menjalankan `zypper` atau YaST, snapshot *pre* dan *post* otomatis dibuat. Ini yang bikin rollback di openSUSE gampang banget.

## Snapshot

| Perintah | Fungsi |
|---|---|
| `snapper list` | Daftar snapshot |
| `snapper create -d "sebelum ganti kernel"` | Buat snapshot manual dengan deskripsi |
| `snapper status 10..12` | File apa saja yang berubah di antara dua snapshot |
| `snapper diff 10..12 /etc/hosts` | Diff isi file di antara dua snapshot |
| `snapper undochange 10..12 /etc/hosts` | Kembalikan file tertentu ke kondisi snapshot 10 |
| `snapper delete 15` | Hapus satu snapshot |
| `snapper delete 15-20` | Hapus rentang snapshot |

## Rollback sistem

Kalau setelah update sistem tidak bisa boot:

1. Di menu GRUB, pilih **Start bootloader from a read-only snapshot**.
2. Pilih snapshot sebelum update, lalu boot.
3. Setelah masuk dan semuanya normal, jadikan permanen:

```bash
sudo snapper rollback
sudo reboot
```

Kalau sistem masih bisa boot, kamu juga bisa langsung rollback ke nomor snapshot tertentu:

```bash
sudo snapper rollback 42
sudo reboot
```

## Konfigurasi

| Perintah | Fungsi |
|---|---|
| `snapper list-configs` | Daftar konfigurasi (biasanya cuma `root`) |
| `snapper -c home create-config /home` | Buat konfigurasi snapshot untuk `/home` (harus subvolume Btrfs) |
| `snapper -c home list` | Daftar snapshot untuk konfigurasi `home` |
| `snapper get-config` | Lihat isi konfigurasi `root` |

Konfigurasi ada di `/etc/snapper/configs/root`. Beberapa opsi yang sering diubah:

```ini
NUMBER_LIMIT="2-10"           # jumlah snapshot pre/post yang disimpan
NUMBER_LIMIT_IMPORTANT="4-10"
TIMELINE_CREATE="no"          # snapshot per jam; matikan kalau disk kecil
```

Pembersihan otomatis dijalankan oleh `snapper-cleanup.timer`. Cek dengan `systemctl status snapper-cleanup.timer`.

## Btrfs

| Perintah | Fungsi |
|---|---|
| `btrfs filesystem usage /` | Pemakaian disk yang akurat (lebih jujur daripada `df`) |
| `btrfs subvolume list /` | Daftar subvolume |
| `btrfs filesystem df /` | Ringkasan pemakaian per tipe (data, metadata) |
| `btrfs balance start -dusage=50 /` | Rapikan blok data yang terisi di bawah 50% |
| `btrfs scrub start /` | Cek integritas data di latar belakang |
| `btrfs scrub status /` | Lihat progres dan hasil scrub |
| `btrfs device stats /` | Statistik error perangkat |

Paket `btrfsmaintenance` menjalankan balance dan scrub secara terjadwal. Pengaturannya ada di `/etc/sysconfig/btrfsmaintenance`.

## Disk penuh gara-gara snapshot?

```bash
sudo snapper list                       # lihat snapshot lama
sudo snapper delete 100-150             # hapus yang tidak perlu
sudo btrfs balance start -dusage=50 /   # kembalikan ruang
sudo btrfs filesystem usage /
```
