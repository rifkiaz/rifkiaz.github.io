---
title: "Tampilan Desktop & Terminal ala macOS di KDE Plasma (Versi Manual)"
date: 2026-11-08T01:40:00+07:00
categories: [tutorial]
tags: [kde, plasma, macos, whitesur, openSUSE, tumbleweed, zsh, powerlevel10k, tilix, monokai]
series: ["Pindah dari GNOME ke KDE"]
description: "Panduan manual meniru desktop KDE Plasma 6 saya: tombol jendela di kiri ala macOS, panel atas dengan global menu, dock di bawah, plus terminal Tilix bertema Monokai dengan zsh dan Powerlevel10k."
ShowToc: true
---
### Pendahuluan
Beberapa waktu lalu saya sudah bikin skrip untuk merombak Plasma jadi mirip macOS, ceritanya ada di [KDE Plasma ala macOS di openSUSE Tumbleweed](/posts/kde-plasma-ala-macos-opensuse-tumbleweed/). Skrip itu enak buat sekali jalan, tapi lama - lama tampilan desktop saya berubah sedikit demi sedikit (namanya juga suka ngoprek). Beberapa kali juga ada yang tanya "itu terminalnya pakai apa?", jadi kali ini saya tulis versi **manualnya**, lengkap sampai gaya terminalnya.

Yang mau ditiru:
- Tombol jendela di **kiri** ala macOS
- **Panel atas** dengan global menu, seperti menu bar macOS
- **Dock** di bawah
- Prompt **zsh + Powerlevel10k** bertema **Monokai**

Kalau kamu lebih suka cara cepat, skrip di post sebelumnya tetap bisa dipakai. Post ini lebih cocok kalau mau tahu setiap pengaturannya ada di mana, atau mau ambil sebagian saja (misalnya cuma gaya terminalnya).

### Kebutuhan
- KDE Plasma 6. Saya tes di **openSUSE Tumbleweed** dengan **Plasma 6.8 (Wayland)**. Distro lain yang sudah Plasma 6 juga harusnya bisa, yang beda cuma nama paketnya.
- Koneksi internet untuk clone tema dan font
- Akses `sudo`

### Ringkasan
| Bagian | Yang dipakai |
|---|---|
| Plasma Style (panel) | **openSUSEdark** (bawaan openSUSE). Di distro lain pakai **Breeze Dark** |
| Warna aplikasi | Breeze Classic (terang) |
| Dekorasi jendela | **WhiteSur-dark** (Aurorae), tombol **close · minimize · maximize di kiri** |
| Ikon / kursor | Breeze / Breeze cursor 24 px |
| Font UI | **Inter** 10 pt (judul jendela: Inter SemiBold 10) |
| Font terminal | **MesloLGS NF** 11 pt |
| Efek | Magic Lamp (animasi minimize ala macOS) |
| Layar login (SDDM) | **WhiteSur-dark** |
| Terminal | **Tilix** + skema warna Monokai |
| Shell | **zsh** + **oh-my-zsh** + **Powerlevel10k** (gaya *lean*, 2 baris) |
| Wallpaper | Mobile Suit Gundam 3840×2160 (cari "mobile suit gundam 3840x2160" di situs wallpaper) |

Iya, panelnya gelap tapi warna aplikasinya terang. Kombinasi ini sengaja, jadi panel atas dan dock kelihatan seperti macOS mode gelap, tapi jendela aplikasi tetap terang dan enak dibaca siang - siang.

### 1. Instal Bahan - bahannya
#### Paket
```
# openSUSE
sudo zypper in git sassc inter-fonts tilix zsh kvantum-manager

# Fedora:        sudo dnf install git sassc rsms-inter-fonts tilix zsh kvantum
# Arch:          sudo pacman -S git sassc inter-font tilix zsh kvantum
# Debian/Ubuntu: sudo apt install git sassc fonts-inter tilix zsh qt6-style-kvantum
```

