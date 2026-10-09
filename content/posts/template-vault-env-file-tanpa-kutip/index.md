---
title: "Template Vault untuk File .env: Kapan Pakai Tanda Kutip, Kapan Tidak"
date: 2026-10-09T11:45:00+07:00
categories: [tutorial]
tags: [vault, consul-template, docker, env, devops, secrets]
description: "Memperbaiki template Vault (consul-template) yang menghasilkan file .env dengan value berkutip, kenapa kutipnya terbaca di Docker env-file tapi tidak di shell, dan cara menangani value multiline."
---

Di salah satu service, konfigurasi aplikasi diambil dari Vault lalu ditulis jadi file `.env` memakai template (consul-template / Vault Agent). Template awalnya kira-kira seperti ini:

```gotemplate
{{ with secret "secret/data/dev/app/my-service" }}
{{ range $k, $v := .Data.data }}
{{- if (contains "\n" $v) -}}
{{ $k }}="{{ $v | replaceAll "\n" "\\n" }}"
{{- else -}}
{{ $k }}="{{ $v }}"
{{- end }}
{{ end }}
{{ end }}
```

Hasilnya, setiap value dibungkus tanda kutip:

```
DB_HOST="db.example.internal"
API_KEY="<api-key>"
```

Lalu datang komplain dari tim aplikasi: konfigurasinya "nggak kebaca". Koneksi database gagal, padahal value di Vault benar.

## Kenapa kutipnya jadi masalah

Jawabannya tergantung **siapa yang membaca file itu**, karena aturan parsing `.env` tidak seragam:

| Cara baca | Tanda kutip |
|---|---|
| `docker run --env-file` | **ikut jadi bagian value** |
| `source .env` di bash | dilepas |
| `godotenv` dan library dotenv sejenis | dilepas |
| `env_file` di Docker Compose | dilepas di versi Compose modern, tapi perilakunya pernah berbeda antar versi |

Jadi kalau file ini dipakai sebagai `--env-file` di Docker, `DB_HOST` berisi literal `"db.example.internal"` lengkap dengan kutipnya, dan tentu saja host itu nggak bisa di-resolve.

## Template yang diperbaiki

Kutipnya dihilangkan, **kecuali** untuk value multiline seperti private key atau sertifikat. Value seperti itu tetap butuh kutip supaya `\n` hasil escape tidak merusak format file:

```gotemplate
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ if (contains "\n" $v) }}{{ $k }}="{{ $v | replaceAll "\n" "\\n" }}"
{{ else }}{{ $k }}={{ $v }}
{{ end }}{{ end }}{{ end }}
```

Template-nya sengaja ditulis rapat. Setiap baris baru di luar `{{ }}` ikut tercetak ke output, dan itu sumber baris-baris kosong di file hasil versi lama. Hasilnya sekarang:

```
DB_HOST=db.example.internal
API_KEY=<api-key>
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Kalau di path itu sama sekali nggak ada value multiline, template-nya bisa lebih sederhana:

```gotemplate
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ $k }}={{ $v }}
{{ end }}{{ end }}
```

## Risiko tanpa kutip

Menghapus kutip juga ada harganya, jadi cek dulu isi secret-nya sebelum apply:

- **Spasi dan `#`.** Di beberapa parser, value tanpa kutip yang mengandung spasi atau `#` bisa terpotong (bagian setelah `#` dianggap komentar).
- **Backtick dan `$`.** Di Docker env-file, karakter ini aman karena dibaca apa adanya. Tapi kalau ada yang menjalankan `source .env` di bash, backtick akan dieksekusi sebagai *command substitution* dan `$VAR` akan di-expand. Password acak sering mengandung karakter seperti ini.

Kalau setelah perubahan ini ada service lain yang malah rusak, kemungkinan besar service itu membaca file dengan cara yang berbeda (misalnya di-`source` dari shell). Solusi paling bersih adalah memastikan satu file hanya dikonsumsi dengan satu cara, atau membuat template terpisah per konsumen.

## Catatan soal berbagi screenshot

Waktu debugging seperti ini, gampang sekali seseorang mengirim screenshot isi `.env` ke chat untuk menunjukkan masalahnya. Padahal isinya access key cloud dan API key partner dalam bentuk terbaca. Kalau itu terjadi di channel yang diakses banyak orang, anggap key-nya sudah bocor: **rotate** key-nya, lalu hapus screenshot-nya. Untuk menunjukkan masalah format, cukup kirim nama key dengan value yang disamarkan.
