---
title: "Monitoring EC2 di Auto Scaling Group dengan Prometheus Self-Hosted"
date: 2026-05-23T20:14:00+07:00
categories: [tutorial]
tags: [prometheus, aws, ec2, autoscaling, node-exporter, cloudwatch, grafana, monitoring]
description: "Cara memantau instance EC2 di Auto Scaling Group dari Prometheus self-hosted memakai EC2 service discovery, label yang rapi per instance di Grafana, dan mengambil RPS dari ALB lewat CloudWatch Exporter tanpa boros biaya."
ShowToc: true
---

Prometheus saya selama ini memantau server-server EC2 dengan `static_configs`: daftar IP ditulis manual satu per satu. Untuk server yang tetap, cara itu masih oke. Masalahnya muncul waktu ada aplikasi yang jalan di **Auto Scaling Group** (ASG) dengan kapasitas 2 sampai 50 instance. IP-nya datang dan pergi mengikuti scaling, dan nggak mungkin saya edit `prometheus.yml` setiap kali ASG scale out.

Solusinya ada tiga bagian:

```
Instance di ASG ── node_exporter (:9100)
        ▲
        │ scrape, target ditemukan lewat EC2 service discovery
        │
Prometheus self-hosted ──► Grafana
        │
        └── cloudwatch_exporter (:9106) ◄── CloudWatch ◄── ALB (RPS, latency, error)
```

## 1. Pasang Node Exporter lewat User Data

Instance di ASG dibuat dari **Launch Template**, jadi node_exporter harus terpasang otomatis saat instance pertama kali boot. Tempatnya di **EC2 → Launch Templates → pilih template → Actions → Modify template (Create new version) → Advanced details → User data**.

Tambahkan blok ini ke skrip user data yang sudah ada:

```bash
#!/bin/bash
# --- Node Exporter untuk Prometheus ---
NODE_EXPORTER_VERSION="1.8.1"
cd /tmp
wget -q https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
tar xzf node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
cp node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64*
useradd -rs /bin/false node_exporter

cat > /etc/systemd/system/node_exporter.service <<'NODEEOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
NODEEOF

systemctl daemon-reload
systemctl enable --now node_exporter
```

Beberapa hal kecil tapi penting:

- **Taruh blok ini sebelum bagian yang menjalankan aplikasi.** Kalau skrip kamu punya bagian `sudo -u <user> bash <<'EOF' ... EOF` untuk deploy aplikasi, node_exporter tetap harus dipasang sebagai root di luar blok itu.
- **Pakai penanda heredoc yang berbeda** (`NODEEOF`, bukan `EOF`) supaya nggak bentrok dengan heredoc lain di skrip yang sama.
- Setelah template diubah, buka **Auto Scaling Group → Edit → Launch template version**, lalu pilih versi terbaru. Instance yang sudah jalan nggak ikut berubah. User data cuma dijalankan saat instance pertama kali boot, jadi instance lama perlu diganti (misalnya lewat *instance refresh*) atau dipasangi manual.

> Jangan menaruh password atau token di user data. Isinya bisa dibaca siapa pun yang punya akses `ec2:DescribeInstanceAttribute`, dan juga dari dalam instance lewat metadata service. Untuk secret, pakai SSM Parameter Store atau Secrets Manager.

## 2. Izin IAM untuk Prometheus

Prometheus perlu bertanya ke AWS instance mana saja yang sedang jalan. Tambahkan policy ini ke IAM Role yang terpasang di EC2 Prometheus:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeAvailabilityZones"
      ],
      "Resource": "*"
    }
  ]
}
```

Pakai IAM Role, bukan access key yang ditulis di config. Prometheus otomatis mengambil kredensial dari instance profile.

## 3. Security Group

| Di mana | Arah | Sumber / tujuan | Port |
|---|---|---|---|
| SG instance ASG | Inbound | SG Prometheus | 9100 |
| SG Prometheus | Outbound | SG instance ASG | 9100 |

Prometheus dan ASG juga harus bisa saling menjangkau lewat jaringan: satu VPC, atau lewat VPC peering / Transit Gateway.

## 4. EC2 Service Discovery di prometheus.yml

Job untuk server tetap dibiarkan memakai `static_configs`. Untuk ASG, tambahkan job baru dengan `ec2_sd_configs`:

```yaml
  - job_name: "app-asg"
    ec2_sd_configs:
      - region: ap-southeast-3
        port: 9100
        filters:
          - name: "tag:aws:autoscaling:groupName"
            values: ["app-asg"]
          - name: "instance-state-name"
            values: ["running"]

    relabel_configs:
      # Scrape lewat private IP
      - source_labels: [__meta_ec2_private_ip]
        target_label: __address__
        replacement: "${1}:9100"

      # instance & nodename: instance ID + private IP, unik per EC2
      - source_labels: [__meta_ec2_instance_id, __meta_ec2_private_ip]
        separator: "_"
        target_label: instance
      - source_labels: [__meta_ec2_instance_id, __meta_ec2_private_ip]
        separator: "_"
        target_label: nodename

      # Label tambahan
      - source_labels: [__meta_ec2_instance_id]
        target_label: instance_id
      - source_labels: [__meta_ec2_availability_zone]
        target_label: az
      - source_labels: [__meta_ec2_private_ip]
        target_label: private_ip
      - target_label: env
        replacement: production
      - target_label: asg
        replacement: app-asg
