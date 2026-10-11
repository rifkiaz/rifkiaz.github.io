---
title: "Membangun Cluster Elasticsearch di Docker dengan Ansible"
date: 2026-08-17T20:40:00+07:00
description: "Role Ansible untuk memasang cluster Elasticsearch tiga node berbasis container: tuning kernel, TLS antar-node, password dari Ansible Vault, dan bootstrap cluster yang aman dijalankan ulang."
categories: [proyek]
tags: [ansible, elasticsearch, docker, cluster, otomasi, devops]
ShowToc: true
---

Menjalankan satu container Elasticsearch untuk development itu cukup satu perintah `docker run`. Cluster tiga node untuk production lain cerita: setting kernel di host harus benar, node-node harus saling menemukan, komunikasi antar-node harus terenkripsi, dan proses bootstrap cluster punya jebakan yang bisa bikin data "hilang" kalau salah urus.

Di tulisan ini saya rangkum cara saya mengotomasinya dengan Ansible. Semua nama host, IP, dan versi di bawah cuma contoh, jadi sesuaikan dengan lingkunganmu.

## Yang mau dicapai

- Tiga node Elasticsearch 8.x, satu container per host. Ketiganya master-eligible sekaligus data node.
- Container memakai image resmi, dikelola Ansible lewat collection `community.docker`.
- Security aktif: TLS di transport layer (antar-node) dan HTTP layer (client ke cluster).
- Password user `elastic` disimpan di **Ansible Vault**.
- Playbook **idempoten**, dan `cluster.initial_master_nodes` hanya dipakai saat cluster pertama kali dibentuk.
- Playbook baru selesai setelah cluster benar-benar `green`.

## Prasyarat

- Tiga server Linux (contoh di sini Ubuntu LTS) dengan Docker terpasang, saling terhubung di port 9200 dan 9300.
- RAM minimal 4 GB per node untuk lab, lebih untuk production.
- Collection Ansible yang dipakai:

```bash
ansible-galaxy collection install community.docker community.crypto ansible.posix
```

## Struktur proyek

```text
es-ansible/
├── inventory/
│   ├── hosts.yml
│   └── group_vars/
│       └── elasticsearch/
│           ├── main.yml
│           └── vault.yml        # terenkripsi dengan ansible-vault
├── roles/
│   └── elasticsearch/
│       ├── defaults/main.yml
│       ├── handlers/main.yml
│       └── tasks/
│           ├── main.yml
│           ├── host.yml         # sysctl, direktori, ulimit
│           ├── certs.yml        # CA dan sertifikat node
│           ├── container.yml
│           └── verify.yml
└── site.yml
```

## Inventory dan variabel

```yaml
# inventory/hosts.yml
all:
  children:
    elasticsearch:
      hosts:
        es-01: { ansible_host: 192.0.2.11 }
        es-02: { ansible_host: 192.0.2.12 }
        es-03: { ansible_host: 192.0.2.13 }
```

```yaml
# inventory/group_vars/elasticsearch/main.yml
es_version: "8.15.0"
es_cluster_name: "logs-cluster"
es_heap: "2g"                       # maksimal ±50% RAM, dan di bawah ~31g
es_data_dir: /srv/elasticsearch/data
es_certs_dir: /srv/elasticsearch/certs
es_elastic_password: "{{ vault_es_elastic_password }}"
```

```yaml
# inventory/group_vars/elasticsearch/vault.yml (sebelum dienkripsi)
vault_es_elastic_password: "ganti-dengan-password-panjang"
```

```bash
ansible-vault encrypt inventory/group_vars/elasticsearch/vault.yml
```

## 1. Siapkan host

Elasticsearch punya *bootstrap checks*. Begitu node di-bind ke alamat selain loopback, node akan **menolak start** kalau beberapa setting host belum benar. Yang paling sering kena adalah `vm.max_map_count`.

