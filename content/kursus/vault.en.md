---
title: "Vault Short Course"
linkTitle: "Vault"
description: "Learn HashiCorp Vault hands-on: init and unseal, tokens, KV v2 with versions, policies, AppRole for apps, dynamic database credentials, encryption with transit, and an emergency seal."
summary: "Handle secrets properly: unseal, tokens, KV v2, policies, AppRole, dynamic database credentials, transit, and an emergency seal."
url: "/en/courses/vault/"
sim: vault
layout: "kursus"
weight: 6
minutes: 30
level: "intermediate"
next: "/kursus/terraform/"
ShowToc: false
ShowReadingTime: false
ShowBreadCrumbs: false
comments: false
lessons:
  - title: "Init and unseal"
    missions: [1, 2]
    body: |
      Database passwords in `.env` files, API keys in the repo, tokens in team chat... **Vault** exists so secrets live in one place, encrypted, with controlled and audited access.

      All of Vault's data in storage is encrypted. The key to open it (the *root key*) is never stored whole. At **init**, Vault splits it into several **unseal keys** with Shamir's Secret Sharing, for example 5 shares with a threshold of 3.

      Every time Vault starts, it's **sealed**: running, but unable to read its own data. It takes 3 of the 5 key holders entering their share (**unseal**). Ideally each key is held by a different person, so nobody can open Vault alone.
    steps:
      - text: "Tell the CLI where the Vault server is."
        cmd: "export VAULT_ADDR=http://10.0.0.10:8200"
      - cmd: "vault status"
      - text: "Initialize. You get 5 unseal keys and a root token. In real life, keep them safe!"
        cmd: "vault operator init"
        wait: 1500
      - text: "Enter the first unseal key. Keys are random, so this button uses one from the output above."
        pick: "vault operator unseal "
      - text: "The second key..."
        pick: "vault operator unseal "
      - text: "...and the third. Vault is open."
        pick: "vault operator unseal "
      - cmd: "vault status"
    quiz:
      q: "Vault was initialized with 5 keys and a threshold of 3. Two key holders are on leave. Can Vault be unsealed?"
      options:
        - "Yes, any 3 of the 5 are enough"
        - "No, all 5 are needed"
        - "Yes, with just the root token"
      answer: 0
      why: "A threshold of 3 means any 3 shares will do. The root token can't unseal; it only works once Vault is open."

  - title: "Logging in and tokens"
    missions: [3]
    body: |
      Every request to Vault must carry a **token**. A token has **policies** (what it may do) and a **TTL** (when it expires).

      The **root token** from init can do anything. Use it for the initial setup, then create more limited ways to log in and revoke it. In production, people usually log in with OIDC/LDAP, and apps with AppRole or Kubernetes auth.
    steps:
      - text: "Log in with the root token from init."
        pick: "vault login "
      - text: "See the details of the current token: policies, TTL, and more."
        cmd: "vault token lookup"
    quiz:
      q: "Good practice for the root token after the initial setup?"
      options:
        - "Share it with every developer"
        - "Store it in the repo so it doesn't get lost"
        - "Revoke it, and generate a new one only in an emergency"
      answer: 2
      why: "The root token has no limits at all. If it leaks, every secret leaks. A new root token can be generated with the unseal keys when truly needed."

  - title: "Storing secrets in KV v2"
    missions: [4, 5]
    body: |
      Vault has many **secrets engines**, each *mounted* at a path. The most basic is **KV** (key-value). Version 2 keeps **version history**, so if a password gets overwritten you can still see or restore the old one.

      One thing that often confuses people: with KV v2, the CLI `vault kv get secret/app/db` actually calls the API at `secret/data/app/db`. That `data/` prefix matters later when writing policies.
    steps:
      - text: "Enable KV v2 at `secret/`."
        cmd: "vault secrets enable -path=secret kv-v2"
      - cmd: "vault kv put secret/app/db username=app password=s3cret123"
      - cmd: "vault kv get secret/app/db"
      - text: "Change the password. This becomes version 2."
        cmd: "vault kv put secret/app/db username=app password=Rotated456"
      - text: "The old version is still there."
        cmd: "vault kv get -version=1 secret/app/db"
    quiz:
      q: "The API path that `vault kv get secret/app/db` (KV v2) really hits is..."
      options:
        - "`secret/app/db`"
        - "`secret/data/app/db`"
        - "`kv/secret/app/db`"
      answer: 1
      why: "KV v2 separates data (`data/`) from metadata (`metadata/`). Policies must use this API path, not the CLI path."

  - title: "Policies: who may do what"
    missions: [6]
    body: |
      A **policy** is written in HCL and lists paths with their **capabilities**: `create`, `read`, `update`, `delete`, `list`, and so on. By default Vault denies everything not allowed (*deny by default*).

      Open the **access** tab in the lab to see `app-read.hcl`. It allows `read` on `secret/data/app/*` only. A token with this policy can read the app's database password, but can't change it, and can't see any other secret.

      The principle: **least privilege**. Give every app the narrowest access possible.
    steps:
      - text: "Register the policy from the file."
        cmd: "vault policy write app-read app-read.hcl"
      - text: "Create a token that only has that policy."
        cmd: "vault token create -policy=app-read -ttl=1h"
      - text: "Use that token to read. It works."
        pick: "VAULT_TOKEN="
      - text: "Use the same token to write. Denied: *permission denied*."
        pick: "VAULT_TOKEN="
    quiz:
      q: "A token with the `app-read` policy tries to read `secret/data/billing/key`. Result?"
      options:
        - "Works, it has the read capability"
        - "Denied, that path isn't in the policy"
        - "Works but the data is redacted"
      answer: 1
      why: "Capabilities apply per path. Outside `secret/data/app/*`, that token has no permissions at all."

  - title: "AppRole: logging in as an app"
    missions: [7]
    body: |
      Apps can't log in with a human's username and password, and baking a long-lived token into config is risky. **AppRole** splits the credential in two:

      - **role-id**: a bit like a username. Not very secret, can live in the image or config.
      - **secret-id**: a bit like a password. Delivered separately at deploy time (say by the CI/CD pipeline), and can be limited in lifetime and number of uses.

      The app trades both for a short-lived token with the policies set on the role.
    steps:
      - cmd: "vault auth enable approle"
      - text: "Create a role `web` that issues tokens with the app-read policy for 20 minutes."
        cmd: "vault write auth/approle/role/web token_policies=app-read token_ttl=20m"
      - cmd: "vault read auth/approle/role/web/role-id"
      - cmd: "vault write -f auth/approle/role/web/secret-id"
      - text: "Log in as the app: trade role-id + secret-id for a token."
        pick: "vault write auth/approle/login "
    quiz:
      q: "Why should the role-id and secret-id travel through different channels?"
      options:
        - "It's faster"
        - "So whoever steals just one of them still can't log in"
        - "Because their formats differ"
      answer: 1
      why: "Like a username and password, they're only useful together. Separate channels make it less likely both leak at once."

  - title: "Dynamic database credentials"
    missions: [8]
    body: |
      One database password shared by many apps for years is a nightmare: hard to rotate, hard to tell who's using it.

      The **database secrets engine** flips it around. Vault holds a database admin account, and every time an app asks for credentials, Vault **creates a new user** with a short life (a *lease*). When the lease expires or is revoked, Vault deletes that user from the database.

      The result: each app (even each instance) has its own credentials, and a leaked one goes stale quickly.
    steps:
      - cmd: "vault secrets enable database"
      - text: "Give Vault admin access to PostgreSQL."
        cmd: |-
          vault write database/config/postgres plugin_name=postgresql-database-plugin connection_url="postgresql://{{username}}:{{password}}@10.0.0.20:5432/app" allowed_roles=readonly username=vault password=vault-pass
      - text: "Create the `readonly` role: SQL to create the user, and a 1 minute lifetime (5 max)."
        cmd: |-
          vault write database/roles/readonly db_name=postgres creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" default_ttl=1m max_ttl=5m
      - text: "Ask for credentials. Every call gives a different user."
        cmd: "vault read database/creds/readonly"
      - text: "Revoke the lease now. The database user is deleted right away."
        pick: "vault lease revoke "
    quiz:
      q: "What happens when a dynamic credential's lease expires?"
      options:
        - "Nothing, the user stays"
        - "Vault deletes that user from the database"
        - "The password is resent to the app"
      answer: 1
      why: "Vault tracks every lease and cleans up after itself. An app that still needs access must *renew* the lease or ask for new credentials."

  - title: "Encryption as a service: transit"
    missions: [9]
    body: |
      Sometimes an app has to encrypt data itself, say an ID number before storing it in the database. Managing encryption keys inside the app is risky.

      **Transit** offers encryption as a service: the app sends plaintext (in base64), Vault returns *ciphertext* like `vault:v1:...`. The key **never leaves Vault**. Key rotation is easy too: old data can still be decrypted, new data uses the latest key version.
    steps:
      - cmd: "vault secrets enable transit"
      - text: "Create a key named `app`."
        cmd: "vault write -f transit/keys/app"
      - text: "Encrypt some text. Transit input must be base64."
        cmd: 'vault write transit/encrypt/app plaintext=$(echo -n "hello vault" | base64)'
      - text: "Decrypt that ciphertext and turn it back from base64."
        pick: "vault write -field=plaintext transit/decrypt/app "
    quiz:
      q: "With transit, where is the encryption key kept?"
      options:
        - "Sent to the app along with the ciphertext"
        - "Only in Vault; the app never sees it"
        - "In the app's database"
      answer: 1
      why: "That's the whole point of transit: the app only holds ciphertext. Without access to Vault, the ciphertext can't be opened."

  - title: "Emergency seal"
    missions: [10]
    body: |
      Signs of a break-in? `vault operator seal` **seals** Vault immediately: the root key is dropped from memory and every request stops being served. It's the emergency brake.

      Opening it again takes a full unseal with the threshold of keys, just like at the start. So make sure key holders can be reached, and practice the procedure before you really need it.
    steps:
      - cmd: "vault operator seal"
      - cmd: "vault status"
      - text: "Open it again with 3 keys."
        pick: "vault operator unseal "
      - pick: "vault operator unseal "
      - pick: "vault operator unseal "
    quiz:
      q: "After `vault operator seal`, what does it take to open Vault again?"
      options:
        - "The root token"
        - "Unseal keys up to the threshold"
        - "Just restart the server"
      answer: 1
      why: "Sealing drops the root key from memory. The only way to rebuild it is with the unseal key shares."
recap: |
  What you can do now:

  - Init, unseal, seal, and why the key is split.
  - Tokens, policies, and least privilege.
  - KV v2 with versions, AppRole for apps.
  - Dynamic database credentials and encryption with transit.
---
Vault keeps passwords, tokens, and encryption keys in one encrypted place, with controlled and audited access. The lab has a pretend Vault server and PostgreSQL database you drive from your laptop's terminal.
