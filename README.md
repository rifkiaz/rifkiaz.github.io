# rifkiaz.github.io

Source for [rifkiaz.my.id](https://rifkiaz.my.id), a personal blog and portfolio built with [Hugo](https://gohugo.io) and the [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme.

## Local development

```bash
git clone --recurse-submodules https://github.com/rifkiaz/rifkiaz.github.io.git
cd rifkiaz.github.io
hugo server -D
```

Requires Hugo **extended** 0.148.2 or newer (the version pinned in `.github/workflows/hugo.yml`).

## Structure

```
.
├── hugo.toml                  # site config: menu, params, homepage terminal card, schema
├── archetypes/posts/index.md  # template for `hugo new posts/<slug>/index.md`
├── content/
│   ├── posts/<slug>/          # every post is a page bundle
│   │   ├── index.md
│   │   └── assets/            # images/files used only by that post
│   ├── cheatsheet/            # /cheatsheet/ section
│   ├── hobi/                  # /hobi/ section (bundles, same layout as posts)
│   └── *.md                   # standalone pages: tentang, proyek, archives, search, terminal, topologi, kalkulator
├── layouts/                   # overrides on top of PaperMod
│   ├── _partials/             # head/header/home_info/schema overrides + extend_* hooks
│   ├── _shortcodes/
│   └── terminal.html          # layout for /terminal/
├── assets/
│   ├── css/extended/          # custom CSS, bundled into PaperMod's stylesheet
│   └── js/                    # lightbox, submenu, terminal (minified + fingerprinted)
├── data/hargacloud.json       # AWS/GCP prices for /kalkulator/ (refresh: tools/hargacloud/)
├── static/                    # copied as-is: favicons, logo, fonts, CNAME, img/
└── themes/PaperMod/           # theme (git submodule, do not edit)
```

- Post URLs come from the bundle folder name (`/posts/<slug>/`). Renaming a folder changes its URL, so add the old path to `aliases` if you ever do.
- Project posts use `categories: [proyek]` and get an entry in `content/proyek.md`.
- Photos are WebP (max 1080px). Diagrams are SVG.

## New post

```bash
hugo new posts/judul-tulisan/index.md
```

Put the post's images in `content/posts/judul-tulisan/assets/` and reference them as `assets/<file>`. New posts start as `draft: true`. Fill in `description`, `categories`, and `tags`, then set `draft: false` to publish.

## Deploy

Pushing to the `source` branch triggers `.github/workflows/hugo.yml`, which builds the site and deploys it to GitHub Pages.
