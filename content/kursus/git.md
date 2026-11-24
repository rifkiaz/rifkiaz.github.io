---
title: "Kursus Singkat Git"
linkTitle: "Git"
description: "Belajar Git dari nol sambil langsung praktik: commit, branch, merge sampai konflik, push dan pull bareng teman, stash, menyelamatkan commit yang hilang, dan rebase."
summary: "Dari git init sampai rebase. Commit, branch, konflik, kerja bareng teman lewat remote, dan cara menyelamatkan commit yang kebuang."
sim: git
layout: "kursus"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
weight: 1
minutes: 30
level: "pemula"
next: "/kursus/docker/"
lessons:
  - title: "Repo dan commit pertama"
    missions: [1]
    body: |
      Git itu pencatat riwayat. Setiap kali kamu **commit**, Git menyimpan potret lengkap isi proyek pada saat itu, lengkap dengan siapa yang bikin, kapan, dan pesannya. Kalau nanti ada yang rusak, kamu tinggal lihat atau balik ke potret sebelumnya.

      Ada tiga "tempat" yang perlu kamu kenal:

      - **Working dir**: file yang lagi kamu edit di laptop.
      - **Staging** (index): daftar perubahan yang *mau* masuk ke commit berikutnya. Kamu isi pakai `git add`.
      - **Repo lokal**: riwayat commit yang sudah tersimpan di folder `.git`.

      Alurnya selalu sama: ubah file → `git add` → `git commit`. Lihat strip di atas lab, panahnya menyala tiap kali kamu pindah tahap.

      > Sebelum commit pertama, Git perlu tahu kamu siapa. Itu gunanya `git config user.name` dan `user.email`, cukup sekali per laptop.
    steps:
      - text: "Ubah folder `proyek-web` jadi repo Git."
        cmd: "git init"
      - text: "Cek kondisi repo. Semua file masih *untracked*, belum dilacak Git."
        cmd: "git status"
      - text: "Kenalkan dirimu ke Git."
        cmd: 'git config --global user.name "Kamu"'
      - cmd: "git config --global user.email kamu@contoh.id"
      - text: "Masukkan semua file ke staging. Titik artinya \"semua di folder ini\"."
        cmd: "git add ."
      - text: "Simpan potret pertama."
        cmd: 'git commit -m "Commit pertama"'
      - text: "Lihat riwayatnya. Tiap commit punya hash unik."
        cmd: "git log --oneline"
    quiz:
      q: "Kamu baru mengedit `style.css` lalu langsung `git commit`. Apa yang terjadi?"
      options:
        - "Perubahan style.css ikut masuk commit"
        - "Ga ada yang di-commit, karena style.css belum di-`git add` ke staging"
        - "Git otomatis push ke GitHub"
      answer: 1
      why: "Commit cuma mengambil isi staging. File yang diubah tapi belum di-`add` tetap tinggal di working dir. (Pengecualian: `git commit -a` ikut mengambil file yang sudah dilacak.)"

  - title: "Intip perubahan sebelum commit"
    missions: [2]
    body: |
      Kebiasaan baik sebelum commit: **lihat dulu apa yang berubah**. Git punya dua cara:

      - `git diff` membandingkan **working dir** dengan **staging**. Ini perubahan yang *belum* di-`add`.
      - `git diff --staged` membandingkan **staging** dengan **commit terakhir**. Ini yang *bakal* masuk commit.

      Baris yang diawali `-` dibuang, `+` ditambahkan. Kalau `git diff` kosong padahal kamu yakin sudah mengubah file, kemungkinan perubahannya sudah di-`add`. Coba `--staged`.

      Pesan commit juga penting. Tulis *apa* yang berubah dengan kalimat pendek, misalnya "Ganti warna judul", bukan "update" atau "fix".
    steps:
      - text: "Ganti warna judul di `style.css` (sama seperti mengedit file di editor)."
        cmd: |-
          sed -i 's/color: teal;/color: tomato;/' style.css
      - text: "Lihat perubahan yang belum di-stage."
        cmd: "git diff"
      - cmd: "git add style.css"
      - text: "Sekarang `git diff` kosong, tapi `--staged` menampilkan perubahannya."
        cmd: "git diff --staged"
      - cmd: 'git commit -m "Ganti warna judul"'
    quiz:
      q: "Setelah `git add style.css`, perintah mana yang menampilkan perubahan style.css?"
      options:
        - "`git diff`"
        - "`git diff --staged`"
        - "`git log`"
      answer: 1
      why: "Setelah di-add, perubahannya pindah ke staging, jadi yang menampilkannya `git diff --staged`. `git diff` biasa cuma melihat yang belum di-add."

  - title: "Branch dan merge"
    missions: [3, 4]
    body: |
      **Branch** itu jalur kerja terpisah. Kamu bisa bikin fitur baru di branch sendiri tanpa mengganggu `main`, yang biasanya berisi versi yang sudah jalan.

      Secara teknis branch cuma *label* yang menunjuk ke satu commit. Bikin branch itu murah dan cepat, jadi jangan ragu bikin satu branch per fitur.

      - `git switch -c nama` bikin branch baru dan pindah ke sana.
      - `git switch main` balik ke main.
      - `git merge nama` menggabungkan isi branch itu ke branch yang sedang aktif.

      Kalau `main` belum bergerak sejak branch dibuat, merge-nya **fast-forward**: label `main` cukup digeser maju, ga perlu commit baru. Perhatikan graf commit di lab.
    steps:
      - text: "Bikin branch fitur dan langsung pindah ke sana."
        cmd: "git switch -c fitur/kontak"
      - text: "Tambah file baru di branch itu."
        cmd: 'echo "<p>Kontak: halo@contoh.id</p>" > kontak.html'
      - cmd: "git add kontak.html"
      - cmd: 'git commit -m "Tambah halaman kontak"'
      - text: "Balik ke main. Perhatikan `kontak.html` hilang dari working dir, karena main belum punya file itu."
        cmd: "git switch main"
      - text: "Gabungkan fiturnya ke main."
        cmd: "git merge fitur/kontak"
      - cmd: "git log --oneline --graph"
    quiz:
      q: "Kenapa merge tadi disebut *fast-forward*?"
      options:
        - "Karena main ga punya commit baru sejak branch dibuat, jadi main cukup digeser maju"
        - "Karena Git melewati pengecekan konflik supaya cepat"
        - "Karena branch fitur dihapus otomatis"
      answer: 0
      why: "Riwayat main masih lurus di belakang branch fitur, jadi Git tinggal memindahkan label main ke commit terakhir fitur. Ga ada commit merge baru."

  - title: "Menyelesaikan konflik"
    missions: [5]
    body: |
      Konflik muncul kalau **dua branch mengubah baris yang sama** dengan cara berbeda. Git ga mau menebak mana yang benar, jadi dia berhenti dan menyerahkan keputusannya ke kamu.

      File yang konflik berisi penanda seperti ini:

      ```
      <<<<<<< HEAD
      <h1>Judul dari main</h1>
      =======
      <h1>Judul dari branch fitur</h1>
      >>>>>>> fitur/judul
      ```

      Bagian atas versi branch kamu sekarang (`HEAD`), bagian bawah versi branch yang di-merge. Cara menyelesaikannya:

      1. Edit file sampai isinya benar dan penandanya hilang. Atau pilih satu sisi pakai `git checkout --ours` / `--theirs`.
      2. `git add` file itu buat menandai konfliknya beres.
      3. `git commit` buat menyelesaikan merge.

      Panik? `git merge --abort` membatalkan merge dan mengembalikan semuanya seperti sebelum merge.
    steps:
      - text: "Bikin branch baru dan ubah judul halaman."
        cmd: "git switch -c fitur/judul"
      - cmd: |-
          sed -i 's/<h1>Halo, dunia!<\/h1>/<h1>Judul dari branch fitur<\/h1>/' index.html
      - text: "`-am` = add semua file yang sudah dilacak + commit, sekaligus."
        cmd: 'git commit -am "Judul versi fitur"'
      - text: "Balik ke main dan ubah baris yang sama dengan isi berbeda."
        cmd: "git switch main"
      - cmd: |-
          sed -i 's/<h1>Halo, dunia!<\/h1>/<h1>Judul dari main<\/h1>/' index.html
      - cmd: 'git commit -am "Judul versi main"'
      - text: "Merge. Kali ini Git berhenti karena konflik."
        cmd: "git merge fitur/judul"
      - text: "Lihat penanda konfliknya."
        cmd: "cat index.html"
      - text: "Pilih versi dari branch fitur (*theirs*), lalu tandai beres."
        cmd: "git checkout --theirs index.html"
      - cmd: "git add index.html"
      - cmd: "git commit --no-edit"
    quiz:
      q: "Kamu sudah mengedit file konflik sampai benar. Langkah berikutnya?"
      options:
        - "`git merge` lagi"
        - "`git add` file itu, lalu `git commit`"
        - "`git push` supaya konfliknya hilang"
      answer: 1
      why: "`git add` memberi tahu Git konflik di file itu sudah kamu selesaikan, lalu `git commit` membuat commit merge-nya."

  - title: "Kerja bareng lewat remote"
    missions: [6, 7]
    body: |
      Sejauh ini semua commit cuma ada di laptopmu. **Remote** adalah salinan repo di server (GitHub, GitLab, dan teman-temannya) supaya bisa dipakai bareng tim.

      - `git remote add origin URL` mendaftarkan alamat remote dengan nama `origin`.
      - `git push` mengirim commit kamu ke remote. `-u` sekalian mengingat pasangan branch-nya, jadi berikutnya cukup `git push`.
      - `git pull` = `git fetch` (ambil commit baru dari remote) + merge ke branch kamu.

      Di lab ini ada **Dina**, teman satu tim. Beberapa detik setelah kamu push pertama kali, dia ikut push commit-nya ke main. Akibatnya push kamu berikutnya bakal **ditolak**: remote punya commit yang belum kamu punya. Solusinya bukan force push, tapi `pull` dulu, baru push lagi.
    steps:
      - cmd: "git remote add origin https://github.com/kamu/proyek-web.git"
      - cmd: "git push -u origin main"
      - text: "Tunggu beberapa detik sampai muncul kabar Dina push (lihat tab **remote** di lab). Sementara itu, bikin commit kecil."
        cmd: 'echo "- catatan dari kamu" >> README.md'
      - cmd: 'git commit -am "Tambah catatan"'
      - text: "Push. Kalau Dina sudah push duluan, ini ditolak (*rejected*)."
        cmd: "git push"
      - text: "Ambil commit Dina dan gabungkan dengan punyamu."
        cmd: "git pull --no-rebase"
      - text: "Sekarang push berhasil."
        cmd: "git push"
    quiz:
      q: "Push kamu ditolak dengan pesan *rejected (fetch first)*. Apa yang sebaiknya kamu lakukan?"
      options:
        - "`git push --force` supaya commit kamu menang"
        - "`git pull` dulu, selesaikan konflik kalau ada, lalu push lagi"
        - "Hapus repo lalu clone ulang"
      answer: 1
      why: "Remote punya commit dari orang lain. Force push bakal membuang kerjaan teman kamu. Pull dulu supaya riwayatnya tergabung, baru push."

  - title: "Stash dan menyelamatkan commit"
    missions: [8, 9]
    body: |
      Dua penyelamat yang sering dilupakan:

      **`git stash`** menyimpan perubahan setengah jadi ke "laci" dan membersihkan working dir. Berguna kalau kamu harus pindah branch mendadak (misal ada bug di main) tapi kerjaan sekarang belum siap di-commit. Nanti `git stash pop` mengeluarkannya lagi.

      **`git reflog`** mencatat ke mana saja `HEAD` pernah menunjuk. Jadi kalau kamu "menghapus" commit pakai `git reset --hard`, commit itu sebenarnya belum hilang. Cari hash-nya di reflog, lalu reset balik ke sana.

      > `git reset --hard` membuang perubahan yang belum di-commit tanpa ampun. Yang sudah di-commit masih bisa diselamatkan lewat reflog, yang belum di-commit ga bisa.
    steps:
      - text: "Mulai kerjaan setengah jadi."
        cmd: 'echo "- ide setengah jadi" >> README.md'
      - text: "Simpan ke laci, lalu pindah branch dan balik lagi."
        cmd: "git stash"
      - cmd: "git switch fitur/judul"
      - cmd: "git switch main"
      - text: "Keluarkan lagi dari laci."
        cmd: "git stash pop"
      - cmd: 'git commit -am "Tambah ide"'
      - text: "Sekarang \"tidak sengaja\" buang commit barusan."
        cmd: "git reset --hard HEAD~1"
      - text: "Cari jejaknya. `HEAD@{1}` adalah posisi HEAD satu langkah sebelumnya."
        cmd: "git reflog"
      - cmd: "git reset --hard HEAD@{1}"
    quiz:
      q: "Setelah `git reset --hard HEAD~1`, commit yang dibuang itu..."
      options:
        - "Hilang selamanya"
        - "Masih ada dan bisa ditemukan lewat `git reflog`"
        - "Otomatis pindah ke stash"
      answer: 1
      why: "Commit-nya cuma ga ditunjuk branch mana pun. Reflog masih mencatatnya (biasanya sampai 90 hari), jadi bisa di-reset balik."

  - title: "Rapikan riwayat dengan rebase"
    missions: [10]
    body: |
      Merge menyatukan dua jalur dengan commit merge, jadi grafnya bercabang. **Rebase** cara lain: commit-commit di branch kamu "dipindahkan" ke ujung branch lain, seolah-olah kamu baru mulai kerja dari sana. Hasilnya riwayat lurus.

      `git rebase main` (dijalankan di branch fitur) artinya: ambil commit-commit fitur yang belum ada di main, lalu tempel ulang satu per satu di atas main terbaru. Hash-nya berubah, karena secara teknis itu commit baru.

      > Aturan emas: **jangan rebase commit yang sudah di-push dan dipakai orang lain.** Riwayat mereka jadi ga cocok dengan punyamu. Rebase aman buat branch lokal yang belum dibagikan.
    steps:
      - text: "Bikin branch fitur baru dan satu commit di sana."
        cmd: "git switch -c fitur/footer"
      - cmd: 'echo "footer { color: gray; }" >> style.css'
      - cmd: 'git commit -am "Gaya footer"'
      - text: "Sementara itu main juga maju."
        cmd: "git switch main"
      - cmd: 'echo "- catatan rilis" >> README.md'
      - cmd: 'git commit -am "Catatan rilis"'
      - text: "Balik ke fitur dan rebase ke atas main. Lihat grafnya jadi lurus."
        cmd: "git switch fitur/footer"
      - cmd: "git rebase main"
      - cmd: "git log --oneline --graph --all"
    quiz:
      q: "Kapan sebaiknya kamu **tidak** rebase?"
      options:
        - "Di branch lokal yang belum pernah di-push"
        - "Di branch yang sudah di-push dan dipakai teman satu tim"
        - "Sebelum bikin pull request"
      answer: 1
      why: "Rebase menulis ulang commit (hash-nya berubah). Kalau teman sudah membangun di atas commit lama, riwayat kalian jadi bentrok."
recap: |
  Yang sudah kamu kuasai:

  - Alur dasar: ubah → `git add` → `git commit`, dan `git diff` / `--staged` buat mengintip.
  - `git switch -c`, `git merge`, dan cara menyelesaikan konflik.
  - `git push`, `git pull`, dan kenapa push bisa ditolak.
  - `git stash`, `git reset`, `git reflog`, dan `git rebase`.

  Mau latihan bebas? Buka lab Git versi penuh dan coba perintah lain seperti `git cherry-pick` atau `git revert`.
---
Git mencatat setiap perubahan di proyekmu, jadi kamu bisa kembali ke versi mana pun dan kerja bareng tim tanpa saling timpa. Di kursus ini kamu mulai dari repo kosong sampai menyelesaikan konflik dan merapikan riwayat.