```

AWS otomatis memberi tag `aws:autoscaling:groupName` ke setiap instance di ASG, jadi filter di atas langsung menangkap semua anggotanya. Prometheus me-refresh daftar target secara berkala (default setiap 60 detik). Instance baru otomatis masuk, instance yang di-terminate otomatis hilang, dan `prometheus.yml` nggak perlu disentuh lagi.

### Kenapa label instance-nya begitu?

Percobaan pertama saya memakai tag `Name` sebagai label `instance` dan `nodename`. Hasilnya, di dashboard Grafana (Node Exporter Full) semua instance menyatu jadi satu pilihan di dropdown. Tag `Name` dari Launch Template nilainya **sama** untuk semua instance di ASG.

Yang unik per instance adalah instance ID dan private IP. Gabungan keduanya menghasilkan label seperti `i-0abc123def4567890_10.0.12.34`: langsung kelihatan instance yang mana, dan IP-nya mudah dicocokkan saat debugging.

Kalau kamu lebih suka nama urut seperti `app-1`, `app-2`, Prometheus nggak bisa membuatnya sendiri karena relabeling cuma membaca metadata apa adanya. Pilihannya: memasang tag `Name` unik lewat Lambda yang dipicu event *EC2 Instance Launch Successful* dari EventBridge, atau memakai oktet terakhir IP sebagai akhiran (`app-34`). Buat saya, gabungan ID dan IP sudah paling praktis tanpa komponen tambahan.

## 5. Validasi sebelum reload

Kesalahan yang sempat saya alami: job baru ditempel tanpa indentasi dua spasi, jadi `- job_name:` berada di luar `scrape_configs` dan Prometheus gagal start. Biasakan cek dulu dengan `promtool`:

```bash
promtool check config /etc/prometheus/prometheus.yml
```

Kalau keluar `SUCCESS`, baru reload:

```bash
sudo systemctl reload prometheus
# atau, kalau Prometheus jalan dengan --web.enable-lifecycle:
curl -X POST http://localhost:9090/-/reload
```

## 6. Cek data sudah masuk

1. **Status → Targets** di UI Prometheus. Job `app-asg` harus muncul dengan jumlah target sesuai *desired capacity*, statusnya **UP**.
2. Query di tab Graph:

   ```promql
   up{job="app-asg"}
   100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{job="app-asg", mode="idle"}[5m])))
   node_memory_MemAvailable_bytes{job="app-asg"}
   ```

3. Kalau ada yang bermasalah, ikuti urutan ini:

| Gejala | Cek |
|---|---|
| Target nggak muncul sama sekali | IAM Role (`ec2:DescribeInstances`), region, dan filter tag |
| Target muncul tapi DOWN | Security group port 9100, routing antar subnet/VPC |
| Target UP tapi metrik kosong | `systemctl status node_exporter` di instance, `curl http://<private-ip>:9100/metrics` dari server Prometheus |

## 7. Bonus: RPS dari ALB lewat CloudWatch Exporter

