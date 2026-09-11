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
- `GET /api/v1/packages` — **discovery catalog** (browse/search). No filter = list all, paginated.
  - Query: `contentHash`, `infoHash` (40-char hex), `normalizedName`, `f95ThreadId`, `q` (substring on gameName|normalizedName), `includeFlagged` (default true), `sort=updated|popularity`, `limit`/`offset`
  - Response: `{ items, limit, offset, total }` — package rows include hashes, game/thread, flags, `uniqueSeederPubkeyCount`
- `POST /api/v1/packages/{contentHash}/flags` — body `{ flags: ["broken"|"harmful"], seederPubkey, note? }`
- Popularity = `uniqueSeederPubkeyCount` (unique seeder pubkeys). Flags: `broken` | `harmful`.
- `infoHash` is always normalized to lowercase 40-char hex before metadata/share POSTs and in UI.

## Discovery UI (not F95 download links)
- P2P lives on its **own nav page** (`P2P`). Do **not** attach P2P controls to Game Details download-link rows.
- Browse/search what the metadata API already knows is available (packages others shared).
- Download via P2P by `contentHash` → metadata → `infoHash` magnet (requires Settings `p2pEnabled`).
- Seeding remains opt-in (`p2pEnabled` default OFF) + seed-all local packages when enabled.

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
- Discovery/download UI is separate from F95 link rows; toggle only gates swarm + share-claim work.

## Windows notes (2026-09-11)
- webtorrent@2.8.x installs via bun, but postinstall / electron-builder `install-app-deps` needs Visual Studio Build Tools (node-gyp) for `node-datachannel`.
- Runtime import fails without native `node_datachannel.node` (and optional `bufferutil` rebuild).
- **Blocker:** install VS Build Tools with "Desktop development with C++", then re-run `bun run postinstall` / `@electron/rebuild` for Electron 44; then resume JS/native seed spike.
- Opentracker Docker may peg CPU / hang `/stats` on Docker Desktop Windows host publish — Tracker fixing (TCP-only or bittorrent-tracker swap). Announce URL stays `http://localhost:6969/announce`.
- Fallback (not built): aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.

## WebTorrent JS-fallback (interim, 2026-09-11)

Announce spike proved TCP+HTTP seed works without native WebRTC:

1. **node-datachannel stub** — `src/main/p2p/shims/node-datachannel-stub.mjs` registered via `webtorrent-compat-loader.mjs` before `import('webtorrent')`. App-owned; no permanent `node_modules` edit. Remove once `@electron/rebuild` produces `node_datachannel.node`.
2. **infoHash / arr2hex** — parse-torrent@11 may supply hex strings; WT still calls `arr2hex`. Loader hardens `uint8-util` + torrent.js. Service exposes **40-char hex** via `normalizeInfoHash` for metadata/share POSTs; Buffer stays inside the WT client.
3. Env defaults remain `TRACKER_ANNOUNCE_URL=http://localhost:6969/announce`, `METADATA_BASE_URL=http://localhost:8080`.

Verify: enable P2P in settings (or call main seed IPC) with tracker up; `registerWebtorrentCompat` log then seed/add without native rebuild. `bun run typecheck` + `bun run test:p2p`.

Note: metadata `listPackages` will require `f95ThreadId` soon (catalog filter); discovery UI owns that wire-up.