#### Tema WhiteSur
Tema dari [vinceliuice](https://github.com/vinceliuice/WhiteSur-kde) ini isinya dekorasi jendela, Plasma theme, SDDM, dan Kvantum.
```
git clone --depth=1 https://github.com/vinceliuice/WhiteSur-kde.git
cd WhiteSur-kde
./install.sh            # dekorasi Aurorae, color scheme, Plasma theme, Kvantum
cd ..
```
Untuk tema layar login (opsional), jalankan script install di folder `sddm/` repo tersebut dengan `sudo`. Cek README repo-nya dulu ya, karena lokasi script-nya bisa beda antarversi. Kalau gagal dengan nama folder yang aneh, kemungkinan kena masalah yang sama dengan yang saya alami di [post sebelumnya](/posts/kde-plasma-ala-macos-opensuse-tumbleweed/#1-tema-sddm-gagal-terpasang).

Opsional, supaya aplikasi GTK (Chrome, Thunderbird, dll.) ikut serasi:
```
git clone --depth=1 https://github.com/vinceliuice/WhiteSur-gtk-theme.git
WhiteSur-gtk-theme/install.sh
```

#### Widget panel
Pasang lewat **klik kanan panel > Add Widgets > Get New Widgets**, atau ambil dari GitHub:

| Widget | Fungsi | Sumber |
|---|---|---|
| Application Title Bar | tombol jendela + judul di panel atas | [antroids/application-title-bar](https://github.com/antroids/application-title-bar) |
| Window Title Fork | nama aplikasi yang aktif | [psifidotos/applet-window-title](https://github.com/psifidotos/applet-window-title) |
| macOS Battery *(opsional)* | ikon baterai gaya macOS | [rifkiaz/macos-battery-kde](https://github.com/rifkiaz/macos-battery-kde) |

Widget macOS Battery itu buatan saya sendiri, cerita bikinnya ada di [Membuat Widget Baterai ala macOS untuk KDE Plasma 6](/posts/widget-baterai-ala-macos-kde-plasma-6/).

### 2. Atur di System Settings
Buka **System Settings**, lalu atur satu per satu:
1. **Colors & Themes > Plasma Style** > `openSUSE Dark` (atau `Breeze Dark`)
2. **Colors & Themes > Colors** > `Breeze Classic`
3. **Colors & Themes > Window Decorations** > `WhiteSur-dark`
   - Tab **Titlebar Buttons**: susun **Close, Minimize, Maximize di kiri**, dan kosongkan sisi kanan.
4. **Text & Fonts > Fonts** > semua font `Inter 10pt`, judul jendela `Inter SemiBold 10pt`.
5. **Window Management > Desktop Effects** > nyalakan **Magic Lamp**, matikan *Squash*.
6. **Window Management > Task Switcher** > tampilan `Compact`.
7. **Colors & Themes > Login Screen (SDDM)** > `WhiteSur-dark`.

### 3. Susun Panel
Ada **dua panel**: satu bar di atas dan satu dock di bawah.

#### Panel atas (seperti menu bar macOS)
Urutan widget dari kiri ke kanan:
```
[Application Launcher] | [Application Title Bar] [Window Title] [Global Menu]
      ── spacer ──   [Jam Digital]   ── spacer ──
[System Tray] [Battery] [Lock/Logout] [Display Config] [User Switcher] [Pager]
```
- **Application Title Bar**: di pengaturannya, pilih elemen *Close, Minimize, Maximize*, tema tombol `ChromeOS-dark`, dan *Disabled mode* = **Hide** (tombol hilang kalau gak ada jendela aktif).
- **Global Menu** (`appmenu`) menampilkan menu File/Edit/… milik aplikasi di panel, persis seperti macOS.
- Panel **tidak floating**.

#### Dock bawah
```
[Icons-only Task Manager] | [Trash]
```
```
Width      : Fit content (lebarnya mengikuti jumlah ikon, posisinya di tengah)
Height     : 48 px
Visibility : Dodge Windows
Floating   : mati
```

### 4. Gaya Terminal
Bagian ini yang paling sering ditanyakan.

#### 4a. Font MesloLGS NF
Font ini wajib, karena ikon - ikon Powerlevel10k butuh font yang sudah di-*patch* (Nerd Font). Tanpa font ini prompt-nya bakal penuh kotak - kotak aneh.
```
mkdir -p ~/.local/share/fonts && cd ~/.local/share/fonts
for f in Regular Bold Italic "Bold Italic"; do
  curl -fLO "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20${f// /%20}.ttf"
done
fc-cache -f
```

#### 4b. zsh + oh-my-zsh + Powerlevel10k + plugin
```
# oh-my-zsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

ZSH_CUSTOM=${ZSH_CUSTOM:-~/.oh-my-zsh/custom}
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git          $ZSH_CUSTOM/themes/powerlevel10k
git clone --depth=1 https://github.com/zsh-users/zsh-autosuggestions      $ZSH_CUSTOM/plugins/zsh-autosuggestions
git clone --depth=1 https://github.com/zsh-users/zsh-syntax-highlighting  $ZSH_CUSTOM/plugins/zsh-syntax-highlighting

# aktifkan tema & plugin di ~/.zshrc
sed -i 's|^ZSH_THEME=.*|ZSH_THEME="powerlevel10k/powerlevel10k"|' ~/.zshrc
sed -i 's|^plugins=.*|plugins=(git zsh-autosuggestions zsh-syntax-highlighting)|' ~/.zshrc

chsh -s "$(which zsh)"   # jadikan zsh shell default
```
Catatan: installer oh-my-zsh biasanya langsung masuk ke zsh setelah selesai. Kalau itu terjadi, ketik `exit` dulu lalu lanjutkan perintah berikutnya, atau jalankan installer-nya dengan `RUNZSH=no sh -c "..."` supaya gak pindah shell di tengah jalan.

Buka terminal baru. Wizard `p10k configure` akan muncul otomatis (atau jalankan sendiri). Pilihan yang saya pakai:

| Pertanyaan | Jawaban |
|---|---|
| Prompt Style | **Lean** |
| Character Set | **Unicode** |
| Show current time? | **24-hour format** |
| Prompt Height | **Two lines** |
| Prompt Connection | **Dotted** |
| Prompt Frame | **Left** |
| Connection & Frame Color | **Light** |
| Prompt Spacing | **Sparse** |
| Icons | **Many icons** |
| Prompt Flow | **Fluent** |
| Enable Transient Prompt? | **Yes** |
| Instant Prompt Mode | **Verbose** |

*Transient Prompt* ini favorit saya: prompt dua baris cuma tampil di baris yang sedang aktif, sedangkan perintah - perintah sebelumnya diringkas jadi satu baris. Jadi riwayat di layar tetap rapi.

#### 4c. Tilix dengan skema Monokai
Pakai perintah ini supaya warnanya langsung sama (font MesloLGS NF 11, background `#272822`):
```
dconf load /com/gexperts/Tilix/ <<'EOF'
[/]
prompt-on-close=true

[profiles/2b7c4080-0ddd-46c5-8f23-563fd3ba789d]
visible-name='Default'
use-system-font=false
font='MesloLGS NF 11'
use-theme-colors=false
background-color='#272822'
foreground-color='#F8F8F2'
palette=['#272822', '#F92672', '#A6E22E', '#F4BF75', '#66D9EF', '#AE81FF', '#A1EFE4', '#F8F8F2', '#75715E', '#F92672', '#A6E22E', '#F4BF75', '#66D9EF', '#AE81FF', '#A1EFE4', '#F9F8F5']
EOF

dconf write /com/gexperts/Tilix/profiles/list "['2b7c4080-0ddd-46c5-8f23-563fd3ba789d']"
dconf write /com/gexperts/Tilix/profiles/default "'2b7c4080-0ddd-46c5-8f23-563fd3ba789d'"
```
Perintah di atas akan menimpa profil Tilix yang sudah ada. Kalau sebelumnya sudah punya profil sendiri, backup dulu dengan `dconf dump /com/gexperts/Tilix/ > tilix-backup.dconf`.

Kalau pakai **Konsole**: *Settings > Edit Current Profile > Appearance*, pilih skema warna **Monokai** (ada di *Get New…*) dan font **MesloLGS NF 11**.

### 5. Sentuhan Akhir
- **Wallpaper**: klik kanan desktop > *Configure Desktop and Wallpaper*. Pakai gambar yang sama untuk **Lock Screen** (*System Settings > Screen Locking > Appearance*).
- Log out lalu login lagi supaya panel, font, dan dekorasi jendela tampil sempurna.

Voila, desktop dan terminalnya sudah mirip punya saya. Selamat mencoba! 🎨

Sekian, semoga membantu.

Referensi:
- [WhiteSur KDE](https://github.com/vinceliuice/WhiteSur-kde)
- [WhiteSur GTK Theme](https://github.com/vinceliuice/WhiteSur-gtk-theme)
- [Application Title Bar](https://github.com/antroids/application-title-bar)
- [Powerlevel10k](https://github.com/romkatv/powerlevel10k)
- [oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh)
- [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) dan [zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting)
