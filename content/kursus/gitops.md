---
title: "Kursus Singkat GitOps"
linkTitle: "GitOps"
description: "Belajar GitOps dengan Argo CD sambil praktik: Git sebagai sumber kebenaran, OutOfSync dan sync manual, auto-sync, self-heal saat ada yang mengubah cluster lewat kubectl, sampai memulihkan rilis yang rusak dengan git revert."
summary: "Git sebagai sumber kebenaran: sync, auto-sync, self-heal, dan memulihkan rilis rusak ala Argo CD."
sim: gitops
layout: "kursus"
weight: 9
minutes: 15
level: "menengah"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Git sebagai sumber kebenaran"
    missions: [1]
    body: |
      Cara lama deploy ke Kubernetes: CI menjalankan `kubectl apply` ke cluster. Masalahnya, CI butuh akses admin ke cluster, dan kalau ada yang mengubah cluster langsung, ga ada yang tahu.

      **GitOps** membaliknya. Kondisi yang diinginkan (manifest Kubernetes) disimpan di **repo Git**, dan sebuah agen di dalam cluster, misalnya **Argo CD**, terus membandingkan isi Git dengan isi cluster lalu menyamakannya.

      - Mau deploy? **Commit** ke Git. Ga ada lagi `kubectl apply` manual.
      - Riwayat deploy = riwayat Git: siapa, kapan, apa, dan bisa di-review lewat pull request.
      - Cluster ga perlu dibuka ke CI; Argo CD yang menarik perubahan dari dalam.
    steps:
      - text: "Naikkan jumlah replika di manifest (panel Git di kiri lab)."
        click: '[data-act="rep+"]'
        label: "replicas + 1"
      - text: "Commit dan push ke repo."
        click: '[data-act="commit"]'
        label: "commit & push"
        wait: 1000
    quiz:
      q: "Di GitOps, cara yang benar untuk deploy versi baru adalah..."
      options:
        - "`kubectl apply` dari laptop"
        - "Commit perubahan manifest ke repo Git"
        - "SSH ke node lalu restart container"
      answer: 1
      why: "Git adalah satu-satunya sumber kebenaran. Argo CD yang membawa perubahan itu ke cluster."

  - title: "OutOfSync dan sync manual"
    missions: [2]
    body: |
      Argo CD mengecek Git secara berkala (aslinya tiap 3 menit, di lab dipercepat jadi 10 detik), atau langsung saat kamu klik **refresh** / ada webhook.

      Begitu isi Git beda dengan cluster, aplikasinya berstatus **OutOfSync** dan Argo CD menampilkan **diff**-nya. Dalam mode manual, ga ada yang berubah sampai seseorang menekan **sync**. Ada dua status yang perlu dibedakan:

      - **Sync status** (Synced / OutOfSync): apakah cluster sama dengan Git?
      - **Health status** (Healthy / Progressing / Degraded): apakah aplikasinya benar-benar jalan?
    steps:
      - text: "Paksa Argo CD membaca Git sekarang. Status jadi OutOfSync dan diff-nya muncul."
        click: '[data-act="refresh"]'
        label: "refresh"
        wait: 1500
      - text: "Terapkan ke cluster."
        click: '[data-act="sync"]'
        label: "sync"
        wait: 3000
    quiz:
      q: "Aplikasi berstatus **Synced** tapi **Degraded**. Artinya?"
      options:
        - "Cluster sudah sama dengan Git, tapi aplikasinya bermasalah (misalnya pod crash)"
        - "Git belum di-commit"
        - "Argo CD mati"
      answer: 0
      why: "Sync cuma memastikan manifest terpasang. Health melihat apakah hasilnya sehat. Manifest yang benar pun bisa berisi image yang rusak."

  - title: "Auto-sync"
    missions: [3]
    body: |
      Menekan sync tiap kali itu ga beda jauh dengan deploy manual. Dengan **auto-sync**, Argo CD langsung menerapkan setiap perubahan yang dia temukan di Git. Alur rilis jadi: merge pull request → beberapa saat kemudian sudah jalan di cluster.

      Kontrolnya pindah ke Git: siapa yang boleh merge ke branch itu, review apa yang wajib, dan seterusnya.
    steps:
      - text: "Nyalakan auto-sync."
        click: "#gx-auto"
        state: "on"
        label: "auto-sync: on"
      - text: "Ganti tag image ke v1.1.0."
        select: "#gx-tag"
        value: "v1.1.0"
        label: "image: toko-web:v1.1.0"
      - text: "Commit, lalu tunggu Argo CD menemukannya sendiri (maksimal 10 detik)."
        click: '[data-act="commit"]'
        label: "commit & push"
        wait: 14000
    quiz:
      q: "Dengan auto-sync aktif, apa yang memicu deploy?"
      options:
        - "Perubahan di repo Git"
        - "Tombol sync"
        - "Restart pod"
      answer: 0
      why: "Argo CD mendeteksi commit baru (lewat polling atau webhook) dan langsung menyinkronkannya."

  - title: "Self-heal"
    missions: [4]
    body: |
      Seseorang panik waktu traffic naik dan menjalankan `kubectl scale` langsung ke cluster. Sekarang cluster ga sama dengan Git: ini **drift**.

      Dengan **self-heal**, Argo CD mengembalikan cluster ke isi Git secara otomatis, beberapa detik setelah drift terdeteksi. Perubahan "diam-diam" ga bertahan lama. Kalau memang perlu 5 replika, caranya ya commit ke Git.
    steps:
      - text: "Nyalakan self-heal."
        click: "#gx-heal"
        state: "on"
        label: "self-heal: on"
      - text: "Jadi orang yang iseng mengubah cluster langsung."
        click: '[data-act="kube"][data-k="scale"]'
        label: "kubectl scale deploy/toko-web"
        wait: 6000
    quiz:
      q: "Self-heal aktif, lalu ada yang menjalankan `kubectl set image` ke versi lain. Yang terjadi?"
      options:
        - "Versi baru itu dipertahankan"
        - "Argo CD mengembalikannya ke versi yang tertulis di Git"
        - "Argo CD menghapus deployment"
      answer: 1
      why: "Self-heal menganggap Git benar dan cluster yang menyimpang. Semua perubahan di luar Git dikembalikan."

  - title: "Rilis rusak dan cara pulih"
    missions: [5]
    body: |
      Kadang versi baru memang rusak. Di lab, `v2.0.0` bikin pod crash (**Degraded**).

      Dengan auto-sync aktif, tombol *rollback* di Argo CD dinonaktifkan, karena rollback di cluster bakal langsung ditimpa lagi oleh isi Git. Cara GitOps yang benar: **perbaiki Git**. Paling cepat dengan `git revert` commit yang bermasalah. Argo CD melihat commit revert itu, menyinkronkannya, dan aplikasi kembali sehat. Riwayatnya pun tercatat rapi.
    steps:
      - text: "Rilis v2.0.0 yang ada bug-nya."
        select: "#gx-tag"
        value: "v2.0.0"
        label: "image: toko-web:v2.0.0"
      - click: '[data-act="commit"]'
        label: "commit & push"
        wait: 16000
      - text: "Aplikasi Degraded. Revert commit terakhir di Git."
        click: '[data-act="revert"]'
        label: "git revert"
        wait: 16000
    quiz:
      q: "Auto-sync aktif dan rilis baru rusak. Cara pulih ala GitOps?"
      options:
        - "`kubectl rollout undo` di cluster"
        - "`git revert` commit yang bermasalah dan biarkan Argo CD menyinkronkan"
        - "Matikan Argo CD"
      answer: 1
      why: "Kalau cuma diubah di cluster, auto-sync akan mengembalikan versi rusak dari Git. Perbaikannya harus di Git."
recap: |
  Yang sudah kamu kuasai:

  - Git sebagai sumber kebenaran, sync status vs health status.
  - Sync manual, auto-sync, dan self-heal.
  - Memulihkan rilis rusak lewat `git revert`.
---
GitOps menjadikan repo Git satu-satunya sumber kebenaran untuk isi cluster Kubernetes. Lab-nya mensimulasikan repo manifest, Argo CD, dan cluster dengan pod yang bisa kamu lihat berganti versi.
