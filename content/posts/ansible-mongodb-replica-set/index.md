---
title: "Deploy MongoDB Replica Set dengan Ansible"
date: 2026-09-22T09:00:00+07:00
description: "Membangun role Ansible untuk memasang MongoDB replica set tiga node lengkap dengan keyfile, autentikasi, dan inisialisasi yang idempoten."
categories: [proyek]
tags: [ansible, mongodb, replica-set, otomasi, devops]
---

Pasang satu server MongoDB secara manual itu gampang. Tapi kalau harus pasang tiga node replica set dengan konfigurasi yang sama persis, keyfile yang sama, autentikasi aktif, dan bisa dijalankan ulang kapan saja tanpa merusak cluster yang sudah jalan, ceritanya jadi lain. Di tulisan ini saya mau berbagi cara saya mengotomasinya pakai Ansible.

Oh iya, semua nama host, user, dan nilai di bawah cuma contoh, jadi sesuaikan saja dengan lingkunganmu.

## Yang mau dicapai

- Tiga node MongoDB (satu primary, dua secondary) dalam replica set `rs0`.
- Autentikasi internal antar-node menggunakan **keyfile**.
- `authorization` aktif, dengan satu user admin.
- Playbook **idempoten**: mau dijalankan berapa kali pun hasilnya tetap sama, dan nggak mencoba `rs.initiate()` lagi di cluster yang sudah hidup.
- Rahasia seperti password dan keyfile disimpan di **Ansible Vault**, bukan ditaruh di repository sebagai teks biasa.

## Prasyarat

- Tiga server Ubuntu LTS yang bisa saling terhubung di port 27017 dan bisa dipanggil lewat nama host.
- Ansible di mesin kontrol, ditambah collection `community.mongodb`:

```bash
ansible-galaxy collection install community.mongodb
```

Modul-modul di collection ini butuh `pymongo` di node target. Sebelum pasang, cek dulu versi yang didukung di dokumentasi collection-nya.

## Struktur proyek

```text
mongodb-ansible/
├── inventory/
│   ├── hosts.yml
│   └── group_vars/
│       └── mongodb/
│           ├── main.yml
│           └── vault.yml        # terenkripsi dengan ansible-vault
├── roles/
│   └── mongodb/
│       ├── defaults/main.yml
│       ├── handlers/main.yml
│       ├── tasks/
│       │   ├── main.yml
│       │   ├── install.yml
│       │   ├── configure.yml
│       │   ├── replicaset.yml
│       │   └── users.yml
│       └── templates/mongod.conf.j2
└── site.yml
```

## Inventory

```yaml
# inventory/hosts.yml
all:
  children:
    mongodb:
      hosts:
        mongo-01:
        mongo-02:
        mongo-03:
```

Node pertama di grup nantinya dipakai untuk inisialisasi replica set, dan saya kasih prioritas lebih tinggi supaya dia yang terpilih jadi primary. Daftar anggotanya saya tulis jelas di `group_vars` biar gampang dibaca:

```yaml
# inventory/group_vars/mongodb/main.yml
mongodb_members:
  - host: "mongo-01:27017"
    priority: 2
  - host: "mongo-02:27017"
  - host: "mongo-03:27017"
```

## Variabel dan rahasia

```yaml
# roles/mongodb/defaults/main.yml
mongodb_version: "8.0"
mongodb_user: mongodb
mongodb_port: 27017
mongodb_bind_ip: "127.0.0.1,{{ ansible_default_ipv4.address }}"
mongodb_dbpath: /var/lib/mongodb
mongodb_replset_name: rs0
mongodb_keyfile_path: /etc/mongodb/keyfile
mongodb_admin_user: admin
```

Keyfile dan password admin masuk ke Vault. Isi keyfile cukup dibuat sekali:

```bash
openssl rand -base64 756
```

Lalu simpan di `vault.yml` dan enkripsi:

```yaml
# inventory/group_vars/mongodb/vault.yml (sebelum dienkripsi)
mongodb_admin_password: "ganti-dengan-password-kuat"
mongodb_keyfile_content: |
  <hasil openssl rand -base64 756>
```

```bash
ansible-vault encrypt inventory/group_vars/mongodb/vault.yml
```

## Instalasi

```yaml
# roles/mongodb/tasks/install.yml
- name: Pasang GPG key repository MongoDB
  ansible.builtin.get_url:
    url: "https://pgp.mongodb.com/server-{{ mongodb_version }}.asc"
    dest: "/usr/share/keyrings/mongodb-server-{{ mongodb_version }}.asc"
    mode: "0644"

- name: Tambahkan repository MongoDB
  ansible.builtin.apt_repository:
    repo: >-
      deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-{{ mongodb_version }}.asc ]
      https://repo.mongodb.org/apt/ubuntu {{ ansible_distribution_release }}/mongodb-org/{{ mongodb_version }} multiverse
    filename: "mongodb-org-{{ mongodb_version }}"
    state: present

- name: Install MongoDB dan pymongo
  ansible.builtin.apt:
    name:
      - mongodb-org
      - python3-pymongo
    state: present
    update_cache: true
```

## Konfigurasi dan keyfile

```yaml
# roles/mongodb/templates/mongod.conf.j2
storage:
  dbPath: {{ mongodb_dbpath }}

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: {{ mongodb_port }}
  bindIp: {{ mongodb_bind_ip }}

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

security:
  authorization: enabled
  keyFile: {{ mongodb_keyfile_path }}

replication:
  replSetName: {{ mongodb_replset_name }}
```

