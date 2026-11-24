---
title: "Kursus Singkat OpenStack"
linkTitle: "OpenStack"
description: "Belajar private cloud OpenStack sambil praktik: login ke Keystone, bikin network dan router, security group dan keypair, meluncurkan server, floating IP, ssh, volume Cinder, quota, sampai bersih-bersih."
summary: "Bangun cloud sendiri: Keystone, Neutron, Nova, Cinder. Network, router, security group, server, floating IP, volume, dan quota."
sim: openstack
layout: "kursus"
weight: 5
minutes: 30
level: "menengah"
next: "/kursus/vault/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Login ke cloud"
    missions: [1]
    body: |
      **OpenStack** adalah software buat membangun cloud sendiri, mirip AWS tapi jalan di server milikmu. Isinya kumpulan service, masing-masing mengurus satu hal:

      - **Keystone**: identitas dan login.
      - **Nova**: server (VM).
      - **Neutron**: jaringan.
      - **Cinder**: volume (disk).
      - **Glance**: image OS.

      Semua resource milik sebuah **project** (tenant), dan tiap project punya quota sendiri. Untuk login dari CLI, kredensialnya biasanya disimpan di file *openrc*. `source demo-openrc` memasukkan variabel `OS_*` ke shell, lalu tiap perintah `openstack` menukarnya dengan **token** dari Keystone.
    steps:
      - text: "Muat kredensial project demo."
        cmd: "source demo-openrc"
      - text: "Minta token ke Keystone. Kalau ini berhasil, login-mu benar."
        cmd: "openstack token issue"
      - text: "Lihat image OS dan ukuran server (flavor) yang tersedia."
        cmd: "openstack image list"
      - cmd: "openstack flavor list"
    quiz:
      q: "Service OpenStack yang mengurus login dan token adalah..."
      options:
        - "Nova"
        - "Keystone"
        - "Neutron"
      answer: 1
      why: "Keystone adalah service identitas. Service lain memvalidasi token ke Keystone sebelum melayani permintaan."

  - title: "Jaringan dan router"
    missions: [2, 3]
    body: |
      Server butuh jaringan sebelum bisa diluncurkan. Di OpenStack, project bikin **jaringan privat** sendiri, terisolasi dari project lain walau berbagi hardware yang sama.

      - **Network** itu "kabel"-nya, **subnet** memberi rentang IP (misal `10.0.0.0/24`) dan DHCP.
      - Jaringan privat ga bisa keluar ke internet sendirian. Perlu **router** yang punya kaki di jaringan eksternal (`public`, dipasang sebagai *external gateway*) dan kaki di subnet kamu.

      Polanya mirip VPC + subnet + internet/NAT gateway di AWS.
    steps:
      - cmd: "openstack network create net-app"
      - cmd: "openstack subnet create --network net-app --subnet-range 10.0.0.0/24 sub-app"
      - cmd: "openstack router create r1"
      - text: "Pasang kaki router ke jaringan publik..."
        cmd: "openstack router set --external-gateway public r1"
      - text: "...dan ke subnet kamu. Lihat tab topologi di lab."
        cmd: "openstack router add subnet r1 sub-app"
    quiz:
      q: "Subnet privatmu belum tersambung ke router. Akibatnya?"
      options:
        - "Server ga bisa dibuat"
        - "Server bisa dibuat dan saling bicara di subnet, tapi ga bisa keluar ke internet"
        - "Server otomatis dapat IP publik"
      answer: 1
      why: "Router yang menghubungkan jaringan privat dengan jaringan eksternal. Tanpa itu, lalu lintas berhenti di subnet."

  - title: "Security group dan keypair"
    missions: [4]
    body: |
      Dua hal yang wajib disiapkan sebelum server pertama:

      **Security group** adalah firewall di level port server. Defaultnya, semua lalu lintas *masuk* ditolak. Kamu harus membuka yang perlu, misalnya TCP 22 untuk SSH dan ICMP untuk ping.

      **Keypair** adalah kunci SSH. Public key-nya disimpan OpenStack dan dimasukkan ke server saat boot (lewat cloud-init), private key-nya tetap di laptopmu. Image cloud biasanya **ga punya password**, jadi tanpa keypair kamu ga bisa masuk.
    steps:
      - cmd: "openstack security group create web"
      - text: "Buka SSH."
        cmd: "openstack security group rule create --protocol tcp --dst-port 22 web"
      - text: "Izinkan ping."
        cmd: "openstack security group rule create --protocol icmp web"
      - text: "Daftarkan public key dari laptop."
        cmd: "openstack keypair create --public-key ~/.ssh/id_ed25519.pub kunci"
    quiz:
      q: "Server sudah jalan tapi `ssh` timeout. Penyebab paling mungkin?"
      options:
        - "Image-nya rusak"
        - "Security group belum membuka TCP 22 (atau belum ada floating IP)"
        - "Quota habis"
      answer: 1
      why: "Defaultnya lalu lintas masuk diblokir. Cek dulu security group dan jalur jaringannya sebelum curiga ke hal lain."

  - title: "Server, floating IP, dan ssh"
    missions: [5, 6]
    body: |
      Sekarang semua bahan siap. `openstack server create` meminta Nova membuat VM dengan **flavor** (ukuran CPU/RAM/disk), **image**, network, keypair, dan security group. Statusnya `BUILD` dulu, lalu `ACTIVE`.

      Server cuma dapat IP privat dari subnet. Supaya bisa dijangkau dari luar, pasang **floating IP**: IP publik dari jaringan `public` yang di-NAT oleh router ke IP privat server. Floating IP bisa dilepas dan dipindah ke server lain, cocok buat ganti server tanpa ganti DNS.
    steps:
      - cmd: "openstack server create --flavor m1.small --image ubuntu-24.04 --network net-app --key-name kunci --security-group web web1"
        wait: 9000
      - text: "Tunggu sampai `ACTIVE`."
        cmd: "openstack server list"
      - text: "Ambil satu floating IP dari jaringan publik."
        cmd: "openstack floating ip create public"
      - text: "Pasang ke web1. IP-nya acak, jadi tombol ini memakai IP yang barusan dibuat."
        pick: "openstack server add floating ip web1 "
      - text: "Masuk ke server (user default image Ubuntu: `ubuntu`)."
        pick: "ssh "
        wait: 2000
      - text: "Kamu sekarang di dalam web1."
        cmd: "hostname"
      - cmd: "exit"
    quiz:
      q: "Apa yang terjadi pada floating IP kalau server-nya dihapus?"
      options:
        - "Ikut terhapus"
        - "Lepas dari server tapi tetap jadi milik project (dan tetap memakan quota)"
        - "Pindah otomatis ke server lain"
      answer: 1
      why: "Floating IP dialokasikan ke project, bukan ke server. Kalau sudah ga dipakai, hapus dengan `openstack floating ip delete`."

  - title: "Volume Cinder"
    missions: [7]
    body: |
      Disk bawaan server (dari flavor) ikut hilang kalau server dihapus. Untuk data yang harus awet, pakai **volume** dari **Cinder**: disk terpisah yang bisa di-*attach* ke satu server, di-*detach*, lalu dipasang ke server lain.

      Di balik layar, volume sering disimpan di Ceph dan nyambung ke server lewat jaringan storage. Dari dalam server, dia muncul sebagai disk biasa, misalnya `/dev/vdb`. Kamu tinggal format dan mount.
    steps:
      - cmd: "openstack volume create --size 10 data1"
        wait: 3000
      - cmd: "openstack server add volume web1 data1"
        wait: 2000
      - pick: "ssh "
        wait: 2000
      - text: "Disk baru muncul di daftar."
        cmd: "lsblk"
      - cmd: "exit"
    quiz:
      q: "Bedanya disk dari flavor dan volume Cinder?"
      options:
        - "Ga ada bedanya"
        - "Volume Cinder hidup terpisah dari server, jadi data tetap ada walau server dihapus"
        - "Volume Cinder lebih cepat"
      answer: 1
      why: "Disk flavor (ephemeral) berumur sama dengan server. Volume punya siklus hidup sendiri."

  - title: "Quota dan peran admin"
    missions: [8]
    body: |
      Di cloud bersama, tiap project dibatasi **quota**: jumlah instance, vCPU, RAM, volume, floating IP, dan lainnya. Ini mencegah satu tim menghabiskan kapasitas semua orang.

      Kalau quota habis, permintaan ditolak dengan pesan *Quota exceeded*. User biasa ga bisa menaikkannya sendiri. Yang bisa adalah **admin** cloud, yang login ke project `admin` dengan peran admin.
    steps:
      - text: "Coba bikin server besar. Quota vCPU project demo ga cukup."
        cmd: "openstack server create --flavor m1.xlarge --image ubuntu-24.04 --network net-app besar1"
        wait: 2000
      - cmd: "openstack limits show --absolute"
      - text: "Ganti topi jadi admin."
        cmd: "source admin-openrc"
      - cmd: "openstack quota set --cores 16 demo"
      - text: "Balik lagi ke project demo."
        cmd: "source demo-openrc"
    quiz:
      q: "Siapa yang biasanya bisa menaikkan quota sebuah project?"
      options:
        - "Semua anggota project"
        - "Admin cloud"
        - "Nova secara otomatis"
      answer: 1
      why: "Quota adalah kebijakan operator cloud. Anggota project cuma bisa melihat pemakaian dan batasnya."

  - title: "Bersih-bersih"
    missions: [9]
    body: |
      Resource cloud yang lupa dihapus tetap memakan quota dan kapasitas (di cloud publik: tagihan). Bersih-bersih harus urut, kebalikan dari pembuatan, karena ada ketergantungan:

      1. Hapus server (volume ikut terlepas).
      2. Hapus floating IP dan volume.
      3. Lepas subnet dari router, lalu hapus router.
      4. Hapus network (subnet ikut terhapus).

      Kalau urutannya salah, OpenStack menolak dengan error *409 Conflict*, misalnya "network has ports in use".
    steps:
      - cmd: "openstack server delete web1"
        wait: 4000
      - pick: "openstack floating ip delete "
      - cmd: "openstack volume delete data1"
      - cmd: "openstack router remove subnet r1 sub-app"
      - cmd: "openstack router delete r1"
      - cmd: "openstack network delete net-app"
    quiz:
      q: "`openstack network delete net-app` gagal dengan *409 Conflict: ports in use*. Kenapa?"
      options:
        - "Network-nya terlalu besar"
        - "Masih ada port yang terpasang, misalnya server atau interface router"
        - "Kamu bukan admin"
      answer: 1
      why: "Network baru bisa dihapus setelah semua yang tersambung (server, interface router) dilepas."
recap: |
  Yang sudah kamu kuasai:

  - Keystone, project, dan token.
  - Network, subnet, router, security group, keypair.
  - Server, floating IP, ssh, dan volume Cinder.
  - Quota, peran admin, dan urutan bersih-bersih yang benar.

  Langkah berikutnya: simpan password dan kredensial dengan aman pakai Vault.
---
OpenStack adalah software open source buat membangun cloud sendiri (private cloud). Lab-nya berisi cloud mini lengkap dengan Keystone, Nova, Neutron, dan Cinder, plus dashboard ala Horizon di sebelah terminal.
