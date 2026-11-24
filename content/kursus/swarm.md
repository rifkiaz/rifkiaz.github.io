---
title: "Kursus Singkat Docker Swarm"
linkTitle: "Docker Swarm"
description: "Belajar orkestrasi container dengan Docker Swarm: bikin cluster, deploy service berreplika, routing mesh, scale, self-healing saat node mati, rolling update, rollback, drain, dan stack."
summary: "Dari satu mesin ke cluster: service, replika, routing mesh, self-healing, rolling update, rollback, drain, dan stack."
sim: swarm
layout: "kursus"
weight: 3
minutes: 25
level: "menengah"
next: "/kursus/ceph/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Dari satu mesin ke cluster"
    missions: [1]
    body: |
      `docker run` cuma menjalankan container di satu mesin. Kalau mesin itu mati, aplikasinya ikut mati. **Orkestrator** seperti Docker Swarm (atau Kubernetes) menyatukan beberapa mesin jadi satu cluster dan menjaga aplikasinya tetap jalan.

      Di Swarm ada dua peran:

      - **Manager**: menyimpan kondisi cluster, menerima perintah, dan memutuskan container jalan di mana (*scheduling*).
      - **Worker**: menjalankan container yang ditugaskan manager.

      `docker swarm init` mengubah mesin ini jadi manager pertama dan mencetak perintah `docker swarm join` berisi token. Mesin lain menjalankan perintah itu untuk bergabung.
    steps:
      - text: "Jadikan manager1 sebagai manager."
        cmd: "docker swarm init"
      - text: "Gabungkan worker1. Tombol ini menjalankan `docker swarm join` di worker1 lewat SSH."
        click: '[data-act="join"][data-n="worker1"]'
        label: "worker1: gabung ke swarm"
        wait: 1500
      - click: '[data-act="join"][data-n="worker2"]'
        label: "worker2: gabung ke swarm"
        wait: 1500
      - text: "Lihat anggota cluster."
        cmd: "docker node ls"
    quiz:
      q: "Di Swarm, siapa yang memutuskan container jalan di node mana?"
      options:
        - "Kamu, harus diatur manual per container"
        - "Manager, lewat proses scheduling"
        - "Worker memilih sendiri"
      answer: 1
      why: "Kamu cukup bilang \"mau 3 replika\". Manager yang memilih node berdasarkan resource, constraint, dan sebaran."

  - title: "Service, replika, dan routing mesh"
    missions: [2, 3]
    body: |
      Di Swarm kamu ga menjalankan container satu per satu. Kamu bikin **service**: deskripsi *kondisi yang diinginkan*, misalnya "nginx:1.25, 3 replika, port 8080". Swarm memecahnya jadi **task** (satu task = satu container) dan menyebarnya ke node.

      Port yang dipublikasikan service berlaku di **semua node** lewat **routing mesh**. Request ke port 8080 di node mana pun diteruskan ke salah satu task yang sehat, bahkan kalau node itu sendiri ga menjalankan task-nya. Load balancer di depan cluster jadi cukup mengarah ke semua node.
    steps:
      - cmd: "docker service create --name web --replicas 3 -p 8080:80 nginx:1.25"
        wait: 3000
      - text: "Lihat task-nya tersebar ke node mana saja."
        cmd: "docker service ps web"
      - text: "Gabungkan worker3. Dia belum punya task web."
        click: '[data-act="join"][data-n="worker3"]'
        label: "worker3: gabung ke swarm"
        wait: 1500
      - text: "Tapi curl ke worker3 tetap dijawab. Itu routing mesh."
        cmd: "curl worker3:8080"
    quiz:
      q: "Node X ga menjalankan task service web. Request ke X:8080..."
      options:
        - "Ditolak, connection refused"
        - "Diteruskan routing mesh ke task web di node lain"
        - "Membuat task baru di X"
      answer: 1
      why: "Port service dibuka di semua node anggota swarm, dan ingress network meneruskannya ke task yang sehat."

  - title: "Scale dan self-healing"
    missions: [4, 5]
    body: |
      Karena service itu *kondisi yang diinginkan*, menambah kapasitas cukup mengubah angkanya: `docker service scale web=6`. Swarm menambah task sampai jumlahnya sesuai.

      Prinsip yang sama bikin Swarm **menyembuhkan diri sendiri**. Manager terus membandingkan kondisi yang diinginkan dengan kenyataan. Kalau sebuah node mati, heartbeat-nya hilang, task di sana dianggap hilang, dan manager menjadwalkan pengganti di node lain.

      Catatan: waktu node itu hidup lagi, task yang sudah pindah **ga balik sendiri**. Swarm ga melakukan rebalance otomatis.
    steps:
      - cmd: "docker service scale web=6"
        wait: 3000
      - text: "Matikan worker1 (seperti cabut kabel listriknya), lalu tunggu beberapa detik."
        click: 'input[data-act="power"][data-n="worker1"]'
        state: "off"
        label: "matikan worker1"
        wait: 12000
      - text: "Task yang hilang sudah diganti di node lain."
        cmd: "docker service ps web"
      - text: "Nyalakan lagi worker1."
        click: 'input[data-act="power"][data-n="worker1"]'
        state: "on"
        label: "nyalakan worker1"
        wait: 3000
    quiz:
      q: "Worker1 mati lalu hidup lagi. Task yang tadi pindah ke worker lain..."
      options:
        - "Otomatis balik ke worker1"
        - "Tetap di node barunya; Swarm ga rebalance sendiri"
        - "Dihapus semua"
      answer: 1
      why: "Swarm cuma bertindak kalau jumlahnya kurang. Untuk menyebar ulang, kamu bisa paksa dengan `docker service update --force web`."

  - title: "Rolling update dan rollback"
    missions: [6, 7]
    body: |
      Ganti versi aplikasi tanpa downtime pakai **rolling update**: Swarm mengganti task satu per satu (atau sesuai `--update-parallelism`), menunggu jeda (`--update-delay`), lalu lanjut. Selama proses, sebagian task lama masih melayani request.

      Kalau task baru gagal start, update **berhenti** (*paused*) supaya kerusakannya ga menyebar. Dari sini `docker service rollback` mengembalikan service ke spesifikasi sebelumnya.

      Di production, pasang `--update-failure-action rollback` supaya rollback-nya otomatis.
    steps:
      - text: "Update ke nginx 1.27 dan tunggu sampai selesai. Lihat panel service di lab."
        cmd: "docker service update --image nginx:1.27 web"
        wait: 15000
      - text: "Sekarang update ke versi yang ga ada. Task baru gagal dan update berhenti."
        cmd: "docker service update --image nginx:9.9 web"
        wait: 8000
      - text: "Kembalikan ke versi sebelumnya."
        cmd: "docker service rollback web"
        wait: 12000
    quiz:
      q: "Update ke image rusak berhenti di tengah jalan. Kenapa itu bagus?"
      options:
        - "Supaya replika yang masih jalan dengan versi lama tetap melayani pengguna"
        - "Supaya Swarm bisa menghapus image rusak"
        - "Ga bagus, harusnya lanjut terus"
      answer: 0
      why: "Rolling update membatasi dampak. Cuma sebagian kecil task yang kena, sisanya masih versi lama yang sehat."

  - title: "Maintenance node dan stack"
    missions: [8]
    body: |
      Mau update OS atau ganti hardware di satu worker? Jangan langsung dimatikan. **Drain** dulu: `docker node update --availability drain worker2`. Swarm memindahkan task dari node itu dengan rapi dan ga menjadwalkan task baru ke sana. Selesai maintenance, set lagi ke `active`.

      Terakhir, mengetik `docker service create` panjang buat tiap service itu ga praktis. **Stack** memakai file format Compose (lihat `stack.yml` di lab) yang ditambah bagian `deploy:` untuk replika, update, dan placement. Satu `docker stack deploy` membuat atau memperbarui semua service-nya.
    steps:
      - cmd: "docker node update --availability drain worker2"
        wait: 2000
      - text: "worker2 sekarang `Drain` dan task-nya sudah pindah."
        cmd: "docker node ls"
      - cmd: "docker stack deploy -c stack.yml shop"
        wait: 3000
      - cmd: "docker stack services shop"
    quiz:
      q: "Bedanya drain dan mematikan node langsung?"
      options:
        - "Sama saja"
        - "Drain memindahkan task dengan terencana sebelum node berhenti, jadi ga ada jeda menunggu heartbeat hilang"
        - "Drain menghapus node dari cluster"
      answer: 1
      why: "Mematikan langsung bikin task hilang mendadak dan baru diganti setelah manager sadar. Drain memindahkannya dulu, baru kamu matikan dengan tenang."
recap: |
  Yang sudah kamu kuasai:

  - Manager vs worker, `swarm init` dan `join`.
  - Service, replika, task, dan routing mesh.
  - Scale, self-healing, rolling update, rollback.
  - Drain buat maintenance dan stack buat banyak service.

  Konsep yang sama (kondisi yang diinginkan, reconcile, rolling update) juga jadi inti Kubernetes.
---
Docker Swarm menjalankan container di banyak mesin sekaligus dan menjaganya tetap hidup. Lab-nya punya empat mesin: manager1 tempat terminal ini, plus worker1 sampai worker3 yang bisa kamu gabungkan, matikan, dan drain.
