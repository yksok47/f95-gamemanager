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

## Discovery / management UI
- **No standalone P2P nav page.**
- Per-game: **P2P downloads** section on the game **Downloads** tab (download only — no share/upload UI there).
- Global **Downloads** page: dedicated **P2P** section — flat list of downloads + shares with game name, status, down/up speeds (not grouped by game).
- Sharing remains opt-in via Settings (p2pEnabled / seed-all); monitor shares on the Downloads page.

## Discovery UI (catalog)
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

## NAT / hole-punching (no user port forwards)

TCP to an HTTP/UDP tracker (**opentracker**) cannot punch holes. It only returns `IP:port` and tries a direct TCP connect. That works on LAN / UPnP / forwarded ports — not across two home NATs.

Hole punching is **WebRTC ICE**. The app does it when all three are in place:

1. **Native `node-datachannel`** — rebuild for this Electron ABI (`bun run rebuild:native` after VS Build Tools with “Desktop development with C++”). Until that loads, Settings → P2P shows `WebRTC: stub` and stays TCP-only.
2. **WebSocket tracker** — HTTP opentracker cannot exchange ICE offers. Run `bittorrent-tracker` (or equivalent) with WebSocket and set **Settings → WebRTC tracker URL** to `ws://your-host:8000` / `wss://…`. Example: `npx bittorrent-tracker --http false --udp false --ws --port 8000`.
3. **STUN** (built-in: Google/Cloudflare) discovers public candidates. Override with `P2P_STUN_URLS`.
4. **TURN (you host)** — required for symmetric NAT / CGNAT when STUN punch fails. Users still do nothing. Set on the app process:
   ```
   P2P_TURN_URLS=turn:your-host:3478
   P2P_TURN_USERNAME=…
   P2P_TURN_CREDENTIAL=…
   ```
   `coturn` on the same Oracle box as the tracker is the usual deploy.

Same-LAN peers still use LSD + TCP even without WebRTC. Cross-internet without native WebRTC + ws tracker will not connect unless a port is reachable (UPnP may map one automatically; many routers/CGNAT refuse).

