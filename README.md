# rifkiaz.github.io

Source for [rifkiaz.github.io](https://rifkiaz.github.io), a personal blog and portfolio built with [Hugo](https://gohugo.io) and the [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme.

## Local development

```bash
git clone --recurse-submodules https://github.com/rifkiaz/rifkiaz.github.io.git
cd rifkiaz.github.io
hugo server -D
```

Requires Hugo **extended** 0.148.2 or newer (the version pinned in `.github/workflows/hugo.yml`).

## New post

```bash
hugo new posts/judul-tulisan/index.md
```

New posts start as `draft: true`. Fill in `description`, `categories`, and `tags`, then set `draft: false` to publish.

## Deploy

Pushing to the `source` branch triggers `.github/workflows/hugo.yml`, which builds the site and deploys it to GitHub Pages.
