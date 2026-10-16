<div align="center">

<img src="resources/icon.png" alt="F95 Game Manager" width="96" />

# F95 Game Manager

**A desktop library for F95zone games: browse, follow, download, install, play and back up, all in one window.**

[![Latest release](https://img.shields.io/github/v/release/yksok47/f95-gamemanager?label=release)](https://github.com/yksok47/f95-gamemanager/releases/latest)
[![Release build](https://img.shields.io/github/actions/workflow/status/yksok47/f95-gamemanager/release.yml?label=build)](https://github.com/yksok47/f95-gamemanager/actions/workflows/release.yml)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-informational)

[Download](https://github.com/yksok47/f95-gamemanager/releases/latest) · [Features](#features) · [Privacy](#privacy-and-network-access) · [Development](#development)

</div>

---

## Why

I built this for myself. I wanted a game manager that looks good, is easy to use and needs almost no setup: you sign in to F95zone once and that's it. It handles the tedious parts for you: following threads, picking the right download mirror, extracting archives, keeping several versions side by side, and making sure your saves survive when you delete or replace a game folder.

It works well for me, so here it is in case it's what you're looking for too.

> [!NOTE]
> This is an unofficial, community-made tool. It isn't affiliated with F95zone. You need your own F95zone account, and the games it manages are adult (18+) content.

## Features

### Discover

- **Catalog**: browse and search F95zone with tag, prefix and engine filters, quick filters and favorite or hated tags.
- **Game details**: overview, gallery, changelog, reviews, thread posts (with a BBCode composer) and your own notes.
- **Follow and get updates**: follow games and see when their threads change on the **Updates** page.
- **Roster**: rate and order the games you've played into your own ranked list.

### Download and install

- **One-click downloads** from the links in the thread, with built-in support for MEGA, Google Drive, MediaFire, Pixeldrain, GoFile, Buzzheavier, DataNodes, Workupload, UploadHaven, VikingFile, Mixdrop and more.
- **Mirror priority**: choose which file hosts you prefer and the app picks the best available link.
- **Built-in ad blocking** on file-host pages, plus a guard against unexpected executable downloads.
- **Automatic extraction and install** (zip, 7z, rar) straight into your library.
- **Version management**: keep several versions of a game installed instead of overwriting the last folder.
- **Mods and patches**: install walkthrough mods and uncensor patches, and remove them again.
- **Import an existing library**: point it at folders you already have, or paste a list of thread links.
- **Storage overview**: see how much disk space each game and version uses.

### Play and keep your saves

- **Launch from the app**: native games, plus HTML games in a dedicated window with their saves kept.
- **Ren'Py tools**: built-in UnRen to unpack RPA archives and decompile scripts, using the game's own Python.
- **Save management** for Ren'Py, RPG Maker and HTML games, including **save editors** for Ren'Py and RPG Maker.
- **Automatic RPG Maker save backup**, so saves aren't lost when a game folder is replaced.
- **Cloud saves on Google Drive** (optional): back up saves and sync your follows, roster, notes and settings between computers.

### Share (optional)

- **Peer-to-peer downloads**: when you turn on P2P, files other users already downloaded show up as an extra mirror, and you can seed your own archives back. P2P is **off by default**.

### Stay current

- **Built-in updater** that checks this repository's GitHub releases and updates the app in place.

## Install

Grab the latest build from the [**Releases**](https://github.com/yksok47/f95-gamemanager/releases/latest) page:

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `f95-gamemanager-<version>-setup.exe` | Standard installer. A portable `win-unpacked.zip` is also available. |
| Linux | `f95-gamemanager-<version>-linux-x86_64.AppImage` | Run `chmod +x` on the file, then start it. |
| macOS | `f95-gamemanager-<version>-mac-<arch>.dmg` | The build is unsigned: right-click the app and pick **Open** the first time. |

On first launch, sign in to F95zone and pick a library folder. That's all the setup there is.

## Privacy and network access

The app has no account system and no telemetry. These are the services it talks to, and why:

| Service | When | Why |
| --- | --- | --- |
| **F95zone** | Always | Catalog, thread data, follows and sign-in. Your F95zone credentials are only ever sent to F95zone. |
| **File hosts** (MEGA, Google Drive, MediaFire, …) | When you download | To fetch the files you picked. |
| **GitHub** | On update checks | To look for new app releases. |
| **Game metadata service** | When you open a game's downloads, download or install | Looks up and shares which file a download link served, plus install tags and broken or harmful flags, so links and versions can be matched for everyone. Requests are signed with an anonymous key that's generated locally and never linked to your F95zone account. |
| **P2P tracker and STUN** (Google, Cloudflare) | Only with P2P on | To find peers and set up direct WebRTC connections. File data goes directly between users, never through a server. |
| **Google Drive** | Only if you sign in under **Settings → Cloud** | Stores save backups and synced user data in the app's private Drive folder (`drive.appdata` scope). The app can't see the rest of your Drive. |

You don't have to take this on trust: **Settings → Request log** lists every request sent to F95zone and the metadata service, with the full headers and bodies of both the request and the response. Passwords, form tokens and cookies are hidden there.

Sensitive local data is encrypted at rest:

- The **Google Drive tokens** are encrypted with a key held in the computer's **TPM** on Windows. The token file is useless if it's copied to another machine. If no TPM is available, the app falls back to the OS keychain (DPAPI, macOS Keychain or the Linux Secret Service). If none of these exist, the sign-in is kept in memory only and never written to disk.
- The **anonymous P2P identity key** is encrypted with the OS keychain when one is available.

## Development

You need [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

### Useful scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the app with hot reload |
| `bun run dev:both` | Start two instances with separate user data, for testing P2P locally |
| `bun run typecheck` | Type-check the main and renderer processes |
| `bun run test:p2p` | Run the P2P and download-link unit tests |
| `bun run test:parser` | Run the F95zone parser tests against saved page samples |
| `bun run parser:fetch` | Refresh the parser samples from live pages |
| `bun test <path>` | Run any other `*.test.ts` file next to the code |

### Google Drive in development

Cloud saves need a Google OAuth **desktop** client. Put its JSON at `resources/google-oauth.json` (this file is git-ignored), or drop the `client_secret_*.apps.googleusercontent.com.json` file Google gives you into the project root.

### Building installers

```bash
bun run build:win
```

```bash
bun run build:linux
```

```bash
bun run build:mac
```

Output goes to `dist/`. Native modules such as WebRTC are compiled per OS, so build each platform on that platform.

### Releasing

Push a tag like `v1.2.3`. The [release workflow](.github/workflows/release.yml) builds Windows, Linux and macOS artifacts on matching runners and attaches them to a GitHub release. It needs the `GOOGLE_OAUTH_JSON` repository secret, which holds the contents of `resources/google-oauth.json`.

### Project layout

```
src/
├── main/        Electron main process
│   ├── f95/           F95zone session, HTTP, scraping and page parsers
│   ├── cloud-saves/   Google Drive sign-in and save sync
│   ├── cloud-user-data/  Sync of follows, roster, notes and settings
│   ├── p2p/           WebTorrent, tracker and metadata clients
│   ├── renpy/ rpgmaker/ html-game/   Engine-specific saves, tools and launching
│   └── *.ts           Downloads, file-host connectors, install, launch, storage
├── preload/     The `window.api` bridge exposed to the UI
├── renderer/    React UI (pages, components, view logic)
└── shared/      Types and helpers used by both processes
resources/       Bundled UnRen tools, certificates and icons
docs/            Design notes (see docs/p2p.md)
```

## Acknowledgements

The Ren'Py tooling bundles [rpatool](https://github.com/Shizmob/rpatool), [unrpyc](https://github.com/CensoredUsername/unrpyc) and `rpa.py` as distributed with UnRen. See [resources/unren/README.md](resources/unren/README.md) for details.
