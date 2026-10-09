#!/usr/bin/env bash
# =============================================================================
#  kde-macos.sh — Ubah KDE Plasma 6 di openSUSE Tumbleweed jadi mirip macOS
#                 dan bersihkan sisa GNOME.
#
#  Penggunaan (jalankan sebagai USER BIASA, bukan root):
#    chmod +x kde-macos.sh
#    ./kde-macos.sh all            # semua langkah, urut & aman
#
#  Atau per langkah:
#    ./kde-macos.sh backup         # cadangkan konfigurasi KDE
#    ./kde-macos.sh dm             # pasang & aktifkan SDDM (ganti GDM)
#    ./kde-macos.sh apps           # pasang pengganti aplikasi GNOME (Dolphin, Konsole, dst)
#    ./kde-macos.sh theme          # unduh & pasang tema WhiteSur (KDE, GTK, ikon, kursor, SDDM)
#    ./kde-macos.sh sddm-theme     # pasang ulang tema layar login SDDM saja
#    ./kde-macos.sh apply          # terapkan tema, tombol jendela kiri, font, efek
#    ./kde-macos.sh layout         # panel atas (global menu) + dock bawah
#    ./kde-macos.sh remove-gnome   # hapus GNOME (zypper menampilkan daftar & minta konfirmasi)
#
#  Variabel opsional:
#    VARIANT=dark|light   (default: dark)
#    KVANTUM=1|0          (default: 1 — pakai Kvantum untuk gaya aplikasi Qt)
#
#  Contoh:  VARIANT=light ./kde-macos.sh all
# =============================================================================

set -Eeuo pipefail

VARIANT="${VARIANT:-dark}"
KVANTUM="${KVANTUM:-1}"
SRC_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/kde-macos-src"
BACKUP_DIR="$HOME/kde-macos-backup"
QDBUS=""

# ---------- util ------------------------------------------------------------
info() { printf '\n\e[1;34m==>\e[0m \e[1m%s\e[0m\n' "$*"; }
ok()   { printf '\e[1;32m  ✓\e[0m %s\n' "$*"; }
warn() { printf '\e[1;33m  !\e[0m %s\n' "$*" >&2; }
err()  { printf '\e[1;31m  ✗\e[0m %s\n' "$*" >&2; }
trap 'err "Gagal di baris $LINENO: $BASH_COMMAND"' ERR

confirm() {
  local a
  read -r -p "$1 [y/N] " a
  [[ ${a,,} == y || ${a,,} == ya ]]
}

is_installed() { rpm -q "$1" &>/dev/null; }

# Pasang paket satu per satu; yang tidak ada di repo dilewati dengan peringatan.
pkg_install() {
  local p
  for p in "$@"; do
    if is_installed "$p"; then continue; fi
    if sudo zypper -n --quiet in --no-recommends "$p" >/dev/null 2>&1; then
      ok "Terpasang: $p"
    else
      warn "Dilewati (tidak tersedia/gagal): $p"
    fi
  done
  return 0
}

# Pasang paket pertama yang tersedia dari beberapa nama alternatif.
pkg_install_any() {
  local p
  for p in "$@"; do is_installed "$p" && return 0; done
  for p in "$@"; do
    if sudo zypper -n --quiet in --no-recommends "$p" >/dev/null 2>&1; then
      ok "Terpasang: $p"; return 0
    fi
  done
  warn "Tidak ada paket yang cocok dari: $*"
  return 1
}

find_qdbus() {
  local q
  for q in qdbus6 qdbus-qt6 qdbus; do
    if command -v "$q" &>/dev/null; then QDBUS="$q"; return 0; fi
  done
  return 1
}

in_kde_session() { [[ ${XDG_CURRENT_DESKTOP:-} == *KDE* ]]; }

gdm_running() { pgrep -x gdm &>/dev/null || systemctl is-active --quiet gdm.service 2>/dev/null; }

# Dari daftar kandidat (stdin), pilih varian WhiteSur yang paling "dasar"
# sesuai VARIANT (dark/light), hindari varian alt/opaque/sharp/skala.
pick_variant() {
  local all v clean
  all=$(grep -i whitesur || true)
  [[ -z $all ]] && return 0
  if [[ $VARIANT == dark ]]; then
    v=$(grep -i dark <<<"$all" || true)
  else
    v=$(grep -vi dark <<<"$all" || true)
  fi
  [[ -z $v ]] && v=$all
  clean=$(grep -viE 'alt|liquid|opaque|solid|sharp|nord|_x[0-9]|cursor' <<<"$v" || true)
  [[ -n $clean ]] && v=$clean
  awk '{ print length, $0 }' <<<"$v" | sort -n | head -n1 | cut -d' ' -f2-
}

