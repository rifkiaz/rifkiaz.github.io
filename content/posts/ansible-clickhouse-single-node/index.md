---
title: "Deploy ClickHouse Single Node di Ubuntu 24.04 dengan Ansible"
date: 2026-10-11T21:12:00+07:00
description: "Deploy ClickHouse LTS di EC2 Ubuntu 24.04 menggunakan Ansible: EBS terpisah untuk data, tuning OS, user dari Ansible Vault, sampai monitoring di Grafana."
categories: [proyek]
tags: [ansible, clickhouse, aws, ec2, ebs, ansible-vault, grafana, monitoring, devops]
ShowToc: true
---
### Pendahuluan
[ClickHouse](https://clickhouse.com/) adalah database kolumnar (OLAP) yang memang dibuat untuk query analitik dan agregasi data yang besar. Beberapa waktu belakangan ini DWH di tempat saya yang masih pakai PostgreSQL mulai berat, job dbt makin banyak, tabel makin gemuk, dan query analitik jadi saling antre (asli bikin nunggu lama). Karena itu rencananya DWH dipindah ke ClickHouse.

Untuk tahap awal cukup single node di satu EC2 dulu. Supaya gampang dibangun ulang kapan saja, semua proses install dan konfigurasinya saya buat dalam bentuk role Ansible. Pada tulisan kali ini saya akan berbagi langkah - langkahnya dari nol sampai ClickHouse jalan, termasuk beberapa kendala yang sempat saya temui.

Oh ya, semua IP, ID, nama user dan password di tulisan ini cuma contoh ya, silakan disesuaikan.

Gambaran arsitekturnya kurang lebih seperti ini:

![Arsitektur: laptop menjalankan Ansible lewat SSH di VPN ke EC2 Ubuntu 24.04 berisi ClickHouse, node_exporter, EBS root, dan EBS data yang di-mount ke /var/lib/clickhouse. Airflow, BI, Grafana, dan Prometheus terhubung ke port masing-masing](assets/arsitektur.svg)

### Kebutuhan
- EC2 dengan Ubuntu 24.04
- EBS tambahan untuk data (gp3)
- Ansible di laptop, plus collection `ansible.posix` dan `community.general`
- Akses SSH ke server (di sini saya lewat VPN)

### Kenapa gak pakai container?
Awalnya sempat kepikiran pakai Docker, tapi akhirnya saya pilih install native lewat paket `.deb`. Alasannya:
1. Satu EC2 ini memang khusus untuk ClickHouse saja, jadi kelebihan container (isolasi dan banyak service di satu host) gak kepakai.
2. Tuning OS seperti sysctl, THP, swap dan mount disk tetap harus dilakukan di host, mau pakai container ataupun tidak.
3. Kalau pakai container mesti atur sendiri `ulimit`, capability, volume untuk data dan config. Sedangkan paket `.deb` sudah bawa unit systemd yang settingnya sudah benar.
4. Operasional sehari - hari lebih gampang, tinggal `systemctl status`, log ada di `/var/log/clickhouse-server/`, dan upgrade cukup ganti satu variabel.

Container tetap berguna kok, misalnya untuk nyoba model dbt di laptop sebelum masuk production.

### Spesifikasi
Awalnya saya mau pakai 2 core 4 GB biar hemat (maklum budget). Ternyata 4 GB itu batas bawah banget, karena ClickHouse cuma dapat sekitar 3,6 GB dan sebagian sudah kepakai untuk cache, merge dan system log. Kalau ada JOIN atau GROUP BY yang besar bakal sering kena error `MEMORY_LIMIT_EXCEEDED`.

Akhirnya saya pakai 2 vCPU / 8 GB. Beberapa pilihan instance yang masuk akal:

| Instance | Spek | Catatan |
|---|---|---|
| `t4g.large` | 2 vCPU / 8 GB | Hemat, cocok untuk job batch |
| `m7g.large` / `m6g.large` | 2 vCPU / 8 GB | CPU tidak burstable, performa lebih stabil |
| `r7g.large` | 2 vCPU / 16 GB | Kalau banyak JOIN berat |

Instance yang ada huruf `g` itu Graviton (ARM). ClickHouse sudah support ARM64 secara resmi, dan role Ansible ini otomatis pilih repo `arm64` atau `amd64`. Yang penting waktu launch instance pilih AMI Ubuntu 24.04 yang **64-bit (Arm)**.

Untuk disk, data di ClickHouse biasanya 3 sampai 10 kali lebih kecil dibanding di PostgreSQL karena kolumnar dan terkompresi. Ukuran EBS juga bisa diperbesar nanti tanpa downtime, tapi tidak bisa dikecilkan. Saya akhirnya pakai gp3 500 GB biar lega.

### Persiapan Disk Data di AWS Console
Tahap ini dilakukan **sebelum** menjalankan Ansible.
1. Buka EC2 > Instances, pilih instance, lalu catat **Availability Zone**-nya. Volume cuma bisa di-attach ke instance di AZ yang sama.
2. Buat volume baru
   - EC2 > Elastic Block Store > Volumes > Create volume
````
Volume type : gp3
Size : sesuai kebutuhan
IOPS : 3000 (default)
Throughput : 125 MiB/s (default)
Availability Zone : sama dengan instance
Encryption : (✓)
Tag : Name = clickhouse-data
````
3. Attach volume ke instance
   - Pilih volume > Actions > Attach volume
````
Instance : pilih instance ClickHouse
Device name : /dev/sdf
````
4. Masuk ke server, lalu cari path disk yang stabil. Di instance Nitro, `/dev/sdf` akan muncul sebagai `/dev/nvme1n1`, tapi nama ini bisa berubah setelah reboot, jadi yang dipakai path `by-id`
```
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT
ls -l /dev/disk/by-id/ | grep Elastic_Block_Store | grep -v part
```
Outputnya kurang lebih seperti ini:
````
nvme-Amazon_Elastic_Block_Store_vol0abc123def4567890 -> ../../nvme1n1
````
5. Pastikan disk masih kosong dan belum ada data ClickHouse
```
sudo lsblk -f /dev/nvme1n1      # kolom FSTYPE harus kosong
ls /var/lib/clickhouse           # harus "No such file or directory"
```
Catatan: jangan format atau mount manual ya, biar nanti Ansible yang mengerjakan.

### Struktur Project
````
ansible-clickhouse-deployment/
├── ansible.cfg
├── requirements.yml
├── site.yml
├── inventory/
│   ├── hosts.ini
│   └── group_vars/clickhouse/
│       ├── main.yml
│       ├── connection.yml
│       ├── secrets.yml
│       ├── vault.yml.example
│       └── vault.yml
└── roles/clickhouse/
    ├── defaults/main.yml
    ├── handlers/main.yml
    ├── tasks/
    └── templates/
````
Role `clickhouse` ini menjalankan beberapa tahap secara berurutan seperti berikut:

![Alur role: preflight, OS tuning, storage, install, lalu config. Kalau config valid, service di-restart dan post install jalan. Kalau tidak valid, play berhenti dan server tidak di-restart](assets/alur-role.svg)

- **preflight**: cek OS harus Ubuntu 24.04, arsitektur didukung, dan password sudah diisi (minimal 12 karakter).
- **OS tuning**: sysctl, Transparent Huge Pages di-set `madvise`, dan swap dimatikan.
- **storage**: format dan mount EBS data ke `/var/lib/clickhouse`.
- **install**: pasang ClickHouse dari repo resmi channel `lts`.
- **config**: tambah file override di `config.d/` dan `users.d/`, lalu divalidasi dulu sebelum restart.
- **service** dan **post install**: health check, lalu buat database.

### Tahapan
1. Isi inventory dengan IP private server
```
vim inventory/hosts.ini

............
[clickhouse]
clickhouse-01 ansible_host=10.0.1.10 ansible_user=ubuntu
```
2. Atur koneksi SSH
```
vim inventory/group_vars/clickhouse/connection.yml

............
ansible_ssh_private_key_file: ~/.ssh/id_ed25519
ansible_ssh_common_args: -o StrictHostKeyChecking=accept-new
```
Kalau gak ada VPN, bisa juga lewat AWS SSM tanpa buka port 22. Caranya isi `ansible_host` dengan Instance ID, lalu tambahkan ProxyCommand ini:
````
ansible_ssh_common_args: >-
  -o ProxyCommand="aws ssm start-session --target %h
  --document-name AWS-StartSSHSession --parameters portNumber=%p --region <region>"
````
3. Isi path disk data dari tahap persiapan tadi
```
vim inventory/group_vars/clickhouse/main.yml

............
clickhouse_data_device: /dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol0abc123def4567890
clickhouse_data_fstype: ext4
```
4. Buat file secret lalu encrypt dengan ansible-vault
```
cd inventory/group_vars/clickhouse
cp vault.yml.example vault.yml
vim vault.yml
```
```
............
vault_clickhouse_secrets:
  default_password: "<isi-password>"
  admin_username: "admin"
  admin_password: "<isi-password>"
  etl_password: "<isi-password>"
  bi_password: "<isi-password>"
  grafana_password: "<isi-password>"
```
Password bisa dibuat pakai `openssl rand -base64 24`. Setelah itu encrypt filenya
```
ansible-vault encrypt vault.yml
head -1 vault.yml
cd -
```
Kalau berhasil, baris pertamanya akan jadi `$ANSIBLE_VAULT;1.1;AES256`.

5. Install collection dan tes koneksi
```
ansible-galaxy collection install -r requirements.yml
ansible clickhouse -m ping --ask-vault-pass
```
Jika berhasil akan menampilkan output seperti berikut:
````
clickhouse-01 | SUCCESS =>
    changed: false
    ping: pong
````
6. Jalankan dulu tahap persiapan OS dan disk
```
ansible-playbook site.yml --ask-vault-pass --tags preflight,os,storage
```
Lalu cek di server apakah disk sudah ter-mount
```
df -h /var/lib/clickhouse
grep clickhouse /etc/fstab
```
````
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme1n1    492G   28K  467G   1% /var/lib/clickhouse
UUID=xxxx-xxxx /var/lib/clickhouse ext4 defaults,noatime,nofail 0 0
````
Opsional, karena ini disk khusus data, ruang yang disisihkan ext4 untuk root bisa dikurangi dari 5% ke 1%
```
sudo tune2fs -m 1 /dev/nvme1n1
```
7. Kalau disk sudah benar, jalankan deploy penuh
```
ansible-playbook site.yml --ask-vault-pass
```
Di akhir play akan muncul pesan `ClickHouse 26.8.x.x berjalan di clickhouse-01`. Coba jalankan playbook sekali lagi, hasilnya harus `changed=0`, tandanya role ini aman dijalankan ulang.

8. Pin versi ClickHouse supaya kalau server dibangun ulang versinya tetap sama
```
dpkg -l clickhouse-server | tail -1
```
```
vim inventory/group_vars/clickhouse/main.yml

............
clickhouse_version: "26.8.x.y"
```
Paket ClickHouse juga sudah di-`hold`, jadi gak ikut ter-upgrade waktu `apt upgrade`.

9. Cek di server
```
systemctl status clickhouse-server
clickhouse-client --user admin --password -q "SHOW DATABASES"
curl -s localhost:9363/metrics | head
```

Voila, ClickHouse sudah jalan.

### Beberapa Hal di Dalam Role
#### Disk data yang aman dijalankan ulang
Bagian storage ini sengaja dibuat hati - hati supaya gak pernah memformat disk yang sudah ada isinya:
```
- name: Create filesystem on data device (hanya jika belum ada filesystem)
  community.general.filesystem:
    dev: "{{ clickhouse_data_device }}"
    fstype: "{{ clickhouse_data_fstype }}"
    force: false

- name: Mount data device to {{ clickhouse_data_path }}
  ansible.posix.mount:
    path: "{{ clickhouse_data_path }}"
    src: "UUID={{ clickhouse_data_uuid.stdout }}"
    fstype: "{{ clickhouse_data_fstype }}"
    opts: defaults,noatime,nofail
    state: mounted
```
- `force: false` artinya filesystem cuma dibuat kalau disk masih kosong.
- Mount pakai UUID, bukan nama device.
- `nofail` supaya server tetap bisa boot walaupun volume ter-detach.

Selain itu di preflight ada pengecekan, kalau `/var/lib/clickhouse` ternyata sudah ada isinya tapi belum di-mount ke EBS maka play akan berhenti. Kalau gak dicek, mount-nya bakal menutupi data lama dan tabel ClickHouse seolah hilang semua.

#### Konfigurasi lewat override
Config bawaan paket (`config.xml` dan `users.xml`) tidak diubah sama sekali. Semua perubahan ditaruh di `config.d/` dan `users.d/` supaya upgrade paket tetap bersih. Isinya antara lain:
- Port 9004, 9005 dan 9009 dimatikan karena gak dipakai di single node.
- Endpoint Prometheus `/metrics` di port 9363.
- Log level diturunkan dari `trace` ke `information` biar disk gak boros.
- System log tables seperti `query_log` diberi TTL 30 hari.

Sebelum restart, config dicek dulu pakai `xmllint` dan `clickhouse extract-from-config`. Kalau ada yang salah, play berhenti dan server gak di-restart, jadi server yang lagi jalan gak ikut mati gara - gara salah ketik.

#### User dan ansible-vault
User yang dibuat oleh role ini:

| User | Untuk | Akses |
|---|---|---|
| `default` | Bawaan | Diberi password, hanya dari localhost |
| `admin` | Admin | Full, bisa `CREATE USER` via SQL |
| `etl` | Airflow / dbt | `GRANT ALL ON dwh.*` |
| `bi_readonly` | Metabase / Superset | `readonly=2` |
| `grafana_ro` | Grafana | Read-only |

Catatan: user yang gak diberi `grants` akan dapat akses penuh, jadi selalu isi `grants` untuk user aplikasi.

Alur ansible-vault-nya seperti ini:

![Alur ansible-vault: vault.yml terenkripsi dibuka ansible-playbook dengan vault password, didekripsi di memori, lalu dirender ke users.d di server yang hanya menyimpan hash SHA-256](assets/alur-vault.svg)

File `vault.yml` di-encrypt AES-256, jadi aman di-commit ke git. Yang wajib dijaga cuma vault password-nya. Di server pun ClickHouse cuma menyimpan hash SHA-256, bukan password aslinya. Beberapa perintah yang sering dipakai:
```
ansible-vault view vault.yml
ansible-vault edit vault.yml
ansible-vault rekey vault.yml
```
Biar gak ngetik vault password terus, simpan di file `chmod 600` di luar repo
```
export ANSIBLE_VAULT_PASSWORD_FILE=~/.ansible/clickhouse.vault_pass
```

### Security Group
Port yang perlu dibuka di Security Group ClickHouse:

| Port | Source | Untuk |
|---|---|---|
| 22 | VPN | Ansible |
| 8123 | SG Airflow/dbt, SG BI | HTTP interface |
| 9000 | SG Airflow/dbt, SG Grafana | Native protocol |
| 9363 | SG Prometheus | Metrik ClickHouse |
| 9100 | SG Prometheus | node_exporter |

Sebaiknya pakai SG ID sebagai source, jangan CIDR. Oh ya, 9100 dan 9363 itu beda loh. 9100 untuk node_exporter (metrik OS), sedangkan 9363 untuk metrik bawaan ClickHouse.

### Monitoring
Sebenarnya ClickHouse sudah punya UI bawaan, bisa dibuka di `http://<ip>:8123/dashboard` untuk grafik monitoring dan `http://<ip>:8123/play` untuk SQL editor. Tapi biar lebih enak dilihat dan bisa kirim alert, saya sambungkan ke Grafana seperti berikut:

![Alur monitoring: metrik ClickHouse port 9363 dan node_exporter port 9100 di-scrape Prometheus lalu tampil di Grafana. Grafana juga query langsung ke ClickHouse port 9000 lewat plugin. Alert diteruskan lewat webhook ke n8n lalu ke Discord](assets/alur-monitoring.svg)

1. Tambahkan job scrape di Prometheus
```
- job_name: clickhouse
  static_configs:
    - targets: ["10.0.1.10:9363"]
      labels: { instance: clickhouse-01 }

- job_name: clickhouse-node
  static_configs:
    - targets: ["10.0.1.10:9100"]
      labels: { instance: clickhouse-01 }
```
2. Install plugin ClickHouse di Grafana
   - Administration > Plugins > cari ClickHouse > Install
3. Tambahkan data source
   - Connections > Data sources > Add > ClickHouse
````
Server address : 10.0.1.10
Server port : 9000
Protocol : Native
Secure Connection : Off
Username : grafana_ro
Password : (isi dari vault.yml)
Default database : dwh
SAVE & TEST
````
4. Kalau sudah muncul "Data source is working", buka tab Dashboards di data source tersebut lalu import **ClickHouse System Dashboards**, **Query Analysis** dan **Data Analysis**.
5. Import dashboard **Node Exporter Full** (ID `1860`) untuk metrik CPU, RAM dan disk.

Untuk alert, beberapa yang saya siapkan:

| Alert | PromQL | Kondisi |
|---|---|---|
| ClickHouse down | `up{job="clickhouse"}` | `== 0` selama 2m |
| Disk hampir penuh | `1 - node_filesystem_avail_bytes{mountpoint="/var/lib/clickhouse"} / node_filesystem_size_bytes{mountpoint="/var/lib/clickhouse"}` | `> 0.8` |
| RAM hampir habis | `1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` | `> 0.9` selama 5m |
| Banyak query gagal | `increase(ClickHouseProfileEvents_FailedQuery[5m])` | `> 10` |

Alert-nya saya arahkan ke webhook n8n, lalu diteruskan ke Discord.

### Kendala yang Sempat Ditemui
#### `No inventory was parsed`
Ini muncul karena perintahnya dijalankan dari dalam folder `inventory/`. File `ansible.cfg` ada di root project, jadi semua perintah Ansible harus dijalankan dari root project.

#### `Attempting to decrypt but no vault secrets found`
Setelah `vault.yml` di-encrypt, semua perintah Ansible termasuk `ping` butuh vault password. Solusinya tambahkan `--ask-vault-pass` atau set `ANSIBLE_VAULT_PASSWORD_FILE`.

#### Login admin gagal padahal deploy sukses
````
Code: 516. DB::Exception: admin: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)
````
Ternyata ada dua hal yang bikin ini terjadi:
- Yang diketik malah vault password, padahal yang diminta itu `admin_password` yang ada di dalam `vault.yml`.
- `admin_username` di `vault.yml` sudah diganti ke nama lain, jadi user `admin` memang gak ada.

Cek dulu isinya dengan `ansible-vault view`, lalu login pakai nama user yang benar
```
clickhouse-client --user <admin_username> --password
```
Satu lagi, kalau isi `vault.yml` sempat ke-screenshot atau kelihatan orang lain, sebaiknya langsung ganti password-nya
```
ansible-vault edit inventory/group_vars/clickhouse/vault.yml
ansible-playbook site.yml --ask-vault-pass --tags config,post_install
```
ClickHouse otomatis baca ulang konfigurasi user, jadi gak perlu restart.

### Selanjutnya
ClickHouse sudah jalan, PR berikutnya adalah backup (snapshot EBS lewat Data Lifecycle Manager dan `BACKUP ... TO S3`) dan migrasi data dari DWH PostgreSQL. Nantikan untuk tulisan selanjutnya perihal migrasinya ya ~

Sekian, semoga membantu.

Referensi:
- [ClickHouse Documentation](https://clickhouse.com/docs/install/debian_ubuntu)
- [Grafana ClickHouse data source plugin](https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/)
