---
title: "openSUSE Tumbleweed di ThinkPad X1 Nano: Benerin Scaling GDM, Mikrofon, dan Speaker"
date: 2026-08-26T20:31:00+07:00
categories: [tutorial]
tags: [openSUSE, tumbleweed, gnome, gdm, thinkpad, audio, pipewire, linux]
description: "Catatan troubleshooting openSUSE Tumbleweed di ThinkPad X1 Nano Gen 1: layar login GDM yang tetap 150%, mikrofon hilang setelah pasang sof-firmware, dan speaker yang terasa pelan."
---

Beberapa waktu lalu saya pasang openSUSE Tumbleweed dengan GNOME di ThinkPad X1 Nano Gen 1. Secara umum mulus, tapi ada tiga hal yang bikin saya cukup lama ngoprek:

1. Layar login (GDM) tetap di-scale 150%, padahal sesi GNOME sudah 100%.
2. Mikrofon hilang setelah pasang `sof-firmware`.
3. X1 Nano punya 4 speaker, tapi yang "terdeteksi" cuma 2 dan suaranya pelan dibanding Windows.

Tulisan ini merangkum apa yang ternyata jadi penyebab, termasuk jalan buntu yang sempat saya lewati. Siapa tahu kamu kena masalah yang sama.

## 1. GDM tetap di 150%

Panel X1 Nano itu 2160×1350 di layar 13 inci, jadi GNOME otomatis memilih scale 150%. Di sesi desktop saya ubah ke 100% lewat **Settings → Displays**, aman. Tapi layar login tetap 150%.

Penyebab dasarnya: GDM jalan sebagai user `gdm` sendiri dengan konfigurasi terpisah, jadi setting display user kamu nggak ikut terbawa. Solusi klasiknya adalah menyalin `~/.config/monitors.xml` ke home milik `gdm`.

### Pastikan `monitors.xml` kamu benar dulu

File ini baru dibuat kalau kamu pernah menekan **Apply** di Settings → Displays. Cek isinya:

```bash
cat ~/.config/monitors.xml
```

Yang perlu diperhatikan adalah nilai `<scale>`. Kalau masih `1.5`, ya menyalinnya ke GDM nggak akan mengubah apa-apa. Punya saya kira-kira begini (bagian vendor/product disederhanakan):

```xml
<monitors version="2">
  <configuration>
    <layoutmode>logical</layoutmode>
    <logicalmonitor>
      <x>0</x>
      <y>0</y>
      <scale>1</scale>
      <primary>yes</primary>
      <monitor>
        <monitorspec>
          <connector>eDP-1</connector>
          <vendor>...</vendor>
          <product>...</product>
          <serial>...</serial>
        </monitorspec>
        <mode>
          <width>2160</width>
          <height>1350</height>
          <rate>59.744</rate>
        </mode>
      </monitor>
    </logicalmonitor>
  </configuration>
</monitors>
```

Sebaiknya jangan tulis file ini manual. `connector`, `vendor`, `product`, `serial`, dan `rate` harus persis sama dengan yang dilaporkan mutter. Kalau satu saja meleset (misalnya `rate` dibulatkan jadi `60`), mutter diam-diam membuang seluruh konfigurasi dan balik ke auto-scale.

### Jebakan 1: paste multi-baris di terminal

Ini agak memalukan tapi patut diceritakan. Saya sempat yakin sudah menyalin file-nya, tapi ternyata `ls` bilang file-nya nggak ada. Waktu dilihat lagi, baris-baris perintah yang saya paste sekaligus ternyata nempel jadi satu (`... restart display-manageruser@host:~>`), jadi `cp`-nya nggak pernah benar-benar jalan.

Kalau terminal kamu bermasalah dengan paste multi-baris, sambung saja dengan `&&` di satu baris, plus penanda di akhir supaya kelihatan berhasil atau tidak:

```bash
sudo cp ~/.config/monitors.xml /var/lib/gdm/.config/ && sudo chown -R gdm:gdm /var/lib/gdm/.config && sudo restorecon -Rv /var/lib/gdm/.config && echo BERHASIL
```

### Jebakan 2: SELinux

Tumbleweed sekarang default-nya SELinux enforcing (kelihatan dari titik di akhir permission, misalnya `-rw-r--r--.`). File yang di-`cp` dari home bisa membawa context `user_home_t` yang belum tentu boleh dibaca GDM. Makanya ada `restorecon` di perintah di atas. Cek hasilnya:

```bash
sudo ls -laZ /var/lib/gdm/.config/
```

Context-nya harus `xdm_var_lib_t` dan owner-nya `gdm gdm`.

### Jebakan 3: path-nya sudah pindah di GDM baru