```yaml
# roles/elasticsearch/tasks/host.yml
- name: Set vm.max_map_count
  ansible.posix.sysctl:
    name: vm.max_map_count
    value: "262144"
    state: present
    sysctl_set: true

- name: Matikan swap untuk sesi ini
  ansible.builtin.command: swapoff -a
  when: ansible_swaptotal_mb > 0
  changed_when: true

- name: Buat direktori data dan sertifikat
  ansible.builtin.file:
    path: "{{ item }}"
    state: directory
    owner: "1000"
    group: "0"
    mode: "0750"
  loop:
    - "{{ es_data_dir }}"
    - "{{ es_certs_dir }}"
```

Owner `1000:0` itu bukan asal pilih: proses Elasticsearch di image resmi berjalan sebagai UID 1000 dengan GID 0. Kalau direktori bind mount dimiliki root, container langsung crash dengan error `AccessDeniedException`.

Untuk swap, `swapoff -a` cuma berlaku sampai reboot. Agar permanen, hapus entri swap di `/etc/fstab`. Opsi lainnya adalah `bootstrap.memory_lock: true` (ada di bagian container di bawah).

## 2. Sertifikat TLS

Elasticsearch 8 sebenarnya bisa membuat sertifikat sendiri saat pertama start, tapi mekanisme itu dirancang untuk satu node yang lalu di-*enroll* ke node lain secara manual. Untuk cluster yang dibangun Ansible, saya lebih suka membuat CA sendiri sekali di mesin kontrol, lalu menerbitkan sertifikat per node. Semuanya pakai `community.crypto`, jadi tetap idempoten.

```yaml
# roles/elasticsearch/tasks/certs.yml
- name: Buat CA (sekali, di mesin kontrol)
  delegate_to: localhost
  run_once: true
  become: false
  block:
    - name: Private key CA
      community.crypto.openssl_privatekey:
        path: "{{ playbook_dir }}/pki/ca.key"

    - name: CSR CA
      community.crypto.openssl_csr_pipe:
        privatekey_path: "{{ playbook_dir }}/pki/ca.key"
        common_name: "{{ es_cluster_name }}-ca"
        basic_constraints: ["CA:TRUE"]
        basic_constraints_critical: true
        key_usage: [keyCertSign, cRLSign]
      register: ca_csr
      changed_when: false

    - name: Sertifikat CA
      community.crypto.x509_certificate:
        path: "{{ playbook_dir }}/pki/ca.crt"
        csr_content: "{{ ca_csr.csr }}"
        privatekey_path: "{{ playbook_dir }}/pki/ca.key"
        provider: selfsigned
        selfsigned_not_after: "+3650d"

- name: Sertifikat per node (dibuat di mesin kontrol)
  delegate_to: localhost
  become: false
  block:
    - name: Private key node
      community.crypto.openssl_privatekey:
        path: "{{ playbook_dir }}/pki/{{ inventory_hostname }}.key"

    - name: CSR node
      community.crypto.openssl_csr_pipe:
        privatekey_path: "{{ playbook_dir }}/pki/{{ inventory_hostname }}.key"
        common_name: "{{ inventory_hostname }}"
        subject_alt_name:
          - "DNS:{{ inventory_hostname }}"
          - "DNS:localhost"
          - "IP:{{ ansible_host }}"
          - "IP:127.0.0.1"
        extended_key_usage: [serverAuth, clientAuth]
      register: node_csr
      changed_when: false

    - name: Sertifikat node ditandatangani CA
      community.crypto.x509_certificate:
        path: "{{ playbook_dir }}/pki/{{ inventory_hostname }}.crt"
        csr_content: "{{ node_csr.csr }}"
        provider: ownca
        ownca_path: "{{ playbook_dir }}/pki/ca.crt"
        ownca_privatekey_path: "{{ playbook_dir }}/pki/ca.key"
        ownca_not_after: "+825d"

- name: Kirim sertifikat ke node
  ansible.builtin.copy:
    src: "{{ playbook_dir }}/pki/{{ item.src }}"
    dest: "{{ es_certs_dir }}/{{ item.dest }}"
    owner: "1000"
    group: "0"
    mode: "{{ item.mode }}"
  loop:
    - { src: "ca.crt", dest: "ca.crt", mode: "0644" }
    - { src: "{{ inventory_hostname }}.crt", dest: "node.crt", mode: "0644" }
    - { src: "{{ inventory_hostname }}.key", dest: "node.key", mode: "0600" }
  notify: Restart elasticsearch
```

