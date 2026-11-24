---
title: "Docker Short Course"
linkTitle: "Docker"
description: "Learn Docker by doing: run containers, build your own image from a Dockerfile, keep data with volumes, make use of the layer cache, then bring up several services at once with Compose."
summary: "Images vs containers, Dockerfiles, ports, volumes, the layer cache, and Docker Compose. The foundation before Swarm or Kubernetes."
url: "/en/courses/docker/"
sim: docker
layout: "kursus"
weight: 2
minutes: 25
level: "beginner"
next: "/kursus/swarm/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Images and containers"
    missions: [1]
    body: |
      Two terms that get mixed up all the time:

      - An **image** is a template: a minimal file system, the app, and the command that starts it. Images can't be changed (*read-only*). Examples: `nginx`, `python:3.12-slim`.
      - A **container** is a process running from an image. One image can run as many containers at once.

      A container has its own isolated network. To reach it from your laptop, map a port with `-p LAPTOP_PORT:CONTAINER_PORT`. So `-p 8080:80` means "forward port 8080 on the laptop to port 80 inside the container".

      Other common flags: `-d` (run in the background) and `--name` (give it a name so it's easy to refer to).
    steps:
      - text: "Run nginx. The image isn't on the laptop yet, so Docker pulls it first."
        cmd: "docker run -d -p 8080:80 --name web nginx"
        wait: 6000
      - text: "List running containers."
        cmd: "docker ps"
      - text: "Open the site through the mapped port."
        cmd: "curl localhost:8080"
      - text: "Peek at the container logs. Your request is in there."
        cmd: "docker logs web"
    quiz:
      q: "What does `-p 3000:80` mean?"
      options:
        - "Port 3000 in the container is forwarded to port 80 on the laptop"
        - "Port 3000 on the laptop is forwarded to port 80 in the container"
        - "The container may use ports 3000 through 80"
      answer: 1
      why: "The format is always `HOST:CONTAINER`. The left side is the port you open on the laptop, the right side is where the app listens inside the container."

  - title: "Build your own image"
    missions: [2, 3]
    body: |
      An image for your own app is built from a **Dockerfile**: a step-by-step recipe. Open the `Dockerfile` tab in the lab:

      - `FROM python:3.12-slim` starts from an existing base image that has Python.
      - `WORKDIR /app` switches to a working folder inside the image.
      - `COPY . .` copies the project files into the image.
      - `RUN pip install ...` runs a command at *build* time (the result is saved in the image).
      - `EXPOSE 5000` documents the port the app uses.
      - `CMD [...]` is the command run when a container *starts*.

      `docker build -t app:1.0 .` builds an image from the Dockerfile in this folder (the dot at the end) and names it `app` with the tag `1.0`.
    steps:
      - cmd: "docker build -t app:1.0 ."
        wait: 6000
      - text: "Your image is on the list now."
        cmd: "docker images"
      - text: "Run it. The Flask app listens on port 5000."
        cmd: "docker run -d -p 5000:5000 --name app app:1.0"
      - cmd: "curl localhost:5000"
      - text: "Call it once more. The visit counter goes up."
        cmd: "curl localhost:5000"
    quiz:
      q: "What's the difference between `RUN` and `CMD` in a Dockerfile?"
      options:
        - "`RUN` runs at build time, `CMD` runs when the container starts"
        - "Same thing, different style"
        - "`RUN` is for Linux, `CMD` is for Windows"
      answer: 0
      why: "`RUN` executes once while building the image (say, installing packages). `CMD` is the default command every time a container runs."

  - title: "Data that sticks around: volumes"
    missions: [4]
    body: |
      Containers are **disposable**. Delete a container and everything written inside it goes too. The lab app keeps its visit counter in `/data/hits.txt`, so if the container is recreated, the counter goes back to 1.

      The fix is a **volume**: storage managed by Docker that lives separately from the container. `-v hits:/data` means "mount the volume named `hits` at `/data` in the container". Containers can be deleted and recreated, the volume's contents stay.

      > Rule of thumb: anything that must survive (databases, uploads, counters) goes in a volume. Treat the container itself as something you can throw away at any time.
    steps:
      - text: "Remove the old app container (`-f` = force, even if it's running)."
        cmd: "docker rm -f app"
      - text: "Run it again, this time with a volume."
        cmd: "docker run -d -p 5000:5000 -v hits:/data --name app app:1.0"
      - cmd: "curl localhost:5000"
      - text: "Now remove and recreate the container."
        cmd: "docker rm -f app"
      - cmd: "docker run -d -p 5000:5000 -v hits:/data --name app app:1.0"
      - text: "The counter keeps going instead of resetting to 1."
        cmd: "curl localhost:5000"
      - cmd: "docker volume ls"
    quiz:
      q: "You run a database in a container without a volume, then delete the container. The data?"
      options:
        - "Safe, it's stored in the image"
        - "Gone with the container"
        - "Moved to a volume automatically"
      answer: 1
      why: "Images are read-only, so any writes land in a thin layer that belongs to the container. Delete the container and that layer is gone."

  - title: "Faster builds with the layer cache"
    missions: [5]
    body: |
      Every Dockerfile line produces a **layer**. Docker keeps these layers as a cache. On a rebuild, layers whose input hasn't changed are reused (`CACHED`), so the build is much faster.

      But as soon as one layer changes, **every layer below it is rebuilt too**. In the original Dockerfile, `COPY . .` comes before `pip install`. So changing a single letter in `app.py` makes `pip install` run again from scratch.

      The trick: copy the file that rarely changes (`requirements.txt`) first, install dependencies, then copy the rest of the code.
    steps:
      - text: "Reorder the Dockerfile."
        edit:
          file: "Dockerfile"
          tab: '[data-act="tab"][data-f="Dockerfile"]'
          find: |-
            COPY . .
            RUN pip install -r requirements.txt
          replace: |-
            COPY requirements.txt .
            RUN pip install -r requirements.txt
            COPY . .
      - text: "Build once so the cache forms with the new order."
        cmd: "docker build -t app:1.1 ."
        wait: 6000
      - text: "Now change the code."
        edit:
          file: "app.py"
          tab: '[data-act="tab"][data-f="app.py"]'
          find: '"Hello from the container!"'
          replace: '"Hello from the Docker course!"'
      - text: "Build again. `pip install` is `CACHED` now, only `COPY . .` reruns."
        cmd: "docker build -t app:1.2 ."
        wait: 6000
    quiz:
      q: "Why put `COPY requirements.txt .` before `COPY . .`?"
      options:
        - "To make the image smaller"
        - "So the `pip install` layer stays cached when only the app code changes"
        - "Because Docker requires that order"
      answer: 1
      why: "The cache breaks at the first line whose input changed. With this order, a code change only invalidates the cache from `COPY . .` down."

  - title: "Many services at once: Compose"
    missions: [6]
    body: |
      Real apps are rarely a single container. There's usually a web app, a cache, a database, and so on. Typing a long `docker run` for each one is tiring and easy to get wrong.

      **Docker Compose** describes everything in one `compose.yaml` file: which services, their image or build, ports, environment, volumes, and start order (`depends_on`). Open the `compose.yaml` tab in the lab.

      A single `docker compose up -d` builds and starts all of it. Services in the same file also share a network automatically and can call each other by service name (for example `cache`).
    steps:
      - text: "Bring up every service."
        cmd: "docker compose up -d"
        wait: 6000
      - cmd: "docker compose ps"
      - text: "The Compose web app is mapped to port 8000."
        cmd: "curl localhost:8000"
    quiz:
      q: "In compose.yaml, the `web` service wants to reach Redis in the `cache` service. Which host does web use?"
      options:
        - "`localhost`"
        - "`cache`"
        - "Your laptop's IP"
      answer: 1
      why: "Compose creates a shared network with internal DNS, so every service is reachable by name. `localhost` inside a container means that container itself."
recap: |
  What you can do now:

  - Tell images and containers apart, and use `docker run -d -p --name`.
  - Write and build a Dockerfile, with a cache-friendly layer order.
  - Use volumes for data that must survive.
  - `docker compose up` for many services at once.

  Next step: run containers across several servers with Docker Swarm.
---
Docker wraps an app and everything it needs into one package that runs exactly the same on a laptop, a server, or the cloud. In this course you go from running nginx to bringing up a multi-service app with Compose.
