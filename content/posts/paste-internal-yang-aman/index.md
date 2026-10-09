---
title: "Membangun Layanan Paste Internal yang Aman"
date: 2026-09-08T09:00:00+07:00
description: "Kenapa tim teknis butuh pastebin internal, fitur apa yang wajib ada, dan bagaimana men-deploy-nya secara aman di belakang reverse proxy dan autentikasi."
categories: [proyek]
tags: [self-hosted, keamanan, docker, nginx, privatebin]
---

Hampir setiap tim teknis punya kebiasaan yang sama: butuh membagikan potongan log, konfigurasi, atau stack trace dengan cepat, lalu menempelkannya ke pastebin publik. Praktis, tapi berisiko. Isi log sering memuat token, alamat internal, atau data pengguna, dan begitu masuk ke layanan publik, kita tidak lagi mengontrol siapa yang bisa membacanya atau berapa lama data itu tersimpan.

Solusinya adalah layanan **paste internal**: sama praktisnya, tapi berjalan di infrastruktur sendiri dan hanya bisa diakses oleh orang yang berhak. Tulisan ini merangkum pertimbangan desain dan cara deploy yang saya anggap masuk akal.

## Kebutuhan minimum

Sebelum memilih tools, saya menuliskan dulu kebutuhannya:

| Kebutuhan | Alasan |
|---|---|
| Hanya bisa diakses dari jaringan internal atau setelah login | Mencegah kebocoran ke luar |
| Masa kedaluwarsa (expiry) per paste | Data sensitif tidak menumpuk selamanya |
| Opsi *burn after reading* | Cocok untuk berbagi kredensial sementara sekali pakai |
| Enkripsi, idealnya di sisi klien | Admin server pun tidak bisa membaca isi paste |
| Syntax highlighting | Log dan konfigurasi lebih mudah dibaca |
| Batas ukuran dan rate limit | Mencegah penyalahgunaan dan disk penuh |
| Tidak diindeks mesin pencari | Mencegah paste muncul di hasil pencarian |

## Pilihan pendekatan

**Memakai aplikasi open source yang sudah matang.** [PrivateBin](https://privatebin.info/) adalah contoh yang populer: paste dienkripsi di browser sebelum dikirim ke server, dan kunci dekripsinya ada di bagian `#fragment` URL yang tidak pernah dikirim ke server. Fitur expiry, burn after reading, dan syntax highlighting sudah tersedia.

**Membangun sendiri.** Masuk akal kalau ada kebutuhan khusus, misalnya integrasi dengan SSO internal, audit log, atau API untuk dipanggil dari script. Konsekuensinya, Anda yang menanggung pemeliharaan dan keamanannya.

Untuk sebagian besar tim, saya menyarankan mulai dari aplikasi yang sudah ada, lalu menambahkan lapisan autentikasi dan kebijakan di depannya.

## Arsitektur

```text
Pengguna ──HTTPS──▶ Reverse proxy (TLS + autentikasi) ──▶ Aplikasi paste ──▶ Storage
```

- **Reverse proxy** (Nginx, HAProxy, atau Caddy) menangani TLS, autentikasi, rate limit, dan header keamanan.
- **Aplikasi paste** hanya mendengarkan di `127.0.0.1` atau jaringan privat, tidak pernah langsung ke internet.
- **Storage** cukup filesystem untuk skala kecil, atau database bila butuh replikasi.

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

- **Pin versi image**, jangan pakai `latest`, supaya upgrade selalu disengaja dan bisa di-rollback.
- `read_only: true` membuat filesystem container tidak bisa ditulis selain volume data.
- Port hanya di-bind ke `127.0.0.1`, jadi satu-satunya jalan masuk adalah lewat reverse proxy.
- Pastikan direktori `./data` bisa ditulis oleh user yang dipakai container (cek dokumentasi image).

Di `conf.php`, atur nilai default yang aman, misalnya expiry bawaan yang pendek dan batas ukuran paste yang wajar.

## Reverse proxy dan autentikasi

Contoh minimal dengan Nginx:

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

`Referrer-Policy: no-referrer` penting: tanpa header ini, URL paste lengkap bisa ikut terkirim sebagai referrer ketika pengguna mengklik tautan di dalam paste.

Untuk organisasi yang sudah punya identity provider, autentikasi lebih baik diserahkan ke SSO lewat proxy seperti oauth2-proxy, supaya akses otomatis dicabut ketika akun seseorang dinonaktifkan.

## Operasional

- **Backup**: tentukan dulu apakah paste memang perlu di-backup. Untuk data yang sifatnya sementara, sering kali jawabannya tidak.
- **Pembersihan**: pastikan paste yang kedaluwarsa benar-benar dihapus dari storage, bukan hanya disembunyikan.
- **Monitoring**: pantau penggunaan disk dan error rate di reverse proxy.
- **Update**: ikuti rilis keamanan aplikasi dan base image secara berkala.

## Yang paling penting: kebiasaan

Tools hanya separuh solusi. Separuhnya lagi adalah membuat tim terbiasa memakai paste internal dan tidak kembali ke pastebin publik. Yang membantu: URL yang mudah diingat, tampilan yang tidak kalah nyaman dari layanan publik, dan pengingat singkat di dokumentasi onboarding tim.
