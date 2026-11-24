---
title: "GitOps Short Course"
linkTitle: "GitOps"
description: "Learn GitOps with Argo CD hands-on: Git as the source of truth, OutOfSync and manual sync, auto-sync, self-heal when someone changes the cluster with kubectl, and recovering a broken release with git revert."
summary: "Git as the source of truth: sync, auto-sync, self-heal, and recovering a broken release, the Argo CD way."
url: "/en/courses/gitops/"
sim: gitops
layout: "kursus"
weight: 9
minutes: 15
level: "intermediate"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Git as the source of truth"
    missions: [1]
    body: |
      The old way to deploy to Kubernetes: CI runs `kubectl apply` against the cluster. The problem is that CI needs admin access to the cluster, and if someone changes the cluster directly, nobody knows.

      **GitOps** flips it around. The desired state (Kubernetes manifests) lives in a **Git repo**, and an agent inside the cluster, such as **Argo CD**, keeps comparing Git with the cluster and making them match.

      - Want to deploy? **Commit** to Git. No more manual `kubectl apply`.
      - Deploy history = Git history: who, when, what, reviewable through pull requests.
      - The cluster doesn't have to be opened up to CI; Argo CD pulls changes from inside.
    steps:
      - text: "Raise the replica count in the manifest (the Git panel on the left of the lab)."
        click: '[data-act="rep+"]'
        label: "replicas + 1"
      - text: "Commit and push to the repo."
        click: '[data-act="commit"]'
        label: "commit & push"
        wait: 1000
    quiz:
      q: "In GitOps, the right way to deploy a new version is..."
      options:
        - "`kubectl apply` from your laptop"
        - "Commit the manifest change to the Git repo"
        - "SSH into a node and restart the container"
      answer: 1
      why: "Git is the single source of truth. Argo CD carries the change to the cluster."

  - title: "OutOfSync and manual sync"
    missions: [2]
    body: |
      Argo CD checks Git periodically (every 3 minutes for real, sped up to 10 seconds in the lab), or right away when you click **refresh** / a webhook fires.

      As soon as Git differs from the cluster, the app is **OutOfSync** and Argo CD shows the **diff**. In manual mode, nothing changes until someone presses **sync**. Two statuses to tell apart:

      - **Sync status** (Synced / OutOfSync): does the cluster match Git?
      - **Health status** (Healthy / Progressing / Degraded): is the app actually running fine?
    steps:
      - text: "Make Argo CD read Git now. The status turns OutOfSync and the diff appears."
        click: '[data-act="refresh"]'
        label: "refresh"
        wait: 1500
      - text: "Apply it to the cluster."
        click: '[data-act="sync"]'
        label: "sync"
        wait: 3000
    quiz:
      q: "An app is **Synced** but **Degraded**. Meaning?"
      options:
        - "The cluster matches Git, but the app has a problem (say, crashing pods)"
        - "Git hasn't been committed"
        - "Argo CD is down"
      answer: 0
      why: "Sync only makes sure the manifests are applied. Health checks whether the result is healthy. Correct manifests can still point at a broken image."

  - title: "Auto-sync"
    missions: [3]
    body: |
      Pressing sync every time isn't much different from deploying by hand. With **auto-sync**, Argo CD applies every change it finds in Git right away. The release flow becomes: merge the pull request → moments later it's running in the cluster.

      Control moves to Git: who may merge to that branch, which reviews are required, and so on.
    steps:
      - text: "Turn on auto-sync."
        click: "#gx-auto"
        state: "on"
        label: "auto-sync: on"
      - text: "Change the image tag to v1.1.0."
        select: "#gx-tag"
        value: "v1.1.0"
        label: "image: toko-web:v1.1.0"
      - text: "Commit, then wait for Argo CD to find it on its own (10 seconds at most)."
        click: '[data-act="commit"]'
        label: "commit & push"
        wait: 14000
    quiz:
      q: "With auto-sync on, what triggers a deploy?"
      options:
        - "A change in the Git repo"
        - "The sync button"
        - "A pod restart"
      answer: 0
      why: "Argo CD notices the new commit (through polling or a webhook) and syncs it right away."

  - title: "Self-heal"
    missions: [4]
    body: |
      Someone panics when traffic spikes and runs `kubectl scale` straight against the cluster. Now the cluster doesn't match Git: that's **drift**.

      With **self-heal**, Argo CD puts the cluster back to what Git says automatically, a few seconds after detecting the drift. "Quiet" changes don't last. If you really need 5 replicas, commit it to Git.
    steps:
      - text: "Turn on self-heal."
        click: "#gx-heal"
        state: "on"
        label: "self-heal: on"
      - text: "Be the person who changes the cluster directly."
        click: '[data-act="kube"][data-k="scale"]'
        label: "kubectl scale deploy/toko-web"
        wait: 6000
    quiz:
      q: "Self-heal is on, and someone runs `kubectl set image` to another version. What happens?"
      options:
        - "The new version is kept"
        - "Argo CD puts it back to the version written in Git"
        - "Argo CD deletes the deployment"
      answer: 1
      why: "Self-heal treats Git as right and the cluster as drifted. Any change made outside Git is reverted."

  - title: "A broken release and how to recover"
    missions: [5]
    body: |
      Sometimes a new version really is broken. In the lab, `v2.0.0` makes the pods crash (**Degraded**).

      With auto-sync on, Argo CD's *rollback* button is disabled, because a rollback in the cluster would be overwritten by Git right away. The GitOps way is to **fix Git**. The quickest fix is `git revert` on the bad commit. Argo CD sees the revert commit, syncs it, and the app is healthy again. The history stays clean too.
    steps:
      - text: "Release v2.0.0, the one with the bug."
        select: "#gx-tag"
        value: "v2.0.0"
        label: "image: toko-web:v2.0.0"
      - click: '[data-act="commit"]'
        label: "commit & push"
        wait: 16000
      - text: "The app is Degraded. Revert the last commit in Git."
        click: '[data-act="revert"]'
        label: "git revert"
        wait: 16000
    quiz:
      q: "Auto-sync is on and a new release is broken. The GitOps way to recover?"
      options:
        - "`kubectl rollout undo` in the cluster"
        - "`git revert` the bad commit and let Argo CD sync"
        - "Turn off Argo CD"
      answer: 1
      why: "If you only change the cluster, auto-sync brings the broken version back from Git. The fix has to be in Git."
recap: |
  What you can do now:

  - Git as the source of truth, sync status vs health status.
  - Manual sync, auto-sync, and self-heal.
  - Recovering a broken release with `git revert`.
---
GitOps makes a Git repo the single source of truth for what runs in a Kubernetes cluster. The lab simulates a manifest repo, Argo CD, and a cluster whose pods you can watch change versions.
