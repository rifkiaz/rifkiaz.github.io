---
title: "Install POWERDNS di Ubuntu 18.04"
date: 2020-09-14T11:29:13+07:00
image: assets/thumb.jpg
author: Rifki Affandi
kategori: [Tutorial]
tags: [linux, powerdns, ubuntu, dns, server]
description: 
---
[POWERDNS](https://www.powerdns.com/) adalah DNS Server berbasis MySQL, yang ditulis dalam C ++ dan berlisensi Under GPL. PowerDNS dapat dikelola melalui web base interface (PowerAdmin). Pada tutorial kali ini akan membahas bagaimana menginstall dan mengkonfigurasi [POWERDNS](https://www.powerdns.com) pada [Ubuntu 18.04](http://kambing.ui.ac.id/iso/ubuntu/releases/bionic/). 

### Persiapan
1. [Ubuntu 18.04](http://kambing.ui.ac.id/iso/ubuntu/releases/bionic/)
2. Domain

### Tahap Instalasi
- Update repositori pada Ubuntu 18.04
    ```
    sudo apt update 
    ```
- Install MariaDB
    ```
    sudo apt install mariadb-server mariadb-client -y
    ```
    ```
    mysql_secure_installation
    ```
- Edit konfigurasi pada MariaDB
    ```
    vim /etc/mysql/mariadb.conf/50-server.cnf
    ```
    ```
    ........
    bind = 0.0.0.0 ----> ganti dengan ip lokal
    ........
    ```
- Restart MariaDB
    ```
    sudo systemctl restart mariadb
    ```
- Buat database pada database
    ```
    sudo mysql -u root -p 
    ```
    ```
    CREATE DATABASE powerdns CHARACTER SET utf8 DEFAULT COLLATE utf8_general_ci;
    ```
    ```
    GRANT ALL ON powerdns.* TO 'powerdns'@'localhost' IDENTIFIED BY 'YOURPASSWORD';
    ```
    ```
    GRANT ALL ON powerdns.* TO 'powerdns'@'%' IDENTIFIED BY 'YOURPASSWORD';
    ```
    ```
    FLUSH PRIVILEGES;
    ```
    ```
    USE powerdns; 
    ```
    ```
    CREATE TABLE domains (
    id                    INT AUTO_INCREMENT,
    name                  VARCHAR(255) NOT NULL,
    master                VARCHAR(128) DEFAULT NULL,
    last_check            INT DEFAULT NULL,
    type                  VARCHAR(6) NOT NULL,
    notified_serial       INT DEFAULT NULL,
    account               VARCHAR(40) CHARACTER SET 'utf8' DEFAULT NULL,
    PRIMARY KEY (id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE UNIQUE INDEX name_index ON domains(name);


    CREATE TABLE records (
    id                    BIGINT AUTO_INCREMENT,
    domain_id             INT DEFAULT NULL,
    name                  VARCHAR(255) DEFAULT NULL,
    type                  VARCHAR(10) DEFAULT NULL,
    content               VARCHAR(64000) DEFAULT NULL,
    ttl                   INT DEFAULT NULL,
    prio                  INT DEFAULT NULL,
    change_date           INT DEFAULT NULL,
    disabled              TINYINT(1) DEFAULT 0,
    ordername             VARCHAR(255) BINARY DEFAULT NULL,
    auth                  TINYINT(1) DEFAULT 1,
    PRIMARY KEY (id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE INDEX nametype_index ON records(name,type);
    CREATE INDEX domain_id ON records(domain_id);
    CREATE INDEX ordername ON records (ordername);


    CREATE TABLE supermasters (
    ip                    VARCHAR(64) NOT NULL,
    nameserver            VARCHAR(255) NOT NULL,
    account               VARCHAR(40) CHARACTER SET 'utf8' NOT NULL,
    PRIMARY KEY (ip, nameserver)
    ) Engine=InnoDB CHARACTER SET 'latin1';


    CREATE TABLE comments (
    id                    INT AUTO_INCREMENT,
    domain_id             INT NOT NULL,
    name                  VARCHAR(255) NOT NULL,
    type                  VARCHAR(10) NOT NULL,
    modified_at           INT NOT NULL,
    account               VARCHAR(40) CHARACTER SET 'utf8' DEFAULT NULL,
    comment               TEXT CHARACTER SET 'utf8' NOT NULL,
    PRIMARY KEY (id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE INDEX comments_name_type_idx ON comments (name, type);
    CREATE INDEX comments_order_idx ON comments (domain_id, modified_at);


    CREATE TABLE domainmetadata (
    id                    INT AUTO_INCREMENT,
    domain_id             INT NOT NULL,
    kind                  VARCHAR(32),
    content               TEXT,
    PRIMARY KEY (id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE INDEX domainmetadata_idx ON domainmetadata (domain_id, kind);


    CREATE TABLE cryptokeys (
    id                    INT AUTO_INCREMENT,
    domain_id             INT NOT NULL,
    flags                 INT NOT NULL,
    active                BOOL,
    content               TEXT,
    PRIMARY KEY(id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE INDEX domainidindex ON cryptokeys(domain_id);


    CREATE TABLE tsigkeys (
    id                    INT AUTO_INCREMENT,
    name                  VARCHAR(255),
    algorithm             VARCHAR(50),
    secret                VARCHAR(255),
    PRIMARY KEY (id)
    ) Engine=InnoDB CHARACTER SET 'latin1';

    CREATE UNIQUE INDEX namealgoindex ON tsigkeys(name, algorithm);
    ```
- Disable systemd-resolved
    ```
    sudo su
    systemctl disable systemd-resolved
    systemctl stop systemd-resolved
    ls -lh /etc/resolv.conf 
    rm /etc/resolv.conf
    echo "nameserver 8.8.8.8" > /etc/resolv.conf
    ```
- Install POWERDNS (versi 4.1.13)
    ```
    sudo su
    ```
- edit repositori 
    ```
    vi /etc/apt/sources.list.d/pdns.list
    ```
    ```
    .............
    deb [arch=amd64] http://repo.powerdns.com/ubuntu bionic-auth-41 main
    .............
    ```
    ```
    vi /etc/apt/preferences.d/pdns
    ```
    ```
    ...
    Package: pdns-*
    Pin: origin repo.powerdns.com
    Pin-Priority: 600
    ...
    ```
- Install powerdns beserta dependensi yang dibutuhkan
    ```
    curl https://repo.powerdns.com/FD380FBB-pub.asc | sudo apt-key add - 
    curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
    sudo apt-get update
    sudo apt-get install pdns-server pdns-backend-mysql virtualenv python3-pip yarn -y
    apt-get install -y libmysqlclient-dev python3-mysqldb python-mysqldb libsasl2-dev libffi-dev libldap2-dev libssl-dev libxml2-dev libxslt1-dev libxmlsec1-dev pkg-config
    ```
- Setelah berhasil terinstall konfigurasi powerdns agar terhubung dengan backend mysql
    ```
    sudo vi /etc/powerdns/pdns.d/pdns.local.gmysql.conf
    ## Masukkan skrip berikut tanpa tanda #
    ......
    launch=gmysql
    gmysql-host=#IPHOSTMYSQL
    gmysql-user=#USER
    gmysql-dbname=#YOURDB
    gmysql-password=#YOURPASSWORD
    gmysql-dnssec=yes
    ```
- Konfigurasi pdns.conf agar bisa dimonitoring 
    ```
    echo 'api=yes' >> /etc/powerdns/pdns.conf
    echo 'api-key=YOURIPKEY' >> /etc/powerdns/pdns.conf
    echo 'webserver=yes' >> /etc/powerdns/pdns.conf
    echo 'webserver-address=0.0.0.0' >> /etc/powerdns/pdns.conf
    echo 'webserver-allow-from=0.0.0.0/0,::/0' >> /etc/powerdns/pdns.conf
    echo 'webserver-port=8081' >> /etc/powerdns/pdns.conf
    echo 'version-string=anonymous' >> /etc/powerdns/pdns.conf
    echo 'webserver-password=YOURPASSWORD' >> /etc/powerdns/pdns.conf
    ```
- Tes koneksi ke database
    ```
    /usr/sbin/pdns_server --daemon=no --guardian=no --loglevel=9
    ```
- Jika berhasil restart pdns service
    ```
    sudo systemctl restart pdns
    ```