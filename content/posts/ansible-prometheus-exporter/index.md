---
title: "Memasang Prometheus Exporter dengan Ansible"
date: 2026-09-29T09:00:00+07:00
description: "Role Ansible yang rapi untuk memasang node_exporter sebagai service systemd, lengkap dengan verifikasi checksum, user khusus, dan target scrape Prometheus yang dibuat dari inventory."
categories: [proyek]
tags: [ansible, prometheus, node-exporter, monitoring, observability]
---

Monitoring yang baik dimulai dari metrik yang konsisten di semua server. Memasang `node_exporter` secara manual di puluhan host rawan beda versi, beda flag, dan lupa di-enable setelah reboot. Di tulisan ini saya membahas role Ansible sederhana untuk memasang exporter Prometheus dengan cara yang bisa diulang.

Contoh di sini memakai `node_exporter`, tapi polanya sama untuk exporter lain yang didistribusikan sebagai satu binary, misalnya exporter untuk MongoDB, MySQL, atau HAProxy.

## Prinsip yang saya pegang

- **Versi di-pin** di variabel, bukan "latest".
- **Checksum diverifikasi** sebelum binary dipasang.
- **User khusus tanpa shell**, bukan root.
- **Dikelola systemd**, otomatis start setelah reboot.
- **Tidak terbuka ke publik.** Port exporter hanya bisa dijangkau oleh server Prometheus.

## Struktur role

```text
roles/node_exporter/
├── defaults/main.yml
├── handlers/main.yml
├── tasks/main.yml
└── templates/node_exporter.service.j2
```

## Variabel

```yaml
# roles/node_exporter/defaults/main.yml
node_exporter_version: "1.9.1"
node_exporter_arch: amd64
node_exporter_user: node_exporter
node_exporter_bin: /usr/local/bin/node_exporter
node_exporter_listen_address: "{{ ansible_default_ipv4.address }}:9100"
node_exporter_extra_flags:
  - --collector.systemd
```

Cek versi terbaru di halaman rilis resmi lalu ubah `node_exporter_version` secara sadar, bukan otomatis.

## Task

```yaml
# roles/node_exporter/tasks/main.yml
- name: Buat user sistem untuk node_exporter
  ansible.builtin.user:
    name: "{{ node_exporter_user }}"
    system: true
    shell: /usr/sbin/nologin
    create_home: false

- name: Unduh arsip node_exporter dengan verifikasi checksum
  ansible.builtin.get_url:
    url: "https://github.com/prometheus/node_exporter/releases/download/v{{ node_exporter_version }}/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}.tar.gz"
    dest: "/tmp/node_exporter-{{ node_exporter_version }}.tar.gz"
    checksum: "sha256:https://github.com/prometheus/node_exporter/releases/download/v{{ node_exporter_version }}/sha256sums.txt"
    mode: "0644"

- name: Ekstrak arsip
  ansible.builtin.unarchive:
    src: "/tmp/node_exporter-{{ node_exporter_version }}.tar.gz"
    dest: /tmp
    remote_src: true
    creates: "/tmp/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}/node_exporter"

- name: Pasang binary node_exporter
  ansible.builtin.copy:
    src: "/tmp/node_exporter-{{ node_exporter_version }}.linux-{{ node_exporter_arch }}/node_exporter"
    dest: "{{ node_exporter_bin }}"
    remote_src: true
    owner: root
    group: root
    mode: "0755"
  notify: Restart node_exporter

- name: Pasang unit systemd
  ansible.builtin.template:
    src: node_exporter.service.j2
    dest: /etc/systemd/system/node_exporter.service
    owner: root
    group: root
    mode: "0644"
  notify: Restart node_exporter

- name: Aktifkan dan jalankan node_exporter
  ansible.builtin.systemd_service:
    name: node_exporter
    state: started
    enabled: true
    daemon_reload: true

- name: Terapkan restart bila ada perubahan
  ansible.builtin.meta: flush_handlers

- name: Pastikan endpoint metrics merespons
  ansible.builtin.uri:
    url: "http://{{ node_exporter_listen_address }}/metrics"
    status_code: 200
  register: node_exporter_metrics
  until: node_exporter_metrics.status == 200
  retries: 5
  delay: 3
```

## Unit systemd

```ini
# roles/node_exporter/templates/node_exporter.service.j2
[Unit]
Description=Prometheus Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User={{ node_exporter_user }}
Group={{ node_exporter_user }}
Type=simple
ExecStart={{ node_exporter_bin }} \
  --web.listen-address={{ node_exporter_listen_address }}{% for flag in node_exporter_extra_flags %} \
  {{ flag }}{% endfor %}

Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Opsi hardening seperti `ProtectSystem` dan `NoNewPrivileges` murah untuk ditambahkan dan membatasi dampak kalau ada celah di exporter.

## Handler

```yaml
# roles/node_exporter/handlers/main.yml
- name: Restart node_exporter
  ansible.builtin.systemd_service:
    name: node_exporter
    state: restarted
    daemon_reload: true
```

## Playbook

```yaml
# monitoring.yml
- name: Pasang node_exporter
  hosts: all
  become: true
  roles:
    - node_exporter
```

```bash
ansible-playbook -i inventory/hosts.yml monitoring.yml
```

## Target scrape dari inventory

Supaya daftar target Prometheus tidak ditulis manual, saya membuatnya dari inventory yang sama. Contoh template untuk `file_sd`:

```yaml
# roles/prometheus_targets/templates/node.yml.j2
- targets:
{% for host in groups['all'] %}
    - "{{ hostvars[host]['ansible_default_ipv4']['address'] }}:9100"
{% endfor %}
  labels:
    job: node
```

Lalu di `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: node
    file_sd_configs:
      - files:
          - /etc/prometheus/targets/node.yml
```

Prometheus membaca ulang file `file_sd` secara otomatis, jadi menambah host baru cukup dengan menambahkannya ke inventory lalu menjalankan playbook. Template ini butuh fakta dari semua host, jadi pastikan fact gathering sudah berjalan untuk semua host di play yang sama.

## Keamanan

- Buka port 9100 di firewall **hanya** untuk alamat server Prometheus.
- Untuk jaringan yang tidak sepenuhnya tepercaya, aktifkan TLS dan basic auth lewat `--web.config.file` yang didukung exporter resmi Prometheus.
- Jangan aktifkan collector yang tidak dibutuhkan. Lebih sedikit metrik berarti lebih sedikit beban dan lebih sedikit informasi yang terekspos.

## Alternatif: collection resmi

Kalau tidak ingin memelihara role sendiri, collection `prometheus.prometheus` di Ansible Galaxy sudah menyediakan role untuk `node_exporter` dan beberapa exporter lain. Membuat role sendiri tetap berguna untuk memahami apa yang terjadi di balik layar, dan untuk exporter yang belum tersedia di collection tersebut.

Exporter ini pasangan yang cocok untuk [MongoDB replica set yang dipasang dengan Ansible](/posts/ansible-mongodb-replica-set/): metrik host dari `node_exporter`, metrik database dari exporter MongoDB, dan semuanya dipasang dari satu repository otomasi.
