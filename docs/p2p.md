# P2P scaffolding (phase 1)

## Stack
- **WebTorrent >=2.3** in Electron **main** only (Node). Not renderer. Not webtorrent-hybrid.
- Magnet + `seed(path)`. Announce list = `TRACKER_ANNOUNCE_URL` (+ optional UDP).
- **Fallback (not built):** aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.

## Env (Tracker compose — sibling repo `C:\Repos\p2p-tracker`)
```
TRACKER_ANNOUNCE_URL=http://localhost:6969/announce
METADATA_BASE_URL=http://localhost:8080
TRACKER_ANNOUNCE_UDP_URL=udp://localhost:6969/announce   # optional
```

## Dual hash
- `contentHash` = SHA-256 file bytes (metadata index / matching)
- `infoHash` = BT/WebTorrent SHA-1 info dict (swarm key)
- No metadata `POST /announce` — swarm announce is WebTorrent → opentracker only.

## Metadata REST (`METADATA_BASE_URL`)
- `GET /health`
- `POST /api/v1/packages` — share-claim v1 body (dual-hash + seederPubkey + base64 sig)
- `GET /api/v1/packages/{contentHash}`
- `GET /api/v1/packages?normalizedName=` or `?infoHash=` → `{ items: [...] }`
- `POST /api/v1/packages/{contentHash}/flags` — body `{ flags: ["broken"|"harmful"], seederPubkey, note? }`
- Popularity = `uniqueSeederPubkeyCount` (unique seeder pubkeys). Flags: `broken` | `harmful`.

## Share-claim v1
```
f95-gm:share:v1
contentHash=<hexSHA256>
infoHash=<hexSHA1 or empty>
normalizedName=<name>
ts=<unixSeconds>
```
- `seederPubkey`: lowercase hex 64 chars (raw Ed25519)
- `signature`: standard base64 of raw 64-byte Ed25519 sig over message UTF-8 bytes
- Tracker verify is format-only for now (bad sig not rejected yet)

## Identity
- Ed25519 in `safeStorage`; never send F95 credentials

## Settings / local seed path
- `p2pEnabled` default **false**. When on → sync game-files `archivePath` (+ downloadsDir archives) into torrent map, then seed-all (best-effort).
- Unhashed downloads are skipped until hashed/seeded individually.

## Windows notes (2026-09-11)
- webtorrent@2.8.x installs via bun, but postinstall / electron-builder `install-app-deps` needs Visual Studio Build Tools (node-gyp) for `node-datachannel`.
- Runtime import fails without native `node_datachannel.node` (and optional `bufferutil` rebuild).
- **Blocker:** install VS Build Tools with "Desktop development with C++", then re-run `bun run postinstall` / `@electron/rebuild` for Electron 44; then resume JS/native seed spike.
- Opentracker Docker may peg CPU / hang `/stats` on Docker Desktop Windows host publish — Tracker fixing (TCP-only or bittorrent-tracker swap). Announce URL stays `http://localhost:6969/announce`.
- Fallback (not built): aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.

