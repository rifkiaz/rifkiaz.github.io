---
title: "How to Install Google Cursor on openSUSE Tumbleweed"
date: 2020-05-08T04:48:14+07:00
tags: ["Google Cursor", "openSUSE", "Tumbleweed"]
categories: ["tutorial"]
slug: "install-google-cursor-opensuse-tumbleweed"
description: "Build and install the Google cursor theme on openSUSE Tumbleweed."
---

### Install Dependencies
Before installing Google Cursor, install its dependencies
```
sudo zypper in xcursorgen inkscape gnome-themes appmenu-gtk2-module appmenu-gtk3-module
```
### Build Google Cursor
```
git clone https://github.com/KaizIqbal/Google_Cursor.git
cd Google_Cursor
chmod +x build.sh
./build.sh
chmod +x ./Installer_Google.sh
```

### Install as Root User
```
sudo ./Installer_Google.sh
```
### Install as Local User
```
./Installer_Google.sh
```

Enjoy!

Source : [Google Cursor](https://github.com/KaizIqbal/Google_Cursor)