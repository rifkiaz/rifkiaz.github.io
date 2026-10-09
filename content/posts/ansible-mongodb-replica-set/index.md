---
title: "Deploy MongoDB Replica Set dengan Ansible"
date: 2026-09-22T09:00:00+07:00
description: "Membangun role Ansible untuk memasang MongoDB replica set tiga node lengkap dengan keyfile, autentikasi, dan inisialisasi yang idempoten."
categories: [proyek]
tags: [ansible, mongodb, replica-set, otomasi, devops]
---

Memasang satu server MongoDB secara manual itu mudah. Memasang tiga node replica set dengan konfigurasi yang identik, keyfile yang sama, autentikasi aktif, dan bisa diulang kapan saja tanpa merusak cluster yang sudah berjalan, itu cerita lain. Di tulisan ini saya membahas pendekatan yang saya pakai untuk mengotomasinya dengan Ansible.

Semua nama host, user, dan nilai di bawah adalah contoh. Sesuaikan dengan lingkungan Anda.

## Target akhir

- Tiga node MongoDB (satu primary, dua secondary) dalam replica set `rs0`.
- Autentikasi internal antar-node menggunakan **keyfile**.
- `authorization` aktif, dengan satu user admin.
- Playbook **idempoten**: dijalankan berulang kali hasilnya sama, dan tidak mencoba `rs.initiate()` ulang di cluster yang sudah hidup.
- Rahasia (password, keyfile) disimpan di **Ansible Vault**, bukan di repository dalam bentuk teks biasa.

## Prasyarat

- Tiga server Ubuntu LTS yang bisa saling menjangkau di port 27017 dan bisa di-resolve dengan nama host.
- Ansible di mesin kontrol, plus collection `community.mongodb`:

```bash
ansible-galaxy collection install community.mongodb
```

Modul di collection tersebut membutuhkan `pymongo` di node target. Cek versi yang didukung di dokumentasi collection sebelum memilih cara pemasangannya.

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

Node pertama di grup akan menjadi tempat inisialisasi replica set dan diberi prioritas lebih tinggi supaya terpilih sebagai primary. Daftar anggota ditulis eksplisit di `group_vars` supaya mudah dibaca:

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

Keyfile dan password admin masuk ke Vault. Buat isi keyfile sekali saja:

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

Keyfile harus **identik** di semua node dan hanya bisa dibaca oleh user `mongodb`. Kalau permission-nya terlalu longgar, `mongod` akan menolak start.

## Inisialisasi replica set yang idempoten

Bagian ini yang paling sering bikin playbook gagal di run kedua. Begitu user admin dibuat, *localhost exception* tertutup, sehingga perintah yang tadinya jalan tanpa login sekarang butuh kredensial. Triknya: cek status memakai `db.hello()`, yang tidak memerlukan autentikasi dan mengembalikan `setName` kalau replica set sudah aktif.

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

`run_once` tanpa `delegate_to` akan berjalan di host pertama pada play, yaitu `mongo-01`, sama dengan anggota yang diberi prioritas 2 di `mongodb_members`.

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

Opsi `create_for_localhost_exception` membuat user pertama lewat localhost exception, lalu menulis file penanda. Di run berikutnya modul akan memakai `login_user` dan `login_password` biasa.

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

Jalankan:

```bash
ansible-playbook -i inventory/hosts.yml site.yml --ask-vault-pass
```

## Verifikasi

```bash
mongosh "mongodb://mongo-01:27017,mongo-02:27017,mongo-03:27017/?replicaSet=rs0&authSource=admin" \
  -u admin -p --eval "rs.status().members.map(m => m.name + ' ' + m.stateStr)"
```

Hasilnya harus menampilkan satu `PRIMARY` dan dua `SECONDARY`. Jalankan playbook sekali lagi: semua task seharusnya berstatus `ok`, tanpa `changed`.

## Pelajaran yang saya ambil

- **Jangan pernah commit keyfile atau password** dalam bentuk teks biasa. Ansible Vault (atau secret manager) wajib sejak hari pertama.
- **Idempotensi harus diuji**, bukan diasumsikan. Jalankan playbook dua kali di lingkungan uji dan pastikan run kedua bersih.
- **Batasi akses jaringan.** `bindIp` hanya ke interface privat, lalu buka port 27017 di firewall hanya untuk anggota replica set dan aplikasi yang memang butuh.
- **Uji failover.** Matikan primary di lingkungan uji dan pastikan aplikasi tetap bisa menulis setelah election selesai.

Di tulisan berikutnya saya membahas cara memasang [Prometheus exporter dengan Ansible](/posts/ansible-prometheus-exporter/) supaya cluster seperti ini bisa dimonitor.
