---
title: "Kursus Singkat Ansible"
linkTitle: "Ansible"
description: "Belajar Ansible sambil praktik ke lima server lab: inventory, perintah ad-hoc, playbook pertama, idempotensi, dry run dengan --check --diff, --limit, dan playbook yang jalan di Ubuntu maupun Rocky Linux."
summary: "Inventory, ad-hoc, playbook, handler, idempotensi, --check --diff, --limit, dan playbook lintas distro."
sim: ansible
layout: "kursus"
weight: 8
minutes: 25
level: "pemula"
next: "/kursus/gitops/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Inventory dan perintah ad-hoc"
    missions: [1]
    body: |
      Ansible mengatur banyak server sekaligus lewat **SSH biasa**. Ga perlu agent yang dipasang di server, cukup Python dan akses SSH.

      Daftar server ada di **inventory**. Buka tab `inventory.ini` di lab:

      - `[web]` dan `[db]` adalah **grup**. Kamu bisa menargetkan satu grup, satu host, atau `all`.
      - `[all:vars]` berisi variabel untuk semua host, misalnya user SSH-nya.

      Perintah **ad-hoc** cocok buat hal cepat sekali jalan: `ansible <target> -m <modul> -a <argumen>`. Modul `ping` bukan ping ICMP, tapi tes "bisa SSH dan ada Python-nya?".
    steps:
      - text: "Lihat struktur inventory dalam bentuk pohon."
        cmd: "ansible-inventory --graph"
      - text: "Tes koneksi ke semua host."
        cmd: "ansible all -m ping"
        wait: 2500
      - text: "Jalankan perintah di grup web saja."
        cmd: 'ansible web -a "uptime"'
        wait: 2000
    quiz:
      q: "Apa yang perlu dipasang di server supaya bisa diatur Ansible?"
      options:
        - "Agent Ansible yang jalan terus sebagai service"
        - "Cukup SSH dan Python"
        - "Docker"
      answer: 1
      why: "Ansible itu *agentless*. Dia SSH ke server, mengirim modul kecil, menjalankannya pakai Python, lalu membersihkannya lagi."

  - title: "Playbook pertama"
    missions: [2]
    body: |
      Untuk pekerjaan yang diulang-ulang, tulis **playbook** (YAML). Buka tab `site.yml`:

      - Satu **play** = target (`hosts: web`) + daftar **task**.
      - Tiap task memanggil satu **modul**: `apt` pasang paket, `template` menulis file dari template Jinja2, `service` mengatur service.
      - `become: true` artinya jalankan sebagai root (sudo).
      - `notify: restart nginx` memanggil **handler**. Handler cuma jalan kalau task pemanggilnya benar-benar mengubah sesuatu, dan jalannya sekali di akhir play.

      Waktu playbook jalan, tiap task per host melapor `ok` (sudah sesuai), `changed` (diubah), atau `failed`.
    steps:
      - cmd: "ansible-playbook site.yml"
        wait: 9000
      - text: "Cek halaman yang dipasang lewat template."
        cmd: "curl web1"
    quiz:
      q: "Handler `restart nginx` kapan dijalankan?"
      options:
        - "Setiap kali playbook jalan"
        - "Cuma kalau task yang memanggilnya (notify) berstatus changed"
        - "Sebelum semua task"
      answer: 1
      why: "Handler dipicu oleh perubahan. Kalau template ga berubah, nginx ga perlu di-restart."

  - title: "Idempoten: jalankan berkali-kali, hasil sama"
    missions: [3]
    body: |
      Playbook yang baik itu **idempoten**: dijalankan sekali atau sepuluh kali, hasil akhirnya sama, dan run kedua melaporkan `changed=0`. Modul seperti `apt` dan `service` sudah idempoten: mereka cek kondisi dulu, baru bertindak kalau perlu.

      Modul `shell` dan `command` beda. Ansible ga tahu apa yang dilakukan perintahmu, jadi dia selalu menganggapnya `changed`. Di lab, task "Catat waktu deploy" bikin `changed` terus.

      Cara memperbaikinya: kasih tahu Ansible kapan perintah itu ga perlu jalan, misalnya `creates=/path` (lewati kalau file itu sudah ada). Alternatif lain `changed_when: false` buat perintah yang cuma membaca.
    steps:
      - text: "Jalankan lagi. Perhatikan masih ada `changed` dari task shell."
        cmd: "ansible-playbook site.yml"
        wait: 8000
      - text: "Tambahkan `creates` ke task shell."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: "shell: date > /etc/deploy-time"
          replace: "shell: date > /etc/deploy-time creates=/etc/deploy-time"
      - text: "Jalankan sekali lagi. Sekarang `changed=0` di semua host."
        cmd: "ansible-playbook site.yml"
        wait: 8000
    quiz:
      q: "Kenapa task `shell` selalu dilaporkan `changed`?"
      options:
        - "Karena shell selalu error"
        - "Karena Ansible ga bisa tahu apakah perintah itu benar-benar mengubah sesuatu"
        - "Karena shell butuh become"
      answer: 1
      why: "Modul shell cuma menjalankan perintah. Tanpa petunjuk seperti `creates`, `removes`, atau `changed_when`, Ansible menganggap tiap eksekusi sebagai perubahan."

  - title: "Intip dulu: --check --diff"
    missions: [4]
    body: |
      Sebelum mengubah server production, lebih aman lihat dulu apa yang *akan* berubah:

      - `--check` menjalankan playbook dalam mode **dry run**. Modul melaporkan apa yang akan dilakukan, tapi ga mengubah server.
      - `--diff` menampilkan isi file sebelum dan sesudah, misalnya untuk task `template`.

      Gabungkan keduanya dan kamu dapat semacam "plan" ala Terraform buat konfigurasi server.
    steps:
      - text: "Ganti variabel pesan di playbook."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: 'pesan: "Halo dari Ansible"'
          replace: 'pesan: "Halo dari kursus Ansible"'
      - text: "Dry run. Lihat diff-nya, server belum berubah."
        cmd: "ansible-playbook site.yml --check --diff"
        wait: 8000
      - cmd: "curl web1"
      - text: "Yakin? Jalankan beneran. Handler restart nginx ikut terpanggil."
        cmd: "ansible-playbook site.yml"
        wait: 8000
      - cmd: "curl web1"
    quiz:
      q: "Kamu menjalankan `--check`. Apa yang terjadi pada server?"
      options:
        - "Ga ada yang berubah, Ansible cuma melaporkan rencananya"
        - "Perubahan diterapkan tapi bisa di-rollback"
        - "Server di-restart untuk pengecekan"
      answer: 0
      why: "Check mode itu dry run. Hati-hati juga: task shell/command biasanya dilewati di check mode karena Ansible ga bisa memprediksi hasilnya."

  - title: "Host baru dan --limit"
    missions: [5]
    body: |
      Menambah server cukup dengan menambahkannya ke inventory. Tapi kamu mungkin ga mau menjalankan ulang playbook ke semua server cuma demi satu host baru.

      `--limit` membatasi playbook ke host atau grup tertentu, misalnya `--limit web3` atau `--limit 'web:!web1'`. Play yang targetnya ga beririsan dengan limit dilewati.

      Host baru di lab, `web3`, ternyata pakai **Rocky Linux**. Perhatikan apa yang terjadi.
    steps:
      - text: "Tambah web3 ke grup web."
        edit:
          file: "inventory.ini"
          tab: '[data-act="tab"][data-f="inventory.ini"]'
          find: |-
            web1
            web2
          replace: |-
            web1
            web2
            web3
      - cmd: "ansible-inventory --graph"
      - text: "Jalankan khusus web3. Task `apt` bakal gagal."
        cmd: "ansible-playbook site.yml --limit web3"
        wait: 6000
    quiz:
      q: "Perintah mana yang menjalankan playbook ke semua host grup web **kecuali** web1?"
      options:
        - "`ansible-playbook site.yml --limit web1`"
        - "`ansible-playbook site.yml --limit 'web:!web1'`"
        - "`ansible-playbook site.yml --skip web1`"
      answer: 1
      why: "Pola host Ansible mendukung `:` (gabung), `:&` (irisan), dan `:!` (kecuali)."

  - title: "Satu playbook, beda distro"
    missions: [6]
    body: |
      `apt` cuma ada di keluarga Debian/Ubuntu. Rocky Linux (keluarga RedHat) memakai `dnf`. Ada dua cara umum:

      - Pakai modul generik **`package`**, yang otomatis memilih package manager sesuai host. Cocok kalau nama paketnya sama di semua distro, seperti `nginx`.
      - Pakai **facts** dan `when:`. Ansible mengumpulkan fakta tiap host di awal (*gathering facts*), misalnya `ansible_os_family`. Lalu task bisa dibatasi: `when: ansible_os_family == "RedHat"`.

      Di sini kita pakai cara pertama karena paling ringkas.
    steps:
      - text: "Ganti `apt` di task install nginx jadi `package`."
        edit:
          file: "site.yml"
          tab: '[data-act="tab"][data-f="site.yml"]'
          find: |-
            apt:
                    name: nginx
          replace: |-
            package:
                    name: nginx
      - cmd: "ansible-playbook site.yml --limit web3"
        wait: 8000
      - text: "Halaman di web3 menyebut distribusinya, diisi dari facts."
        cmd: "curl web3"
    quiz:
      q: "Variabel `ansible_os_family` datang dari mana?"
      options:
        - "Harus kamu tulis manual di inventory"
        - "Dikumpulkan otomatis oleh Ansible dari tiap host (facts)"
        - "Dari file ansible.cfg"
      answer: 1
      why: "Di awal tiap play, Ansible menjalankan modul `setup` (gathering facts) yang mengumpulkan info OS, IP, CPU, dan lainnya per host."
recap: |
  Yang sudah kamu kuasai:

  - Inventory, grup, dan perintah ad-hoc.
  - Playbook, modul, `become`, dan handler.
  - Idempotensi dan cara menjinakkan task `shell`.
  - `--check --diff`, `--limit`, dan playbook lintas distro dengan `package` atau facts.

  Langkah berikutnya: deploy aplikasi ke Kubernetes ala GitOps dengan Argo CD.
---
Ansible mengatur konfigurasi banyak server sekaligus dari satu playbook. Lab-nya berisi lima server bohongan (Ubuntu, Debian, dan satu Rocky Linux) yang bisa kamu ping, pasangi nginx, dan rusak sesukanya.
