# P2P scaffolding (phase 1)

## Stack
- **WebTorrent ≥2.3** in Electron **main** only (Node). Not renderer. Not webtorrent-hybrid.
- Magnet + `seed(path)`. Announce list = `TRACKER_ANNOUNCE_URL` (+ optional UDP).
- **Fallback (not built):** aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.

## Env (Tracker compose)
```
TRACKER_ANNOUNCE_URL=http://localhost:6969/announce
METADATA_BASE_URL=http://localhost:8080
TRACKER_ANNOUNCE_UDP_URL=udp://localhost:6969/announce   # optional
```

## Dual hash
- `contentHash` = SHA-256 file bytes (metadata index / matching)
- `infoHash` = BT/WebTorrent SHA-1 info dict (swarm key)

## Identity
- Ed25519 in `safeStorage`; `seederPubkey` = lowercase hex 64 chars
- Share-claim v1 signed messages for metadata POST /packages
- Never send F95 credentials

## Settings
- `p2pEnabled` default **false**. When on → seed all local packages (torrent map).

## Windows spike notes (2026-09-11)

- webtorrent@2.8.5 installs via bun, but postinstall / electron-builder install-app-deps fails without Visual Studio Build Tools (node-gyp).
- Runtime import fails on missing native 
ode-datachannel (uild/Release/node_datachannel.node) and optional ufferutil rebuild.
- **Blocker:** install VS Build Tools with "Desktop development with C++", then re-run un run postinstall / @electron/rebuild for Electron 44, then re-spike seed(path) on a 1–5GB file.
- Fallback (not built): aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.
