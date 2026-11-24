---
title: "Terraform Short Course"
linkTitle: "Terraform"
description: "Learn Infrastructure as Code with Terraform: init, plan, apply, reading update and replace markers, handling drift, and destroy. Practice right away against a pretend AWS account."
summary: "Infrastructure as Code from zero: init, plan, apply, update vs replace, drift, and destroy against a pretend AWS account."
url: "/en/courses/terraform/"
sim: terraform
layout: "kursus"
weight: 7
minutes: 20
level: "beginner"
next: "/kursus/ansible/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Infrastructure as code"
    missions: [1]
    body: |
      Picture creating servers on AWS by clicking around the console. Fine once or twice, but try repeating it exactly across 3 environments, or remembering which setting someone changed last month. Painful.

      **Terraform** flips it around: you *write down* the infrastructure you want in `.tf` files, and Terraform builds it. Open `main.tf` in the lab:

      - `provider "aws"` says we're using AWS, Jakarta region.
      - `resource "aws_vpc" "main"` means "there must be one VPC, called `main` in this code".
      - `aws_vpc.main.id` is used by the subnet. Terraform understands the subnet depends on the VPC and orders creation itself.

      The workflow is always: `terraform init` (download providers) → `terraform plan` (see what *will* happen) → `terraform apply` (do it).
    steps:
      - text: "Download the AWS provider and set up the working folder."
        cmd: "terraform init"
        wait: 3000
      - text: "Look at the plan. A `+` means the resource will be created. Nothing has changed on AWS yet."
        cmd: "terraform plan"
        wait: 3000
    quiz:
      q: "What does `terraform plan` do?"
      options:
        - "Creates the resources on AWS right away"
        - "Shows the changes it would make, without changing anything"
        - "Downloads providers"
      answer: 1
      why: "Plan compares the code with the state and the real world, then shows the difference. It's safe to run any time."

  - title: "Apply and state"
    missions: [2]
    body: |
      `terraform apply` shows the plan once more and asks for confirmation. Type `yes` and Terraform creates resources in dependency order: the VPC first, then the subnet, then the EC2 instance.

      Afterwards, Terraform records everything it manages in the **state** (`terraform.tfstate`): each resource's real ID on AWS and its latest attributes. That's how Terraform tells "needs creating" apart from "already exists".

      > State is precious and can contain sensitive data. On a team, keep it in a *remote backend* (like S3 + locking), not on each laptop, and never commit it to Git.
    steps:
      - cmd: "terraform apply"
        wait: 2500
      - text: "Confirm. Watch the resources appear one by one in the AWS panel."
        cmd: "yes"
        wait: 9000
      - text: "The resources tracked in state."
        cmd: "terraform state list"
      - text: "The `output` values from the code, like the instance ID."
        cmd: "terraform output"
    quiz:
      q: "Why shouldn't the state file be committed to Git?"
      options:
        - "It's too big"
        - "It can hold sensitive data and easily clashes when shared"
        - "Terraform can't read it from Git"
      answer: 1
      why: "State can include passwords or keys in plain text, and two people applying with different state copies can overwrite each other. A remote backend with locking prevents both."

  - title: "Update or replace?"
    missions: [3, 4]
    body: |
      Change the code, run plan again, and Terraform only does the **difference**. But watch the markers:

      - `~` **update in-place**: the resource changes without being recreated. Example: changing `instance_type` (the server stops briefly, the type changes, it starts again).
      - `-/+` **replace**: the resource is destroyed and created anew. This happens when the changed attribute can't be changed in place, like `ami`. The old server is gone along with its contents, and its ID changes.

      In the plan, the attribute causing a replace is marked `# forces replacement`. Always check for it before typing `yes` in production.
    steps:
      - text: "Bump the instance type."
        edit:
          file: "main.tf"
          find: 'instance_type = "t3.micro"'
          replace: 'instance_type = "t3.small"'
      - text: "Apply. Note the `~` marker."
        cmd: "terraform apply"
        wait: 2500
      - cmd: "yes"
        wait: 5000
      - text: "Now switch the AMI to Ubuntu 22.04."
        edit:
          file: "main.tf"
          find: 'ami           = "ami-0f1e2d3c4b5a69788"'
          replace: 'ami           = "ami-0a9b8c7d6e5f40312"'
      - text: "Apply. This time it's `-/+` with `# forces replacement`."
        cmd: "terraform apply"
        wait: 2500
      - cmd: "yes"
        wait: 9000
    quiz:
      q: "The plan shows `-/+ aws_instance.web` with `# forces replacement` on the `ami` line. Meaning?"
      options:
        - "The instance changes without a restart"
        - "The old instance is destroyed and a new one is created"
        - "The plan failed because the AMI is wrong"
      answer: 1
      why: "An AMI can't be swapped on a running instance, so Terraform has to destroy and recreate it. Data on the old instance's disk is lost."

  - title: "Drift: when someone changes things in the console"
    missions: [5]
    body: |
      **Drift** is when the real cloud no longer matches the code, usually because someone changed something in the console "just for a minute".

      Terraform doesn't know right away. Only on `plan` or `apply` does it *refresh*: read the real state, compare it with the code, and offer changes to bring it back in line. The code stays the source of truth.

      If the manual change was actually right, don't just apply it away. Put it in the code too, so the next apply doesn't overwrite it.
    steps:
      - text: "Pretend to be a coworker who changes the instance type in the AWS console."
        click: '.tf-con-b[data-k="type"]'
        label: "AWS console: change instance type"
      - text: "Plan detects the change made outside Terraform."
        cmd: "terraform plan"
        wait: 3000
      - text: "Put it back the way the code says."
        cmd: "terraform apply"
        wait: 3000
      - cmd: "yes"
        wait: 5000
    quiz:
      q: "Someone added a tag in the console and that tag really is needed. The right move?"
      options:
        - "Leave it, Terraform will keep it automatically"
        - "Add the tag to the `.tf` code, then plan until it says `No changes`"
        - "Delete the state so Terraform forgets"
      answer: 1
      why: "Terraform always follows the code. If a manual change should stay, the code has to be updated."

  - title: "Cleaning up with destroy"
    missions: [6]
    body: |
      `terraform destroy` deletes **every** resource in the state, in reverse creation order: EC2 first, then the subnet, the VPC last.

      Useful for temporary environments (labs, testing, demos) so the cloud bill doesn't keep running. In production, protect important resources with something like `lifecycle { prevent_destroy = true }`.
    steps:
      - cmd: "terraform destroy"
        wait: 2500
      - cmd: "yes"
        wait: 8000
      - text: "The state is empty now."
        cmd: "terraform state list"
    quiz:
      q: "Why is the destroy order the reverse of the create order?"
      options:
        - "It's random"
        - "Dependent resources (EC2 in a subnet) must go before what they sit on (subnet, VPC)"
        - "To be faster"
      answer: 1
      why: "A VPC can't be deleted while it still has subnets and instances in it. Terraform uses the same dependency graph, just reversed."
recap: |
  What you can do now:

  - The `init` → `plan` → `apply` workflow and the role of state.
  - Read the `+`, `~`, `-/+`, and `# forces replacement` markers.
  - Spot and fix drift.
  - `terraform destroy` to clean up.

  Next step: once the servers exist, configure what's on them with Ansible.
---
Terraform describes cloud infrastructure as code, so it can be reviewed, repeated, and tracked like application code. The lab uses a pretend AWS account, so you can poke at it freely with no bill.