Direktori `pki/` berisi private key CA, jadi **jangan di-commit** (masukkan ke `.gitignore`), atau enkripsi juga dengan Vault.

## 3. Container dan jebakan bootstrap cluster

Saat cluster **pertama kali** dibentuk, node-node perlu tahu siapa saja kandidat master awal lewat `cluster.initial_master_nodes`. Setelah cluster terbentuk, setting itu **harus dihilangkan**. Kalau dibiarkan, lalu suatu hari data salah satu node terhapus dan node itu start ulang, node tersebut bisa membentuk cluster baru sendirian, lengkap dengan password dan state yang berbeda.

Triknya: cek apakah direktori data sudah punya state cluster. Kalau belum ada, berarti ini bootstrap pertama.

```yaml
# roles/elasticsearch/tasks/container.yml
- name: Cek apakah node sudah pernah bergabung ke cluster
  ansible.builtin.stat:
    path: "{{ es_data_dir }}/_state"
  register: es_state

- name: Tentukan apakah ini bootstrap pertama
  ansible.builtin.set_fact:
    es_bootstrap: >-
      {{ groups['elasticsearch']
         | map('extract', hostvars, ['es_state', 'stat', 'exists'])
         | select | list | length == 0 }}

- name: Jalankan container Elasticsearch
  community.docker.docker_container:
    name: elasticsearch
    image: "docker.elastic.co/elasticsearch/elasticsearch:{{ es_version }}"
    restart_policy: unless-stopped
    network_mode: host
    ulimits:
      - "memlock:-1:-1"
      - "nofile:65535:65535"
    volumes:
      - "{{ es_data_dir }}:/usr/share/elasticsearch/data"
      - "{{ es_certs_dir }}:/usr/share/elasticsearch/config/certs:ro"
    env: "{{ es_env | combine(es_bootstrap_env if es_bootstrap else {}) }}"
  vars:
    es_env:
      cluster.name: "{{ es_cluster_name }}"
      node.name: "{{ inventory_hostname }}"
      network.host: "0.0.0.0"
      network.publish_host: "{{ ansible_host }}"
      discovery.seed_hosts: "{{ groups['elasticsearch'] | map('extract', hostvars, 'ansible_host') | join(',') }}"
      bootstrap.memory_lock: "true"
      ES_JAVA_OPTS: "-Xms{{ es_heap }} -Xmx{{ es_heap }}"
      ELASTIC_PASSWORD: "{{ es_elastic_password }}"
      xpack.security.enabled: "true"
      xpack.security.transport.ssl.enabled: "true"
      xpack.security.transport.ssl.verification_mode: "certificate"
      xpack.security.transport.ssl.key: "certs/node.key"
      xpack.security.transport.ssl.certificate: "certs/node.crt"
      xpack.security.transport.ssl.certificate_authorities: "certs/ca.crt"
      xpack.security.http.ssl.enabled: "true"
      xpack.security.http.ssl.key: "certs/node.key"
      xpack.security.http.ssl.certificate: "certs/node.crt"
      xpack.security.http.ssl.certificate_authorities: "certs/ca.crt"
    es_bootstrap_env:
      cluster.initial_master_nodes: "{{ groups['elasticsearch'] | join(',') }}"
  no_log: true
```

Beberapa catatan:

