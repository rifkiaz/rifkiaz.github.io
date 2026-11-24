---
title: "Kursus Singkat Docker"
linkTitle: "Docker"
description: "Belajar Docker sambil praktik: jalankan container, build image sendiri dari Dockerfile, simpan data pakai volume, manfaatkan cache layer, lalu naikkan beberapa service sekaligus dengan Compose."
summary: "Image vs container, Dockerfile, port, volume, cache layer, dan Docker Compose. Fondasi sebelum belajar Swarm atau Kubernetes."
sim: docker
layout: "kursus"
weight: 2
minutes: 25
level: "pemula"
next: "/kursus/swarm/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Image dan container"
    missions: [1]
    body: |
      Dua istilah yang paling sering ketuker:

      - **Image** itu cetakan: berisi sistem file minimal, aplikasi, dan perintah untuk menjalankannya. Image ga bisa diubah (*read-only*). Contoh: `nginx`, `python:3.12-slim`.
      - **Container** itu proses yang jalan dari sebuah image. Satu image bisa dipakai buat banyak container sekaligus.

      Container punya jaringan sendiri yang terisolasi. Supaya bisa diakses dari laptop, port-nya harus dipetakan pakai `-p PORT_LAPTOP:PORT_CONTAINER`. Jadi `-p 8080:80` artinya "port 8080 di laptop diteruskan ke port 80 di dalam container".

      Opsi lain yang sering dipakai: `-d` (jalan di background) dan `--name` (kasih nama supaya gampang dipanggil).
    steps:
      - text: "Jalankan nginx. Image-nya belum ada di laptop, jadi Docker otomatis menariknya (*pull*) dulu."
        cmd: "docker run -d -p 8080:80 --name web nginx"
        wait: 6000
      - text: "Lihat container yang sedang jalan."
        cmd: "docker ps"
      - text: "Buka web-nya lewat port yang dipetakan."
        cmd: "curl localhost:8080"
      - text: "Intip log container. Request barusan tercatat di sini."
        cmd: "docker logs web"
    quiz:
      q: "Apa arti `-p 3000:80`?"
      options:
        - "Port 3000 di container diteruskan ke port 80 di laptop"
        - "Port 3000 di laptop diteruskan ke port 80 di container"
        - "Container boleh pakai port 3000 sampai 80"
      answer: 1
      why: "Formatnya selalu `HOST:CONTAINER`. Yang kiri port yang kamu buka di laptop, yang kanan port tempat aplikasi mendengarkan di dalam container."

  - title: "Build image sendiri"
    missions: [2, 3]
    body: |
      Image buat aplikasimu sendiri dibuat dari **Dockerfile**: resep langkah demi langkah. Buka tab `Dockerfile` di lab:

      - `FROM python:3.12-slim` mulai dari image dasar yang sudah ada Python-nya.
      - `WORKDIR /app` pindah ke folder kerja di dalam image.
      - `COPY . .` salin file proyek ke image.
      - `RUN pip install ...` jalankan perintah waktu *build* (hasilnya ikut tersimpan di image).
      - `EXPOSE 5000` dokumentasi port yang dipakai aplikasi.
      - `CMD [...]` perintah yang dijalankan waktu container *start*.

      `docker build -t app:1.0 .` membangun image dari Dockerfile di folder ini (titik di akhir) dan memberinya nama `app` dengan tag `1.0`.
    steps:
      - cmd: "docker build -t app:1.0 ."
        wait: 6000
      - text: "Image-mu sekarang ada di daftar."
        cmd: "docker images"
      - text: "Jalankan. Aplikasi Flask-nya mendengarkan di port 5000."
        cmd: "docker run -d -p 5000:5000 --name app app:1.0"
      - cmd: "curl localhost:5000"
      - text: "Panggil sekali lagi. Hitungan kunjungannya naik."
        cmd: "curl localhost:5000"
    quiz:
      q: "Bedanya `RUN` dan `CMD` di Dockerfile?"
      options:
        - "`RUN` jalan waktu build, `CMD` jalan waktu container start"
        - "Sama saja, cuma beda gaya penulisan"
        - "`RUN` buat Linux, `CMD` buat Windows"
      answer: 0
      why: "`RUN` dieksekusi sekali saat membangun image (misal install paket). `CMD` adalah perintah default tiap kali container dijalankan."

  - title: "Data yang ga hilang: volume"
    missions: [4]
    body: |
      Container itu **sekali pakai**. Kalau container dihapus, semua yang ditulis di dalamnya ikut hilang. Aplikasi di lab menyimpan hitungan kunjungan di `/data/hits.txt`, jadi kalau container-nya dibuat ulang, hitungannya balik ke 1.

      Solusinya **volume**: penyimpanan yang dikelola Docker dan hidup terpisah dari container. `-v hits:/data` artinya "pasang volume bernama `hits` ke folder `/data` di container". Container boleh dihapus dan dibuat ulang, isi volume tetap ada.

      > Aturan praktis: apa pun yang harus bertahan (database, upload, hitungan) taruh di volume. Container-nya sendiri anggap saja bisa dibuang kapan pun.
    steps:
      - text: "Hapus container app yang lama (`-f` = paksa walau masih jalan)."
        cmd: "docker rm -f app"
      - text: "Jalankan lagi, kali ini dengan volume."
        cmd: "docker run -d -p 5000:5000 -v hits:/data --name app app:1.0"
      - cmd: "curl localhost:5000"
      - text: "Sekarang hapus dan bikin ulang container-nya."
        cmd: "docker rm -f app"
      - cmd: "docker run -d -p 5000:5000 -v hits:/data --name app app:1.0"
      - text: "Hitungannya lanjut, ga balik ke 1."
        cmd: "curl localhost:5000"
      - cmd: "docker volume ls"
    quiz:
      q: "Kamu menjalankan database di container tanpa volume, lalu container-nya dihapus. Datanya?"
      options:
        - "Aman, tersimpan di image"
        - "Hilang bersama container"
        - "Otomatis pindah ke volume"
      answer: 1
      why: "Image itu read-only, jadi tulisan apa pun masuk ke lapisan tipis milik container. Container dihapus, lapisan itu ikut hilang."

  - title: "Build lebih cepat dengan cache layer"
    missions: [5]
    body: |
      Tiap baris di Dockerfile menghasilkan satu **layer**. Docker menyimpan layer-layer ini sebagai cache. Waktu build ulang, layer yang input-nya ga berubah dipakai lagi (`CACHED`), jadi build jauh lebih cepat.

      Tapi begitu satu layer berubah, **semua layer di bawahnya ikut dibangun ulang**. Di Dockerfile awal, `COPY . .` ada sebelum `pip install`. Akibatnya, ubah satu huruf di `app.py` saja sudah bikin `pip install` jalan ulang dari nol.

      Triknya: salin dulu file yang jarang berubah (`requirements.txt`), install dependensi, baru salin sisa kode.
    steps:
      - text: "Atur ulang urutan di Dockerfile."
        edit:
          file: "Dockerfile"
          tab: '[data-act="tab"][data-f="Dockerfile"]'
          find: |-
            COPY . .
            RUN pip install -r requirements.txt
          replace: |-
            COPY requirements.txt .
            RUN pip install -r requirements.txt
            COPY . .
      - text: "Build sekali supaya cache-nya terbentuk dengan urutan baru."
        cmd: "docker build -t app:1.1 ."
        wait: 6000
      - text: "Sekarang ubah kodenya."
        edit:
          file: "app.py"
          tab: '[data-act="tab"][data-f="app.py"]'
          find: '"Halo dari container!"'
          replace: '"Halo dari kursus Docker!"'
      - text: "Build lagi. Perhatikan `pip install` sekarang `CACHED`, cuma `COPY . .` yang jalan ulang."
        cmd: "docker build -t app:1.2 ."
        wait: 6000
    quiz:
      q: "Kenapa `COPY requirements.txt .` ditaruh sebelum `COPY . .`?"
      options:
        - "Supaya image lebih kecil"
        - "Supaya layer `pip install` tetap ke-cache waktu yang berubah cuma kode aplikasi"
        - "Karena Docker mewajibkan urutan itu"
      answer: 1
      why: "Cache layer putus di baris pertama yang input-nya berubah. Dengan urutan ini, perubahan kode cuma membatalkan cache mulai dari `COPY . .`."

  - title: "Banyak service sekaligus: Compose"
    missions: [6]
    body: |
      Aplikasi beneran jarang cuma satu container. Biasanya ada web, cache, database, dan seterusnya. Mengetik `docker run` panjang buat masing-masing itu melelahkan dan gampang salah.

      **Docker Compose** menuliskan semuanya di satu file `compose.yaml`: service apa saja, image atau build-nya, port, environment, volume, dan urutan start (`depends_on`). Buka tab `compose.yaml` di lab.

      Satu perintah `docker compose up -d` membangun dan menjalankan semuanya. Service di file yang sama juga otomatis satu jaringan dan bisa saling panggil pakai nama service-nya (misalnya `cache`).
    steps:
      - text: "Naikkan semua service."
        cmd: "docker compose up -d"
        wait: 6000
      - cmd: "docker compose ps"
      - text: "Web dari Compose dipetakan ke port 8000."
        cmd: "curl localhost:8000"
    quiz:
      q: "Di compose.yaml, service `web` mau terhubung ke Redis di service `cache`. Host yang dipakai web adalah..."
      options:
        - "`localhost`"
        - "`cache`"
        - "IP laptop kamu"
      answer: 1
      why: "Compose membuat jaringan bersama dan DNS internal, jadi tiap service bisa dipanggil pakai namanya. `localhost` di dalam container artinya container itu sendiri."
recap: |
  Yang sudah kamu kuasai:

  - Bedanya image dan container, serta `docker run -d -p --name`.
  - Menulis dan membangun Dockerfile, plus urutan layer yang ramah cache.
  - Volume buat data yang harus bertahan.
  - `docker compose up` buat banyak service sekaligus.

  Langkah berikutnya: jalankan container di banyak server dengan Docker Swarm.
---
Docker membungkus aplikasi beserta semua kebutuhannya jadi satu paket yang jalan sama persis di laptop, server, atau cloud. Di kursus ini kamu mulai dari menjalankan nginx sampai menaikkan aplikasi multi-service dengan Compose.
