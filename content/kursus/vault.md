---
title: "Kursus Singkat Vault"
linkTitle: "Vault"
description: "Belajar HashiCorp Vault sambil praktik: init dan unseal, token, KV v2 dengan versi, policy, AppRole untuk aplikasi, kredensial database dinamis, enkripsi dengan transit, dan seal darurat."
summary: "Kelola rahasia dengan benar: unseal, token, KV v2, policy, AppRole, kredensial database dinamis, transit, dan seal darurat."
sim: vault
layout: "kursus"
weight: 6
minutes: 30
level: "menengah"
next: "/kursus/terraform/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Init dan unseal"
    missions: [1, 2]
    body: |
      Password database di file `.env`, API key di repo, token di chat tim... **Vault** hadir supaya rahasia disimpan di satu tempat, terenkripsi, dengan akses yang diatur dan tercatat.

      Semua data Vault di storage terenkripsi. Kunci untuk membukanya (*root key*) ga pernah disimpan utuh. Waktu **init**, Vault memecahnya jadi beberapa **unseal key** pakai Shamir's Secret Sharing, misalnya 5 potong dengan ambang 3.

      Setiap Vault start, dia dalam kondisi **sealed**: jalan tapi ga bisa membaca datanya sendiri. Butuh 3 dari 5 pemegang key memasukkan potongannya (**unseal**). Idealnya tiap key dipegang orang berbeda, jadi ga ada satu orang pun yang bisa membuka Vault sendirian.
    steps:
      - text: "Kasih tahu CLI alamat server Vault."
        cmd: "export VAULT_ADDR=http://10.0.0.10:8200"
      - cmd: "vault status"
      - text: "Inisialisasi. Hasilnya 5 unseal key dan satu root token. Di dunia nyata, simpan baik-baik!"
        cmd: "vault operator init"
        wait: 1500
      - text: "Masukkan unseal key pertama. Key-nya acak, jadi tombol ini memakai key dari output barusan."
        pick: "vault operator unseal "
      - text: "Key kedua..."
        pick: "vault operator unseal "
      - text: "...dan ketiga. Vault terbuka."
        pick: "vault operator unseal "
      - cmd: "vault status"
    quiz:
      q: "Vault di-init dengan 5 key dan threshold 3. Dua pemegang key sedang cuti. Bisakah Vault di-unseal?"
      options:
        - "Bisa, cukup 3 dari 5"
        - "Ga bisa, butuh semua 5"
        - "Bisa, pakai root token saja"
      answer: 0
      why: "Threshold 3 artinya 3 potongan mana pun cukup. Root token ga bisa membuka segel; dia cuma bisa dipakai setelah Vault terbuka."

  - title: "Login dan token"
    missions: [3]
    body: |
      Setiap permintaan ke Vault harus membawa **token**. Token punya **policy** (apa yang boleh dilakukan) dan **TTL** (kapan kedaluwarsa).

      **Root token** dari hasil init bisa melakukan apa saja. Pakai cukup untuk setup awal, lalu buat cara login yang lebih terbatas dan revoke root token-nya. Di production, manusia biasanya login lewat OIDC/LDAP, aplikasi lewat AppRole atau Kubernetes auth.
    steps:
      - text: "Login pakai root token dari hasil init."
        pick: "vault login "
      - text: "Lihat detail token yang sedang dipakai: policy, TTL, dan lainnya."
        cmd: "vault token lookup"
    quiz:
      q: "Praktik yang baik untuk root token setelah setup awal?"
      options:
        - "Dibagikan ke semua developer"
        - "Disimpan di repo supaya ga hilang"
        - "Di-revoke, dan dibuat ulang hanya saat darurat"
      answer: 2
      why: "Root token ga punya batasan apa pun. Kalau bocor, semua rahasia ikut bocor. Root token baru bisa dibuat lagi dengan unseal key bila benar-benar perlu."

  - title: "Simpan rahasia di KV v2"
    missions: [4, 5]
    body: |
      Vault punya banyak **secrets engine**, masing-masing di-*mount* di sebuah path. Yang paling dasar adalah **KV** (key-value). Versi 2-nya menyimpan **riwayat versi**, jadi kalau password tertimpa kamu masih bisa melihat atau mengembalikan versi lama.

      Satu hal yang sering bikin bingung: di KV v2, CLI `vault kv get secret/app/db` sebenarnya memanggil API `secret/data/app/db`. Prefix `data/` ini nanti penting waktu menulis policy.
    steps:
      - text: "Aktifkan KV v2 di path `secret/`."
        cmd: "vault secrets enable -path=secret kv-v2"
      - cmd: "vault kv put secret/app/db username=app password=rahasia123"
      - cmd: "vault kv get secret/app/db"
      - text: "Ganti password. Ini jadi versi 2."
        cmd: "vault kv put secret/app/db username=app password=GantiDong456"
      - text: "Versi lama masih bisa diambil."
        cmd: "vault kv get -version=1 secret/app/db"
    quiz:
      q: "Path API yang sebenarnya diakses `vault kv get secret/app/db` (KV v2) adalah..."
      options:
        - "`secret/app/db`"
        - "`secret/data/app/db`"
        - "`kv/secret/app/db`"
      answer: 1
      why: "KV v2 memisahkan data (`data/`) dan metadata (`metadata/`). Policy harus memakai path API ini, bukan path CLI."

  - title: "Policy: siapa boleh apa"
    missions: [6]
    body: |
      **Policy** ditulis dalam HCL dan berisi daftar path beserta **capabilities**: `create`, `read`, `update`, `delete`, `list`, dan seterusnya. Defaultnya Vault menolak semua yang ga diizinkan (*deny by default*).

      Buka tab **akses** di lab untuk melihat `app-read.hcl`. Isinya mengizinkan `read` di `secret/data/app/*` saja. Token dengan policy ini bisa membaca password database aplikasi, tapi ga bisa mengubahnya, dan ga bisa melihat rahasia lain.

      Prinsipnya: **least privilege**. Beri setiap aplikasi akses sesempit mungkin.
    steps:
      - text: "Daftarkan policy dari file."
        cmd: "vault policy write app-read app-read.hcl"
      - text: "Bikin token yang cuma punya policy itu."
        cmd: "vault token create -policy=app-read -ttl=1h"
      - text: "Pakai token itu untuk membaca. Berhasil."
        pick: "VAULT_TOKEN="
      - text: "Pakai token yang sama untuk menulis. Ditolak: *permission denied*."
        pick: "VAULT_TOKEN="
    quiz:
      q: "Token dengan policy `app-read` mencoba membaca `secret/data/billing/key`. Hasilnya?"
      options:
        - "Berhasil, karena punya capability read"
        - "Ditolak, karena path itu ga ada di policy"
        - "Berhasil tapi datanya disensor"
      answer: 1
      why: "Capability berlaku per path. Di luar `secret/data/app/*`, token itu ga punya izin apa pun."

  - title: "AppRole: login untuk aplikasi"
    missions: [7]
    body: |
      Aplikasi ga bisa login pakai username-password manusia, dan memasang token panjang umur di konfigurasi itu berisiko. **AppRole** memecah kredensial jadi dua:

      - **role-id**: semacam username. Ga terlalu rahasia, boleh ditanam di image atau konfigurasi.
      - **secret-id**: semacam password. Dikirim terpisah saat deploy (misalnya oleh pipeline CI/CD), bisa dibatasi umur dan jumlah pemakaiannya.

      Aplikasi menukar keduanya jadi token berumur pendek dengan policy yang sudah ditentukan di role.
    steps:
      - cmd: "vault auth enable approle"
      - text: "Bikin role `web` yang menghasilkan token dengan policy app-read selama 20 menit."
        cmd: "vault write auth/approle/role/web token_policies=app-read token_ttl=20m"
      - cmd: "vault read auth/approle/role/web/role-id"
      - cmd: "vault write -f auth/approle/role/web/secret-id"
      - text: "Login sebagai aplikasi: tukar role-id + secret-id jadi token."
        pick: "vault write auth/approle/login "
    quiz:
      q: "Kenapa role-id dan secret-id sebaiknya dikirim lewat jalur berbeda?"
      options:
        - "Supaya lebih cepat"
        - "Supaya yang mencuri salah satunya saja belum bisa login"
        - "Karena formatnya beda"
      answer: 1
      why: "Seperti username dan password, keduanya baru berguna kalau digabung. Memisahkan jalurnya memperkecil risiko keduanya bocor bersamaan."

  - title: "Kredensial database dinamis"
    missions: [8]
    body: |
      Password database yang sama dipakai bertahun-tahun oleh banyak aplikasi itu mimpi buruk: susah dirotasi, susah dilacak siapa memakainya.

      **Database secrets engine** membalik caranya. Vault memegang akun admin database, dan setiap kali aplikasi minta kredensial, Vault **membuat user baru** dengan umur pendek (*lease*). Begitu lease habis atau di-revoke, Vault menghapus user itu dari database.

      Hasilnya: tiap aplikasi (bahkan tiap instance) punya kredensial sendiri, yang bocor pun cepat basi.
    steps:
      - cmd: "vault secrets enable database"
      - text: "Kasih Vault akses admin ke PostgreSQL."
        cmd: |-
          vault write database/config/postgres plugin_name=postgresql-database-plugin connection_url="postgresql://{{username}}:{{password}}@10.0.0.20:5432/app" allowed_roles=readonly username=vault password=vault-pass
      - text: "Bikin role `readonly`: SQL untuk membuat user, dan umurnya 1 menit (maks 5)."
        cmd: |-
          vault write database/roles/readonly db_name=postgres creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" default_ttl=1m max_ttl=5m
      - text: "Minta kredensial. Tiap kali dipanggil, user-nya beda."
        cmd: "vault read database/creds/readonly"
      - text: "Cabut lease-nya sekarang. User di database langsung dihapus."
        pick: "vault lease revoke "
    quiz:
      q: "Apa yang terjadi saat lease kredensial dinamis habis?"
      options:
        - "Ga terjadi apa-apa, user tetap ada"
        - "Vault menghapus user itu dari database"
        - "Password-nya dikirim ulang ke aplikasi"
      answer: 1
      why: "Vault mencatat setiap lease dan membersihkannya sendiri. Aplikasi yang masih butuh akses harus *renew* lease atau minta kredensial baru."

  - title: "Enkripsi sebagai layanan: transit"
    missions: [9]
    body: |
      Kadang aplikasi perlu mengenkripsi data sendiri, misalnya nomor KTP sebelum disimpan di database. Mengurus kunci enkripsi di aplikasi itu rawan.

      **Transit** menyediakan enkripsi sebagai layanan: aplikasi mengirim teks (dalam base64), Vault mengembalikan *ciphertext* seperti `vault:v1:...`. Kuncinya **ga pernah keluar dari Vault**. Rotasi kunci juga gampang: data lama tetap bisa didekripsi, data baru memakai versi kunci terbaru.
    steps:
      - cmd: "vault secrets enable transit"
      - text: "Bikin kunci bernama `app`."
        cmd: "vault write -f transit/keys/app"
      - text: "Enkripsi teks. Input transit harus base64."
        cmd: 'vault write transit/encrypt/app plaintext=$(echo -n "halo vault" | base64)'
      - text: "Dekripsi ciphertext barusan dan ubah balik dari base64."
        pick: "vault write -field=plaintext transit/decrypt/app "
    quiz:
      q: "Di transit, di mana kunci enkripsinya disimpan?"
      options:
        - "Dikirim ke aplikasi bersama ciphertext"
        - "Cuma di Vault; aplikasi ga pernah melihatnya"
        - "Di database aplikasi"
      answer: 1
      why: "Itu inti transit: aplikasi cuma memegang ciphertext. Tanpa akses ke Vault, ciphertext ga bisa dibuka."

  - title: "Seal darurat"
    missions: [10]
    body: |
      Ada indikasi pembobolan? `vault operator seal` langsung **menyegel** Vault: root key dibuang dari memori dan semua permintaan berhenti dilayani. Ini rem darurat.

      Untuk membukanya lagi, perlu proses unseal penuh dengan threshold key seperti di awal. Jadi pastikan para pemegang key bisa dihubungi, dan latih prosedur ini sebelum benar-benar dibutuhkan.
    steps:
      - cmd: "vault operator seal"
      - cmd: "vault status"
      - text: "Buka lagi dengan 3 key."
        pick: "vault operator unseal "
      - pick: "vault operator unseal "
      - pick: "vault operator unseal "
    quiz:
      q: "Setelah `vault operator seal`, apa yang dibutuhkan untuk membuka Vault lagi?"
      options:
        - "Root token"
        - "Unseal key sejumlah threshold"
        - "Restart server saja"
      answer: 1
      why: "Seal membuang root key dari memori. Satu-satunya cara menyusunnya lagi adalah dengan potongan unseal key."
recap: |
  Yang sudah kamu kuasai:

  - Init, unseal, seal, dan kenapa key dipecah.
  - Token, policy, dan least privilege.
  - KV v2 dengan versi, AppRole buat aplikasi.
  - Kredensial database dinamis dan enkripsi dengan transit.
---
Vault menyimpan password, token, dan kunci enkripsi di satu tempat yang terenkripsi, dengan akses yang diatur dan tercatat. Lab-nya berisi server Vault dan database PostgreSQL bohongan yang bisa kamu atur dari terminal laptop.
