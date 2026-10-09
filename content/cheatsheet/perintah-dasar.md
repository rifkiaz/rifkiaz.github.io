---
title: "Perintah Dasar Linux"
description: "Contekan perintah Linux sehari-hari: file, izin, proses, disk, dan arsip."
date: 2026-10-09
weight: 60
tags: ["Linux"]
---

Contekan umum yang berlaku di hampir semua distro, bukan cuma openSUSE.

## File dan direktori

| Perintah | Fungsi |
|---|---|
| `ls -lah` | Daftar file lengkap dengan ukuran yang mudah dibaca |
| `cd -` | Kembali ke direktori sebelumnya |
| `cp -a sumber tujuan` | Salin dengan mempertahankan izin dan timestamp |
| `mv lama baru` | Pindah atau ganti nama |
| `rm -ri folder` | Hapus folder dengan konfirmasi |
| `mkdir -p a/b/c` | Buat direktori bertingkat |
| `find /etc -name "*.conf" -mtime -1` | Cari file `.conf` yang berubah sehari terakhir |
| `grep -rn "teks" /etc` | Cari teks di dalam file secara rekursif |
| `tail -f /var/log/file.log` | Ikuti isi file log |
| `less file` | Baca file panjang (`/` untuk cari, `q` keluar) |

## Izin dan kepemilikan

| Perintah | Fungsi |
|---|---|
| `chmod 644 file` | rw untuk pemilik, r untuk lainnya |
| `chmod 755 skrip.sh` | Bisa dieksekusi semua, hanya pemilik yang bisa ubah |
| `chmod +x skrip.sh` | Tambah izin eksekusi |
| `chown user:grup file` | Ganti pemilik |
| `chown -R user:grup folder` | Ganti pemilik secara rekursif |
| `sudo -i` | Masuk shell root |
| `id` | Lihat UID, GID, dan grup user |

## Proses dan sumber daya

| Perintah | Fungsi |
|---|---|
| `htop` / `top` | Monitor proses interaktif |
| `ps aux \| grep nama` | Cari proses |
| `pgrep -a nama` | Cari PID beserta perintahnya |
| `kill PID` / `kill -9 PID` | Hentikan proses (halus / paksa) |
| `free -h` | Pemakaian RAM |
| `uptime` | Lama menyala dan load average |
| `lscpu` | Info CPU |

## Disk

| Perintah | Fungsi |
|---|---|
| `df -h` | Pemakaian per filesystem (di Btrfs, pakai `btrfs filesystem usage /`) |
| `du -sh *` | Ukuran tiap isi direktori |
| `du -h --max-depth=1 / \| sort -h` | Cari direktori yang paling besar |
| `lsblk -f` | Daftar disk, partisi, filesystem, dan UUID |
| `mount \| column -t` | Filesystem yang sedang di-mount |

## Arsip dan kompresi

| Perintah | Fungsi |
|---|---|
| `tar czf arsip.tar.gz folder/` | Buat arsip gzip |
| `tar xzf arsip.tar.gz` | Ekstrak arsip gzip |
| `tar tf arsip.tar.gz` | Lihat isi arsip tanpa ekstrak |
| `zstd -19 file` | Kompres dengan zstd |
| `unzip file.zip -d tujuan` | Ekstrak zip ke folder tertentu |

## Remote

| Perintah | Fungsi |
|---|---|
| `ssh user@host` | Login SSH |
| `ssh-keygen -t ed25519` | Buat SSH key baru |
| `ssh-copy-id user@host` | Pasang public key di server |
| `scp file user@host:/tujuan/` | Salin file ke server |
| `rsync -avh --progress sumber/ user@host:/tujuan/` | Sinkronisasi folder, bisa dilanjutkan kalau putus |
