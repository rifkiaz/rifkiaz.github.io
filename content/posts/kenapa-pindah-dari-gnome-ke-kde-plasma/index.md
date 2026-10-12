---
title: "Kenapa Saya Pindah dari GNOME ke KDE Plasma (dan Kenapa Kamu Perlu Coba)"
date: 2026-10-10T21:15:00+07:00
categories: [opini]
tags: [openSUSE, tumbleweed, kde, plasma, gnome, desktop, linux]
description: "Lanjutan dari post KDE Plasma ala macOS: kelebihan KDE Plasma 6 dibanding GNOME dari pengalaman sehari-hari, plus kapan GNOME masih jadi pilihan yang lebih pas."
series: ["Pindah dari GNOME ke KDE"]
ShowToc: true
---
### Pendahuluan
Di post sebelumnya, [KDE Plasma ala macOS di openSUSE Tumbleweed](/posts/kde-plasma-ala-macos-opensuse-tumbleweed/), saya bahas cara merombak tampilan Plasma jadi mirip macOS sekalian menghapus GNOME. Tapi di sana saya belum cerita **kenapa** akhirnya pindah. Padahal saya lumayan lama pakai GNOME, bahkan pernah datang ke [GNOME.Asia Summit](/posts/gnomeasia/) (jadi ini bukan karena benci GNOME ya).

Jadi di post ini saya rangkum hal - hal yang bikin saya betah di KDE Plasma 6. Siapa tahu kamu yang masih di GNOME jadi tertarik untuk coba.

### 1. Hal Dasar Langsung Ada, Tanpa Extension
Ini alasan nomor satu. Di GNOME, banyak hal yang menurut saya dasar justru harus pasang extension dulu:
- **Icon tray** (Discord, Telegram, Nextcloud, dll) gak tampil tanpa extension AppIndicator.
- **Tombol minimize dan maximize** gak ada secara default, cuma tombol close. Harus diaktifkan lewat GNOME Tweaks.
- **Icon di desktop** gak ada, perlu extension juga.
- **Riwayat clipboard** gak ada.

Di Plasma semuanya sudah ada dari awal. System tray jalan, tombol jendela lengkap, desktop bisa diisi file, dan riwayat clipboard sudah ditangani **Klipper** (klik icon clipboard di tray atau `Meta+V`).

Masalah extension di GNOME itu bukan cuma repot pasangnya. Tiap GNOME naik versi mayor, extension sering belum kompatibel dan otomatis dinonaktifkan. Di Tumbleweed yang rolling release, ini lumayan sering kejadian (asli bikin kesel waktu habis `zypper dup` tray icon tiba - tiba hilang semua).

### 2. Hampir Semua Bisa Diatur dari System Settings
GNOME punya filosofi minimalis, jadi pengaturannya sengaja dibuat sedikit. Sisanya ada di GNOME Tweaks atau malah harus lewat `gsettings`/`dconf`.

Di Plasma, hampir semua ada di **System Settings**: tema, font, animasi, shortcut, perilaku jendela, sampai efek desktop. Ada kolom pencarian juga, jadi cukup ketik misalnya `shortcut` atau `font`.

Contoh yang paling sering saya pakai:
- **Panel** bisa dipindah ke atas, bawah, kiri, kanan, dibuat melayang, atau ditambah panel kedua jadi dock. Ini yang saya pakai di post macOS kemarin.
- **Shortcut** bisa diganti untuk hampir semua aksi, termasuk menjalankan perintah sendiri.
- **Window Rules**: klik kanan title bar > More Actions > Configure Special Window Settings. Misalnya terminal selalu buka di monitor kedua dengan ukuran tertentu, atau aplikasi chat selalu di virtual desktop 2.

### 3. Aplikasi KDE yang Bikin Kerja Lebih Cepat
Ini yang jarang dibahas, padahal justru di sini Plasma terasa beda.

**Dolphin** (file manager)
- `F3` untuk split view, dua folder berdampingan. Mindahin file jadi gampang banget.
- `F4` untuk panel terminal di bawah, otomatis pindah ke folder yang sedang dibuka.
- Bisa buka folder di server lewat `sftp://user@host/path` langsung dari address bar.

**Konsole** (terminal)
- Tab dan split terminal tanpa perlu tmux.
- Profile berbeda untuk tiap kebutuhan, misalnya warna merah untuk sesi ke server production (biar gak salah ketik di tempat yang salah).

**Spectacle** (screenshot)
- Ambil screenshot area, jendela, atau layar penuh, lalu langsung kasih **anotasi** (panah, kotak, teks, blur). Buat bikin dokumentasi atau lapor bug ke tim, ini sangat membantu. Tool screenshot bawaan GNOME belum punya fitur anotasi.
- Bisa rekam layar juga.

