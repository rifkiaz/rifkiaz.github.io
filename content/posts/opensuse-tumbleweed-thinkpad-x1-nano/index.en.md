---
title: "openSUSE Tumbleweed on a ThinkPad X1 Nano: Fixing GDM Scaling, the Microphone, and the Speakers"
slug: "opensuse-tumbleweed-thinkpad-x1-nano"
date: 2026-08-26T20:31:00+07:00
categories: [tutorial]
tags: [openSUSE, tumbleweed, gnome, gdm, thinkpad, audio, pipewire, linux]
description: "Troubleshooting notes for openSUSE Tumbleweed on a ThinkPad X1 Nano Gen 1: a GDM login screen stuck at 150%, a microphone that vanished after installing sof-firmware, and speakers that sound quiet."
---
### Introduction
A while ago I installed openSUSE Tumbleweed with GNOME on a ThinkPad X1 Nano Gen 1 (a small laptop that's really nice to carry around). Overall it went smoothly, but three things kept me tinkering for quite a while:

1. The login screen (GDM) stayed scaled at 150%, even though the GNOME session was at 100%.
2. The microphone disappeared after installing `sof-firmware`.
3. The X1 Nano has 4 speakers, but only 2 were "detected" and it sounded quiet compared to Windows.

In this post I'll share what turned out to be the cause of each, including the dead ends I went down. Maybe someone out there has the same problem.

### Requirements
- openSUSE Tumbleweed with GNOME
- A ThinkPad X1 Nano Gen 1 (or a laptop with similar audio hardware)
- `sudo` access

### 1. GDM Stuck at 150%
The X1 Nano's panel is 2160×1350 on a 13-inch screen, so GNOME picks 150% scaling automatically. In the desktop session I changed it to 100% in **Settings > Displays**, fine. But the login screen stayed at 150%.

The root cause: GDM runs as its own `gdm` user with a separate config, so your user's display settings don't carry over. The classic fix is to copy `~/.config/monitors.xml` into the `gdm` user's home.

#### Make sure `monitors.xml` is right
This file is only created once you've pressed **Apply** in Settings > Displays. Check what's in it:
```
cat ~/.config/monitors.xml
```

The thing to look at is the `<scale>` value. If it's still `1.5`, copying it to GDM won't change anything. Mine looked roughly like this (vendor/product simplified):
```
<monitors version="2">
  <configuration>
    <layoutmode>logical</layoutmode>
    <logicalmonitor>
      <x>0</x>
      <y>0</y>
      <scale>1</scale>
      <primary>yes</primary>
      <monitor>
        <monitorspec>
          <connector>eDP-1</connector>
          <vendor>...</vendor>
          <product>...</product>
          <serial>...</serial>
        </monitorspec>
        <mode>
          <width>2160</width>
          <height>1350</height>
          <rate>59.744</rate>
        </mode>
      </monitor>
    </logicalmonitor>
  </configuration>
</monitors>
```

Better not to write this file by hand. `connector`, `vendor`, `product`, `serial`, and `rate` have to match exactly what mutter reports. If even one is off (say, `rate` rounded to `60`), mutter silently throws away the whole config and falls back to auto-scaling.

#### Trap 1: multi-line paste in the terminal
This is a bit embarrassing, but worth telling (I really embarrassed myself). I was sure I'd copied the file, but `ls` said it wasn't there. Looking again, the lines I'd pasted all at once had stuck together into one (`... restart display-manageruser@host:~>`), so the `cp` never actually ran.

If your terminal has trouble with multi-line pastes, just chain everything with `&&` on one line, plus a marker at the end so you can see whether it worked:
```
sudo cp ~/.config/monitors.xml /var/lib/gdm/.config/ && sudo chown -R gdm:gdm /var/lib/gdm/.config && sudo restorecon -Rv /var/lib/gdm/.config && echo SUCCESS
```

#### Trap 2: SELinux
Tumbleweed now defaults to SELinux enforcing (you can tell from the dot at the end of the permissions, like `-rw-r--r--.`). A file `cp`'d from your home can carry the `user_home_t` context, which GDM may not be allowed to read. That's why there's a `restorecon` in the command above. Check the result:
```
sudo ls -laZ /var/lib/gdm/.config/
```

The context should be `xdm_var_lib_t` and the owner `gdm gdm`.

#### Trap 3: the path moved in newer GDM
Even after the file really existed, with the right owner and SELinux context, and the display manager restarted, the login screen was *still* at 150%. `journalctl` didn't mention a monitor config at all, which means the file was never read.

According to reports on the GDM issue tracker, since GDM 49 the file `/var/lib/gdm/.config/monitors.xml` isn't read anymore. My system runs mutter 50, so it definitely applied. Check your version with:
```
mutter --version
```

There are two locations you can try. The cleanest is the system-wide fallback in `/etc/xdg`, because it doesn't depend on the `gdm` home at all:
```
sudo cp ~/.config/monitors.xml /etc/xdg/monitors.xml && sudo chmod 644 /etc/xdg/monitors.xml && echo OK
```

If that doesn't do it, try the new per-seat location:
```
sudo mkdir -p /var/lib/gdm/seat0/config && sudo cp ~/.config/monitors.xml /var/lib/gdm/seat0/config/ && sudo chown -R gdm:gdm /var/lib/gdm/seat0/config && sudo restorecon -Rv /var/lib/gdm/seat0/config && echo OK
```

Then restart the display manager. Careful, this closes your running session right away, so save your work first:
```
sudo systemctl restart display-manager
```

There are also reports that the permissions on the `seat0/config` directory can reset themselves, so personally I prefer `/etc/xdg`.

#### About dconf
Lots of tutorials suggest an override through `/etc/dconf/db/gdm.d/` (for example turning off mutter's `experimental-features` or setting `scaling-factor`). On openSUSE, the `/etc/dconf/profile/gdm` file doesn't exist by default, so that dconf database isn't used at all. On top of that, the ArchWiki warns that changing mutter's `experimental-features` can make `monitors.xml` incompatible. If you created a file like that, just delete it:
```
sudo rm /etc/dconf/db/gdm.d/10-scale && sudo dconf update
```

One more note: at scale 1, the login screen runs at the full 2160×1350, so the text feels small on a 13-inch panel. That's the natural trade-off of choosing 100%.

### 2. The Microphone Vanished After Installing `sof-firmware`
After installing `sof-firmware`, the microphone went "mute". Before digging deep, check the most trivial thing first: ThinkPads have a mic mute key (F4) with an orange LED, and its state survives reboots.

If that's not it, check layer by layer from the kernel up.

**Kernel / SOF.** Make sure the firmware and topology load without errors:
```
sudo dmesg | grep -i -E "sof|snd_soc|firmware" | head -30
```

On mine, the kernel side was actually perfect:
```
DMICs detected in NHLT tables: 4
Topology file: intel/sof-tplg/sof-hda-generic-4ch.tplg
```

**PipeWire.** See what it recognizes as input sources:
```
wpctl status
```

Under **Sources** there was only "HD Audio Stereo", no "Digital Microphone". And `wpctl get-volume @DEFAULT_AUDIO_SOURCE@` errored with `'-1' is not a valid ID`. So the problem wasn't mute; the mic simply wasn't being exposed.

**UCM.** Here's the culprit:
```
zypper info alsa-ucm-conf sof-firmware
```

It turned out `alsa-ucm-conf` was **not installed**. UCM (Use Case Manager) is the layer that tells PipeWire/WirePlumber *how* to expose the DMIC array as an input device. Without UCM, WirePlumber only sees a generic HDA path.

The fix is just to install these packages and restart WirePlumber:
```
sudo zypper install alsa-ucm-conf alsa-utils
systemctl --user restart wireplumber pipewire pipewire-pulse
```

I installed `alsa-utils` too because `alsamixer` and `alsactl` weren't there either. After the restart, `wpctl status` immediately showed **Digital Microphone** as the default source. As a bonus, the sinks were right too: from a single generic "Stereo" to Speaker plus several HDMI/DisplayPort outputs. So the missing UCM was breaking both input and output.

Voilà, the mic is back. A quick mic test:
```
arecord -f cd -d 5 /tmp/test.wav && aplay /tmp/test.wav
```

If it's still silent, open `alsamixer -c 0`, press F4 for the Capture view, and make sure `Dmic0` isn't showing `MM` (muted).

Since `alsa-ucm-conf` usually comes in as a dependency, it going missing is a bit odd. Once everything's fixed, it's worth running `sudo zypper dup` to make sure no other packages were left behind.

### 3. Four Speakers, but Only Two?
The X1 Nano has 2 tweeters on top and 2 woofers underneath, driven by a Realtek ALC287 codec through two DACs. PipeWire only showed a stereo sink, so I assumed two speakers weren't working.

First check the mixer controls:
```
amixer -c 0 scontrols
for c in Master Speaker "Bass Speaker" DAC1 DAC2 "Auto-Mute Mode"; do amixer -c 0 sget "$c"; done
```

On mine, `Speaker` and `Bass Speaker` were already `[on]`, `DAC1` and `DAC2` were both at 100%, and `Auto-Mute Mode` was already `Disabled`. Nothing to fix.

It turns out all four speakers **were already playing**. They're wired as two stereo pairs fed the same stream, so it's normal for PipeWire to show just one stereo sink. To prove it: play some sound, then mute one of the pairs from another terminal.
```
speaker-test -D hw:0,0 -c 2 -t wav -l 10
```
```
amixer -c 0 sset 'Bass Speaker' mute     # sound gets thin? then the woofers are working
amixer -c 0 sset 'Bass Speaker' unmute
```

If muting each pair changes the sound, all four speakers are working. No need to force a kernel quirk like `model=alc285-speaker2-to-dac1`. That quirk can actually lower the maximum volume and mess up the volume controls.

#### Why is it quieter than on Windows?
On Windows, Lenovo ships a DSP layer (Dolby / Realtek audio effects) that does compression, bass boost, and limiting. The same speakers end up sounding much louder and fuller. On Linux, what you hear is the raw output with no processing. A few things you can do:

**Turn up Master.** Mine was still at 82% (-12 dB):
```
amixer -c 0 sset Master 100% && sudo alsactl store
```

**Over-amplification.** Turn it on in Settings > Sound so the volume can go up to 150%. Remember, above 100% is pure digital gain, so it can distort if you overdo it.

**EasyEffects.** This gets closest to the Windows experience:
```
sudo zypper install easyeffects
```

In the Output tab, add a **Bass Enhancer > Compressor > Limiter** chain, then enable "Start Service at Login". The compressor lifts the quiet parts without making the loud parts distort, and the limiter prevents clipping. You can also look for community presets for the X1 Nano or X1 Carbon Gen 9 (similar audio hardware) and drop them in `~/.config/easyeffects/output/`.

Keep expectations realistic though. The X1 Nano's speakers really are small, and part of the "loudness" on Windows is a psychoacoustic effect from bass boost, not real power.

### Summary
| Problem | Cause | Fix |
|---|---|---|
| GDM stuck at 150% | Since GDM 49, `/var/lib/gdm/.config/monitors.xml` isn't read | Copy `monitors.xml` to `/etc/xdg/` (or `/var/lib/gdm/seat0/config/`) |
| Microphone gone | `alsa-ucm-conf` not installed | `zypper install alsa-ucm-conf alsa-utils`, restart WirePlumber |
| "Only 2" speakers | Normal, 4 speakers = 2 stereo pairs | No quirk needed; use EasyEffects for loudness |

The biggest lesson for me: don't assume a command ran. Check the result (`ls`, `echo $?`, `journalctl`) before moving on to the next guess. Half my time went to a `cp` that never actually executed.

That's it, hope it helps.

References:
- [ArchWiki: GDM](https://wiki.archlinux.org/title/GDM)
- [ArchWiki: Lenovo ThinkPad X1 Nano](https://wiki.archlinux.org/title/Lenovo_ThinkPad_X1_Nano)
