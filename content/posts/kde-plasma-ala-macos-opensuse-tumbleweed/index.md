---
title: "KDE Plasma ala macOS di openSUSE Tumbleweed (Sekaligus Pensiunkan GNOME)"
date: 2026-10-08T23:48:00+07:00
categories: [tutorial]
tags: [openSUSE, tumbleweed, kde, plasma, macos, whitesur, sddm, gnome, bash]
description: "Skrip bash untuk mengubah KDE Plasma 6 di openSUSE Tumbleweed jadi mirip macOS dengan tema WhiteSur, pindah dari GDM ke SDDM, lalu menghapus GNOME dengan aman."
ShowToc: true
---

Laptop saya awalnya pakai GNOME, lalu saya pasang KDE Plasma di atasnya. Setelah betah di Plasma, saya mau dua hal: tampilannya dibuat mirip macOS, dan GNOME dibersihkan supaya nggak ada dua desktop yang makan tempat dan bikin bingung saat update.

Supaya bisa diulang di mesin lain, semuanya saya bungkus jadi satu skrip: **[kde-macos.sh](assets/kde-macos.sh)**. Skrip ini sudah lolos `bash -n` dan `shellcheck`.

## Isi skrip

Skrip dijalankan sebagai **user biasa** (bukan root) dari dalam sesi Plasma. Bagian yang butuh root memakai `sudo`.

```bash
chmod +x kde-macos.sh
./kde-macos.sh all                 # varian gelap (default)
VARIANT=light ./kde-macos.sh all   # varian terang
```

Mode `all` menjalankan langkah-langkah ini berurutan:

1. **Backup** konfigurasi KDE (`kdeglobals`, `kwinrc`, layout panel, GTK, Kvantum) ke `~/kde-macos-backup/`. Perintah restore-nya dicetak di terminal.
2. **SDDM** dipasang dan diaktifkan menggantikan GDM. Tumbleweed sekarang punya dua mekanisme display manager: `sddm.service` sendiri (hasil *Display Manager Rework*) dan cara lama lewat `update-alternatives`. Skrip menangani keduanya.
3. **Aplikasi pengganti** dipasang: Dolphin, Konsole, Kate, Okular, Gwenview, Ark, dan lainnya, supaya kamu nggak kehilangan file manager dan terminal setelah aplikasi GNOME dihapus.
4. **Tema WhiteSur** dari [vinceliuice](https://github.com/vinceliuice/WhiteSur-kde) dipasang lengkap: global theme, Plasma style, dekorasi jendela, Kvantum, tema GTK dan libadwaita, ikon, kursor, layar login SDDM, plus font **Inter** sebagai pengganti San Francisco.
5. **Tampilan ala macOS** diterapkan:
   - tombol jendela di **kiri** (tutup, minimize, maximize)
   - efek **Magic Lamp** (mirip Genie) saat minimize, plus blur
   - **panel atas** berisi menu aplikasi, menu global, system tray, dan jam
   - **dock melayang** di tengah bawah yang menghindar saat tertutup jendela
6. **GNOME dihapus**, dengan pengaman (dibahas di bawah).

Tiap langkah juga bisa dijalankan sendiri:

```bash
./kde-macos.sh backup        # cadangkan konfigurasi
./kde-macos.sh dm            # pasang & aktifkan SDDM
./kde-macos.sh apps          # aplikasi KDE pengganti
./kde-macos.sh theme         # unduh & pasang WhiteSur
./kde-macos.sh sddm-theme    # pasang ulang tema login SDDM saja
./kde-macos.sh apply         # terapkan tema, tombol, font, efek
./kde-macos.sh layout        # susun ulang panel atas + dock
./kde-macos.sh remove-gnome  # hapus GNOME
```

## Cara skrip menerapkan tema

Semua diatur lewat tool bawaan Plasma 6, jadi nggak ada edit file konfigurasi yang rapuh:

- `plasma-apply-lookandfeel`, `plasma-apply-colorscheme`, `plasma-apply-desktoptheme`, dan `plasma-apply-cursortheme` untuk tema.
- `kwriteconfig6` untuk tombol jendela (`ButtonsOnLeft=XIA`), efek KWin, font, dan gaya aplikasi.
- Panel dan dock dibuat dengan skrip JavaScript Plasma yang dikirim lewat `qdbus6 ... evaluateScript`. Aplikasi yang disematkan di dock hanya yang memang terpasang.

WhiteSur punya banyak varian (alt, opaque, sharp, dan seterusnya). Fungsi `pick_variant` di skrip memilih varian paling dasar sesuai `VARIANT=dark` atau `light`.

## Menghapus GNOME dengan aman

Bagian ini yang paling berisiko, jadi skripnya sengaja hati-hati:

- **Ditunda kalau sesi masih lewat GDM.** Kalau kamu login lewat GDM, menghapus GDM di tengah jalan bisa mematikan sesi saat zypper masih bekerja. Skrip menolak dan menyuruh reboot dulu, login lewat SDDM, baru jalankan `./kde-macos.sh remove-gnome`.
- **Tanpa `zypper -n`.** Pattern dan paket inti GNOME dihapus dengan `zypper rm` biasa, jadi zypper menampilkan daftar lengkap (termasuk dependensi yang ikut terhapus) dan minta konfirmasi. **Baca daftarnya sebelum menjawab `y`**. Kalau ada paket Plasma atau KDE ikut tercantum, jawab `n`.
- **Aplikasi bawaan GNOME ditanyakan terpisah**, jadi kamu bisa menyimpan yang masih dipakai.
- **`gnome-keyring` dipertahankan**, karena Chrome dan VS Code masih memakainya untuk menyimpan kredensial lewat libsecret.
- Setelah itu GNOME **dikunci** dengan `zypper al`, supaya nggak terpasang lagi diam-diam saat `zypper dup`. Daftar kuncinya bisa dilihat dengan `zypper ll` dan dilepas dengan `sudo zypper rl <nama>`.

## Masalah yang saya temui di run pertama

Run pertama sebagian besar berhasil, tapi ada tiga hal yang gagal. Ketiganya sudah diperbaiki di skrip yang ada di atas, dan penyebabnya cukup menarik untuk dicatat.

**1. Tema SDDM gagal terpasang.** Installer SDDM bawaan WhiteSur menentukan versi tema dari output `plasmashell -v`. Karena installer itu dijalankan dengan `sudo`, nggak ada display yang bisa diakses, `plasmashell` gagal (muncul pesan `qt.qpa.xcb` di log), dan nama folder sumber jadi kosong: `WhiteSur-`. Solusinya, skrip memasang tema SDDM sendiri: versi Plasma dibaca sebagai user biasa (dengan fallback ke `rpm -q plasma6-workspace`), lalu dipetakan ke folder yang sesuai. Untuk Plasma 6.2 ke atas dipakai `WhiteSur-6.2`.

**2. Kvantum terpasang versi terang padahal pilih gelap.** Ternyata varian gelap Kvantum WhiteSur bukan folder terpisah, melainkan file `WhiteSurDark.kvconfig` di dalam folder `WhiteSur`. Skrip sekarang mencari file `.kvconfig`, bukan nama folder.

**3. "Font Inter tidak ditemukan" padahal sudah terpasang.** Ini bug klasik bash. Pengecekan awalnya:

```bash
fc-list | grep -qi 'Inter'
```

Dengan `set -o pipefail` aktif, `grep -q` berhenti begitu menemukan baris pertama yang cocok, `fc-list` yang masih menulis output kena **SIGPIPE** (exit 141), dan seluruh pipeline dianggap gagal. Perbaikannya: jangan pakai `-q`, buang output ke `/dev/null`, dan cocokkan nama family dengan lebih ketat:

```bash
fc-list : family | grep -iE '^Inter([ ,]|$)' >/dev/null
```

Setelah memakai versi yang sudah diperbaiki, cukup jalankan ulang bagian yang gagal:

```bash
./kde-macos.sh sddm-theme
./kde-macos.sh apply
```

Lalu reboot, login lewat SDDM yang sudah bertema WhiteSur, dan hapus GNOME:

```bash
./kde-macos.sh remove-gnome
```

## Pesan yang boleh diabaikan

- `plasma-systemmonitor` dilewati: nama paketnya di Tumbleweed berbeda. Skrip sekarang juga mencoba `plasma6-systemmonitor`.
- Modul menu global untuk aplikasi GTK tidak ada di repo resmi. Efeknya cuma menu aplikasi GTK yang nggak tampil di panel atas, apalagi di Wayland. Aplikasi KDE/Qt tetap normal.
- Installer tema GTK sempat memasang tema GNOME Shell karena GNOME masih terdeteksi. Tema itu nggak berpengaruh ke KDE, dan akan ikut hilang bersama GNOME.

## Kalau mau kembali

Konfigurasi lama ada di `~/kde-macos-backup/`. Ekstrak dengan `tar -C ~ -xzf <file-backup>`, lalu logout dan login lagi.

Referensi:

- [WhiteSur KDE](https://github.com/vinceliuice/WhiteSur-kde)
- [openSUSE SDB: Change Display Manager](https://en.opensuse.org/SDB:Change_Display_Manager)