Setelah file benar-benar ada, owner dan SELinux sudah tepat, dan display manager sudah di-restart, layar login *tetap* 150%. `journalctl` juga sama sekali nggak menyebut monitor config, artinya file itu memang nggak pernah dibaca.

Ternyata menurut laporan di issue tracker GDM, sejak GDM 49 file `/var/lib/gdm/.config/monitors.xml` sudah nggak dibaca lagi. Sistem saya pakai mutter 50, jadi pasti kena. Cek versimu dengan:

```bash
mutter --version
```

Ada dua lokasi yang bisa dicoba. Yang paling bersih adalah fallback sistem-wide di `/etc/xdg`, karena nggak bergantung pada home `gdm` sama sekali:

```bash
sudo cp ~/.config/monitors.xml /etc/xdg/monitors.xml && sudo chmod 644 /etc/xdg/monitors.xml && echo OK
```

Kalau belum mempan, coba lokasi baru per-seat:

```bash
sudo mkdir -p /var/lib/gdm/seat0/config && sudo cp ~/.config/monitors.xml /var/lib/gdm/seat0/config/ && sudo chown -R gdm:gdm /var/lib/gdm/seat0/config && sudo restorecon -Rv /var/lib/gdm/seat0/config && echo OK
```

Lalu restart display manager. Hati-hati, perintah ini langsung menutup sesi kamu, jadi simpan pekerjaan dulu:

```bash
sudo systemctl restart display-manager
```

Ada juga laporan bahwa permission direktori `seat0/config` bisa ter-reset sendiri, jadi saya pribadi lebih memilih `/etc/xdg`.

### Soal dconf

Banyak tutorial menyarankan override lewat `/etc/dconf/db/gdm.d/` (misalnya mematikan `experimental-features` mutter atau mengatur `scaling-factor`). Di openSUSE, file `/etc/dconf/profile/gdm` defaultnya nggak ada, jadi database dconf itu nggak dipakai sama sekali. Selain itu, ArchWiki memperingatkan bahwa mengubah `experimental-features` mutter bisa bikin `monitors.xml` jadi nggak kompatibel. Kalau kamu sempat membuat file seperti itu, mending hapus saja:

```bash
sudo rm /etc/dconf/db/gdm.d/10-scale && sudo dconf update
```

Satu catatan lagi: dengan scale 1, layar login berjalan di 2160×1350 penuh, jadi teksnya terasa kecil di panel 13 inci. Itu konsekuensi wajar dari pilihan 100%.

## 2. Mikrofon hilang setelah pasang `sof-firmware`

Setelah memasang `sof-firmware`, mikrofon malah "mute". Sebelum ngoprek jauh, cek dulu hal yang paling sepele: ThinkPad punya tombol mic mute (F4) dengan LED oranye, dan statusnya bertahan lintas reboot.

Kalau bukan itu, cek berlapis dari kernel ke atas.

**Kernel / SOF.** Pastikan firmware dan topology ter-load tanpa error:

```bash
sudo dmesg | grep -i -E "sof|snd_soc|firmware" | head -30
```

Di punya saya sisi kernel sebenarnya sudah sempurna:

```
DMICs detected in NHLT tables: 4
Topology file: intel/sof-tplg/sof-hda-generic-4ch.tplg
```

**PipeWire.** Lihat apa yang dikenali sebagai sumber input:

```bash
wpctl status
```

Di bagian **Sources** cuma ada "HD Audio Stereo", nggak ada "Digital Microphone". Perintah `wpctl get-volume @DEFAULT_AUDIO_SOURCE@` malah error `'-1' is not a valid ID`. Jadi masalahnya bukan mute, tapi mic-nya memang nggak di-expose.

**UCM.** Ini dia biang keroknya:

```bash
zypper info alsa-ucm-conf sof-firmware
```

Hasilnya `alsa-ucm-conf` ternyata **tidak terpasang**. UCM (Use Case Manager) adalah lapisan yang memberi tahu PipeWire/WirePlumber *bagaimana* meng-expose DMIC array sebagai perangkat input. Tanpa UCM, WirePlumber cuma melihat jalur HDA generik.

Perbaikannya:

```bash
sudo zypper install alsa-ucm-conf alsa-utils
systemctl --user restart wireplumber pipewire pipewire-pulse
```

`alsa-utils` sekalian dipasang karena `alsamixer` dan `alsactl` juga belum ada. Setelah restart, `wpctl status` langsung menampilkan **Digital Microphone** sebagai source default. Bonusnya, sink-nya juga jadi benar: dari satu "Stereo" generik jadi Speaker plus beberapa output HDMI/DisplayPort. Jadi UCM yang hilang itu merusak input dan output sekaligus.

