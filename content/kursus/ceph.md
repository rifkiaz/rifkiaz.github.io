---
title: "Kursus Singkat Ceph"
linkTitle: "Ceph"
description: "Belajar storage terdistribusi Ceph sambil praktik: membaca ceph -s, bikin pool, menaruh objek, melacak objek ke OSD lewat CRUSH, recovery saat disk rusak, noout buat maintenance, cluster yang hampir penuh, dan quorum monitor."
summary: "OSD, pool, PG, CRUSH, replikasi, recovery, noout, nearfull, dan quorum monitor. Storage yang tetap jalan walau disk rusak."
sim: ceph
layout: "kursus"
weight: 4
minutes: 25
level: "menengah"
next: "/kursus/openstack/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Kenalan dengan cluster"
    missions: [1]
    body: |
      **Ceph** menggabungkan disk dari banyak server jadi satu storage besar yang tahan rusak. Komponen yang perlu kamu tahu:

      - **OSD** (Object Storage Daemon): satu proses per disk. Dialah yang menyimpan data. Lab ini punya 3 node × 2 disk = 6 OSD.
      - **MON** (monitor): menyimpan "peta" cluster dan menjaga kesepakatan soal siapa yang hidup. Ada 3, di node1 sampai node3.
      - **MGR** (manager): metrik, dashboard, dan orkestrasi (`ceph orch`).

      Perintah pertama yang selalu dijalankan admin Ceph: `ceph -s`. Lihat bagian `health` (idealnya `HEALTH_OK`), jumlah mon, OSD `up`/`in`, dan status PG.
    steps:
      - cmd: "ceph -s"
      - text: "Pohon OSD per host. Struktur ini dipakai CRUSH buat menyebar salinan."
        cmd: "ceph osd tree"
      - text: "Kapasitas dan pemakaian."
        cmd: "ceph df"
    quiz:
      q: "Satu OSD di Ceph itu biasanya mewakili..."
      options:
        - "Satu server"
        - "Satu disk"
        - "Satu pool"
      answer: 1
      why: "Umumnya satu OSD per disk. Server dengan 12 disk menjalankan 12 OSD."

  - title: "Pool, objek, dan CRUSH"
    missions: [2, 3]
    body: |
      Data di Ceph disimpan sebagai **objek** di dalam **pool**. Pool menentukan aturan, misalnya `size 3` (tiap objek punya 3 salinan) dan `min_size 2` (tetap bisa ditulis selama minimal 2 salinan hidup).

      Ceph ga menyimpan daftar "objek X ada di disk Y". Lokasinya **dihitung**:

      1. Nama objek di-hash ke salah satu **PG** (placement group) milik pool.
      2. Algoritma **CRUSH** memetakan PG itu ke beberapa OSD, dengan aturan tiap salinan di host berbeda.

      Karena dihitung, klien mana pun bisa langsung tahu harus menghubungi OSD mana tanpa bertanya ke server pusat. Itu salah satu rahasia Ceph bisa sangat besar.
    steps:
      - cmd: "ceph osd pool create data"
      - text: "Tandai pool ini dipakai untuk apa (rbd, cephfs, atau rgw). Tanpa ini Ceph memberi peringatan."
        cmd: "ceph osd pool application enable data rbd"
      - text: "Simpan satu objek."
        cmd: "rados -p data put foto.jpg ./foto.jpg"
      - cmd: "rados -p data ls"
      - text: "Lacak objek itu: masuk PG mana dan OSD mana saja yang memegang salinannya."
        cmd: "ceph osd map data foto.jpg"
    quiz:
      q: "Bagaimana klien Ceph tahu objek `foto.jpg` disimpan di OSD mana?"
      options:
        - "Bertanya ke database lokasi di server pusat"
        - "Menghitungnya sendiri: hash nama → PG → CRUSH → daftar OSD"
        - "Mencari ke semua OSD satu per satu"
      answer: 1
      why: "Dengan peta cluster dari monitor, klien menghitung lokasi sendiri. Ga ada tabel lokasi yang jadi bottleneck."

  - title: "Disk rusak dan recovery"
    missions: [4]
    body: |
      Disk pasti rusak, cepat atau lambat. Yang terjadi di Ceph:

      1. OSD berhenti mengirim heartbeat dan ditandai **down**. PG yang salinannya ada di sana jadi `degraded`: masih bisa dibaca dan ditulis, tapi salinannya kurang.
      2. Setelah beberapa waktu (di lab 12 detik, aslinya 10 menit), OSD itu ditandai **out**. CRUSH menghitung ulang, dan Ceph **menyalin ulang** data ke OSD lain (*backfill/recovery*).
      3. Begitu semua salinan lengkap lagi, kembali `HEALTH_OK`, walau disk-nya belum diganti.

      Kamu ga perlu panik tengah malam. Ceph membereskan redundansinya sendiri.
    steps:
      - text: "Isi pool dengan data dulu supaya ada yang perlu di-recovery."
        cmd: "rados bench -p data 30 write --no-cleanup"
        wait: 3000
      - text: "Rusakkan disk osd.0. Tonton kartunya berubah down, lalu out."
        click: '.cp-osd[data-id="0"]'
        label: "rusak disk osd.0"
        wait: 3000
      - cmd: "ceph health detail"
      - text: "Tunggu sekitar setengah menit. Lihat bar PG berubah dari degraded, recovering, sampai clean."
        cmd: "ceph -s"
        wait: 40000
      - text: "Sudah `HEALTH_OK` tanpa osd.0. Sekarang perbaiki disk-nya (klik lagi kartunya)."
        click: '.cp-osd[data-id="0"]'
        label: "nyalakan ulang osd.0"
        wait: 3000
    quiz:
      q: "OSD baru saja **down** tapi belum **out**. Kondisi data?"
      options:
        - "Data hilang"
        - "Masih bisa diakses, tapi salinannya kurang (degraded)"
        - "Cluster berhenti total"
      answer: 1
      why: "Dengan `size 3, min_size 2`, kehilangan satu salinan masih aman untuk baca dan tulis. Ceph menunggu sebentar sebelum mulai menyalin ulang, siapa tahu OSD-nya cuma reboot."

  - title: "Maintenance dengan noout"
    missions: [5]
    body: |
      Kadang node sengaja dimatikan: update kernel, ganti RAM, pindah rak. Kalau dibiarkan, setelah timeout OSD-nya ditandai **out** dan Ceph mulai menyalin ulang ratusan GB. Padahal node-nya cuma pergi 5 menit, dan setelah kembali datanya disalin balik lagi. Buang-buang bandwidth.

      Flag **`noout`** mencegah OSD ditandai out selama flag itu aktif. Data tetap `degraded` sementara, tapi ga ada perpindahan besar-besaran. Polanya:

      1. `ceph osd set noout`
      2. Matikan node, kerjakan maintenance, nyalakan lagi.
      3. `ceph osd unset noout`, supaya cluster kembali melindungi diri secara otomatis.
    steps:
      - cmd: "ceph osd set noout"
      - text: "Matikan node3."
        click: 'input[data-act="power"][data-h="node3"]'
        state: "off"
        label: "matikan node3"
        wait: 4000
      - text: "Perhatikan: OSD-nya down tapi tetap `in`, dan ada peringatan flag noout."
        cmd: "ceph -s"
        wait: 2000
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "on"
        label: "nyalakan node3"
        wait: 4000
      - text: "Jangan lupa dilepas lagi."
        cmd: "ceph osd unset noout"
        wait: 1500
    quiz:
      q: "Kenapa `noout` harus dilepas lagi setelah maintenance?"
      options:
        - "Karena memakan RAM"
        - "Karena selama aktif, OSD yang benar-benar rusak juga ga akan di-out dan datanya ga dipulihkan"
        - "Karena Ceph ga bisa ditulis selama noout"
      answer: 1
      why: "noout mematikan perlindungan otomatis. Lupa melepasnya berarti disk yang rusak beneran dibiarkan degraded selamanya."

  - title: "Cluster hampir penuh"
    missions: [6]
    body: |
      Ceph membagi rata data ke semua OSD, tapi ga pernah benar-benar rata. Yang menentukan bukan rata-rata, melainkan **OSD yang paling penuh**:

      - **nearfull** (85%): peringatan, saatnya tambah kapasitas.
      - **backfillfull** (90%): OSD itu ga mau menerima data recovery.
      - **full** (95%): **semua penulisan ke cluster berhenti**, demi mencegah kerusakan.

      Ingat juga, dengan `size 3`, 1 GB data memakan 3 GB raw. Cara paling sehat keluar dari nearfull: **tambah node dan OSD**, lalu Ceph menyebar ulang datanya otomatis.
    steps:
      - text: "Tulis data besar sampai cluster nearfull."
        cmd: "rados bench -p data 240 write --no-cleanup"
        wait: 3000
      - cmd: "ceph osd df"
      - text: "Tambah node4 ke cluster..."
        cmd: "ceph orch host add node4 10.0.0.24"
        wait: 1500
      - text: "...lalu jadikan semua disk kosongnya OSD."
        cmd: "ceph orch apply osd --all-available-devices"
        wait: 4000
      - text: "Tunggu rebalance selesai, lalu cek lagi. Peringatan nearfull hilang."
        cmd: "ceph osd df"
        wait: 30000
      - cmd: "ceph -s"
    quiz:
      q: "Rata-rata pemakaian cluster 70%, tapi satu OSD sudah 95%. Apa yang terjadi?"
      options:
        - "Aman, yang dihitung rata-ratanya"
        - "Cluster berhenti menerima tulisan karena ada OSD yang full"
        - "Ceph menghapus data lama otomatis"
      answer: 1
      why: "Satu OSD full cukup untuk memblokir penulisan, karena objek yang dipetakan ke OSD itu ga bisa ditulis. Pantau `ceph osd df`, bukan cuma `ceph df`."

  - title: "Quorum monitor"
    missions: [7]
    body: |
      Monitor harus **sepakat** tentang kondisi cluster. Mereka memakai algoritma Paxos dan butuh **mayoritas** (quorum) yang hidup: dengan 3 monitor, minimal 2.

      Kalau mayoritas hilang, monitor yang tersisa ga berani memutuskan apa pun (bisa saja dia yang terisolasi). Akibatnya **seluruh cluster berhenti melayani**, walau OSD-nya sehat. Perintah `ceph` pun cuma menggantung.

      Karena itu jumlah monitor selalu **ganjil** (3 atau 5) dan ditaruh di host, rak, atau zona yang berbeda.
    steps:
      - text: "Matikan node2 dan node3 sekaligus. Monitor tinggal satu dari tiga."
        click: 'input[data-act="power"][data-h="node2"]'
        state: "off"
        label: "matikan node2"
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "off"
        label: "matikan node3"
        wait: 4000
      - text: "Coba cek status. Tanpa quorum, perintahnya timeout."
        cmd: "ceph -s"
        wait: 4000
      - text: "Nyalakan lagi keduanya."
        click: 'input[data-act="power"][data-h="node2"]'
        state: "on"
        label: "nyalakan node2"
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "on"
        label: "nyalakan node3"
        wait: 5000
      - cmd: "ceph -s"
    quiz:
      q: "Kenapa cluster Ceph pakai 3 monitor, bukan 2?"
      options:
        - "Dengan 2 monitor, satu mati saja sudah kehilangan mayoritas"
        - "Supaya lebih cepat"
        - "Karena 2 ga didukung Ceph"
      answer: 0
      why: "Mayoritas dari 2 adalah 2, jadi ga ada toleransi sama sekali. Dengan 3, satu boleh mati; dengan 5, dua boleh mati."
recap: |
  Yang sudah kamu kuasai:

  - Membaca `ceph -s`, `ceph osd tree`, `ceph osd df`.
  - Pool, PG, CRUSH, dan cara Ceph menghitung lokasi objek.
  - Recovery otomatis, `noout` buat maintenance, batas nearfull/full.
  - Kenapa monitor butuh quorum dan jumlahnya ganjil.

  Langkah berikutnya: Ceph sering jadi storage di balik private cloud OpenStack.
---
Ceph adalah storage terdistribusi yang dipakai dari cluster kecil sampai skala petabyte, dan sering jadi storage di balik OpenStack dan Kubernetes. Lab-nya berisi cluster 3 node (plus satu node cadangan) yang disk dan listriknya bisa kamu "rusak" sendiri.
