---
title: "Disable SSH Ask Pass on openSUSE"
slug: "disable-ssh-askpass-opensuse"
date: 2021-03-30T14:44:46+07:00
categories: [tutorial]
tags: [openSUSE, Tumbleweed, SSH, git]
description: "How to turn off the askpass pop-up on git push/pull in openSUSE with a single line of git config."
---
After installing git on openSUSE, when you push or pull a repository that needs authentication, a pop-up appears asking for your username and password. I don't find that very comfortable, so here's how to turn it off:
```
git config --global core.askpass ''
```
That's it~.
