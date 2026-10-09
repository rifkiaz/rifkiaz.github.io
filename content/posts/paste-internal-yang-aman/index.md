---
title: "Membangun Layanan Paste Internal yang Aman"
date: 2026-06-14T20:12:00+07:00
description: "Kenapa tim teknis butuh pastebin internal, fitur apa yang wajib ada, dan bagaimana men-deploy-nya secara aman di belakang reverse proxy dan autentikasi."
categories: [proyek]
tags: [self-hosted, keamanan, docker, nginx, privatebin]
---

Hampir semua tim teknis pernah begini: butuh berbagi potongan log, konfigurasi, atau stack trace dengan cepat, lalu langsung tempel ke pastebin publik. Praktis sih, tapi berisiko. Log sering berisi token, alamat internal, atau data pengguna. Begitu masuk ke layanan publik, kita sudah nggak bisa mengontrol siapa yang membacanya atau berapa lama datanya disimpan.

Jalan keluarnya adalah **paste internal**. Sama praktisnya, tapi jalan di infrastruktur sendiri dan cuma bisa diakses orang yang berhak. Di tulisan ini saya rangkum hal-hal yang perlu dipikirkan waktu mendesainnya, plus cara deploy yang menurut saya masuk akal.

## Kebutuhan minimum

Sebelum pilih tools, saya tulis dulu kebutuhannya:

| Kebutuhan | Alasan |
|---|---|
| Cuma bisa diakses dari jaringan internal atau setelah login | Supaya isinya nggak bocor ke luar |
| Masa kedaluwarsa (expiry) per paste | Data sensitif nggak numpuk selamanya |
| Opsi *burn after reading* | Pas untuk berbagi kredensial sementara yang sekali pakai |
| Enkripsi, idealnya di sisi klien | Admin server pun nggak bisa membaca isinya |
| Syntax highlighting | Log dan konfigurasi lebih mudah dibaca |
| Batas ukuran dan rate limit | Mencegah penyalahgunaan dan disk penuh |
| Nggak diindeks mesin pencari | Supaya paste nggak muncul di hasil pencarian |

## Pilihan pendekatan

**Pakai aplikasi open source yang sudah matang.** Salah satu yang populer adalah [PrivateBin](https://privatebin.info/). Paste dienkripsi di browser sebelum dikirim ke server, dan kunci dekripsinya ada di bagian `#fragment` URL yang nggak pernah ikut terkirim ke server. Expiry, burn after reading, dan syntax highlighting juga sudah tersedia.

**Bikin sendiri.** Ini masuk akal kalau ada kebutuhan khusus, misalnya integrasi dengan SSO internal, audit log, atau API yang bisa dipanggil dari script. Konsekuensinya, pemeliharaan dan keamanannya jadi tanggung jawab kita sendiri.

Untuk kebanyakan tim, saran saya mulai saja dari aplikasi yang sudah ada, lalu tambahkan autentikasi dan aturan main di depannya.

## Arsitektur

```text
Pengguna ──HTTPS──▶ Reverse proxy (TLS + autentikasi) ──▶ Aplikasi paste ──▶ Storage
```

- **Reverse proxy** (Nginx, HAProxy, atau Caddy) mengurus TLS, autentikasi, rate limit, dan header keamanan.
- **Aplikasi paste** cuma listen di `127.0.0.1` atau jaringan privat, nggak pernah langsung menghadap internet.
- **Storage** untuk skala kecil cukup filesystem saja, atau database kalau butuh replikasi.

## Contoh deploy dengan Docker Compose

```yaml
# docker-compose.yml
services:
  paste:
    image: privatebin/nginx-fpm-alpine:<versi-yang-di-pin>
    restart: unless-stopped
    read_only: true
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/srv/data
      - ./conf.php:/srv/cfg/conf.php:ro
```

Beberapa catatan:

- **Kunci versi image**, jangan pakai `latest`, supaya upgrade selalu disengaja dan gampang di-rollback.
- `read_only: true` bikin filesystem container nggak bisa ditulis, kecuali volume data.
- Port cuma di-bind ke `127.0.0.1`, jadi satu-satunya pintu masuk ya lewat reverse proxy.
- Pastikan direktori `./data` bisa ditulis oleh user yang dipakai container (cek dokumentasi image-nya).

Di `conf.php`, atur nilai default yang aman, misalnya expiry bawaan yang pendek dan batas ukuran paste yang wajar.

## Reverse proxy dan autentikasi

Contoh paling sederhana pakai Nginx:

```nginx
server {
    listen 443 ssl;
    server_name paste.example.com;

    ssl_certificate     /etc/ssl/certs/paste.crt;
    ssl_certificate_key /etc/ssl/private/paste.key;

    # Contoh paling sederhana. Untuk tim besar, ganti dengan SSO/OIDC.
    auth_basic           "Internal";
    auth_basic_user_file /etc/nginx/.htpasswd;

    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header Referrer-Policy "no-referrer" always;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Header `Referrer-Policy: no-referrer` ini penting. Tanpa header ini, URL paste lengkap bisa ikut terkirim sebagai referrer waktu ada yang mengklik link di dalam paste.

Kalau organisasimu sudah punya identity provider, lebih baik autentikasinya diserahkan ke SSO lewat proxy seperti oauth2-proxy. Jadi waktu akun seseorang dinonaktifkan, aksesnya ikut tercabut otomatis.

## Operasional

- **Backup**: tanya dulu, paste ini memang perlu di-backup? Untuk data yang sifatnya sementara, jawabannya sering kali nggak.
- **Pembersihan**: pastikan paste yang sudah kedaluwarsa benar-benar terhapus dari storage, bukan cuma disembunyikan.
- **Monitoring**: pantau pemakaian disk dan error rate di reverse proxy.
- **Update**: rutin cek rilis keamanan aplikasi dan base image-nya.

## Yang paling penting: kebiasaan tim

Tools cuma separuh solusi. Separuhnya lagi adalah membiasakan tim pakai paste internal dan nggak balik lagi ke pastebin publik. Yang biasanya membantu: URL yang gampang diingat, tampilan yang nggak kalah nyaman dari layanan publik, dan pengingat singkat di dokumentasi onboarding.