Tes cepat mic-nya:

```bash
arecord -f cd -d 5 /tmp/tes.wav && aplay /tmp/tes.wav
```

Kalau masih senyap, buka `alsamixer -c 0`, tekan F4 untuk view Capture, dan pastikan `Dmic0` tidak berstatus `MM` (muted).

Karena `alsa-ucm-conf` biasanya ikut sebagai dependency, hilangnya paket ini agak aneh. Setelah beres, ada baiknya jalankan `sudo zypper dup` untuk memastikan nggak ada paket lain yang tertinggal.

## 3. Empat speaker, tapi kok cuma dua?

X1 Nano punya 2 tweeter di atas dan 2 woofer di bawah, di-drive codec Realtek ALC287 lewat dua DAC. Di PipeWire yang muncul cuma sink stereo, jadi saya kira dua speaker nggak jalan.

Cek dulu kontrol mixer-nya:

```bash
amixer -c 0 scontrols
for c in Master Speaker "Bass Speaker" DAC1 DAC2 "Auto-Mute Mode"; do amixer -c 0 sget "$c"; done
```

Di punya saya `Speaker` dan `Bass Speaker` sudah `[on]`, `DAC1` dan `DAC2` sama-sama 100%, dan `Auto-Mute Mode` sudah `Disabled`. Nggak ada yang perlu diperbaiki.

Ternyata keempat speaker **memang sudah bunyi**. Empat speaker itu dirangkai sebagai dua pasang stereo yang menerima stream yang sama, jadi wajar kalau PipeWire cuma menampilkan satu sink stereo. Cara membuktikannya: putar suara, lalu matikan salah satu pasangan di terminal lain.

```bash
speaker-test -D hw:0,0 -c 2 -t wav -l 10
```

```bash
amixer -c 0 sset 'Bass Speaker' mute     # suara jadi tipis? berarti woofer aktif
amixer -c 0 sset 'Bass Speaker' unmute
```

Kalau tiap pasangan yang di-mute mengubah suara, berarti keempat speaker kamu berfungsi. Kamu nggak perlu memaksa quirk kernel seperti `model=alc285-speaker2-to-dac1`. Quirk itu justru bisa menurunkan volume maksimum dan bikin kontrol volume kacau.

### Kenapa lebih pelan dibanding Windows?

Di Windows, Lenovo memasang lapisan DSP (Dolby / efek audio Realtek) yang melakukan compression, bass boost, dan limiting. Speaker yang sama jadi terdengar jauh lebih keras dan penuh. Di Linux, yang kamu dengar adalah output mentah tanpa pemrosesan. Beberapa hal yang bisa dilakukan:

**Naikkan Master.** Punya saya ternyata masih di 82% (-12 dB):

```bash
amixer -c 0 sset Master 100% && sudo alsactl store
```

**Over-amplification.** Aktifkan di Settings → Sound supaya volume bisa sampai 150%. Ingat, di atas 100% itu gain digital murni, jadi bisa pecah kalau berlebihan.

**EasyEffects.** Ini yang paling mendekati pengalaman Windows:

```bash
sudo zypper install easyeffects
```

Di tab Output, tambahkan chain **Bass Enhancer → Compressor → Limiter**, lalu aktifkan "Start Service at Login". Compressor menaikkan bagian yang pelan tanpa bikin yang keras jadi pecah, dan Limiter mencegah clipping. Kamu juga bisa cari preset komunitas untuk X1 Nano atau X1 Carbon Gen 9 (hardware audionya mirip) lalu taruh di `~/.config/easyeffects/output/`.

Ekspektasinya tetap harus realistis. Speaker X1 Nano memang kecil, dan sebagian "kerasnya" di Windows itu efek psikoakustik dari bass boost, bukan tenaga sesungguhnya.

## Rangkuman

| Masalah | Penyebab | Solusi |
|---|---|---|
| GDM tetap 150% | Sejak GDM 49 `/var/lib/gdm/.config/monitors.xml` tidak dibaca | Salin `monitors.xml` ke `/etc/xdg/` (atau `/var/lib/gdm/seat0/config/`) |
| Mikrofon hilang | `alsa-ucm-conf` tidak terpasang | `zypper install alsa-ucm-conf alsa-utils`, restart WirePlumber |
| Speaker "cuma 2" | Normal, 4 speaker = 2 pasang stereo | Tidak perlu quirk; pakai EasyEffects untuk loudness |

Pelajaran terbesarnya buat saya: jangan langsung percaya perintah sudah jalan. Cek hasilnya (`ls`, `echo $?`, `journalctl`) sebelum lanjut ke tebakan berikutnya. Setengah waktu saya habis karena `cp` yang ternyata nggak pernah dieksekusi.
