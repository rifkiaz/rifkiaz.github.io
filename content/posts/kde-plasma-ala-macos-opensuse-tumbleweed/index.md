---
title: "KDE Plasma ala macOS di openSUSE Tumbleweed (Sekaligus Pensiunkan GNOME)"
date: 2026-10-08T23:48:00+07:00
categories: [tutorial]
tags: [openSUSE, tumbleweed, kde, plasma, macos, whitesur, sddm, gnome, bash]
description: "Skrip bash untuk mengubah KDE Plasma 6 di openSUSE Tumbleweed jadi mirip macOS dengan tema WhiteSur, pindah dari GDM ke SDDM, lalu menghapus GNOME dengan aman."
ShowToc: true
---
### Pendahuluan
Laptop saya awalnya pakai GNOME, lalu saya pasang KDE Plasma di atasnya. Setelah lama - lama betah di Plasma, ada dua hal yang saya mau: tampilannya dibuat mirip macOS (maklum belum kesampaian beli MacBook), dan GNOME dibersihkan supaya gak ada dua desktop yang makan tempat dan bikin bingung waktu update.

Supaya bisa diulang di mesin lain, semuanya saya bungkus jadi satu skrip: **[kde-macos.sh](assets/kde-macos.sh)**. Skrip ini sudah lolos `bash -n` dan `shellcheck`.

### Kebutuhan
- openSUSE Tumbleweed dengan KDE Plasma 6
- Koneksi internet (untuk unduh tema WhiteSur)
- Akses `sudo`

### Tahapan
1. Unduh skripnya lalu beri izin eksekusi
```
chmod +x kde-macos.sh
```
2. Jalankan sebagai **user biasa** (bukan root) dari dalam sesi Plasma. Bagian yang butuh root sudah pakai `sudo` di dalam skrip.
```
./kde-macos.sh all                 # varian gelap (default)
VARIANT=light ./kde-macos.sh all   # varian terang
```

