---
title: "Kursus Singkat Terraform"
linkTitle: "Terraform"
description: "Belajar Infrastructure as Code dengan Terraform: init, plan, apply, membaca tanda update dan replace, menangani drift, sampai destroy. Praktik langsung ke akun AWS bohongan."
summary: "Infrastructure as Code dari nol: init, plan, apply, update vs replace, drift, dan destroy ke akun AWS bohongan."
sim: terraform
layout: "kursus"
weight: 7
minutes: 20
level: "pemula"
next: "/kursus/ansible/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Infrastruktur sebagai kode"
    missions: [1]
    body: |
      Bayangkan bikin server di AWS lewat klik-klik di console. Sekali dua kali sih oke, tapi coba ulangi persis sama di 3 environment, atau ingat-ingat setting apa yang dulu diubah. Ribet.

      **Terraform** membalik caranya: kamu *menuliskan* infrastruktur yang kamu mau di file `.tf`, lalu Terraform yang membuatnya. Buka `main.tf` di lab:

      - `provider "aws"` bilang kita pakai AWS, region Jakarta.
      - `resource "aws_vpc" "main"` artinya "harus ada satu VPC, di kode ini namanya `main`".
      - `aws_vpc.main.id` dipakai di subnet. Terraform paham subnet bergantung pada VPC, jadi urutan pembuatannya diatur sendiri.

      Alur kerjanya selalu: `terraform init` (unduh provider) → `terraform plan` (lihat apa yang *akan* terjadi) → `terraform apply` (jalankan).
    steps:
      - text: "Unduh provider AWS dan siapkan folder kerja."
        cmd: "terraform init"
        wait: 3000
      - text: "Lihat rencananya. Tanda `+` artinya resource akan dibuat. Belum ada yang berubah di AWS."
        cmd: "terraform plan"
        wait: 3000
    quiz:
      q: "Apa yang dilakukan `terraform plan`?"
      options:
        - "Langsung membuat resource di AWS"
        - "Menampilkan perubahan yang akan dilakukan, tanpa mengubah apa pun"
        - "Mengunduh provider"
      answer: 1
      why: "Plan membandingkan kode dengan state dan kondisi asli, lalu menampilkan selisihnya. Aman dijalankan kapan saja."

  - title: "Apply dan state"
    missions: [2]
    body: |
      `terraform apply` menampilkan plan sekali lagi lalu minta konfirmasi. Ketik `yes` dan Terraform mulai membuat resource sesuai urutan dependensinya: VPC dulu, lalu subnet, lalu EC2.

      Setelah selesai, Terraform mencatat semua yang dia kelola di **state** (`terraform.tfstate`): ID asli tiap resource di AWS dan atribut terakhirnya. Dari state inilah Terraform tahu bedanya "mau dibuat" dan "sudah ada".

      > State itu berharga dan bisa berisi data sensitif. Di tim, simpan di *remote backend* (misal S3 + locking), jangan di laptop masing-masing, dan jangan di-commit ke Git.
    steps:
      - cmd: "terraform apply"
        wait: 2500
      - text: "Konfirmasi. Lihat resource-nya muncul satu per satu di panel AWS."
        cmd: "yes"
        wait: 9000
      - text: "Daftar resource yang tercatat di state."
        cmd: "terraform state list"
      - text: "Nilai `output` di kode, misalnya ID instance."
        cmd: "terraform output"
    quiz:
      q: "Kenapa file state sebaiknya ga di-commit ke Git?"
      options:
        - "Karena ukurannya terlalu besar"
        - "Karena bisa berisi data sensitif dan gampang bentrok kalau dipakai bareng"
        - "Karena Terraform ga bisa membacanya dari Git"
      answer: 1
      why: "State bisa memuat password atau key dalam teks biasa, dan dua orang yang apply bareng dengan state berbeda bisa saling timpa. Remote backend dengan locking mencegah keduanya."

  - title: "Update atau replace?"
    missions: [3, 4]
    body: |
      Ubah kode, jalankan plan lagi, dan Terraform cuma mengerjakan **selisihnya**. Tapi perhatikan tandanya:

      - `~` **update in-place**: resource diubah tanpa dibuat ulang. Contoh: ganti `instance_type` (server di-stop sebentar, tipenya diganti, dinyalakan lagi).
      - `-/+` **replace**: resource dihapus lalu dibuat baru. Terjadi kalau atribut yang berubah ga bisa diubah di tempat, misalnya `ami`. Server lama hilang beserta isinya, dan ID-nya berganti.

      Di plan, atribut penyebab replace ditandai `# forces replacement`. Selalu cek ini sebelum ketik `yes` di production.
    steps:
      - text: "Naikkan tipe instance."
        edit:
          file: "main.tf"
          find: 'instance_type = "t3.micro"'
          replace: 'instance_type = "t3.small"'
      - text: "Apply. Perhatikan tanda `~`."
        cmd: "terraform apply"
        wait: 2500
      - cmd: "yes"
        wait: 5000
      - text: "Sekarang ganti AMI ke Ubuntu 22.04."
        edit:
          file: "main.tf"
          find: 'ami           = "ami-0f1e2d3c4b5a69788"'
          replace: 'ami           = "ami-0a9b8c7d6e5f40312"'
      - text: "Apply. Kali ini `-/+` dan ada `# forces replacement`."
        cmd: "terraform apply"
        wait: 2500
      - cmd: "yes"
        wait: 9000
    quiz:
      q: "Plan menunjukkan `-/+ aws_instance.web` dengan `# forces replacement` di baris `ami`. Artinya?"
      options:
        - "Instance diubah tanpa restart"
        - "Instance lama dihapus dan instance baru dibuat"
        - "Plan gagal karena AMI salah"
      answer: 1
      why: "AMI ga bisa diganti di instance yang sudah jalan, jadi Terraform harus menghancurkan lalu membuat ulang. Data di disk instance lama ikut hilang."

  - title: "Drift: kalau ada yang ubah lewat console"
    missions: [5]
    body: |
      **Drift** terjadi kalau kondisi asli di cloud ga lagi sama dengan kode, biasanya karena seseorang mengubah sesuatu lewat console "sebentar saja".

      Terraform ga langsung tahu. Baru waktu `plan` atau `apply`, dia *refresh*: membaca kondisi asli, membandingkannya dengan kode, lalu menawarkan perubahan supaya kembali sesuai kode. Kode tetap jadi sumber kebenaran.

      Kalau perubahan manual itu memang benar, jangan cuma di-apply balik. Pindahkan juga ke kode, supaya ga tertimpa di apply berikutnya.
    steps:
      - text: "Pura-pura jadi rekan kerja yang ganti tipe instance lewat console AWS."
        click: '.tf-con-b[data-k="type"]'
        label: "console AWS: ganti instance type"
      - text: "Plan mendeteksi perubahan di luar Terraform."
        cmd: "terraform plan"
        wait: 3000
      - text: "Kembalikan sesuai kode."
        cmd: "terraform apply"
        wait: 3000
      - cmd: "yes"
        wait: 5000
    quiz:
      q: "Ada yang menambah tag lewat console dan tag itu memang diperlukan. Langkah yang benar?"
      options:
        - "Biarkan, Terraform akan menyimpannya otomatis"
        - "Tambahkan tag itu ke kode `.tf`, lalu plan supaya hasilnya `No changes`"
        - "Hapus state supaya Terraform lupa"
      answer: 1
      why: "Terraform selalu mengikuti kode. Kalau perubahan manual mau dipertahankan, kodenya yang harus diperbarui."

  - title: "Bersih-bersih dengan destroy"
    missions: [6]
    body: |
      `terraform destroy` menghapus **semua** resource yang tercatat di state, dalam urutan terbalik dari pembuatannya: EC2 dulu, lalu subnet, terakhir VPC.

      Berguna buat environment sementara (lab, testing, demo) supaya tagihan cloud ga jalan terus. Di production, beri pengaman seperti `lifecycle { prevent_destroy = true }` pada resource penting.
    steps:
      - cmd: "terraform destroy"
        wait: 2500
      - cmd: "yes"
        wait: 8000
      - text: "State sekarang kosong."
        cmd: "terraform state list"
    quiz:
      q: "Urutan destroy-nya kenapa terbalik dari urutan create?"
      options:
        - "Acak saja"
        - "Karena resource yang bergantung (EC2 di subnet) harus dihapus sebelum yang ditumpanginya (subnet, VPC)"
        - "Supaya lebih cepat"
      answer: 1
      why: "VPC ga bisa dihapus selama masih ada subnet dan instance di dalamnya. Terraform memakai graf dependensi yang sama, cuma dibalik."
recap: |
  Yang sudah kamu kuasai:

  - Alur `init` → `plan` → `apply` dan peran state.
  - Membaca tanda `+`, `~`, `-/+`, dan `# forces replacement`.
  - Mendeteksi dan membereskan drift.
  - `terraform destroy` buat bersih-bersih.

  Langkah berikutnya: setelah servernya ada, atur isinya dengan Ansible.
---
Terraform menuliskan infrastruktur cloud sebagai kode, jadi bisa di-review, diulang, dan dilacak riwayatnya seperti kode aplikasi. Lab-nya memakai akun AWS bohongan, jadi aman diutak-atik tanpa tagihan.
