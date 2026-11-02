# Installing and Using Sahamati (Linux)

Sahamati is a desktop application (Tauri) for generating, reviewing, and
maintaining software-development-process artefacts with Claude-driven agents.
This guide covers installing and running the **Linux x86_64** build.

The build ships in three formats — pick the one for your distribution:

| File | Best for |
|---|---|
| `Sahamati_0.2.0_amd64.deb` | Debian, Ubuntu, Linux Mint, Pop!_OS |
| `Sahamati-0.2.0-1.x86_64.rpm` | Fedora, RHEL, CentOS Stream, openSUSE |
| `Sahamati_0.2.0_amd64.AppImage` | Any distribution (portable, no install) |

> Architecture: these are **x86_64 (amd64)** binaries. They do not run on
> arm64/aarch64 Linux or on macOS/Windows.

---

## 1. Requirements

- A 64-bit (x86_64) Linux desktop with a graphical session.
- **WebKitGTK 4.1** and GTK 3 at runtime. The `.deb` and `.rpm` declare these
  as dependencies, so your package manager installs them automatically. For the
  AppImage, GTK is bundled, but very minimal systems may still need
  `libwebkit2gtk-4.1-0` present.
- For the AppImage only: **FUSE** (`libfuse2` on most distros) to mount the
  image at runtime — or run it in extract mode (see Troubleshooting).

---

## 2. Get the package

The installers are produced by the **Linux build** GitHub Actions workflow and
attached to each run as the `sahamati-linux-bundles` artifact. With the GitHub
CLI (requires read access to the repository):

```bash
gh run download --repo suyeshshankar-eng/sahamati-core \
  --name sahamati-linux-bundles -D ./sahamati-linux
```

This extracts:

```
sahamati-linux/deb/Sahamati_0.2.0_amd64.deb
sahamati-linux/rpm/Sahamati-0.2.0-1.x86_64.rpm
sahamati-linux/appimage/Sahamati_0.2.0_amd64.AppImage
```

> Tip: CI artifacts expire and require repository access. For wider
> distribution, publish these files to a GitHub Release and link them here.

---

## 3. Install

### Debian / Ubuntu (.deb)

```bash
sudo apt install ./Sahamati_0.2.0_amd64.deb
```

`apt` resolves the WebKitGTK/GTK dependencies for you. (On older systems without
`apt install ./file`, use `sudo dpkg -i Sahamati_0.2.0_amd64.deb` followed by
`sudo apt-get -f install` to pull dependencies.)

### Fedora / RHEL / openSUSE (.rpm)

```bash
sudo dnf install ./Sahamati-0.2.0-1.x86_64.rpm
# openSUSE:
sudo zypper install ./Sahamati-0.2.0-1.x86_64.rpm
```

### Any distribution (AppImage, no install)

```bash
chmod +x Sahamati_0.2.0_amd64.AppImage
./Sahamati_0.2.0_amd64.AppImage
```

The AppImage is self-contained and leaves your system untouched — move it
wherever you like and double-click or run it from a terminal.

---

## 4. First run

After installing the `.deb`/`.rpm`, launch **Sahamati** from your application
menu, or run `sahamati` from a terminal. (The AppImage launches by running the
file directly.)

On launch the app starts a local background service (the bundled
`agent-server`) and opens the main window. Sign in when prompted; the app
supports two-factor authentication (TOTP) and GitHub sign-in.

To run the Claude-powered agents you need an **Anthropic API key**:

1. Open **Settings → Secrets** in the app.
2. Add your Anthropic API key.

The key is held by the local service and used when you run agents. Without it,
the app still opens but agent runs will fail.

---

## 5. Using the app

1. **Create a project** from the project list.
2. **Run an agent** (discovery, requirements, security, etc.) against the
   project to generate process artefacts.
3. **Browse generated documents** in the app; output is organised by category.

The templates the agents start from (BRD, FRD, user story, architecture,
security assessment) ship with the app and shape the structure of what's
produced.

---

## 6. Updating

- **.deb / .rpm:** install the newer package the same way; it upgrades in place.
- **AppImage:** replace the old `.AppImage` file with the new one.

## 7. Uninstalling

```bash
# Debian / Ubuntu
sudo apt remove sahamati

# Fedora / RHEL / openSUSE
sudo dnf remove sahamati
```

For the AppImage, just delete the file.

---

## 8. Troubleshooting

**AppImage: "Cannot mount AppImage" / dlopen libfuse error.**
Install FUSE, or run without it:

```bash
# Install FUSE (Debian/Ubuntu)
sudo apt install libfuse2
# Or run in extract-and-run mode (no FUSE needed)
./Sahamati_0.2.0_amd64.AppImage --appimage-extract-and-run
```

**App won't start / blank window (WebKitGTK missing).**
Install WebKitGTK 4.1:

```bash
sudo apt install libwebkit2gtk-4.1-0     # Debian/Ubuntu
sudo dnf install webkit2gtk4.1            # Fedora
```

**AppImage fails to launch on a sandboxed/older system.**
Some environments need `--no-sandbox`. Try:

```bash
./Sahamati_0.2.0_amd64.AppImage --no-sandbox
```

---

## Notes and limitations

- These builds are **x86_64 only**. arm64 Linux needs a separate build.
- **Video generation is disabled** in these builds (the ffmpeg component is not
  bundled); all other features work.
