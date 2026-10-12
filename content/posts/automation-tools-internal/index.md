---
title: "Membangun Automation Tools Internal untuk Pekerjaan Ops"
date: 2026-07-05T19:47:00+07:00
description: "Prinsip dan kerangka praktis untuk mengubah kumpulan script operasional menjadi automation tool internal yang aman, bisa diuji, dan nyaman dipakai tim."
categories: [proyek]
tags: [otomasi, python, cli, devops, tooling]
---
### Pendahuluan
Hampir semua orang ops pasti punya satu folder isinya script - script kecil, ya cek disk, rotasi log, restart service, tarik laporan dan lain - lain. Saya pun begitu. Masalahnya baru kerasa waktu script itu mulai dipakai orang lain di tim. Parameternya beda - beda, gak ada mode uji coba, output-nya susah dibaca, dan satu salah ketik bisa langsung kena ke production (amit - amit).

Karena itu pada tulisan kali ini saya akan berbagi prinsip yang saya pakai untuk merapikan script - script tersebut jadi satu **automation tool internal** yang bisa dipercaya tim.

### Prinsip Desain
1. **Satu pintu masuk, banyak subcommand.** Daripada belasan script dengan gaya masing - masing, satu CLI dengan beberapa subcommand jauh lebih gampang dipelajari. Cukup ingat satu nama, dan `opsctl --help` otomatis jadi dokumentasi yang selalu up to date.
````
opsctl disk-report --host web-01
opsctl service restart nginx --host web-01 --dry-run
opsctl backup verify --target db
````
2. **Dry-run untuk semua aksi yang mengubah sesuatu.** Setiap perintah yang mengubah sesuatu wajib punya `--dry-run`, yang menampilkan apa yang *akan* dilakukan tanpa benar - benar menjalankannya. Untuk aksi yang berisiko, minta konfirmasi dulu, dan sediakan `--yes` untuk dipakai di pipeline.
3. **Idempoten.** Menjalankan perintah yang sama dua kali harus tetap aman. Cek dulu kondisi sekarang, baru ubah kalau memang perlu. Sama seperti Ansible, karena automation pasti bakal dijalankan ulang, entah karena retry, timeout, atau salah klik.
4. **Rahasia gak boleh ada di kode.** Kredensial dibaca dari environment variable atau secret manager, jangan di-hardcode apalagi di-commit. Tambahkan juga secret scanner di CI biar lebih aman.
5. **Output untuk manusia dan mesin.** Output default-nya ringkas dan enak dibaca, plus ada `--output json` supaya hasilnya bisa diolah tool lain. Log ke stderr, hasil ke stdout.
6. **Exit code yang jujur.** `0` berarti berhasil, selain itu gagal. Kedengarannya sepele, tapi justru ini yang bikin tool bisa dirangkai di cron, CI, atau tool otomasi lain.

### Kerangka Minimal dengan Python
Berikut contoh kerangkanya, cukup pakai library standar Python saja:
```
vim opsctl.py

............
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
Kerangkanya memang sengaja dibuat sederhana. Setiap subcommand cuma fungsi biasa yang menerima `args` dan mengembalikan exit code, jadi gampang dites pakai `pytest`.

Coba jalankan
```
python3 opsctl.py disk-report --path /
```
Jika berhasil akan menampilkan output seperti berikut:
````
/: 42.5% terpakai
````

### Struktur Repository
````
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
````
Kalau entry point-nya sudah didefinisikan di `pyproject.toml`, tool ini bisa dipasang pakai perintah berikut dan langsung bisa dipanggil sebagai `opsctl` di laptop siapa pun di tim.
```
pipx install .
```

### Kapan Pakai Ansible, Kapan Pakai Tool Sendiri
- **Ansible** cocok untuk mengatur *kondisi* server: paket, konfigurasi, service. Contohnya bisa dilihat di [deploy MongoDB replica set dengan Ansible](/posts/ansible-mongodb-replica-set/).
- **Tool internal** cocok untuk tugas yang sifatnya *aksi* atau *laporan*: cek cepat, bersih - bersih, integrasi dengan API internal, atau membungkus beberapa langkah yang sering dikerjakan barengan.

Dua - duanya bisa saling melengkapi kok. Tool internal bahkan bisa memanggil playbook Ansible sebagai salah satu subcommand-nya.

### Checklist Sebelum Dibagikan ke Tim
- [ ] Ada `--help` yang jelas di setiap subcommand
- [ ] Semua aksi yang mengubah state punya `--dry-run`
- [ ] Gak ada secret di kode maupun riwayat git
- [ ] Ada test untuk logika inti
- [ ] CI menjalankan lint dan test di setiap pull request
- [ ] README berisi cara install dan contoh pemakaian

Automation tool yang bagus gak harus besar. Yang penting tim berani dan percaya untuk menjalankannya, dan rasa percaya itu dibangun dari hal - hal kecil di atas.

Sekian, semoga membantu.

Referensi:
- [argparse - Python Documentation](https://docs.python.org/3/library/argparse.html)