- **`network_mode: host`** membuat port 9200 dan 9300 langsung memakai IP host. Dengan begitu `network.publish_host` yang diumumkan ke node lain adalah IP host yang bisa dijangkau, bukan IP internal bridge Docker. Ini sumber masalah paling umum di cluster Elasticsearch berbasis container.
- **Heap** di-set sama untuk `-Xms` dan `-Xmx`, maksimal sekitar setengah RAM. Sisanya dipakai filesystem cache, yang justru sangat dibutuhkan Lucene.
- **`ELASTIC_PASSWORD`** hanya dipakai saat keystore pertama kali dibuat. Mengubah variabel ini nanti tidak mengganti password yang sudah ada; untuk itu pakai API `_security/user/elastic/_password`.
- **`no_log: true`** mencegah password tercetak di output Ansible, termasuk saat ada task yang gagal.
- Penentuan `es_bootstrap` melihat ke **semua** node: kalau salah satu node saja sudah punya state, berarti cluster sudah pernah terbentuk, dan `initial_master_nodes` tidak dipasang ke node mana pun.

## 4. Tunggu sampai cluster green

Tanpa langkah ini, playbook "sukses" padahal cluster belum tentu sehat.

```yaml
# roles/elasticsearch/tasks/verify.yml
- name: Tunggu cluster green
  ansible.builtin.uri:
    url: "https://{{ ansible_host }}:9200/_cluster/health?wait_for_status=green&timeout=50s"
    user: elastic
    password: "{{ es_elastic_password }}"
    force_basic_auth: true
    ca_path: "{{ es_certs_dir }}/ca.crt"
    return_content: true
  register: health
  until: health.status == 200 and health.json.status == 'green'
  retries: 12
  delay: 10
  run_once: true
  no_log: true

- name: Tampilkan ringkasan cluster
  ansible.builtin.debug:
    msg: "{{ health.json.cluster_name }}: {{ health.json.status }}, {{ health.json.number_of_nodes }} node"
  run_once: true
```

Handler restart-nya sederhana:

```yaml
# roles/elasticsearch/handlers/main.yml
- name: Restart elasticsearch
  ansible.builtin.command: docker restart elasticsearch
```

## 5. Playbook

```yaml
# site.yml
- name: Cluster Elasticsearch
  hosts: elasticsearch
  become: true
  roles:
    - elasticsearch
```

```yaml
# roles/elasticsearch/tasks/main.yml
- ansible.builtin.import_tasks: host.yml
- ansible.builtin.import_tasks: certs.yml
- ansible.builtin.import_tasks: container.yml
- ansible.builtin.meta: flush_handlers   # restart dulu kalau sertifikat berubah, baru verifikasi
- ansible.builtin.import_tasks: verify.yml
```

```bash
ansible-playbook -i inventory/hosts.yml site.yml --ask-vault-pass
```

Cek manual dari salah satu node:

```bash
curl --cacert /srv/elasticsearch/certs/ca.crt -u elastic \
  "https://localhost:9200/_cat/nodes?v"
```

Hasilnya tiga baris node, salah satunya bertanda `*` di kolom `master`.

## Upgrade versi tanpa downtime

Karena versi diatur lewat `es_version`, upgrade cukup mengganti variabel itu. Tapi jangan biarkan Ansible me-restart ketiga node sekaligus. Jalankan playbook dengan `serial: 1`, supaya node diganti satu per satu dan setiap node baru lanjut setelah cluster kembali green:

```yaml
- name: Rolling upgrade
  hosts: elasticsearch
  become: true
  serial: 1
  roles:
    - elasticsearch
```

Untuk cluster dengan data besar, tambahkan langkah menonaktifkan alokasi shard (`cluster.routing.allocation.enable: primaries`) sebelum restart dan mengaktifkannya lagi setelahnya, sesuai panduan *rolling upgrade* di dokumentasi Elastic.

## Pelajaran

- **Bootstrap checks itu teman.** Error `max virtual memory areas vm.max_map_count [65530] is too low` di log berarti task sysctl belum jalan, bukan masalah di image.
- **Jangan biarkan `cluster.initial_master_nodes` permanen.** Ini satu-satunya setting di sini yang bisa membuat cluster terbelah diam-diam.
- **Publish host harus IP yang bisa dijangkau node lain.** Di Docker mode bridge tanpa pengaturan tambahan, node akan mengumumkan IP container dan gagal saling menemukan.
- **Rahasia di satu tempat.** Password di Vault, private key CA di luar repository, dan `no_log` di task yang menyentuhnya.
