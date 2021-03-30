---
title: "Disable SSH Ask Pass di openSUSE"
date: 2021-03-30T14:44:46+07:00
image: assets/thumb.jpg
author: Rifki Affandi
kategori: [panduan]
tags: [openSUSE, Tumbleweed, SSH, git]
description: 
---
Ketika selesai menginstall git di openSUSE, ketika akan melakukan push ataupun pull pada repository yang membutuhkan autentikasi, akan muncul pop up untuk mengisi kolom nama dan password, Hal tersebut bagi saya kurang nyaman, maka bisa dinonaktifkan dengan cara berikut : 
```
git config --global core.askpass '' 
```
Sekian~.