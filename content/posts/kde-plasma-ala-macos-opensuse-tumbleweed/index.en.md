---
title: "A macOS-Style KDE Plasma on openSUSE Tumbleweed (and Retiring GNOME)"
slug: "kde-plasma-macos-style-opensuse-tumbleweed"
date: 2026-10-08T23:48:00+07:00
categories: [tutorial]
tags: [openSUSE, tumbleweed, kde, plasma, macos, whitesur, sddm, gnome, bash]
series: ["Moving from GNOME to KDE"]
description: "A bash script that turns KDE Plasma 6 on openSUSE Tumbleweed into a macOS look-alike with the WhiteSur theme, switches from GDM to SDDM, then removes GNOME safely."
ShowToc: true
---
### Introduction
My laptop started out on GNOME, then I installed KDE Plasma on top. After getting comfortable in Plasma, I wanted two things: make it look like macOS (haven't managed to buy a MacBook yet, you see), and clean out GNOME so there aren't two desktops taking up space and causing confusion during updates.

So I could repeat it on other machines, I wrapped everything into one script: **[kde-macos.sh](assets/kde-macos.sh)**. The script passes `bash -n` and `shellcheck`.

### Requirements
- openSUSE Tumbleweed with KDE Plasma 6
- An internet connection (to download the WhiteSur theme)
- `sudo` access

### Steps
1. Download the script and make it executable
```
chmod +x kde-macos.sh
```
2. Run it as a **regular user** (not root) from inside a Plasma session. The parts that need root already use `sudo` inside the script.
```
./kde-macos.sh all                 # dark variant (default)
VARIANT=light ./kde-macos.sh all   # light variant
```

`all` mode runs these steps in order:
- **Back up** the KDE config (`kdeglobals`, `kwinrc`, panel layout, GTK, Kvantum) to `~/kde-macos-backup/`. The restore command is printed to the terminal too.
- **SDDM** is installed and enabled in place of GDM. Tumbleweed now has two ways to set the display manager: its own `sddm.service` (from the *Display Manager Rework*) and the old way through `update-alternatives`. The script handles both.
- **Replacement apps** are installed: Dolphin, Konsole, Kate, Okular, Gwenview, Ark, and so on, so you don't lose your file manager and terminal after the GNOME apps are removed.
- The full **WhiteSur theme** by [vinceliuice](https://github.com/vinceliuice/WhiteSur-kde) is installed: global theme, Plasma style, window decorations, Kvantum, GTK and libadwaita themes, icons, cursors, the SDDM login screen, plus the **Inter** font as a stand-in for San Francisco.
- The **macOS look** is applied: window buttons on the **left**, the **Magic Lamp** effect (like Genie) on minimize plus blur, a **top panel** with the app menu, global menu, system tray and clock, and a **floating dock** at the bottom center.
- **GNOME is removed**, with a few safeguards (covered below).

Each step can also be run on its own:
```
./kde-macos.sh backup        # back up the config
./kde-macos.sh dm            # install & enable SDDM
./kde-macos.sh apps          # replacement KDE apps
./kde-macos.sh theme         # download & install WhiteSur
./kde-macos.sh sddm-theme    # reinstall only the SDDM login theme
./kde-macos.sh apply         # apply theme, buttons, fonts, effects
./kde-macos.sh layout        # rebuild the top panel + dock
./kde-macos.sh remove-gnome  # remove GNOME
```

### How the Script Applies the Theme
Everything goes through Plasma 6's own tools, so there's no hand-editing of config files that break easily:
- `plasma-apply-lookandfeel`, `plasma-apply-colorscheme`, `plasma-apply-desktoptheme` and `plasma-apply-cursortheme` for the theme.
- `kwriteconfig6` for the window buttons (`ButtonsOnLeft=XIA`), KWin effects, fonts and app style.
- The panel and dock are created with a Plasma JavaScript script sent through `qdbus6 ... evaluateScript`. Only apps that are actually installed get pinned to the dock.

WhiteSur has lots of variants (alt, opaque, sharp, etc.). The `pick_variant` function in the script picks the most basic variant for `VARIANT=dark` or `light`.

### Removing GNOME Safely
This is the riskiest part, so the script is careful on purpose:
1. **It waits if your session still came through GDM.** If you logged in through GDM, removing GDM halfway can kill the session while zypper is still running. The script refuses and tells you to reboot first, log in through SDDM, and only then run `./kde-macos.sh remove-gnome`.
2. **No `zypper -n`.** GNOME's patterns and core packages are removed with a plain `zypper rm`, so zypper shows the full list (including dependencies that get removed too) and asks for confirmation. **Read the list before answering `y`**. If any Plasma or KDE packages are on it, answer `n`.
3. **GNOME's default apps are asked about separately**, so you can keep the ones you still use.
4. **`gnome-keyring` is kept**, because Chrome and VS Code still use it to store credentials through libsecret.
5. Afterwards GNOME is **locked** with `zypper al`, so it doesn't quietly come back during `zypper dup`. You can see the locks with `zypper ll` and remove one with `sudo zypper rl <name>`.

### Problems on the First Run
The first run mostly worked, but three things failed. All three are fixed in the script above, and the causes are interesting enough to write down.

#### 1. The SDDM theme failed to install
WhiteSur's own SDDM installer figures out the theme version from the output of `plasmashell -v`. Because that installer runs under `sudo`, there's no display it can reach, `plasmashell` fails (you'll see `qt.qpa.xcb` messages in the log), and the source folder name ends up empty: `WhiteSur-`. The fix is that the script installs the SDDM theme itself: it reads the Plasma version as a regular user (falling back to `rpm -q plasma6-workspace`), then matches it to the right folder. For Plasma 6.2 and up it uses `WhiteSur-6.2`.

#### 2. Kvantum installed the light version even though I picked dark
It turns out WhiteSur's dark Kvantum variant isn't a separate folder but a `WhiteSurDark.kvconfig` file inside the `WhiteSur` folder. The script now looks for the `.kvconfig` file instead of a folder name.

#### 3. "Inter font not found" even though it was installed
This is a classic bash bug (had me scratching my head). The original check looked like this:
```
fc-list | grep -qi 'Inter'
```
With `set -o pipefail` on, `grep -q` exits as soon as it finds the first matching line, `fc-list`, still writing output, gets **SIGPIPE** (exit 141), and the whole pipeline counts as failed. The fix: don't use `-q`, send the output to `/dev/null`, and match the family name more strictly:
```
fc-list : family | grep -iE '^Inter([ ,]|$)' >/dev/null
```

With the fixed script, just re-run the parts that failed
```
./kde-macos.sh sddm-theme
./kde-macos.sh apply
```
Then reboot, log in through the now WhiteSur-themed SDDM, and remove GNOME
```
./kde-macos.sh remove-gnome
```
Voilà, a macOS-style Plasma.

### Messages You Can Ignore
- `plasma-systemmonitor` was skipped: the package has a different name on Tumbleweed. The script now also tries `plasma6-systemmonitor`.
- The global menu module for GTK apps isn't in the official repos. The only effect is that GTK app menus don't show in the top panel, especially on Wayland. KDE/Qt apps are fine.
- The GTK theme installer also installed a GNOME Shell theme because GNOME was still detected. That theme doesn't affect KDE, and it goes away along with GNOME.

### If You Want to Go Back
Your old config is in `~/kde-macos-backup/`. Extract it with the command below, then log out and back in.
```
tar -C ~ -xzf <backup-file>
```

Curious why I finally moved to Plasma? The story is in the follow-up: [Why I Moved from GNOME to KDE Plasma](/en/posts/why-i-moved-from-gnome-to-kde-plasma/).

That's it, hope it helps.

References:
- [WhiteSur KDE](https://github.com/vinceliuice/WhiteSur-kde)
- [openSUSE SDB: Change Display Manager](https://en.opensuse.org/SDB:Change_Display_Manager)
