---
title: "Jaringan dan Firewall"
description: "Contekan NetworkManager, wicked, firewalld, dan perintah jaringan dasar di openSUSE."
date: 2026-10-09
weight: 40
tags: ["openSUSE", "networking", "firewalld"]
---

openSUSE punya dua pengelola jaringan. Desktop Tumbleweed dan Leap 16 memakai **NetworkManager**, sedangkan server Leap 15 umumnya memakai **wicked**. Cek mana yang aktif:

```bash
systemctl is-active NetworkManager wicked
```

> Contoh IP di bawah memakai rentang dokumentasi `192.0.2.0/24`. Ganti dengan alamat di jaringanmu.

## Perintah dasar

| Perintah | Fungsi |
|---|---|
| `ip a` | Daftar interface dan alamat IP |
| `ip r` | Tabel routing |
| `ip -s link` | Statistik paket per interface |
| `ss -tulpn` | Port yang sedang listen beserta prosesnya |
| `ping -c 4 opensuse.org` | Tes konektivitas |
| `tracepath opensuse.org` | Lihat rute ke tujuan |
| `dig opensuse.org` | Tes DNS (paket `bind-utils`) |
| `curl -I https://opensuse.org` | Cek respons HTTP |

## NetworkManager (nmcli)

| Perintah | Fungsi |
|---|---|
| `nmcli device status` | Status semua perangkat |
| `nmcli connection show` | Daftar koneksi tersimpan |
| `nmcli connection up "nama"` | Aktifkan koneksi |
| `nmcli connection down "nama"` | Matikan koneksi |
| `nmcli device wifi list` | Daftar Wi-Fi di sekitar |
| `nmcli device wifi connect SSID --ask` | Sambung ke Wi-Fi, password ditanya |
| `nmtui` | Antarmuka teks yang lebih ramah |

Set IP statis:

```bash
sudo nmcli connection modify "Wired connection 1" \
  ipv4.method manual \
  ipv4.addresses 192.0.2.10/24 \
  ipv4.gateway 192.0.2.1 \
  ipv4.dns "1.1.1.1 9.9.9.9"
sudo nmcli connection up "Wired connection 1"
```

## wicked

| Perintah | Fungsi |
|---|---|
| `wicked show all` | Status semua interface |
| `wicked ifup eth0` | Aktifkan interface |
| `wicked ifdown eth0` | Matikan interface |
| `wicked ifreload all` | Terapkan perubahan konfigurasi |

Konfigurasinya ada di `/etc/sysconfig/network/ifcfg-<interface>`. Contoh IP statis:

```ini
BOOTPROTO='static'
STARTMODE='auto'
IPADDR='192.0.2.10/24'
```

Gateway diatur di `/etc/sysconfig/network/routes`:

```text
default 192.0.2.1 - -
```

DNS di openSUSE dikelola oleh `netconfig`, jadi jangan edit `/etc/resolv.conf` langsung. Atur `NETCONFIG_DNS_STATIC_SERVERS` di `/etc/sysconfig/network/config`, lalu jalankan `sudo netconfig update -f`.

## firewalld

| Perintah | Fungsi |
|---|---|
| `firewall-cmd --state` | Cek firewall berjalan |
| `firewall-cmd --get-active-zones` | Zona aktif dan interface-nya |
| `firewall-cmd --list-all` | Aturan di zona default |
| `firewall-cmd --add-service=http --permanent` | Buka service secara permanen |
| `firewall-cmd --add-port=8080/tcp --permanent` | Buka port tertentu |
| `firewall-cmd --remove-service=http --permanent` | Tutup lagi service |
| `firewall-cmd --reload` | Terapkan aturan permanen |
| `firewall-cmd --get-services` | Daftar nama service yang dikenal |

Aturan tanpa `--permanent` langsung berlaku tapi hilang setelah reload atau reboot. Cara aman: tes dulu tanpa `--permanent`, kalau sudah benar jalankan `firewall-cmd --runtime-to-permanent`.
