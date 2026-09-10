# F95 Game Manager

## Overview

F95 Game Manager is a desktop game manager built around F95zone. It scrapes thread data so you can follow games, browse the catalog, download and install releases, launch them from one UI, and keep versions and saves under control — especially Ren'Py and RPG Maker titles.

Basically I created this for myself, since I wanted something that looks nice, is easy to use, doesn't require a ton of configuration (you only need to login to F95zone once at the start), doesn't call some external services (apart from F95zone obviously), that would make managing the downloads of the games and keeping the saves organised and backed up.

I'll be looking at feasibility of implementing "patching" in a future version, but since it is not really a standardized process, with different links, different installation processes, especially if the game engine is something other than Ren'Py, it might be tricky to pull off.

Since it's already created, why not share it? Maybe you are looking for just this flavor of tool, if so then here you go:

|                  |                             |
| ---------------- | --------------------------- |
| **Version**      | v1.0.1                      |
| **Release Date** | 2026-09-26                  |
| **OS**           | Windows                     |
| **Language**     | English                     |
| **Type**         | Game manager / library tool |

## Features

- **Modern UI** — Clean, readable interface instead of a pile of folders and bookmarks.
- **Follow games** — Track titles you care about and see when threads update.
- **Browse F95zone** — Search and browse games from the app using scraped site data.
- **Download & install** — Pull releases and install them into your library without the usual extract-and-hope workflow.
- **Launch from the UI** — Start installed games directly from the manager.
- **Version management** — Keep multiple versions organized instead of overwriting the last folder and losing track of what you have.
- **Ren'Py unpack / decompile** — Integrated UnRen for unpacking and decompiling Ren'Py games.
- **Save management** — Handle Ren'Py and RPG Maker saves from the app.
- **RPG Maker save backup** — Backs up RPG Maker saves so you don't have to copy files by hand before deleting or replacing a game folder.

## Run

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

## Package (Windows installer)

```bash
bun run build:win
```

The NSIS setup appears in `dist/`. Ordinary users can install it like any other desktop app.

## Layout

- `src/main` — Electron main process: windows, IPC, F95zone HTTP/session, downloads, install, launch, Ren'Py/UnRen, saves
- `src/preload` — renderer API (`window.api`)
- `src/renderer` — React UI (library, catalog, followed, downloads, settings, game details)
- `src/shared` — types and helpers used by both processes
