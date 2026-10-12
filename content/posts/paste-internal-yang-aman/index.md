---
title: "Membangun Layanan Paste Internal yang Aman"
date: 2026-06-14T20:12:00+07:00
description: "Kenapa tim teknis butuh pastebin internal, fitur apa yang wajib ada, dan bagaimana men-deploy-nya secara aman di belakang reverse proxy dan autentikasi."
categories: [proyek]
tags: [self-hosted, keamanan, docker, nginx, privatebin]
---
### Pendahuluan
Pastebin, ya sebuah layanan yang hampir pasti pernah dipakai orang teknis. Butuh berbagi potongan log, konfigurasi, atau stack trace dengan cepat, langsung saja tempel ke pastebin publik. Praktis sih, tapi berisiko banget. Log sering berisi token, alamat internal, atau data pengguna. Begitu masuk ke layanan publik, kita sudah gak bisa mengontrol siapa yang membacanya atau berapa lama datanya disimpan.

Jalan keluarnya adalah **paste internal**. Sama praktisnya, tapi jalan di infrastruktur sendiri dan cuma bisa diakses orang yang berhak. Pada tulisan kali ini saya akan berbagi hal - hal yang perlu dipikirkan waktu mendesainnya, plus cara deploy yang menurut saya masuk akal.

### Kebutuhan
Sebelum pilih tools, saya tulis dulu kebutuhannya:

| Kebutuhan | Alasan |
|---|---|
| Cuma bisa diakses dari jaringan internal atau setelah login | Supaya isinya gak bocor ke luar |
| Masa kedaluwarsa (expiry) per paste | Data sensitif gak numpuk selamanya |
| Opsi *burn after reading* | Cocok untuk berbagi kredensial sementara yang sekali pakai |
| Enkripsi, idealnya di sisi klien | Admin server pun gak bisa membaca isinya |
| Syntax highlighting | Log dan konfigurasi lebih mudah dibaca |
| Batas ukuran dan rate limit | Mencegah penyalahgunaan dan disk penuh |
| Gak diindeks mesin pencari | Supaya paste gak muncul di hasil pencarian |

### Pilih Bikin Sendiri atau Pakai yang Sudah Ada?
- **Pakai aplikasi open source yang sudah matang.** Salah satu yang populer adalah [PrivateBin](https://privatebin.info/). Paste dienkripsi di browser sebelum dikirim ke server, dan kunci dekripsinya ada di bagian `#fragment` URL yang gak pernah ikut terkirim ke server. Expiry, burn after reading, dan syntax highlighting juga sudah ada.
- **Bikin sendiri.** Masuk akal kalau ada kebutuhan khusus, misalnya integrasi dengan SSO internal, audit log, atau API yang bisa dipanggil dari script. Konsekuensinya, pemeliharaan dan keamanannya jadi tanggung jawab sendiri.

Untuk kebanyakan tim, saran saya mulai saja dari aplikasi yang sudah ada, lalu tambahkan autentikasi dan aturan main di depannya.

### Arsitektur
````
Pengguna ──HTTPS──▶ Reverse proxy (TLS + autentikasi) ──▶ Aplikasi paste ──▶ Storage
````
- **Reverse proxy** (Nginx, HAProxy, atau Caddy) mengurus TLS, autentikasi, rate limit, dan header keamanan.
- **Aplikasi paste** cuma listen di `127.0.0.1` atau jaringan privat, gak pernah langsung menghadap internet.
- **Storage** untuk skala kecil cukup filesystem saja, atau database kalau butuh replikasi.

### Tahapan
1. Buat file `docker-compose.yml`
```
vim docker-compose.yml

............
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
- `read_only: true` bikin filesystem container gak bisa ditulis, kecuali volume data.
- Port cuma di-bind ke `127.0.0.1`, jadi satu - satunya pintu masuk ya lewat reverse proxy.
- Pastikan direktori `./data` bisa ditulis oleh user yang dipakai container (cek dokumentasi image-nya).

2. Atur nilai default yang aman di `conf.php`, misalnya expiry bawaan yang pendek dan batas ukuran paste yang wajar. Lalu jalankan
```
docker compose up -d
```
3. Pasang reverse proxy dan autentikasi. Contoh paling sederhana pakai Nginx:
```
vim /etc/nginx/conf.d/paste.conf

............
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
4. Cek konfigurasi lalu reload Nginx
```
sudo nginx -t && sudo systemctl reload nginx
```

Header `Referrer-Policy: no-referrer` ini penting loh. Tanpa header ini, URL paste lengkap bisa ikut terkirim sebagai referrer waktu ada yang klik link di dalam paste.

Kalau di kantor sudah ada identity provider, lebih baik autentikasinya diserahkan ke SSO lewat proxy seperti oauth2-proxy. Jadi waktu akun seseorang dinonaktifkan, aksesnya ikut tercabut otomatis.

### Operasional
- **Backup**: tanya dulu, paste ini memang perlu di-backup? Untuk data yang sifatnya sementara, jawabannya sering kali gak.
- **Pembersihan**: pastikan paste yang sudah kedaluwarsa benar - benar terhapus dari storage, bukan cuma disembunyikan.
- **Monitoring**: pantau pemakaian disk dan error rate di reverse proxy.
- **Update**: rutin cek rilis keamanan aplikasi dan base image-nya.

### Yang Paling Penting: Kebiasaan Tim
Tools cuma separuh solusi. Separuhnya lagi adalah membiasakan tim pakai paste internal dan gak balik lagi ke pastebin publik. Yang biasanya membantu: URL yang gampang diingat, tampilan yang gak kalah nyaman dari layanan publik, dan pengingat singkat di dokumentasi onboarding.

Sekian, semoga membantu.

Referensi:
- [PrivateBin](https://privatebin.info/)