**KRunner**
- Tekan `Alt+Space`, lalu ketik apa saja: buka aplikasi, cari file, hitung `2^10`, konversi `10 km to mi`, atau jalankan perintah. Mirip Spotlight di macOS.

**KDE Connect**
- Hubungkan HP Android ke laptop: notifikasi HP muncul di desktop, kirim file dua arah, clipboard bersama, sampai jadikan HP sebagai remote presentasi. GNOME sebenarnya bisa juga lewat GSConnect, tapi itu (lagi - lagi) extension.

### 4. Tampilan Bebas Diubah
GNOME sekarang cenderung membatasi tema, terutama untuk aplikasi libadwaita. Di Plasma, mengganti tampilan itu fitur resmi. Global Theme, Plasma Style, dekorasi jendela, icon, kursor, sampai layar login SDDM bisa diganti dari System Settings, dan ada tombol **Get New...** untuk unduh tema dari store KDE.

Hasilnya bisa dilihat di post sebelumnya: Plasma bisa dibuat mirip macOS. Mau mirip Windows juga bisa, atau tetap pakai tema bawaan **Breeze** yang menurut saya sudah rapi.

### 5. Workflow ala GNOME Juga Ada
Banyak yang betah di GNOME karena Activities Overview dan gesture touchpad-nya. Kabar baiknya, Plasma 6 punya juga:
- **Overview** (`Meta+W`) menampilkan semua jendela dan virtual desktop, plus pencarian.
- **Gesture touchpad**: usap empat jari ke atas untuk Overview, ke kiri atau kanan untuk pindah virtual desktop.

Jadi kalau sudah terbiasa dengan cara kerja GNOME, pindah ke Plasma gak harus mulai dari nol.

### 6. Gak Seberat Anggapan Orang
Dulu KDE terkenal berat. Sekarang, dari pengalaman saya pemakaian harian Plasma 6 terasa ringan dan gak beda jauh dengan GNOME. Angka pastinya tergantung aplikasi apa saja yang jalan di belakang, jadi ini catatan pengalaman ya, bukan benchmark.

### Ringkasan
````
Fitur                         GNOME                      KDE Plasma 6
----------------------------  -------------------------  ---------------------------
Icon tray                     extension AppIndicator     bawaan
Tombol minimize / maximize    aktifkan lewat Tweaks      bawaan
Riwayat clipboard             extension                  bawaan (Klipper)
Pengaturan                    Settings + Tweaks + dconf  System Settings
Anotasi screenshot            belum ada                  bawaan (Spectacle)
Split view file manager       belum ada                  bawaan (Dolphin, F3)
Integrasi HP Android          GSConnect (extension)      KDE Connect
Ganti tema                    terbatas                   fitur resmi + Get New...
Overview + gesture            bawaan                     bawaan (Meta+W, 4 jari)
````

### Kapan GNOME Masih Lebih Pas?
Biar adil, GNOME juga punya kelebihan:
- **Konsisten dan rapi** dari awal. Kalau kamu gak suka mengatur - atur, GNOME sudah enak dipakai tanpa diapa - apakan.
- **Pilihan yang sedikit** justru bikin fokus. Di Plasma, saking banyaknya pengaturan kadang malah bingung sendiri.
- **Aplikasi GNOME** (libadwaita) tampilannya seragam dan modern.

Jadi kalau kamu suka desktop yang "langsung jadi" dan jarang ngoprek, GNOME tetap pilihan bagus. Tapi kalau kamu sering kesel karena harus pasang extension untuk hal - hal kecil, atau pengen desktop yang bisa diatur sesuai cara kerja sendiri, Plasma layak dicoba.

### Cara Coba Tanpa Menghapus GNOME
Di openSUSE Tumbleweed, Plasma bisa dipasang berdampingan dengan GNOME:
```
sudo zypper in -t pattern kde kde_plasma
```
Logout, lalu di layar login pilih sesi **Plasma (Wayland)**. Pakai saja beberapa hari. Kalau sudah yakin pindah, lanjut ke [post sebelumnya](/posts/kde-plasma-ala-macos-opensuse-tumbleweed/) untuk mengganti GDM ke SDDM dan menghapus GNOME dengan aman.

Sekian, semoga membantu.

Referensi:
- [KDE Plasma](https://kde.org/plasma-desktop/)
- [KDE Connect](https://kdeconnect.kde.org/)
- [GNOME Shell Extensions](https://extensions.gnome.org/)
- [openSUSE Wiki: KDE](https://en.opensuse.org/Portal:KDE)
