---
title: "Installing Hugo on openSUSE Tumbleweed"
slug: "install-hugo-opensuse-tumbleweed"
date: 2020-05-19T08:52:01+07:00
categories: [tutorial]
tags: [openSUSE, hugo, tutorial, tumbleweed]
description: "Steps to install Hugo, the Go-based static site generator, on openSUSE Tumbleweed."
---
### Introduction
[Hugo](https://gohugo.io) is a static site generator like [Hexo](https://hexo.io/). [Hugo](https://gohugo.io) is written in [Go](https://golang.org/), so pages build faster than with [Hexo](https://hexo.io). Oh, and this website happens to use Hugo too.
### Install the dependencies
Before installing Hugo on openSUSE Tumbleweed, you need a few dependencies:
- Go
- Git
- Hugo<br/>
```
sudo zypper in go git
wget -c https://github.com/gohugoio/hugo/releases/download/v0.71.0/hugo_0.71.0_Linux-64bit.tar.gz
tar -xvf hugo_0.71.0_Linux-64bit.tar.gz
sudo mv hugo /usr/local/bin
```
##### Check the Hugo version
```
hugo version
```
If it installed correctly, you'll see output like this:
````
Hugo Static Site Generator v0.71.0-06150C87 linux/amd64 BuildDate: 2020-05-18T16:08:02Z
````

Done ~

Stay tuned for the next update on configuring Hugo and a few simple commands for creating posts and applying a theme ~

Cheers~.

Reference:
[Hugo Documentation](https://gohugo.io/getting-started/quick-start/)
