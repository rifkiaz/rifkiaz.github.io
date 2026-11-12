---
title: "Vault Templates for .env Files: When to Quote, When Not To"
slug: "vault-template-env-file-quotes"
date: 2026-09-12T14:22:00+07:00
categories: [tutorial]
tags: [vault, consul-template, docker, env, devops, secrets]
description: "Fixing a Vault (consul-template) template that produced a .env file with quoted values, why the quotes are kept by Docker env-file but not by the shell, and how to handle multiline values."
---
### Introduction
In one of our services, the app config is pulled from Vault and written to a `.env` file with a template (consul-template / Vault Agent). The original template looked roughly like this:
```
{{ with secret "secret/data/dev/app/my-service" }}
{{ range $k, $v := .Data.data }}
{{- if (contains "\n" $v) -}}
{{ $k }}="{{ $v | replaceAll "\n" "\\n" }}"
{{- else -}}
{{ $k }}="{{ $v }}"
{{- end }}
{{ end }}
{{ end }}
```
The result wrapped every value in quotes:
````
DB_HOST="db.example.internal"
API_KEY="<api-key>"
````
Then the app team complained that the config "wasn't being read". The database connection failed, even though the values in Vault were correct (quite the headache). In this post I'll share what caused it and how to fix it.

### Why the quotes are a problem
It turns out it depends on **who reads the file**, because `.env` parsing rules aren't consistent:

| How it's read | Quotes |
|---|---|
| `docker run --env-file` | **become part of the value** |
| `source .env` in bash | stripped |
| `godotenv` and similar dotenv libraries | stripped |
| `env_file` in Docker Compose | stripped in modern Compose, but behavior has differed between versions |

So when this file is used as `--env-file` in Docker, `DB_HOST` is literally `"db.example.internal"`, quotes and all, and of course that host can't be resolved.

It looks roughly like this:

![The .env file from Vault: Docker env-file reads the quotes as part of the value, while bash and dotenv strip them](assets/alur-env-en.svg)

### The fixed template
The quotes are gone, **except** for multiline values like private keys or certificates. Those still need quotes so the escaped `\n` doesn't break the file format.
```
vim env.tpl

............
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ if (contains "\n" $v) }}{{ $k }}="{{ $v | replaceAll "\n" "\\n" }}"
{{ else }}{{ $k }}={{ $v }}
{{ end }}{{ end }}{{ end }}
```
The template is written tightly on purpose. Every newline outside `{{ }}` gets printed to the output, and that's what caused all the blank lines in the old version's output. Now the result looks like this:
````
DB_HOST=db.example.internal
API_KEY=<api-key>
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
````
If that path has no multiline values at all, the template can be even simpler:
```
{{ with secret "secret/data/dev/app/my-service" }}{{ range $k, $v := .Data.data }}{{ $k }}={{ $v }}
{{ end }}{{ end }}
```

### Risks of going without quotes
Dropping the quotes has its own risks, so check the secret's contents before applying:
1. **Spaces and `#`.** In some parsers, an unquoted value with spaces or `#` can get cut off (everything after `#` is treated as a comment).
2. **Backticks and `$`.** In a Docker env-file these are safe because they're read as-is. But if someone runs `source .env` in bash, backticks get executed as *command substitution* and `$VAR` gets expanded. Random passwords often contain characters like these.

If another service breaks after this change, it's most likely reading the file differently (for example, `source`-ing it from a shell). The cleanest fix is to make sure each file is only consumed one way, or to keep a separate template per consumer.

### A note on sharing screenshots
While debugging something like this, it's very easy for someone to post a screenshot of the `.env` file in chat to show the problem. Except it has cloud access keys and partner API keys in plain sight. If that happens in a channel lots of people can see, assume the keys have leaked: **rotate** them, then delete the screenshot. To show a format problem, sharing the key names with masked values is enough.

That's it, hope it helps.

References:
- [Vault Agent templates](https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent/template)
- [docker run --env-file](https://docs.docker.com/reference/cli/docker/container/run/#env)