Mode `all` menjalankan langkah - langkah ini secara berurutan:
- **Backup** konfigurasi KDE (`kdeglobals`, `kwinrc`, layout panel, GTK, Kvantum) ke `~/kde-macos-backup/`. Perintah restore-nya juga dicetak di terminal.
- **SDDM** dipasang dan diaktifkan menggantikan GDM. Tumbleweed sekarang punya dua cara mengatur display manager: `sddm.service` sendiri (hasil *Display Manager Rework*) dan cara lama lewat `update-alternatives`. Skrip ini menangani keduanya.
- **Aplikasi pengganti** dipasang: Dolphin, Konsole, Kate, Okular, Gwenview, Ark, dll, supaya gak kehilangan file manager dan terminal setelah aplikasi GNOME dihapus.
- **Tema WhiteSur** dari [vinceliuice](https://github.com/vinceliuice/WhiteSur-kde) dipasang lengkap: global theme, Plasma style, dekorasi jendela, Kvantum, tema GTK dan libadwaita, ikon, kursor, layar login SDDM, plus font **Inter** sebagai pengganti San Francisco.
- **Tampilan ala macOS** diterapkan: tombol jendela di **kiri**, efek **Magic Lamp** (mirip Genie) waktu minimize plus blur, **panel atas** berisi menu aplikasi, menu global, system tray dan jam, serta **dock melayang** di tengah bawah.
- **GNOME dihapus**, dengan beberapa pengaman (dibahas di bawah).

Tiap langkah juga bisa dijalankan sendiri - sendiri:
```
./kde-macos.sh backup        # cadangkan konfigurasi
./kde-macos.sh dm            # pasang & aktifkan SDDM
./kde-macos.sh apps          # aplikasi KDE pengganti
./kde-macos.sh theme         # unduh & pasang WhiteSur
./kde-macos.sh sddm-theme    # pasang ulang tema login SDDM saja
./kde-macos.sh apply         # terapkan tema, tombol, font, efek
./kde-macos.sh layout        # susun ulang panel atas + dock
./kde-macos.sh remove-gnome  # hapus GNOME
```

### Cara Skrip Menerapkan Tema
Semua diatur lewat tool bawaan Plasma 6, jadi gak ada edit file konfigurasi manual yang gampang rusak:
- `plasma-apply-lookandfeel`, `plasma-apply-colorscheme`, `plasma-apply-desktoptheme` dan `plasma-apply-cursortheme` untuk tema.
- `kwriteconfig6` untuk tombol jendela (`ButtonsOnLeft=XIA`), efek KWin, font dan gaya aplikasi.
- Panel dan dock dibuat dengan skrip JavaScript Plasma yang dikirim lewat `qdbus6 ... evaluateScript`. Aplikasi yang disematkan di dock cuma yang memang terpasang.

WhiteSur punya banyak varian (alt, opaque, sharp, dll). Fungsi `pick_variant` di skrip memilih varian paling dasar sesuai `VARIANT=dark` atau `light`.

### Menghapus GNOME dengan Aman
Bagian ini yang paling berisiko, jadi skripnya sengaja dibuat hati - hati:
1. **Ditunda kalau sesi masih lewat GDM.** Kalau login lewat GDM, menghapus GDM di tengah jalan bisa mematikan sesi waktu zypper masih jalan. Skrip akan menolak dan menyuruh reboot dulu, login lewat SDDM, baru jalankan `./kde-macos.sh remove-gnome`.
2. **Tanpa `zypper -n`.** Pattern dan paket inti GNOME dihapus pakai `zypper rm` biasa, jadi zypper menampilkan daftar lengkap (termasuk dependensi yang ikut terhapus) dan minta konfirmasi. **Baca daftarnya dulu sebelum jawab `y`**. Kalau ada paket Plasma atau KDE yang ikut tercantum, jawab `n`.
3. **Aplikasi bawaan GNOME ditanyakan terpisah**, jadi yang masih dipakai bisa disimpan.
4. **`gnome-keyring` dipertahankan**, karena Chrome dan VS Code masih pakai itu untuk menyimpan kredensial lewat libsecret.
5. Setelah itu GNOME **dikunci** dengan `zypper al`, supaya gak terpasang lagi diam - diam waktu `zypper dup`. Daftar kuncinya bisa dilihat dengan `zypper ll` dan dilepas dengan `sudo zypper rl <nama>`.

### Kendala di Run Pertama
Run pertama sebagian besar berhasil, tapi ada tiga hal yang gagal. Ketiganya sudah diperbaiki di skrip di atas, dan penyebabnya lumayan menarik untuk dicatat.

#### 1. Tema SDDM gagal terpasang
Installer SDDM bawaan WhiteSur menentukan versi tema dari output `plasmashell -v`. Karena installer itu dijalankan pakai `sudo`, gak ada display yang bisa diakses, `plasmashell` gagal (muncul pesan `qt.qpa.xcb` di log), dan nama folder sumbernya jadi kosong: `WhiteSur-`. Solusinya skrip memasang tema SDDM sendiri: versi Plasma dibaca sebagai user biasa (dengan fallback ke `rpm -q plasma6-workspace`), lalu dicocokkan ke folder yang sesuai. Untuk Plasma 6.2 ke atas dipakai `WhiteSur-6.2`.

#### 2. Kvantum terpasang versi terang padahal pilih gelap
Ternyata varian gelap Kvantum WhiteSur bukan folder terpisah, tapi file `WhiteSurDark.kvconfig` di dalam folder `WhiteSur`. Skrip sekarang mencari file `.kvconfig`, bukan nama folder.

#### 3. "Font Inter tidak ditemukan" padahal sudah terpasang
Ini bug klasik bash (asli bikin garuk - garuk kepala). Pengecekan awalnya seperti ini:
```
fc-list | grep -qi 'Inter'
```
Dengan `set -o pipefail` aktif, `grep -q` langsung berhenti begitu ketemu baris pertama yang cocok, `fc-list` yang masih menulis output kena **SIGPIPE** (exit 141), dan seluruh pipeline dianggap gagal. Perbaikannya: jangan pakai `-q`, buang output ke `/dev/null`, dan cocokkan nama family dengan lebih ketat:
```
fc-list : family | grep -iE '^Inter([ ,]|$)' >/dev/null
```

Setelah pakai skrip yang sudah diperbaiki, cukup jalankan ulang bagian yang gagal
```
./kde-macos.sh sddm-theme
./kde-macos.sh apply
```
Lalu reboot, login lewat SDDM yang sudah bertema WhiteSur, dan hapus GNOME
```
./kde-macos.sh remove-gnome
```
Voila, Plasma ala macOS sudah jadi.

### Pesan yang Boleh Diabaikan
- `plasma-systemmonitor` dilewati: nama paketnya di Tumbleweed beda. Skrip sekarang juga mencoba `plasma6-systemmonitor`.
- Modul menu global untuk aplikasi GTK gak ada di repo resmi. Efeknya cuma menu aplikasi GTK yang gak tampil di panel atas, apalagi di Wayland. Aplikasi KDE/Qt tetap normal.
- Installer tema GTK sempat memasang tema GNOME Shell karena GNOME masih terdeteksi. Tema itu gak berpengaruh ke KDE, dan akan ikut hilang bersama GNOME.

### Kalau Mau Kembali
Konfigurasi lama ada di `~/kde-macos-backup/`. Ekstrak dengan perintah berikut, lalu logout dan login lagi.
```
tar -C ~ -xzf <file-backup>
```

Sekian, semoga membantu.

Referensi:
- [WhiteSur KDE](https://github.com/vinceliuice/WhiteSur-kde)
- [openSUSE SDB: Change Display Manager](https://en.opensuse.org/SDB:Change_Display_Manager)
