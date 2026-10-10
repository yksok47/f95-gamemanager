# P2P scaffolding (phase 1)

## Stack
- **WebTorrent >=2.3** in Electron **main** only (Node). Not renderer. Not webtorrent-hybrid.
- Magnet + `seed(path)`. Announce list = WebSocket tracker only (`TRACKER_WEBRTC_URL`).
- **Fallback (not built):** aria2 RPC for multi-GB hashing if WebTorrent hashing is too slow.

## Env (Tracker compose — sibling repo `C:\Repos\p2p-tracker`)
```
TRACKER_WEBRTC_URL=wss://localhost:6969
METADATA_BASE_URL=https://localhost:8080
```

TLS: metadata-api (HTTPS) and the WebSocket tracker (WSS) share a private CA (`p2p-tracker/certs`). The app pins `resources/certs/metadata-ca.crt`.

## Dual hash
- `contentHash` = SHA-256 file bytes (metadata index / matching)
- `infoHash` = BT/WebTorrent SHA-1 info dict (swarm key)
- No metadata `POST /announce` — swarm announce is WebTorrent → tracker only.

## Metadata REST (`METADATA_BASE_URL`)
- `GET /health`
- `POST /api/v1/packages` — share-claim v1 body (dual-hash + seederPubkey + base64 sig)
- `GET /api/v1/packages/{contentHash}`
- `GET /api/v1/packages` — **discovery catalog** (browse/search). No filter = list all, paginated.
  - Query: `contentHash`, `infoHash` (40-char hex), `normalizedName`, `f95ThreadId`, `q` (substring on gameName|normalizedName), `includeFlagged` (default true), `sort=updated|popularity`, `limit`/`offset`
  - Response: `{ items, limit, offset, total }` — package rows include hashes, game/thread, flags, `uniqueSeederPubkeyCount`
- `POST /api/v1/packages/{contentHash}/flags` — body `{ flags: ["broken"|"harmful"], seederPubkey, note? }`
- `POST /api/v1/links` — signed link report: which file (`contentHash`) an F95 download link and its mirrors served. Creates the package row when missing, so install tags work with P2P off.
- `GET /api/v1/links?f95ThreadId=` — `{ links: [{ url, files: [{ contentHash, reports }] }], packages }` for one thread.
- Popularity = `uniqueSeederPubkeyCount` (unique seeder pubkeys). Flags: `broken` | `harmful`.
- `infoHash` is always normalized to lowercase 40-char hex before metadata/share POSTs and in UI.

## Download links and metadata
- Approving an HTTP download reports the clicked link plus every mirror of the same entry/part (`GameFileContext.sourceLinks`), then the install tags. Mirrors carry the same content, so one report covers all of them; one link may serve several files over time.
- Link URLs are keyed by `downloadLinkKey` (`src/shared/download-links.ts`), which matches the server's `NormalizeLinkURL`.
- The game **Downloads** tab loads `p2p:threadDownloads` and runs `applyDownloadMetadata` (`src/renderer/src/lib/download-metadata.ts`): unanimous votes set the entry's kind and version, voted platforms are added, and each row lists the known files behind its links.

## P2P in the Downloads tab
- With `p2pEnabled`, every known file with an `infoHash` becomes one more mirror (`Peer-to-peer`, URL `p2p:<contentHash>`) of the entry or part whose links served it.
- Its priority is the `p2p` slot in Settings › Downloads (`downloadProviderOrder`, appended last for existing users). Copies nobody seeds or reported harmful always rank behind posted links.
- Thread files not behind any posted link appear as **Shared by app users** rows (current, older, or add-on by vote), except ones with more flags than installs.
- Global **Downloads** page: dedicated **P2P** section — flat list of downloads + shares with game name, status, down/up speeds.
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
- The metadata API is always on (no setting): link reports, install tags, and flags are sent with P2P off too.
- `p2pUploadLimitKBps` default **0** (unlimited). Caps WebTorrent upload; change applies immediately while P2P is on.
- Unhashed downloads are skipped until hashed/seeded individually.
- `p2pEnabled` gates swarm work only.

## Direct internet connections

The app installs the native `node-datachannel` WebRTC implementation before WebTorrent loads. The tracker WebSocket only exchanges encrypted WebRTC offers and ICE candidates; archive data flows directly between clients and never through the server.

The direct path needs all of the following:

1. A working native `node-datachannel` package (an N-API prebuild is installed with the app).
2. A WebSocket tracker at `TRACKER_WEBRTC_URL` for announce and signaling.
3. STUN, which discovers each peer's public candidate addresses. Set `P2P_STUN_URLS` to a comma-separated list to override the built-in Google and Cloudflare endpoints.

The app fails P2P startup explicitly if native WebRTC cannot load; it does not silently downgrade to a connection mode that cannot traverse two home NATs. The tiny `webtorrent-compat-loader.mjs` remains only to work around WebTorrent's current hex-info-hash regression without patching `node_modules`.

Verify a build with `bun run typecheck`, `bun run test:p2p`, then test one client on a different network. The P2P service status must report native WebRTC and the WebSocket tracker URL must be present.

