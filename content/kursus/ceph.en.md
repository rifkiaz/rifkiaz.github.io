---
title: "Ceph Short Course"
linkTitle: "Ceph"
description: "Learn the Ceph distributed storage system hands-on: reading ceph -s, creating a pool, storing objects, tracing an object to its OSDs through CRUSH, recovery when a disk dies, noout for maintenance, a nearly full cluster, and monitor quorum."
summary: "OSDs, pools, PGs, CRUSH, replication, recovery, noout, nearfull, and monitor quorum. Storage that keeps going when disks die."
url: "/en/courses/ceph/"
sim: ceph
layout: "kursus"
weight: 4
minutes: 25
level: "intermediate"
next: "/kursus/openstack/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Meet the cluster"
    missions: [1]
    body: |
      **Ceph** pools the disks of many servers into one big storage system that survives failures. The pieces you need to know:

      - **OSD** (Object Storage Daemon): one process per disk. This is what actually stores data. The lab has 3 nodes × 2 disks = 6 OSDs.
      - **MON** (monitor): holds the cluster "map" and keeps agreement about who's alive. There are 3, on node1 to node3.
      - **MGR** (manager): metrics, dashboard, and orchestration (`ceph orch`).

      The first command every Ceph admin runs: `ceph -s`. Look at `health` (ideally `HEALTH_OK`), the number of mons, OSDs `up`/`in`, and PG status.
    steps:
      - cmd: "ceph -s"
      - text: "The OSD tree per host. CRUSH uses this structure to spread copies."
        cmd: "ceph osd tree"
      - text: "Capacity and usage."
        cmd: "ceph df"
    quiz:
      q: "One OSD in Ceph usually stands for..."
      options:
        - "One server"
        - "One disk"
        - "One pool"
      answer: 1
      why: "Typically one OSD per disk. A server with 12 disks runs 12 OSDs."

  - title: "Pools, objects, and CRUSH"
    missions: [2, 3]
    body: |
      Ceph stores data as **objects** inside **pools**. A pool sets the rules, like `size 3` (every object has 3 copies) and `min_size 2` (still writable as long as at least 2 copies are alive).

      Ceph keeps no list of "object X is on disk Y". The location is **computed**:

      1. The object name is hashed into one of the pool's **PGs** (placement groups).
      2. The **CRUSH** algorithm maps that PG to several OSDs, with the rule that each copy lives on a different host.

      Because it's computed, any client can work out which OSDs to talk to without asking a central server. That's one reason Ceph can grow so large.
    steps:
      - cmd: "ceph osd pool create data"
      - text: "Tag what the pool is for (rbd, cephfs, or rgw). Without it Ceph raises a warning."
        cmd: "ceph osd pool application enable data rbd"
      - text: "Store one object."
        cmd: "rados -p data put foto.jpg ./foto.jpg"
      - cmd: "rados -p data ls"
      - text: "Trace that object: which PG, and which OSDs hold its copies."
        cmd: "ceph osd map data foto.jpg"
    quiz:
      q: "How does a Ceph client know which OSDs hold `foto.jpg`?"
      options:
        - "It asks a location database on a central server"
        - "It computes it: hash the name → PG → CRUSH → list of OSDs"
        - "It searches every OSD one by one"
      answer: 1
      why: "With the cluster map from the monitors, the client computes the location itself. There's no location table to become a bottleneck."

  - title: "Disk failure and recovery"
    missions: [4]
    body: |
      Disks fail, sooner or later. Here's what happens in Ceph:

      1. The OSD stops sending heartbeats and is marked **down**. PGs with a copy there become `degraded`: still readable and writable, but short a copy.
      2. After a while (12 seconds in the lab, 10 minutes for real) the OSD is marked **out**. CRUSH recomputes and Ceph **copies the data again** to other OSDs (*backfill/recovery*).
      3. Once every copy is complete again, it's back to `HEALTH_OK`, even though the disk hasn't been replaced.

      No need to panic at midnight. Ceph restores its own redundancy.
    steps:
      - text: "Put some data in the pool first, so there's something to recover."
        cmd: "rados bench -p data 30 write --no-cleanup"
        wait: 3000
      - text: "Break osd.0's disk. Watch its card turn down, then out."
        click: '.cp-osd[data-id="0"]'
        label: "break osd.0's disk"
        wait: 3000
      - cmd: "ceph health detail"
      - text: "Wait about half a minute. Watch the PG bar go from degraded to recovering to clean."
        cmd: "ceph -s"
        wait: 40000
      - text: "`HEALTH_OK` without osd.0. Now fix the disk (click its card again)."
        click: '.cp-osd[data-id="0"]'
        label: "restart osd.0"
        wait: 3000
    quiz:
      q: "An OSD just went **down** but isn't **out** yet. The data is..."
      options:
        - "Lost"
        - "Still accessible, but short a copy (degraded)"
        - "Frozen, the whole cluster stops"
      answer: 1
      why: "With `size 3, min_size 2`, losing one copy is still fine for reads and writes. Ceph waits a bit before re-copying, in case the OSD is just rebooting."

  - title: "Maintenance with noout"
    missions: [5]
    body: |
      Sometimes you turn a node off on purpose: kernel update, RAM swap, moving racks. Left alone, after the timeout its OSDs are marked **out** and Ceph starts copying hundreds of GB. Yet the node was only gone for 5 minutes, and once it's back the data gets copied back again. Wasted bandwidth.

      The **`noout`** flag stops OSDs from being marked out while it's set. Data stays `degraded` for a while, but nothing moves around in bulk. The pattern:

      1. `ceph osd set noout`
      2. Turn the node off, do the work, turn it back on.
      3. `ceph osd unset noout`, so the cluster protects itself automatically again.
    steps:
      - cmd: "ceph osd set noout"
      - text: "Turn off node3."
        click: 'input[data-act="power"][data-h="node3"]'
        state: "off"
        label: "turn off node3"
        wait: 4000
      - text: "Notice: its OSDs are down but stay `in`, and there's a noout flag warning."
        cmd: "ceph -s"
        wait: 2000
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "on"
        label: "turn on node3"
        wait: 4000
      - text: "Don't forget to clear it."
        cmd: "ceph osd unset noout"
        wait: 1500
    quiz:
      q: "Why must `noout` be cleared after maintenance?"
      options:
        - "It uses up RAM"
        - "While it's set, an OSD that really dies is never marked out and its data never recovers"
        - "Ceph can't be written to while noout is set"
      answer: 1
      why: "noout turns off automatic protection. Forget to clear it and a really broken disk stays degraded forever."

  - title: "A nearly full cluster"
    missions: [6]
    body: |
      Ceph spreads data across all OSDs, but never perfectly evenly. What matters isn't the average, it's **the fullest OSD**:

      - **nearfull** (85%): a warning, time to add capacity.
      - **backfillfull** (90%): that OSD won't accept recovery data.
      - **full** (95%): **all writes to the cluster stop**, to prevent damage.

      Remember too that with `size 3`, 1 GB of data takes 3 GB raw. The healthiest way out of nearfull: **add nodes and OSDs**, and Ceph redistributes data automatically.
    steps:
      - text: "Write a lot of data until the cluster is nearfull."
        cmd: "rados bench -p data 240 write --no-cleanup"
        wait: 3000
      - cmd: "ceph osd df"
      - text: "Add node4 to the cluster..."
        cmd: "ceph orch host add node4 10.0.0.24"
        wait: 1500
      - text: "...then turn all its empty disks into OSDs."
        cmd: "ceph orch apply osd --all-available-devices"
        wait: 4000
      - text: "Wait for the rebalance, then check again. The nearfull warning is gone."
        cmd: "ceph osd df"
        wait: 30000
      - cmd: "ceph -s"
    quiz:
      q: "The cluster is 70% used on average, but one OSD is at 95%. What happens?"
      options:
        - "Fine, only the average counts"
        - "The cluster stops accepting writes because one OSD is full"
        - "Ceph deletes old data automatically"
      answer: 1
      why: "One full OSD is enough to block writes, because objects mapped to it can't be written. Watch `ceph osd df`, not just `ceph df`."

  - title: "Monitor quorum"
    missions: [7]
    body: |
      Monitors must **agree** on the cluster state. They use the Paxos algorithm and need a **majority** (quorum) alive: with 3 monitors, at least 2.

      If the majority is lost, the remaining monitor won't dare to decide anything (it might be the one that's cut off). As a result **the whole cluster stops serving**, even if the OSDs are healthy. Even `ceph` commands just hang.

      That's why the number of monitors is always **odd** (3 or 5) and they sit on different hosts, racks, or zones.
    steps:
      - text: "Turn off node2 and node3 together. Only one of three monitors is left."
        click: 'input[data-act="power"][data-h="node2"]'
        state: "off"
        label: "turn off node2"
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "off"
        label: "turn off node3"
        wait: 4000
      - text: "Try checking the status. Without quorum, the command times out."
        cmd: "ceph -s"
        wait: 4000
      - text: "Turn both back on."
        click: 'input[data-act="power"][data-h="node2"]'
        state: "on"
        label: "turn on node2"
      - click: 'input[data-act="power"][data-h="node3"]'
        state: "on"
        label: "turn on node3"
        wait: 5000
      - cmd: "ceph -s"
    quiz:
      q: "Why does a Ceph cluster run 3 monitors, not 2?"
      options:
        - "With 2 monitors, losing just one already loses the majority"
        - "To be faster"
        - "Because Ceph doesn't support 2"
      answer: 0
      why: "The majority of 2 is 2, so there's no tolerance at all. With 3, one may die; with 5, two may die."
recap: |
  What you can do now:

  - Read `ceph -s`, `ceph osd tree`, `ceph osd df`.
  - Pools, PGs, CRUSH, and how Ceph computes where an object lives.
  - Automatic recovery, `noout` for maintenance, nearfull/full limits.
  - Why monitors need quorum and come in odd numbers.

  Next step: Ceph often sits behind an OpenStack private cloud.
---
Ceph is distributed storage used from small clusters up to petabyte scale, and it often sits behind OpenStack and Kubernetes. The lab has a 3-node cluster (plus a spare node) whose disks and power you can "break" yourself.
