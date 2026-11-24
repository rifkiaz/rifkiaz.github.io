---
title: "Docker Swarm Short Course"
linkTitle: "Docker Swarm"
description: "Learn container orchestration with Docker Swarm: build a cluster, deploy replicated services, the routing mesh, scaling, self-healing when a node dies, rolling updates, rollback, drain, and stacks."
summary: "From one machine to a cluster: services, replicas, the routing mesh, self-healing, rolling updates, rollback, drain, and stacks."
url: "/en/courses/swarm/"
sim: swarm
layout: "kursus"
weight: 3
minutes: 25
level: "intermediate"
next: "/kursus/ceph/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "From one machine to a cluster"
    missions: [1]
    body: |
      `docker run` only runs containers on one machine. If that machine dies, the app dies with it. An **orchestrator** like Docker Swarm (or Kubernetes) joins several machines into one cluster and keeps the app running.

      Swarm has two roles:

      - **Manager**: stores the cluster state, takes commands, and decides where containers run (*scheduling*).
      - **Worker**: runs the containers the manager assigns.

      `docker swarm init` turns this machine into the first manager and prints a `docker swarm join` command with a token. Other machines run that command to join.
    steps:
      - text: "Make manager1 the manager."
        cmd: "docker swarm init"
      - text: "Join worker1. This button runs `docker swarm join` on worker1 over SSH."
        click: '[data-act="join"][data-n="worker1"]'
        label: "worker1: join the swarm"
        wait: 1500
      - click: '[data-act="join"][data-n="worker2"]'
        label: "worker2: join the swarm"
        wait: 1500
      - text: "List the cluster members."
        cmd: "docker node ls"
    quiz:
      q: "In Swarm, who decides which node a container runs on?"
      options:
        - "You, set by hand per container"
        - "The manager, through scheduling"
        - "Workers pick for themselves"
      answer: 1
      why: "You just say \"I want 3 replicas\". The manager picks nodes based on resources, constraints, and spread."

  - title: "Services, replicas, and the routing mesh"
    missions: [2, 3]
    body: |
      In Swarm you don't run containers one by one. You create a **service**: a description of the *desired state*, like "nginx:1.25, 3 replicas, port 8080". Swarm splits it into **tasks** (one task = one container) and spreads them across nodes.

      A published port applies on **every node** through the **routing mesh**. A request to port 8080 on any node is forwarded to a healthy task, even if that node isn't running one itself. A load balancer in front of the cluster can simply point at all nodes.
    steps:
      - cmd: "docker service create --name web --replicas 3 -p 8080:80 nginx:1.25"
        wait: 3000
      - text: "See which nodes the tasks landed on."
        cmd: "docker service ps web"
      - text: "Join worker3. It has no web task yet."
        click: '[data-act="join"][data-n="worker3"]'
        label: "worker3: join the swarm"
        wait: 1500
      - text: "Yet curl to worker3 still gets an answer. That's the routing mesh."
        cmd: "curl worker3:8080"
    quiz:
      q: "Node X runs no task of the web service. A request to X:8080..."
      options:
        - "Is refused, connection refused"
        - "Is forwarded by the routing mesh to a web task on another node"
        - "Creates a new task on X"
      answer: 1
      why: "Service ports are opened on every swarm member, and the ingress network forwards traffic to a healthy task."

  - title: "Scaling and self-healing"
    missions: [4, 5]
    body: |
      Since a service is a *desired state*, adding capacity is just changing a number: `docker service scale web=6`. Swarm adds tasks until the count matches.

      The same idea makes Swarm **heal itself**. The manager keeps comparing the desired state with reality. When a node dies, its heartbeat stops, its tasks are considered lost, and the manager schedules replacements on other nodes.

      Note: when that node comes back, the moved tasks **don't move back on their own**. Swarm doesn't rebalance automatically.
    steps:
      - cmd: "docker service scale web=6"
        wait: 3000
      - text: "Turn off worker1 (like pulling its power cord), then wait a few seconds."
        click: 'input[data-act="power"][data-n="worker1"]'
        state: "off"
        label: "turn off worker1"
        wait: 12000
      - text: "The lost tasks have been replaced on other nodes."
        cmd: "docker service ps web"
      - text: "Turn worker1 back on."
        click: 'input[data-act="power"][data-n="worker1"]'
        state: "on"
        label: "turn on worker1"
        wait: 3000
    quiz:
      q: "Worker1 died and came back. The tasks that moved to other workers..."
      options:
        - "Move back to worker1 automatically"
        - "Stay on their new nodes; Swarm doesn't rebalance by itself"
        - "Are all deleted"
      answer: 1
      why: "Swarm only acts when the count is short. To spread them again you can force it with `docker service update --force web`."

  - title: "Rolling updates and rollback"
    missions: [6, 7]
    body: |
      Change the app version without downtime with a **rolling update**: Swarm replaces tasks one at a time (or per `--update-parallelism`), waits a bit (`--update-delay`), then continues. During the process, some old tasks still serve requests.

      If the new tasks fail to start, the update **stops** (*paused*) so the damage doesn't spread. From there, `docker service rollback` takes the service back to its previous spec.

      In production, set `--update-failure-action rollback` so the rollback happens automatically.
    steps:
      - text: "Update to nginx 1.27 and wait until it finishes. Watch the service panel in the lab."
        cmd: "docker service update --image nginx:1.27 web"
        wait: 15000
      - text: "Now update to a version that doesn't exist. The new task fails and the update stops."
        cmd: "docker service update --image nginx:9.9 web"
        wait: 8000
      - text: "Go back to the previous version."
        cmd: "docker service rollback web"
        wait: 12000
    quiz:
      q: "An update to a broken image stops halfway. Why is that good?"
      options:
        - "The replicas still on the old version keep serving users"
        - "So Swarm can delete the broken image"
        - "It isn't, it should keep going"
      answer: 0
      why: "Rolling updates limit the blast radius. Only a few tasks are hit, the rest are still the healthy old version."

  - title: "Node maintenance and stacks"
    missions: [8]
    body: |
      Want to update the OS or swap hardware on a worker? Don't just turn it off. **Drain** it first: `docker node update --availability drain worker2`. Swarm moves the tasks off that node cleanly and schedules nothing new there. After maintenance, set it back to `active`.

      Finally, typing a long `docker service create` for every service isn't practical. A **stack** uses the Compose file format (see `stack.yml` in the lab) plus a `deploy:` section for replicas, updates, and placement. One `docker stack deploy` creates or updates all its services.
    steps:
      - cmd: "docker node update --availability drain worker2"
        wait: 2000
      - text: "worker2 is now `Drain` and its tasks have moved."
        cmd: "docker node ls"
      - cmd: "docker stack deploy -c stack.yml shop"
        wait: 3000
      - cmd: "docker stack services shop"
    quiz:
      q: "What's the difference between draining a node and just turning it off?"
      options:
        - "No difference"
        - "Drain moves tasks in a planned way before the node stops, without waiting for heartbeats to time out"
        - "Drain removes the node from the cluster"
      answer: 1
      why: "Turning it off makes tasks vanish suddenly, and they're only replaced once the manager notices. Draining moves them first, then you can power off calmly."
recap: |
  What you can do now:

  - Manager vs worker, `swarm init` and `join`.
  - Services, replicas, tasks, and the routing mesh.
  - Scaling, self-healing, rolling updates, rollback.
  - Drain for maintenance and stacks for many services.

  The same ideas (desired state, reconcile, rolling updates) are at the heart of Kubernetes too.
---
Docker Swarm runs containers across many machines and keeps them alive. The lab has four machines: manager1 where this terminal lives, plus worker1 to worker3 that you can join, turn off, and drain.
