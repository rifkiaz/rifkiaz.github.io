---
title: "Git Short Course"
linkTitle: "Git"
description: "Learn Git from zero while practicing right away: commits, branches, merging all the way to conflicts, pushing and pulling with a teammate, stash, rescuing lost commits, and rebase."
summary: "From git init to rebase. Commits, branches, conflicts, working with a teammate through a remote, and how to rescue a commit you threw away."
url: "/en/courses/git/"
sim: git
layout: "kursus"
weight: 1
minutes: 30
level: "beginner"
next: "/kursus/docker/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "A repo and your first commit"
    missions: [1]
    body: |
      Git is a history keeper. Every time you **commit**, Git stores a full snapshot of your project at that moment, along with who made it, when, and a message. If something breaks later, you can look at or go back to an earlier snapshot.

      There are three "places" you need to know:

      - **Working dir**: the files you're editing on your laptop.
      - **Staging** (the index): the list of changes that *will* go into the next commit. You fill it with `git add`.
      - **Local repo**: the history of commits saved in the `.git` folder.

      The flow is always the same: change files → `git add` → `git commit`. Watch the strip above the lab, the arrows light up as you move between stages.

      > Before the first commit, Git needs to know who you are. That's what `git config user.name` and `user.email` are for, once per laptop.
    steps:
      - text: "Turn the `proyek-web` folder into a Git repo."
        cmd: "git init"
      - text: "Check the repo. Every file is still *untracked*."
        cmd: "git status"
      - text: "Introduce yourself to Git."
        cmd: 'git config --global user.name "Your Name"'
      - cmd: "git config --global user.email you@example.com"
      - text: "Stage every file. The dot means \"everything in this folder\"."
        cmd: "git add ."
      - text: "Save the first snapshot."
        cmd: 'git commit -m "First commit"'
      - text: "Look at the history. Every commit has a unique hash."
        cmd: "git log --oneline"
    quiz:
      q: "You just edited `style.css` and go straight to `git commit`. What happens?"
      options:
        - "The style.css change goes into the commit"
        - "Nothing is committed, because style.css hasn't been `git add`ed to staging"
        - "Git pushes to GitHub automatically"
      answer: 1
      why: "A commit only takes what's in staging. Files you changed but didn't `add` stay in the working dir. (The exception: `git commit -a` also picks up files Git already tracks.)"

  - title: "Peek at changes before committing"
    missions: [2]
    body: |
      A good habit before committing: **look at what changed**. Git has two ways:

      - `git diff` compares the **working dir** with **staging**. These are changes you *haven't* added yet.
      - `git diff --staged` compares **staging** with the **last commit**. This is what *will* go into the commit.

      Lines starting with `-` are removed, `+` are added. If `git diff` is empty but you're sure you changed a file, it's probably already staged. Try `--staged`.

      Commit messages matter too. Say *what* changed in a short sentence, like "Change heading color", not "update" or "fix".
    steps:
      - text: "Change the heading color in `style.css` (same as editing the file in your editor)."
        cmd: |-
          sed -i 's/color: teal;/color: tomato;/' style.css
      - text: "See the unstaged change."
        cmd: "git diff"
      - cmd: "git add style.css"
      - text: "Now `git diff` is empty, but `--staged` shows the change."
        cmd: "git diff --staged"
      - cmd: 'git commit -m "Change heading color"'
    quiz:
      q: "After `git add style.css`, which command shows the style.css change?"
      options:
        - "`git diff`"
        - "`git diff --staged`"
        - "`git log`"
      answer: 1
      why: "Once added, the change lives in staging, so `git diff --staged` shows it. Plain `git diff` only looks at what isn't added yet."

  - title: "Branches and merging"
    missions: [3, 4]
    body: |
      A **branch** is a separate line of work. You can build a new feature on its own branch without disturbing `main`, which usually holds the version that works.

      Technically a branch is just a *label* pointing at one commit. Branches are cheap and fast, so don't hesitate to make one per feature.

      - `git switch -c name` creates a new branch and moves to it.
      - `git switch main` goes back to main.
      - `git merge name` merges that branch into the one you're on.

      If `main` hasn't moved since the branch was created, the merge is a **fast-forward**: the `main` label just slides forward, no new commit needed. Watch the commit graph in the lab.
    steps:
      - text: "Create a feature branch and move to it."
        cmd: "git switch -c feature/contact"
      - text: "Add a new file on that branch."
        cmd: 'echo "<p>Contact: hello@example.com</p>" > kontak.html'
      - cmd: "git add kontak.html"
      - cmd: 'git commit -m "Add contact page"'
      - text: "Go back to main. Notice `kontak.html` disappears from the working dir, because main doesn't have it yet."
        cmd: "git switch main"
      - text: "Merge the feature into main."
        cmd: "git merge feature/contact"
      - cmd: "git log --oneline --graph"
    quiz:
      q: "Why was that merge a *fast-forward*?"
      options:
        - "Because main had no new commits since the branch was created, so main just moves forward"
        - "Because Git skipped conflict checks to be quick"
        - "Because the feature branch was deleted automatically"
      answer: 0
      why: "Main's history was still a straight line behind the feature branch, so Git only had to move the main label to the feature's last commit. No merge commit."

  - title: "Resolving a conflict"
    missions: [5]
    body: |
      A conflict happens when **two branches change the same line** differently. Git won't guess which one is right, so it stops and lets you decide.

      The conflicted file contains markers like this:

      ```
      <<<<<<< HEAD
      <h1>Title from main</h1>
      =======
      <h1>Title from the feature branch</h1>
      >>>>>>> feature/title
      ```

      The top part is your current branch (`HEAD`), the bottom part is the branch being merged. To resolve it:

      1. Edit the file until it's right and the markers are gone. Or pick one side with `git checkout --ours` / `--theirs`.
      2. `git add` the file to mark the conflict as resolved.
      3. `git commit` to finish the merge.

      Panicking? `git merge --abort` cancels the merge and puts everything back the way it was.
    steps:
      - text: "Make a new branch and change the page title."
        cmd: "git switch -c feature/title"
      - cmd: |-
          sed -i 's/<h1>Hello, world!<\/h1>/<h1>Title from the feature branch<\/h1>/' index.html
      - text: "`-am` = add every tracked file + commit, in one go."
        cmd: 'git commit -am "Feature version of the title"'
      - text: "Go back to main and change the same line differently."
        cmd: "git switch main"
      - cmd: |-
          sed -i 's/<h1>Hello, world!<\/h1>/<h1>Title from main<\/h1>/' index.html
      - cmd: 'git commit -am "Main version of the title"'
      - text: "Merge. This time Git stops on a conflict."
        cmd: "git merge feature/title"
      - text: "Look at the conflict markers."
        cmd: "cat index.html"
      - text: "Take the feature branch version (*theirs*), then mark it resolved."
        cmd: "git checkout --theirs index.html"
      - cmd: "git add index.html"
      - cmd: "git commit --no-edit"
    quiz:
      q: "You've edited the conflicted file until it's right. What's next?"
      options:
        - "`git merge` again"
        - "`git add` the file, then `git commit`"
        - "`git push` so the conflict goes away"
      answer: 1
      why: "`git add` tells Git the conflict in that file is resolved, and `git commit` creates the merge commit."

  - title: "Working together through a remote"
    missions: [6, 7]
    body: |
      So far every commit only lives on your laptop. A **remote** is a copy of the repo on a server (GitHub, GitLab and friends) so a team can share it.

      - `git remote add origin URL` registers the remote's address under the name `origin`.
      - `git push` sends your commits to the remote. `-u` also remembers the branch pairing, so next time plain `git push` is enough.
      - `git pull` = `git fetch` (grab new commits from the remote) + merge them into your branch.

      This lab has **Dina**, a teammate. A few seconds after your first push, she pushes her own commit to main. So your next push gets **rejected**: the remote has commits you don't. The fix isn't a force push, it's pull first, then push again.
    steps:
      - cmd: "git remote add origin https://github.com/kamu/proyek-web.git"
      - cmd: "git push -u origin main"
      - text: "Wait a few seconds until Dina's push shows up (see the **remote** tab in the lab). Meanwhile, make a small commit."
        cmd: 'echo "- a note from you" >> README.md'
      - cmd: 'git commit -am "Add a note"'
      - text: "Push. If Dina pushed first, this gets *rejected*."
        cmd: "git push"
      - text: "Grab Dina's commit and merge it with yours."
        cmd: "git pull --no-rebase"
      - text: "Now the push goes through."
        cmd: "git push"
    quiz:
      q: "Your push is rejected with *rejected (fetch first)*. What should you do?"
      options:
        - "`git push --force` so your commit wins"
        - "`git pull` first, resolve conflicts if any, then push again"
        - "Delete the repo and clone it again"
      answer: 1
      why: "The remote has someone else's commits. A force push would throw your teammate's work away. Pull first so the histories join, then push."

  - title: "Stash and rescuing commits"
    missions: [8, 9]
    body: |
      Two life savers people often forget:

      **`git stash`** puts half-done changes in a "drawer" and cleans the working dir. Handy when you have to switch branches suddenly (say, a bug on main) but your current work isn't ready to commit. Later, `git stash pop` takes it back out.

      **`git reflog`** records everywhere `HEAD` has pointed. So if you "delete" a commit with `git reset --hard`, it isn't really gone yet. Find its hash in the reflog and reset back to it.

      > `git reset --hard` throws away uncommitted changes with no mercy. Committed work can still be rescued through the reflog, uncommitted work can't.
    steps:
      - text: "Start some half-done work."
        cmd: 'echo "- half-baked idea" >> README.md'
      - text: "Put it in the drawer, then switch branches and come back."
        cmd: "git stash"
      - cmd: "git switch feature/title"
      - cmd: "git switch main"
      - text: "Take it back out of the drawer."
        cmd: "git stash pop"
      - cmd: 'git commit -am "Add an idea"'
      - text: "Now \"accidentally\" throw that commit away."
        cmd: "git reset --hard HEAD~1"
      - text: "Find its trail. `HEAD@{1}` is where HEAD was one step ago."
        cmd: "git reflog"
      - cmd: "git reset --hard HEAD@{1}"
    quiz:
      q: "After `git reset --hard HEAD~1`, the commit you threw away is..."
      options:
        - "Gone forever"
        - "Still there and findable through `git reflog`"
        - "Moved to the stash automatically"
      answer: 1
      why: "No branch points at it anymore, but the reflog still remembers it (usually for 90 days), so you can reset back to it."

  - title: "Tidy history with rebase"
    missions: [10]
    body: |
      A merge joins two lines with a merge commit, so the graph branches. **Rebase** is another way: the commits on your branch are "moved" onto the tip of another branch, as if you'd started working from there. The result is a straight history.

      `git rebase main` (run on the feature branch) means: take the feature commits that main doesn't have, and replay them one by one on top of the latest main. Their hashes change, because technically they're new commits.

      > Golden rule: **don't rebase commits that are already pushed and used by others.** Their history stops matching yours. Rebase is safe for local branches you haven't shared.
    steps:
      - text: "Make a new feature branch with one commit on it."
        cmd: "git switch -c feature/footer"
      - cmd: 'echo "footer { color: gray; }" >> style.css'
      - cmd: 'git commit -am "Footer style"'
      - text: "Meanwhile main moves on too."
        cmd: "git switch main"
      - cmd: 'echo "- release notes" >> README.md'
      - cmd: 'git commit -am "Release notes"'
      - text: "Back to the feature branch and rebase it onto main. Watch the graph straighten out."
        cmd: "git switch feature/footer"
      - cmd: "git rebase main"
      - cmd: "git log --oneline --graph --all"
    quiz:
      q: "When should you **not** rebase?"
      options:
        - "On a local branch that's never been pushed"
        - "On a branch that's already pushed and used by teammates"
        - "Before opening a pull request"
      answer: 1
      why: "Rebase rewrites commits (their hashes change). If a teammate built on the old commits, your histories will clash."
recap: |
  What you can do now:

  - The basic flow: change → `git add` → `git commit`, and `git diff` / `--staged` to peek.
  - `git switch -c`, `git merge`, and resolving conflicts.
  - `git push`, `git pull`, and why a push gets rejected.
  - `git stash`, `git reset`, `git reflog`, and `git rebase`.

  Want free practice? Open the full Git lab and try other commands like `git cherry-pick` or `git revert`.
---
Git records every change in your project, so you can go back to any version and work with a team without overwriting each other. In this course you go from an empty repo all the way to resolving conflicts and tidying history.
