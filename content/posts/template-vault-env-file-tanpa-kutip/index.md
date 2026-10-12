---
title: "Template Vault untuk File .env: Kapan Pakai Tanda Kutip, Kapan Tidak"
date: 2026-09-12T14:22:00+07:00
categories: [tutorial]
tags: [vault, consul-template, docker, env, devops, secrets]
description: "Memperbaiki template Vault (consul-template) yang menghasilkan file .env dengan value berkutip, kenapa kutipnya terbaca di Docker env-file tapi tidak di shell, dan cara menangani value multiline."
---
### Pendahuluan
Di salah satu service, konfigurasi aplikasi diambil dari Vault lalu ditulis jadi file `.env` pakai template (consul-template / Vault Agent). Template awalnya kurang lebih seperti ini:
```
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
Hasilnya setiap value dibungkus tanda kutip:
````
DB_HOST="db.example.internal"
API_KEY="<api-key>"
````
Lalu datang komplain dari tim aplikasi, katanya konfigurasinya "gak kebaca". Koneksi database gagal, padahal value di Vault sudah benar (lumayan bikin pusing). Pada tulisan kali ini saya akan berbagi penyebab dan cara memperbaikinya.

### Kenapa kutipnya jadi masalah
Ternyata tergantung **siapa yang membaca file itu**, karena aturan parsing `.env` gak seragam:

| Cara baca | Tanda kutip |
|---|---|
| `docker run --env-file` | **ikut jadi bagian value** |
| `source .env` di bash | dilepas |
| `godotenv` dan library dotenv sejenis | dilepas |
| `env_file` di Docker Compose | dilepas di versi Compose modern, tapi perilakunya pernah beda antar versi |

Jadi kalau file ini dipakai sebagai `--env-file` di Docker, `DB_HOST` isinya literal `"db.example.internal"` lengkap dengan kutipnya, dan tentu saja host itu gak bisa di-resolve.

### Template yang diperbaiki
Kutipnya dihilangkan, **kecuali** untuk value multiline seperti private key atau sertifikat. Value seperti itu tetap butuh kutip supaya `\n` hasil escape gak merusak format file.
```
vim env.tpl

............
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ if (contains "\n" $v) }}{{ $k }}="{{ $v | replaceAll "\n" "\\n" }}"
{{ else }}{{ $k }}={{ $v }}
{{ end }}{{ end }}{{ end }}
```
Template-nya memang sengaja ditulis rapat. Setiap baris baru di luar `{{ }}` ikut tercetak ke output, dan itu yang bikin banyak baris kosong di file hasil versi lama. Sekarang hasilnya seperti berikut:
````
DB_HOST=db.example.internal
API_KEY=<api-key>
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
````
Kalau di path itu gak ada value multiline sama sekali, template-nya bisa lebih sederhana:
```
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ $k }}={{ $v }}
{{ end }}{{ end }}
```

### Risiko tanpa kutip
Menghapus kutip juga ada risikonya, jadi cek dulu isi secret-nya sebelum apply:
1. **Spasi dan `#`.** Di beberapa parser, value tanpa kutip yang ada spasi atau `#` bisa terpotong (bagian setelah `#` dianggap komentar).
2. **Backtick dan `$`.** Di Docker env-file karakter ini aman karena dibaca apa adanya. Tapi kalau ada yang menjalankan `source .env` di bash, backtick akan dieksekusi sebagai *command substitution* dan `$VAR` akan di-expand. Password acak sering ada karakter seperti ini.

Kalau setelah perubahan ini ada service lain yang malah rusak, kemungkinan besar service itu membaca file dengan cara yang beda (misalnya di-`source` dari shell). Solusi paling bersih adalah memastikan satu file cuma dipakai dengan satu cara, atau buat template terpisah per konsumen.

### Catatan soal berbagi screenshot
Waktu debugging seperti ini, gampang banget ada yang kirim screenshot isi `.env` ke chat untuk menunjukkan masalahnya. Padahal isinya access key cloud dan API key partner yang kebaca jelas. Kalau itu terjadi di channel yang diakses banyak orang, anggap saja key-nya sudah bocor: **rotate** key-nya, lalu hapus screenshot-nya. Untuk menunjukkan masalah format, cukup kirim nama key dengan value yang disamarkan.

Sekian, semoga membantu.

Referensi:
- [Vault Agent templates](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent/template)
- [docker run --env-file](https://docs.docker.com/reference/cli/docker/container/run/#env)