```yaml
# roles/mongodb/tasks/configure.yml
- name: Buat direktori keyfile
  ansible.builtin.file:
    path: "{{ mongodb_keyfile_path | dirname }}"
    state: directory
    owner: "{{ mongodb_user }}"
    group: "{{ mongodb_user }}"
    mode: "0700"

- name: Pasang keyfile replica set
  ansible.builtin.copy:
    content: "{{ mongodb_keyfile_content }}"
    dest: "{{ mongodb_keyfile_path }}"
    owner: "{{ mongodb_user }}"
    group: "{{ mongodb_user }}"
    mode: "0400"
  no_log: true
  notify: Restart mongod

- name: Tulis mongod.conf
  ansible.builtin.template:
    src: mongod.conf.j2
    dest: /etc/mongod.conf
    owner: root
    group: root
    mode: "0644"
  notify: Restart mongod
```

```yaml
# roles/mongodb/handlers/main.yml
- name: Restart mongod
  ansible.builtin.systemd_service:
    name: mongod
    state: restarted
```

Yang perlu diingat, keyfile harus **sama persis** di semua node dan cuma boleh dibaca user `mongodb`. Kalau permission-nya terlalu longgar, `mongod` bakal menolak jalan.

## Inisialisasi replica set yang idempoten

Nah, bagian ini yang paling sering bikin playbook gagal di run kedua. Begitu user admin dibuat, *localhost exception* langsung tertutup, jadi perintah yang tadinya bisa jalan tanpa login sekarang minta kredensial. Triknya, cek status pakai `db.hello()`. Perintah ini nggak butuh autentikasi dan akan mengembalikan `setName` kalau replica set sudah aktif.

```yaml
# roles/mongodb/tasks/replicaset.yml
- name: Cek apakah replica set sudah diinisialisasi
  ansible.builtin.command: >-
    mongosh --quiet --port {{ mongodb_port }}
    --eval "db.hello().setName || ''"
  register: mongodb_rs_check
  changed_when: false
  run_once: true

- name: Inisialisasi replica set
  community.mongodb.mongodb_replicaset:
    login_host: localhost
    login_port: "{{ mongodb_port }}"
    replica_set: "{{ mongodb_replset_name }}"
    members: "{{ mongodb_members }}"
  when: mongodb_rs_check.stdout | trim == ''
  run_once: true

- name: Tunggu node pertama menjadi primary
  ansible.builtin.command: >-
    mongosh --quiet --port {{ mongodb_port }}
    --eval "db.hello().isWritablePrimary"
  register: mongodb_primary_check
  until: mongodb_primary_check.stdout | trim == 'true'
  retries: 30
  delay: 5
  changed_when: false
  run_once: true
```

`run_once` tanpa `delegate_to` akan jalan di host pertama pada play, yaitu `mongo-01`. Kebetulan itu juga anggota yang saya kasih prioritas 2 di `mongodb_members`.

## Membuat user admin

```yaml
# roles/mongodb/tasks/users.yml
- name: Buat user admin
  community.mongodb.mongodb_user:
    login_host: localhost
    login_port: "{{ mongodb_port }}"
    login_user: "{{ mongodb_admin_user }}"
    login_password: "{{ mongodb_admin_password }}"
    create_for_localhost_exception: /root/.mongodb_admin_created
    replica_set: "{{ mongodb_replset_name }}"
    database: admin
    name: "{{ mongodb_admin_user }}"
    password: "{{ mongodb_admin_password }}"
    roles:
      - root
    update_password: on_create
    state: present
  run_once: true
  no_log: true
```

Opsi `create_for_localhost_exception` membuat user pertama lewat localhost exception, lalu menulis file penanda. Di run berikutnya, modul akan login seperti biasa pakai `login_user` dan `login_password`.

## Menyatukan semuanya

```yaml
# roles/mongodb/tasks/main.yml
- name: Install
  ansible.builtin.import_tasks: install.yml

- name: Konfigurasi
  ansible.builtin.import_tasks: configure.yml

- name: Terapkan perubahan konfigurasi sebelum lanjut
  ansible.builtin.meta: flush_handlers

- name: Pastikan mongod aktif
  ansible.builtin.systemd_service:
    name: mongod
    state: started
    enabled: true

- name: Replica set
  ansible.builtin.import_tasks: replicaset.yml

- name: User
  ansible.builtin.import_tasks: users.yml
```

```yaml
# site.yml
- name: Deploy MongoDB replica set
  hosts: mongodb
  become: true
  roles:
    - mongodb
```

Tinggal jalankan:

```bash
ansible-playbook -i inventory/hosts.yml site.yml --ask-vault-pass
```

## Verifikasi

```bash
mongosh "mongodb://mongo-01:27017,mongo-02:27017,mongo-03:27017/?replicaSet=rs0&authSource=admin" \
  -u admin -p --eval "rs.status().members.map(m => m.name + ' ' + m.stateStr)"
```

Kalau semuanya lancar, akan muncul satu `PRIMARY` dan dua `SECONDARY`. Setelah itu coba jalankan playbook sekali lagi. Semua task harusnya berstatus `ok` tanpa ada yang `changed`.

## Beberapa hal yang saya pelajari

- **Jangan pernah commit keyfile atau password** sebagai teks biasa. Pakai Ansible Vault (atau secret manager) dari hari pertama.
- **Idempotensi itu harus dites**, jangan cuma diasumsikan. Jalankan playbook dua kali di lingkungan uji dan pastikan run kedua bersih.
- **Batasi akses jaringan.** Arahkan `bindIp` ke interface privat saja, lalu buka port 27017 di firewall hanya untuk anggota replica set dan aplikasi yang memang perlu.
- **Coba failover-nya.** Matikan primary di lingkungan uji, lalu pastikan aplikasi masih bisa menulis setelah election selesai.

Di tulisan berikutnya, saya bahas cara pasang [Prometheus exporter dengan Ansible](/posts/ansible-prometheus-exporter/) supaya cluster seperti ini bisa dipantau.