clone_or_update() {
  local repo=$1 dir="$SRC_DIR/${1##*/}"
  if [[ -d $dir/.git ]]; then
    git -C "$dir" pull --ff-only -q || warn "Gagal update $repo, pakai versi lokal"
  else
    git clone --depth=1 -q "https://github.com/$repo.git" "$dir"
  fi
  ok "Sumber siap: $repo"
}

# ---------- 0. backup -------------------------------------------------------
do_backup() {
  info "Mencadangkan konfigurasi KDE"
  local ts out f files=()
  ts=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$BACKUP_DIR"
  out="$BACKUP_DIR/kde-config-$ts.tar.gz"
  for f in kdeglobals kwinrc plasmarc plasmashellrc \
           plasma-org.kde.plasma.desktop-appletsrc kcminputrc ksplashrc \
           kscreenlockerrc gtk-3.0 gtk-4.0 Kvantum; do
    [[ -e $HOME/.config/$f ]] && files+=(".config/$f")
  done
  if ((${#files[@]})); then
    tar -C "$HOME" -czf "$out" "${files[@]}"
    ok "Cadangan: $out"
    echo "     Untuk memulihkan: tar -C ~ -xzf $out  lalu logout & login lagi"
  else
    warn "Tidak ada konfigurasi untuk dicadangkan"
  fi
}

# ---------- 1. login manager ------------------------------------------------
do_dm() {
  info "Memasang & mengaktifkan SDDM sebagai login manager"
  pkg_install_any sddm-qt6 sddm || true

  if systemctl cat sddm.service &>/dev/null; then
    # Tumbleweed baru: DM memakai unit systemd sendiri (Display Manager Rework)
    sudo systemctl disable gdm.service display-manager-legacy.service 2>/dev/null || true
    sudo systemctl enable --force sddm.service
    ok "sddm.service diaktifkan"
  else
    # Cara lama: lewat update-alternatives + display-manager(-legacy).service
    sudo systemctl enable --force display-manager-legacy.service 2>/dev/null \
      || sudo systemctl enable --force display-manager.service 2>/dev/null || true
  fi

  local alt
  alt=$(update-alternatives --list default-displaymanager 2>/dev/null | grep -m1 sddm || true)
  if [[ -n $alt ]]; then
    sudo update-alternatives --set default-displaymanager "$alt" >/dev/null
    ok "default-displaymanager → $alt"
  fi
  if [[ -f /etc/sysconfig/displaymanager ]]; then
    sudo sed -i 's/^DISPLAYMANAGER=.*/DISPLAYMANAGER="sddm"/' /etc/sysconfig/displaymanager
  fi
  return 0
}

# ---------- 2. aplikasi pengganti -------------------------------------------
do_apps() {
  info "Memasang aplikasi KDE pengganti aplikasi GNOME"
  pkg_install dolphin konsole kate okular gwenview ark kcalc spectacle \
              filelight partitionmanager
  pkg_install_any plasma6-systemmonitor plasma-systemmonitor || true
  pkg_install_any discover6 discover || true
}

# ---------- 3. unduh & pasang tema ------------------------------------------
do_theme() {
  info "Memasang dependensi tema"
  pkg_install git sassc glib2-tools glib2-devel libxml2-tools fontconfig
  pkg_install_any qt6-tools-qdbus || true
  if [[ $KVANTUM == 1 ]]; then pkg_install kvantum-manager kvantum-qt6; fi
  pkg_install_any appmenu-gtk3-module appmenu-gtk-module-common || true   # global menu untuk app GTK
  pkg_install_any inter-fonts google-inter-fonts || true                  # pengganti font San Francisco

  info "Mengunduh tema WhiteSur"
  mkdir -p "$SRC_DIR"
  clone_or_update vinceliuice/WhiteSur-kde
  clone_or_update vinceliuice/WhiteSur-gtk-theme
  clone_or_update vinceliuice/WhiteSur-icon-theme
  clone_or_update vinceliuice/WhiteSur-cursors

  info "Memasang WhiteSur KDE (global theme, Plasma style, Aurorae, Kvantum, wallpaper)"
  (cd "$SRC_DIR/WhiteSur-kde" && ./install.sh) || warn "Instalasi WhiteSur-kde bermasalah"

  info "Memasang WhiteSur GTK (agar aplikasi GTK ikut serasi)"
  (cd "$SRC_DIR/WhiteSur-gtk-theme" && ./install.sh) || warn "Instalasi WhiteSur-gtk bermasalah"
  (cd "$SRC_DIR/WhiteSur-gtk-theme" && ./install.sh -l -c "$VARIANT") \
    || warn "Tema libadwaita (GTK4) tidak terpasang — opsional"

  info "Memasang ikon & kursor WhiteSur"
  (cd "$SRC_DIR/WhiteSur-icon-theme" && ./install.sh) || warn "Instalasi ikon bermasalah"
  (cd "$SRC_DIR/WhiteSur-cursors" && ./install.sh) || warn "Instalasi kursor bermasalah"

  do_sddm_theme
}

# Pasang tema SDDM sendiri. Installer bawaan WhiteSur membaca versi Plasma
# lewat `plasmashell -v`, yang gagal di bawah sudo (tidak ada display) sehingga
# nama folder sumber jadi kosong ("WhiteSur-").
do_sddm_theme() {
  info "Memasang tema layar login SDDM"
  local src="$SRC_DIR/WhiteSur-kde/sddm" pv major minor ver color dest theme
  if [[ ! -d $src ]]; then
    clone_or_update vinceliuice/WhiteSur-kde
  fi

  # Versi Plasma dibaca sebagai user (di sesi grafis), fallback ke rpm
  pv=$(plasmashell -v 2>/dev/null | awk '{print $2}' || true)
  [[ -z $pv ]] && pv=$(rpm -q --qf '%{VERSION}' plasma6-workspace 2>/dev/null || true)
  major=$(cut -d. -f1 <<<"$pv"); minor=$(cut -d. -f2 <<<"$pv")
  major=${major//[^0-9]/}; minor=${minor//[^0-9]/}
  if   (( ${major:-0} >= 6 && ${minor:-0} < 2 )); then ver=6.0
  elif (( ${major:-0} == 5 )); then ver=5.0
  else ver=6.2; fi
  if [[ ! -d $src/WhiteSur-$ver ]]; then
    ver=$(find "$src" -maxdepth 1 -type d -name 'WhiteSur-*' -printf '%f\n' | sed 's/^WhiteSur-//' | sort -V | tail -n1)
  fi
  if [[ -z $ver || ! -d $src/WhiteSur-$ver ]]; then
    warn "Sumber tema SDDM tidak ditemukan di $src"
    return 0
  fi
  ok "Plasma ${pv:-?} → memakai tema SDDM WhiteSur-$ver"

  sudo mkdir -p /usr/share/sddm/themes
  for color in -light -dark; do
    dest="/usr/share/sddm/themes/WhiteSur$color"
    sudo rm -rf "$dest"
    sudo cp -r "$src/WhiteSur-$ver" "$dest"
    sudo cp "$src/images/background$color.jpeg" "$dest/background.jpeg"
    sudo cp "$src/images/preview$color.jpeg" "$dest/preview.jpeg"
    sudo sed -i "/Name=/s/WhiteSur/WhiteSur$color/; /Theme-Id=/s/WhiteSur/WhiteSur$color/" "$dest/metadata.desktop"
    sudo sed -i "s/WhiteSur/WhiteSur$color/g" "$dest/Main.qml"
    ok "Terpasang: $dest"
  done

  theme="WhiteSur-$VARIANT"
  sudo mkdir -p /etc/sddm.conf.d
  printf '[Theme]\nCurrent=%s\n' "$theme" | sudo tee /etc/sddm.conf.d/10-macos-theme.conf >/dev/null
  # /etc/sddm.conf dibaca paling akhir dan mengalahkan conf.d — samakan juga di sana
  if [[ -f /etc/sddm.conf ]] && grep -q '^Current=' /etc/sddm.conf; then
    sudo sed -i "s/^Current=.*/Current=$theme/" /etc/sddm.conf
  fi
  ok "Tema SDDM aktif: $theme (terlihat setelah logout/reboot)"
  return 0
}

# ---------- 4. terapkan tampilan --------------------------------------------
do_apply() {
  if ! in_kde_session; then
    warn "Bukan sesi KDE Plasma — lewati 'apply'. Login ke Plasma lalu jalankan: $0 apply"
    return 0
  fi
  find_qdbus || true
  info "Menerapkan tema WhiteSur ($VARIANT)"

  local lnf cs dt ic aur kv gtk wp

  lnf=$( (plasma-apply-lookandfeel --list 2>/dev/null || true) | pick_variant)
  if [[ -n $lnf ]]; then plasma-apply-lookandfeel -a "$lnf" >/dev/null && ok "Global theme: $lnf"; fi

  cs=$( (plasma-apply-colorscheme --list-schemes 2>/dev/null || true) \
        | sed -E 's/^ *\* *//; s/ *\(.*\)$//' | pick_variant)
  if [[ -n $cs ]]; then plasma-apply-colorscheme "$cs" >/dev/null && ok "Skema warna: $cs"; fi

  dt=$( (plasma-apply-desktoptheme --list-themes 2>/dev/null || true) \
        | sed -E 's/^ *\* *//; s/ *\(.*\)$//' | pick_variant)
  if [[ -n $dt ]]; then plasma-apply-desktoptheme "$dt" >/dev/null && ok "Plasma style: $dt"; fi

  ic=$( (ls -1 "$HOME/.local/share/icons" /usr/share/icons 2>/dev/null || true) | pick_variant)
  if [[ -n $ic ]]; then
    local changer=""
    for c in /usr/libexec/plasma-changeicons /usr/lib/libexec/plasma-changeicons /usr/lib64/libexec/plasma-changeicons; do
      [[ -x $c ]] && { changer=$c; break; }
    done
    if [[ -n $changer ]]; then "$changer" "$ic" >/dev/null 2>&1 || true
    else kwriteconfig6 --file kdeglobals --group Icons --key Theme "$ic"; fi
    ok "Ikon: $ic"
  fi

  if [[ -d $HOME/.local/share/icons/WhiteSur-cursors || -d /usr/share/icons/WhiteSur-cursors ]]; then
    plasma-apply-cursortheme WhiteSur-cursors >/dev/null 2>&1 && ok "Kursor: WhiteSur-cursors"
  fi

  # Dekorasi jendela + tombol ala macOS di kiri (tutup, minimize, maximize)
  aur=$( (ls -1 "$HOME/.local/share/aurorae/themes" 2>/dev/null || true) | pick_variant)
  for grp in org.kde.kdecoration2 org.kde.kdecoration3; do
    if [[ -n $aur ]]; then
      kwriteconfig6 --file kwinrc --group "$grp" --key library org.kde.kwin.aurorae
      kwriteconfig6 --file kwinrc --group "$grp" --key theme "__aurorae__svg__$aur"
    fi
    kwriteconfig6 --file kwinrc --group "$grp" --key ButtonsOnLeft "XIA"
    kwriteconfig6 --file kwinrc --group "$grp" --key ButtonsOnRight ""
  done
  ok "Dekorasi jendela: ${aur:-default} — tombol di kiri"

  # Efek: Magic Lamp saat minimize (seperti efek Genie macOS) + blur
  kwriteconfig6 --file kwinrc --group Plugins --key magiclampEnabled true
  kwriteconfig6 --file kwinrc --group Plugins --key squashEnabled false
  kwriteconfig6 --file kwinrc --group Plugins --key blurEnabled true
  ok "Efek Magic Lamp & blur aktif"

  # Gaya aplikasi Qt
  # Varian Kvantum adalah file .kvconfig di dalam folder tema (WhiteSur/WhiteSurDark.kvconfig)
  kv=$( (find "$HOME/.config/Kvantum" -mindepth 2 -maxdepth 2 -name '*.kvconfig' -printf '%f\n' 2>/dev/null || true) \
        | sed 's/\.kvconfig$//' | pick_variant)
  if [[ $KVANTUM == 1 && -n $kv ]] && command -v kvantummanager &>/dev/null; then
    kvantummanager --set "$kv" >/dev/null 2>&1 || \
      kwriteconfig6 --file Kvantum/kvantum.kvconfig --group General --key theme "$kv"
    kwriteconfig6 --file kdeglobals --group KDE --key widgetStyle kvantum
    ok "Gaya aplikasi: Kvantum ($kv)"
  else
    kwriteconfig6 --file kdeglobals --group KDE --key widgetStyle Breeze
    ok "Gaya aplikasi: Breeze"
  fi

  # Tema GTK
  gtk=$( (ls -1 "$HOME/.themes" "$HOME/.local/share/themes" 2>/dev/null || true) | pick_variant)
  if [[ -n $gtk ]]; then
    [[ -n $QDBUS ]] && $QDBUS org.kde.GtkConfig /GtkConfig org.kde.GtkConfig.setGtkTheme "$gtk" >/dev/null 2>&1 || true
    for v in 3.0 4.0; do
      mkdir -p "$HOME/.config/gtk-$v"
      kwriteconfig6 --file "gtk-$v/settings.ini" --group Settings --key gtk-theme-name "$gtk"
      [[ -n $ic ]] && kwriteconfig6 --file "gtk-$v/settings.ini" --group Settings --key gtk-icon-theme-name "$ic"
      kwriteconfig6 --file "gtk-$v/settings.ini" --group Settings --key gtk-cursor-theme-name WhiteSur-cursors
      kwriteconfig6 --file "gtk-$v/settings.ini" --group Settings --key gtk-application-prefer-dark-theme \
        "$([[ $VARIANT == dark ]] && echo true || echo false)"
    done
    if command -v gsettings &>/dev/null; then
      gsettings set org.gnome.desktop.interface gtk-theme "$gtk" 2>/dev/null || true
      gsettings set org.gnome.desktop.interface color-scheme \
        "$([[ $VARIANT == dark ]] && echo prefer-dark || echo prefer-light)" 2>/dev/null || true
    fi
    ok "Tema GTK: $gtk"
  fi

  # Font (Inter sebagai pengganti San Francisco)
  # Tanpa -q: grep -q berhenti lebih awal → fc-list kena SIGPIPE → gagal karena pipefail
  if fc-list : family 2>/dev/null | grep -iE '^Inter([ ,]|$)' >/dev/null; then
    local f10="Inter,10,-1,5,400,0,0,0,0,0,0,0,0,0,0,1"
    kwriteconfig6 --file kdeglobals --group General --key font "$f10"
    kwriteconfig6 --file kdeglobals --group General --key menuFont "$f10"
    kwriteconfig6 --file kdeglobals --group General --key toolBarFont "$f10"
    kwriteconfig6 --file kdeglobals --group General --key smallestReadableFont "Inter,8,-1,5,400,0,0,0,0,0,0,0,0,0,0,1"
    kwriteconfig6 --file kdeglobals --group WM --key activeFont "Inter,10,-1,5,600,0,0,0,0,0,0,0,0,0,0,1"
    ok "Font: Inter"
  else
    warn "Font Inter tidak ditemukan — font tidak diubah"
  fi

  # Wallpaper
  wp=$(find "$HOME/.local/share/wallpapers" -ipath '*whitesur*' \( -iname '*.jpg' -o -iname '*.png' \) 2>/dev/null \
       | { if [[ $VARIANT == dark ]]; then grep -i dark || true; else grep -vi dark || true; fi; } | sort | tail -n1)
  [[ -z $wp ]] && wp=$(find "$HOME/.local/share/wallpapers" -ipath '*whitesur*' \( -iname '*.jpg' -o -iname '*.png' \) 2>/dev/null | sort | tail -n1 || true)
  if [[ -n $wp ]]; then plasma-apply-wallpaperimage "$wp" >/dev/null 2>&1 && ok "Wallpaper: ${wp##*/}"; fi

  [[ -n $QDBUS ]] && $QDBUS org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
  return 0
}

# ---------- 5. tata letak ala macOS -----------------------------------------
do_layout() {
  if ! in_kde_session; then
    warn "Bukan sesi KDE Plasma — lewati 'layout'. Login ke Plasma lalu jalankan: $0 layout"
    return 0
  fi
  if ! find_qdbus; then
    warn "qdbus6 tidak ditemukan (paket qt6-tools-qdbus) — lewati 'layout'"
    return 0
  fi
  info "Membuat panel atas (menu global) dan dock bawah"

  # Aplikasi yang disematkan di dock (hanya yang memang terpasang)
  local launchers=() d dir js_launchers=""
  for d in org.kde.dolphin firefox org.mozilla.firefox google-chrome chromium code \
           org.kde.konsole org.kde.kate org.kde.discover systemsettings; do
    for dir in /usr/share/applications "$HOME/.local/share/applications" /var/lib/flatpak/exports/share/applications; do
      if [[ -f $dir/$d.desktop ]]; then launchers+=("applications:$d.desktop"); break; fi
    done
  done
  for d in "${launchers[@]}"; do js_launchers+="\"$d\","; done
  js_launchers="[${js_launchers%,}]"

  local js
  js=$(cat <<EOF
var old = panels();
for (var i = 0; i < old.length; i++) { old[i].remove(); }

// Panel atas: logo/menu, menu global aplikasi, spacer, tray, jam
var topBar = new Panel;
topBar.location = "top";
topBar.height = 30;
try { topBar.floating = false; } catch (e) {}
topBar.addWidget("org.kde.plasma.kickoff");
topBar.addWidget("org.kde.plasma.appmenu");
topBar.addWidget("org.kde.plasma.panelspacer");
topBar.addWidget("org.kde.plasma.systemtray");
var clock = topBar.addWidget("org.kde.plasma.digitalclock");
if (clock) {
  clock.currentConfigGroup = ["Appearance"];
  clock.writeConfig("showDate", true);
  clock.writeConfig("dateDisplayFormat", "BesideTime");
  clock.writeConfig("dateFormat", "custom");
  clock.writeConfig("customDateFormat", "ddd d MMM");
}

// Dock bawah: melayang, di tengah, menghindar dari jendela
var dock = new Panel;
dock.location = "bottom";
dock.height = 60;
try { dock.floating = true; } catch (e) {}
try { dock.alignment = "center"; } catch (e) {}
try { dock.lengthMode = "fit"; } catch (e) {}
try { dock.hiding = "dodgewindows"; } catch (e) {}
var tasks = dock.addWidget("org.kde.plasma.icontasks");
if (tasks) {
  tasks.currentConfigGroup = ["General"];
  tasks.writeConfig("launchers", $js_launchers);
}
dock.addWidget("org.kde.plasma.marginsseparator");
dock.addWidget("org.kde.plasma.trash");
EOF
)
  $QDBUS org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$js" >/dev/null
  ok "Panel atas + dock dibuat"
}

# ---------- 6. hapus GNOME --------------------------------------------------
do_remove_gnome() {
  info "Menghapus GNOME"

  if [[ ${XDG_CURRENT_DESKTOP:-} == *GNOME* ]]; then
    err "Anda sedang berada di sesi GNOME. Login ke Plasma dulu, lalu jalankan: $0 remove-gnome"
    return 1
  fi
  if gdm_running; then
    err "Sesi ini masih dijalankan oleh GDM. Menghapus GDM sekarang bisa mematikan sesi"
    err "di tengah proses zypper. Reboot dulu (SDDM sudah diaktifkan), login lewat SDDM,"
    err "lalu jalankan:  $0 remove-gnome"
    return 1
  fi

  # Pastikan tetap ada file manager & terminal setelah GNOME hilang
  pkg_install dolphin konsole

  # a) pattern GNOME yang terpasang
  local pats=()
  mapfile -t pats < <(zypper --no-refresh -q se -i -t pattern 2>/dev/null \
                      | awk -F'|' 'NR>2 { gsub(/ /,"",$2); if ($2 ~ /^gnome/) print $2 }')

  # b) inti GNOME (shell, session, GDM, settings, portal)
  local core=() p
  mapfile -t core < <( {
      rpm -qa --qf '%{NAME}\n' 'gdm*' 'gnome-shell*' 'gnome-session*' 'mutter*' \
          'gnome-control-center*' 'gnome-settings-daemon*' 'gnome-initial-setup*' \
          'gnome-tour*' 'xdg-desktop-portal-gnome*' 'gnome-remote-desktop*' \
          'gnome-browser-connector*' 'gnome-user-share*' 2>/dev/null || true
    } | sort -u)

  # c) aplikasi bawaan GNOME
  local app_cands=(nautilus gnome-terminal gnome-console gnome-text-editor gedit
    gnome-calendar gnome-contacts gnome-maps gnome-weather gnome-clocks gnome-calculator
    gnome-system-monitor gnome-disk-utility gnome-characters gnome-font-viewer gnome-logs
    gnome-music gnome-photos gnome-boxes gnome-connections gnome-user-docs gnome-software
    gnome-packagekit gnome-tweaks gnome-extensions yelp totem loupe eog evince papers
    epiphany baobab simple-scan snapshot cheese decibels showtime file-roller sushi
    gnome-chess gnome-mahjongg gnome-mines gnome-sudoku aisleriot quadrapassel iagno
    lightsoff swell-foop tali gnome-2048 polari)
  local apps=()
  for p in "${app_cands[@]}"; do is_installed "$p" && apps+=("$p"); done
  while IFS= read -r p; do [[ -n $p ]] && apps+=("$p"); done \
    < <(rpm -qa --qf '%{NAME}\n' 'nautilus-*' 'gnome-shell-extension*' 2>/dev/null | sort -u || true)

  # Paket bahasa (-lang) milik paket yang dihapus
  local langs=()
  for p in "${core[@]}" "${apps[@]}"; do is_installed "$p-lang" && langs+=("$p-lang"); done

  # gnome-keyring sengaja DIPERTAHANKAN (dipakai Chrome, VS Code, dll. lewat libsecret)

  if ((${#pats[@]})); then
    echo "Pattern yang akan dihapus: ${pats[*]}"
    sudo zypper rm -t pattern "${pats[@]}" || warn "Penghapusan pattern dibatalkan/gagal"
  fi

  if ((${#core[@]})); then
    echo
    echo "Paket inti GNOME (${#core[@]}): ${core[*]}"
    echo "zypper akan menampilkan daftar LENGKAP (termasuk paket yang ikut terhapus)."
    echo "Periksa baik-baik: kalau ada paket KDE/Plasma ikut terhapus, jawab 'n'."
    sudo zypper rm "${core[@]}" || warn "Penghapusan inti GNOME dibatalkan/gagal"
  else
    ok "Inti GNOME sudah tidak terpasang"
  fi

  if ((${#apps[@]})); then
    echo
    echo "Aplikasi bawaan GNOME (${#apps[@]}): ${apps[*]}"
    if confirm "Hapus juga aplikasi bawaan GNOME ini?"; then
      sudo zypper rm "${apps[@]}" || warn "Penghapusan aplikasi dibatalkan/gagal"
    fi
  fi

  local still_langs=()
  for p in "${langs[@]}"; do is_installed "$p" && still_langs+=("$p"); done
  if ((${#still_langs[@]})); then
    sudo zypper -n rm "${still_langs[@]}" >/dev/null 2>&1 && ok "Paket bahasa sisa dibersihkan" || true
  fi

  info "Mengunci GNOME agar tidak terpasang lagi saat 'zypper dup'"
  sudo zypper -q al -t pattern gnome gnome_basic gnome_x11 >/dev/null 2>&1 || true
  sudo zypper -q al gdm gnome-shell >/dev/null 2>&1 || true
  ok "Kunci ditambahkan (lihat: zypper ll, lepas: sudo zypper rl <nama>)"

  echo
  echo "Tip: cek paket yatim dengan  sudo zypper packages --unneeded"
  echo "     (periksa manual sebelum menghapus, jangan hapus massal)."
}

# ---------- main ------------------------------------------------------------
main() {
  if [[ $EUID -eq 0 ]]; then
    err "Jangan jalankan sebagai root. Jalankan sebagai user biasa; skrip memakai sudo bila perlu."
    exit 1
  fi
  if ! grep -qi tumbleweed /etc/os-release 2>/dev/null; then
    warn "Skrip ini dirancang untuk openSUSE Tumbleweed."
    confirm "Lanjutkan?" || exit 1
  fi
  [[ $VARIANT == dark || $VARIANT == light ]] || { err "VARIANT harus dark atau light"; exit 1; }

  local cmd="${1:-help}"
  case $cmd in
    backup)        do_backup ;;
    dm)            sudo -v; do_dm ;;
    apps)          sudo -v; do_apps ;;
    theme)         sudo -v; do_theme ;;
    sddm-theme)    sudo -v; do_sddm_theme ;;
    apply)         do_apply ;;
    layout)        do_layout ;;
    remove-gnome)  sudo -v; do_remove_gnome ;;
    all)
      sudo -v
      do_backup
      do_dm
      do_apps
      do_theme
      do_apply
      do_layout
      if gdm_running; then
        warn "Sesi ini masih lewat GDM — penghapusan GNOME ditunda demi keamanan."
        warn "Reboot, login lewat SDDM, lalu jalankan:  $0 remove-gnome"
      else
        do_remove_gnome || true
      fi
      info "Selesai. Logout & login lagi (atau reboot) agar semua perubahan berlaku."
      ;;
    *)
      awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
      ;;
  esac
}

main "$@"
