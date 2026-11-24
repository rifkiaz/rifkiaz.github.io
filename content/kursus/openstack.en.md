---
title: "OpenStack Short Course"
linkTitle: "OpenStack"
description: "Learn the OpenStack private cloud hands-on: log in through Keystone, build a network and router, a security group and keypair, launch a server, floating IP, ssh, Cinder volumes, quotas, and cleanup."
summary: "Build your own cloud: Keystone, Neutron, Nova, Cinder. Networks, routers, security groups, servers, floating IPs, volumes, and quotas."
url: "/en/courses/openstack/"
sim: openstack
layout: "kursus"
weight: 5
minutes: 30
level: "intermediate"
next: "/kursus/vault/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Logging in to the cloud"
    missions: [1]
    body: |
      **OpenStack** is software for building your own cloud, a bit like AWS but running on servers you own. It's a set of services, each handling one thing:

      - **Keystone**: identity and login.
      - **Nova**: servers (VMs).
      - **Neutron**: networking.
      - **Cinder**: volumes (disks).
      - **Glance**: OS images.

      Every resource belongs to a **project** (tenant), and each project has its own quota. To log in from the CLI, credentials usually live in an *openrc* file. `source demo-openrc` loads the `OS_*` variables into your shell, and each `openstack` command trades them for a **token** from Keystone.
    steps:
      - text: "Load the demo project's credentials."
        cmd: "source demo-openrc"
      - text: "Ask Keystone for a token. If this works, your login is right."
        cmd: "openstack token issue"
      - text: "See which OS images and server sizes (flavors) are available."
        cmd: "openstack image list"
      - cmd: "openstack flavor list"
    quiz:
      q: "The OpenStack service in charge of login and tokens is..."
      options:
        - "Nova"
        - "Keystone"
        - "Neutron"
      answer: 1
      why: "Keystone is the identity service. Other services validate the token with Keystone before serving a request."

  - title: "Networks and routers"
    missions: [2, 3]
    body: |
      A server needs a network before it can launch. In OpenStack, each project builds its own **private network**, isolated from other projects even on the same hardware.

      - The **network** is the "cable", the **subnet** gives it an IP range (say `10.0.0.0/24`) and DHCP.
      - A private network can't reach the internet alone. It needs a **router** with one leg on the external network (`public`, set as the *external gateway*) and one leg on your subnet.

      The pattern is much like VPC + subnet + internet/NAT gateway on AWS.
    steps:
      - cmd: "openstack network create net-app"
      - cmd: "openstack subnet create --network net-app --subnet-range 10.0.0.0/24 sub-app"
      - cmd: "openstack router create r1"
      - text: "Give the router a leg on the public network..."
        cmd: "openstack router set --external-gateway public r1"
      - text: "...and one on your subnet. Check the topology tab in the lab."
        cmd: "openstack router add subnet r1 sub-app"
    quiz:
      q: "Your private subnet isn't attached to a router yet. What happens?"
      options:
        - "Servers can't be created"
        - "Servers can be created and talk within the subnet, but can't reach the internet"
        - "Servers get a public IP automatically"
      answer: 1
      why: "The router connects the private network to the external one. Without it, traffic stops at the subnet."

  - title: "Security groups and keypairs"
    missions: [4]
    body: |
      Two things to prepare before your first server:

      A **security group** is a firewall at the server's port level. By default all *incoming* traffic is blocked. You open what you need, like TCP 22 for SSH and ICMP for ping.

      A **keypair** is an SSH key. OpenStack stores the public key and injects it into the server at boot (through cloud-init), while the private key stays on your laptop. Cloud images usually **have no password**, so without a keypair you can't get in.
    steps:
      - cmd: "openstack security group create web"
      - text: "Open SSH."
        cmd: "openstack security group rule create --protocol tcp --dst-port 22 web"
      - text: "Allow ping."
        cmd: "openstack security group rule create --protocol icmp web"
      - text: "Register the public key from your laptop."
        cmd: "openstack keypair create --public-key ~/.ssh/id_ed25519.pub mykey"
    quiz:
      q: "The server is up but `ssh` times out. Most likely cause?"
      options:
        - "The image is broken"
        - "The security group doesn't allow TCP 22 yet (or there's no floating IP)"
        - "The quota ran out"
      answer: 1
      why: "Incoming traffic is blocked by default. Check the security group and the network path before suspecting anything else."

  - title: "Servers, floating IPs, and ssh"
    missions: [5, 6]
    body: |
      Everything's ready. `openstack server create` asks Nova to build a VM with a **flavor** (CPU/RAM/disk size), an **image**, a network, a keypair, and a security group. It's `BUILD` first, then `ACTIVE`.

      The server only gets a private IP from the subnet. To reach it from outside, attach a **floating IP**: a public IP from the `public` network that the router NATs to the server's private IP. A floating IP can be detached and moved to another server, handy for replacing a server without touching DNS.
    steps:
      - cmd: "openstack server create --flavor m1.small --image ubuntu-24.04 --network net-app --key-name mykey --security-group web web1"
        wait: 9000
      - text: "Wait until it's `ACTIVE`."
        cmd: "openstack server list"
      - text: "Grab a floating IP from the public network."
        cmd: "openstack floating ip create public"
      - text: "Attach it to web1. The IP is random, so this button uses the one you just got."
        pick: "openstack server add floating ip web1 "
      - text: "Log in to the server (the Ubuntu image's default user is `ubuntu`)."
        pick: "ssh "
        wait: 2000
      - text: "You're inside web1 now."
        cmd: "hostname"
      - cmd: "exit"
    quiz:
      q: "What happens to a floating IP when its server is deleted?"
      options:
        - "It's deleted too"
        - "It's detached but still belongs to the project (and still counts against quota)"
        - "It moves to another server automatically"
      answer: 1
      why: "Floating IPs are allocated to the project, not the server. When you're done with one, release it with `openstack floating ip delete`."

  - title: "Cinder volumes"
    missions: [7]
    body: |
      A server's built-in disk (from the flavor) is gone when the server is deleted. For data that has to last, use a **volume** from **Cinder**: a separate disk you can *attach* to a server, *detach*, and attach to another server.

      Behind the scenes, volumes often live in Ceph and reach the server over a storage network. Inside the server they show up as a normal disk, like `/dev/vdb`. You just format and mount it.
    steps:
      - cmd: "openstack volume create --size 10 data1"
        wait: 3000
      - cmd: "openstack server add volume web1 data1"
        wait: 2000
      - pick: "ssh "
        wait: 2000
      - text: "The new disk shows up in the list."
        cmd: "lsblk"
      - cmd: "exit"
    quiz:
      q: "How is a flavor disk different from a Cinder volume?"
      options:
        - "No difference"
        - "A Cinder volume lives separately from the server, so the data survives when the server is deleted"
        - "Cinder volumes are faster"
      answer: 1
      why: "A flavor (ephemeral) disk lives and dies with the server. A volume has its own life cycle."

  - title: "Quotas and the admin role"
    missions: [8]
    body: |
      In a shared cloud, each project is capped by **quotas**: instances, vCPUs, RAM, volumes, floating IPs, and more. This stops one team from eating everyone's capacity.

      When a quota runs out, the request is refused with *Quota exceeded*. Regular users can't raise it themselves. The cloud **admin** can, logged in to the `admin` project with the admin role.
    steps:
      - text: "Try a big server. The demo project's vCPU quota isn't enough."
        cmd: "openstack server create --flavor m1.xlarge --image ubuntu-24.04 --network net-app big1"
        wait: 2000
      - cmd: "openstack limits show --absolute"
      - text: "Put on the admin hat."
        cmd: "source admin-openrc"
      - cmd: "openstack quota set --cores 16 demo"
      - text: "Back to the demo project."
        cmd: "source demo-openrc"
    quiz:
      q: "Who can usually raise a project's quota?"
      options:
        - "Every project member"
        - "The cloud admin"
        - "Nova, automatically"
      answer: 1
      why: "Quotas are the cloud operator's policy. Project members can only see their usage and limits."

  - title: "Cleaning up"
    missions: [9]
    body: |
      Forgotten cloud resources keep eating quota and capacity (on a public cloud: money). Cleanup has to go in reverse order of creation, because of dependencies:

      1. Delete servers (volumes get detached).
      2. Delete floating IPs and volumes.
      3. Detach the subnet from the router, then delete the router.
      4. Delete the network (its subnet goes with it).

      Get the order wrong and OpenStack refuses with a *409 Conflict*, like "network has ports in use".
    steps:
      - cmd: "openstack server delete web1"
        wait: 4000
      - pick: "openstack floating ip delete "
      - cmd: "openstack volume delete data1"
      - cmd: "openstack router remove subnet r1 sub-app"
      - cmd: "openstack router delete r1"
      - cmd: "openstack network delete net-app"
    quiz:
      q: "`openstack network delete net-app` fails with *409 Conflict: ports in use*. Why?"
      options:
        - "The network is too big"
        - "Something is still plugged in, like a server or a router interface"
        - "You're not admin"
      answer: 1
      why: "A network can only be deleted once everything attached to it (servers, router interfaces) is removed."
recap: |
  What you can do now:

  - Keystone, projects, and tokens.
  - Networks, subnets, routers, security groups, keypairs.
  - Servers, floating IPs, ssh, and Cinder volumes.
  - Quotas, the admin role, and the right cleanup order.

  Next step: keep passwords and credentials safe with Vault.
---
OpenStack is open source software for building your own (private) cloud. The lab has a complete mini cloud with Keystone, Nova, Neutron, and Cinder, plus a Horizon-style dashboard next to the terminal.
