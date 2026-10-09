---
title: "Membangun Automation Tools Internal untuk Pekerjaan Ops"
date: 2026-09-15T09:00:00+07:00
description: "Prinsip dan kerangka praktis untuk mengubah kumpulan script operasional menjadi automation tool internal yang aman, bisa diuji, dan nyaman dipakai tim."
categories: [proyek]
tags: [otomasi, python, cli, devops, tooling]
---

Hampir semua engineer ops punya folder berisi script kecil: cek disk, rotasi log, restart service, ambil laporan. Masalahnya muncul ketika script tersebut mulai dipakai orang lain. Parameternya beda-beda, tidak ada mode uji coba, output-nya sulit dibaca, dan satu salah ketik bisa berdampak ke produksi.

Tulisan ini merangkum prinsip yang saya pakai untuk merapikan script-script seperti itu menjadi satu **automation tool internal** yang bisa dipercaya tim.

## Prinsip desain

### 1. Satu pintu masuk, banyak subcommand

Daripada belasan script dengan gaya berbeda, satu CLI dengan subcommand jauh lebih mudah dipelajari:

```text
opsctl disk-report --host web-01
opsctl service restart nginx --host web-01 --dry-run
opsctl backup verify --target db
```

Pengguna cukup ingat satu nama, dan `opsctl --help` menjadi dokumentasi yang selalu up to date.

### 2. Dry-run untuk semua aksi yang mengubah sesuatu

Setiap perintah yang mengubah state wajib punya `--dry-run` yang menampilkan apa yang *akan* dilakukan tanpa benar-benar melakukannya. Untuk aksi berisiko, minta konfirmasi eksplisit, dan sediakan `--yes` untuk dipakai di pipeline.

### 3. Idempoten

Menjalankan perintah yang sama dua kali harus aman. Cek dulu state saat ini, baru ubah bila perlu. Prinsip ini sama dengan yang dipegang Ansible, dan alasannya sama: automation pasti akan dijalankan ulang, entah karena retry, timeout, atau salah klik.

### 4. Rahasia tidak pernah ada di kode

Kredensial dibaca dari environment variable atau secret manager, tidak di-hardcode dan tidak di-commit. Tambahkan pemindai secret di CI sebagai jaring pengaman.

### 5. Output untuk manusia dan mesin

Output default yang ringkas dan mudah dibaca, plus `--output json` supaya hasilnya bisa diproses tool lain. Log yang informatif ke stderr, hasil ke stdout.

### 6. Exit code yang jujur

`0` berarti berhasil, selain itu gagal. Terdengar sepele, tapi inilah yang membuat tool bisa dirangkai di cron, CI, atau tool otomasi lain.

## Kerangka minimal dengan Python

Contoh kerangka memakai pustaka standar saja:

```python
#!/usr/bin/env python3
"""opsctl: automation tool internal untuk tugas operasional."""
import argparse
import json
import logging
import shutil
import sys

log = logging.getLogger("opsctl")


def disk_report(args):
    usage = shutil.disk_usage(args.path)
    percent = round(usage.used / usage.total * 100, 1)
    result = {"path": args.path, "used_percent": percent}
    if args.output == "json":
        print(json.dumps(result))
    else:
        print(f"{args.path}: {percent}% terpakai")
    return 1 if percent >= args.threshold else 0


def clean_tmp(args):
    log.info("Mencari file lama di %s", args.path)
    # ... kumpulkan kandidat file yang akan dihapus ...
    candidates = []
    for f in candidates:
        if args.dry_run:
            print(f"[dry-run] akan menghapus {f}")
        else:
            log.info("Menghapus %s", f)
            # f.unlink()
    return 0


def main():
    parser = argparse.ArgumentParser(prog="opsctl")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--output", choices=["text", "json"], default="text")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("disk-report", help="Laporan penggunaan disk")
    p.add_argument("--path", default="/")
    p.add_argument("--threshold", type=float, default=90.0)
    p.set_defaults(func=disk_report)

    p = sub.add_parser("clean-tmp", help="Bersihkan file sementara lama")
    p.add_argument("--path", default="/tmp")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=clean_tmp)

    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
```

Kerangka ini sengaja sederhana. Setiap subcommand adalah fungsi biasa yang menerima `args` dan mengembalikan exit code, jadi mudah diuji dengan `pytest`.

## Struktur repository

```text
opsctl/
├── opsctl/
│   ├── __init__.py
│   ├── cli.py
│   └── commands/
│       ├── disk.py
│       └── cleanup.py
├── tests/
├── pyproject.toml
└── README.md
```

Dengan `pyproject.toml` yang mendefinisikan entry point, tool bisa dipasang dengan `pipx install .` dan langsung tersedia sebagai perintah `opsctl` di mesin siapa pun di tim.

## Kapan memakai Ansible, kapan memakai tool sendiri

- **Ansible** cocok untuk mengelola *state* server: paket, konfigurasi, service. Lihat contoh [deploy MongoDB replica set dengan Ansible](/posts/ansible-mongodb-replica-set/).
- **Tool internal** cocok untuk tugas operasional yang sifatnya *aksi* atau *laporan*: pemeriksaan cepat, pembersihan, integrasi dengan API internal, atau membungkus beberapa langkah yang sering dilakukan bersama.

Keduanya bisa saling melengkapi. Tool internal bahkan bisa memanggil playbook Ansible sebagai salah satu subcommand-nya.

## Checklist sebelum dibagikan ke tim

- [ ] Ada `--help` yang jelas di setiap subcommand
- [ ] Semua aksi yang mengubah state punya `--dry-run`
- [ ] Tidak ada secret di kode maupun riwayat git
- [ ] Ada test untuk logika inti
- [ ] CI menjalankan lint dan test di setiap pull request
- [ ] README berisi cara install dan contoh pemakaian

Automation tool yang baik tidak harus besar. Yang penting, tim percaya untuk menjalankannya, dan itu dibangun dari hal-hal kecil di atas.
