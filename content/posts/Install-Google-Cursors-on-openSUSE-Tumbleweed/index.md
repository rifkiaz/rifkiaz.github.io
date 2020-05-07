+++
title = "How To Install Google Cursor on openSUSE Tumbelweed"
date = 2020-05-08T04:48:14+07:00
tags = ['Google Cursor', 'openSUSE', 'Tumbleweed']
+++

### Install Dependencies
Before install Google Cursor, please install dependencies
```
sudo zypper in xcursorgen inkscape gnome-themes
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