Node exporter cuma melihat resource OS (CPU, RAM, disk, network). Untuk **request per second**, sumbernya harus aplikasi atau load balancer. Karena trafik aplikasi ini masuk lewat ALB, cara termudah tanpa mengubah kode adalah mengambil metrik ALB dari CloudWatch dengan [cloudwatch_exporter](https://github.com/prometheus/cloudwatch_exporter).

ALB sudah otomatis mengirim metriknya ke CloudWatch, jadi di sisi CloudWatch nggak ada yang perlu diatur. Yang dibutuhkan cuma exporter dan izin IAM.

### Pasang exporter

```bash
sudo apt-get install -y default-jre
sudo mkdir -p /opt/cloudwatch_exporter
sudo wget -O /opt/cloudwatch_exporter/cloudwatch_exporter.jar \
  https://github.com/prometheus/cloudwatch_exporter/releases/download/v0.15.5/cloudwatch_exporter-0.15.5-jar-with-dependencies.jar
```

### Pilih metrik secukupnya

Setiap metrik berarti panggilan API CloudWatch yang **berbayar**, jadi saya ambil empat yang paling berguna saja. Simpan sebagai `/opt/cloudwatch_exporter/config.yml`:

```yaml
region: ap-southeast-3

metrics:
  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: RequestCount
    aws_dimensions: [LoadBalancer, TargetGroup]
    aws_statistics: [Sum]
    period_seconds: 60
    range_seconds: 600

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: TargetResponseTime
    aws_dimensions: [LoadBalancer, TargetGroup]
    aws_statistics: [Average]
    aws_extended_statistics: [p95, p99]
    period_seconds: 60
    range_seconds: 600

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: HTTPCode_Target_4XX_Count
    aws_dimensions: [LoadBalancer, TargetGroup]
    aws_statistics: [Sum]
    period_seconds: 60
    range_seconds: 600

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: HTTPCode_Target_5XX_Count
    aws_dimensions: [LoadBalancer, TargetGroup]
    aws_statistics: [Sum]
    period_seconds: 60
    range_seconds: 600
```

`HealthyHostCount` dan `ActiveConnectionCount` sengaja saya lewati: jumlah instance sehat sudah kelihatan dari `up{job="app-asg"}`. Kalau akun kamu punya banyak ALB, batasi ke ALB yang dimaksud dengan `aws_dimension_select` supaya exporter nggak menarik metrik semua load balancer.

### Service systemd

```ini
# /etc/systemd/system/cloudwatch_exporter.service
[Unit]
Description=CloudWatch Exporter
After=network.target

[Service]
ExecStart=/usr/bin/java -jar /opt/cloudwatch_exporter/cloudwatch_exporter.jar 9106 /opt/cloudwatch_exporter/config.yml
Restart=on-failure
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudwatch_exporter
```

Exporter ini nggak perlu root. `DynamicUser=yes` menjalankannya sebagai user sementara.

### Izin IAM tambahan

Tambahkan action berikut ke policy role Prometheus yang tadi:

```json
"cloudwatch:GetMetricStatistics",
"cloudwatch:GetMetricData",
"cloudwatch:ListMetrics",
"tag:GetResources"
```

### Job di Prometheus

```yaml
  - job_name: "cloudwatch-alb"
    scrape_interval: 60s
    scrape_timeout: 50s
    static_configs:
      - targets: ["localhost:9106"]
        labels:
          env: production
```

`scrape_interval: 60s` di job ini penting. Exporter memanggil API CloudWatch **setiap kali di-scrape**, jadi kalau ikut interval global 15 detik, biayanya jadi empat kali lipat tanpa data yang lebih baru. Lagi pula, metrik ALB memang beresolusi satu menit.

### Query di Grafana

`RequestCount` dengan statistik `Sum` dan `period_seconds: 60` berisi jumlah request **per menit**, bukan counter yang terus naik. Jadi jangan pakai `rate()`, cukup bagi 60:

```promql
# RPS
aws_applicationelb_request_count_sum / 60

# Error per detik
aws_applicationelb_httpcode_target_5_xx_count_sum / 60

# Latency (detik)
aws_applicationelb_target_response_time_average
aws_applicationelb_target_response_time_p95
```

Nama metrik persisnya bisa dicek di `http://<prometheus-host>:9106/metrics`.

### Berapa biayanya?

Harga `GetMetricStatistics` sekitar **$0.01 per 1.000 request**. Dengan empat metrik, satu ALB, satu target group, dan scrape tiap 60 detik:

```
4 metrik × 60 per jam × 24 jam × 30 hari ≈ 172.800 request/bulan ≈ $1,7/bulan
```

Ditambah sedikit panggilan `ListMetrics` untuk menemukan dimensi. Bandingkan dengan percobaan pertama saya: tujuh metrik dengan scrape 15 detik, sekitar $12/bulan. Jumlahnya juga naik sebanding dengan jumlah ALB dan target group yang cocok, jadi tetap pantau tagihan CloudWatch di bulan pertama.

Kalau instance-nya memakai Nginx sebagai reverse proxy, `nginx-prometheus-exporter` bisa jadi alternatif yang gratis total. Kalau butuh RPS per endpoint, instrumentasi langsung di aplikasi (misalnya `prom-client` untuk Node.js) yang paling detail.

## Ringkasan

| Kebutuhan | Solusi |
|---|---|
| node_exporter otomatis di instance baru | User data di Launch Template |
| Target ikut naik turun bersama ASG | `ec2_sd_configs` dengan filter tag `aws:autoscaling:groupName` |
| Instance terpisah rapi di Grafana | Label `instance` = instance ID + private IP |
| Config aman sebelum reload | `promtool check config` |
| RPS, latency, error dari ALB | cloudwatch_exporter, 4 metrik, scrape 60 detik |
