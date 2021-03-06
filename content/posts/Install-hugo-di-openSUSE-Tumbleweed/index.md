---
title: "Install Hugo di openSUSE Tumbleweed"
date: 2020-05-19T08:52:01+07:00
image: assets/thumb.jpg
author: Rifki Affandi
kategori: [Tutorial]
tags: [openSUSE, hugo, tutorial, tumbleweed]
description: 
---
### Pengenalan
[Hugo](https://gohugo.io) merupakan sebuah generator web statis seperti [Hexo](https://hexo.io/), [Hugo](https://gohugo.io) ditulis menggunakan bahasa [Golang](https://golang.org/) sehingga load page lebih cepat dibanding dengan [Hexo](https://hexo.io). Oh ya kebetulan website ini menggunakan Hugo loh.
### Install dependensi
Sebelum menginstall Hugo pada openSUSE Tumbeleweed yang harus dilakukan adalah menginstall beberapa dependensi diantaranya adalah: 
- Go
- Git
- Hugo<br/> 
```
sudo zypper in go git
wget -c https://github.com/gohugoio/hugo/releases/download/v0.71.0/hugo_0.71.0_Linux-64bit.tar.gz 
tar -xvf hugo_0.71.0_Linux-64bit.tar.gz 
sudo mv hugo /usr/local/bin
```
##### Cek Versi Hugo 
```
hugo version
```
Jika sudah berhasil terinstall akan menampilkan output seperti berikut : 
````
Hugo Static Site Generator v0.71.0-06150C87 linux/amd64 BuildDate: 2020-05-18T16:08:02Z
````

Selesai ~ 

Nantikan untuk update selanjutnya perihal konfigurasi Hugo dan command - command sederhana untuk membuat post dan menerapkan tema ya ~

Salam~.

Refrensi: 
[Hugo Documentation](https://gohugo.io/getting-started/quick-start/)