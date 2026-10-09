---
title: "Mengatur CORS di Bucket Google Cloud Storage"
date: 2026-10-08T19:40:00+07:00
categories: [tutorial]
tags: [gcp, google-cloud-storage, cors, gcloud, frontend]
description: "Cara menambahkan aturan CORS ke bucket Google Cloud Storage lewat Console atau gcloud, kesalahan trailing slash yang sering bikin gagal, dan kenapa CORS saja belum cukup kalau bucket-nya private."
---

Kasusnya sederhana: frontend (di `localhost` saat development dan di domain production) perlu membaca file langsung dari bucket Google Cloud Storage. Tanpa aturan CORS, browser akan menolak response-nya dengan error klasik `No 'Access-Control-Allow-Origin' header`.

Aturan CORS yang mau dipasang kira-kira begini:

```json
[
  {
    "origin": ["http://localhost:8090/", "https://example.com"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

Sekilas benar, tapi ada satu jebakan di situ.

## Jebakan: trailing slash di origin

Perhatikan `http://localhost:8090/`. Header `Origin` yang dikirim browser **tidak pernah** diakhiri slash. Isinya selalu `http://localhost:8090`. GCS mencocokkan origin secara persis, jadi entri dengan slash di belakang tidak akan pernah cocok, dan request dari localhost tetap kena CORS error walaupun aturannya "sudah dipasang".

Jadi tulis origin tanpa slash: `http://localhost:8090`.

## Cara 1: lewat Console

Buka bucket di Cloud Console, lalu edit konfigurasi CORS-nya. Isi form-nya:

- **List of allowed origins:** `http://localhost:8090, https://example.com`
- **Specify methods:** centang **GET** saja. Tambahkan **HEAD** kalau frontend juga mengecek metadata file. **OPTIONS** nggak perlu dicentang karena preflight sudah ditangani GCS otomatis.
- **List of allowed response headers:** `Content-Type`
- **Cache expiry time:** `3600` (boleh dikosongkan, default-nya juga 3600 detik)

Lalu **Save**.

## Cara 2: lewat gcloud

Bisa dari terminal lokal atau Cloud Shell (ikon `>_` di kanan atas Console):

```bash
cat > cors.json <<'JSON'
[
  {
    "origin": ["http://localhost:8090", "https://example.com"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
JSON

gcloud storage buckets update gs://<nama-bucket> --cors-file=cors.json
```

Kedua cara hasilnya sama, pilih salah satu saja. Kalau konfigurasinya disimpan di repo, cara gcloud lebih enak karena `cors.json` bisa ikut di-review.

## Verifikasi

Cek konfigurasi yang aktif:

```bash
gcloud storage buckets describe gs://<nama-bucket> --format="default(cors_config)"
```

Atau tes langsung seperti browser, dengan mengirim header `Origin`:

```bash
curl -sI -H "Origin: http://localhost:8090" \
  https://storage.googleapis.com/<nama-bucket>/<path-object> | grep -i access-control
```

Kalau berhasil, akan muncul:

```
access-control-allow-origin: http://localhost:8090
```

Kalau baris itu nggak muncul, cek lagi ejaan origin-nya (skema `http`/`https`, port, dan trailing slash).

## CORS bukan izin akses

Ini yang sering terlewat. CORS cuma mengatur apakah **browser boleh membaca** response lintas origin. Izin untuk mengakses objeknya sendiri diatur terpisah.

Kalau bucket memakai *uniform bucket-level access* dan *public access prevention* (setelan yang aman dan memang disarankan), request dari frontend tetap akan dapat **403** walaupun CORS sudah benar. Frontend butuh salah satu dari ini:

- **Signed URL**, dibuat oleh backend dengan masa berlaku pendek. Ini pilihan yang tepat untuk file yang tidak boleh diakses sembarang orang.
- **IAM `allUsers` dengan role Storage Object Viewer**, kalau isi bucket memang dimaksudkan publik (misalnya aset statis). Untuk ini, public access prevention harus dimatikan dulu, jadi pastikan bucket-nya memang khusus untuk file publik.

Urutan debugging yang saya pakai: kalau dapat **403**, masalahnya izin (IAM atau signed URL). Kalau status-nya **200** tapi browser tetap protes soal CORS, baru masalahnya ada di aturan CORS.
