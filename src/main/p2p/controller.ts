/**
 * P2P controller — gates all network/torrent work behind settings.p2pEnabled (OFF by default).
 * When enabled: intent is seed all local packages (wired via torrent map + library paths).
 */

import {
  normalizeInfoHash,
  normalizePackageFilename,
} from "@shared/content-address";
import {
  normalizePackageInstallTags,
  type PackageFlagKind,
  type PackageInstallTags,
  type PackageListQuery,
  type PackageListResponse,
  type PackageMetadata,
  type P2pIdentityPublic,
  type P2pTransferProgress,
  type P2pTransferState,
} from "@shared/p2p";
import { addCompletedDownload } from "../downloads";
import { getUntrustedDownloadsDirSync, getSettings } from "../settings-store";
import { hashFile } from "../hash";
import { getP2pIdentity, signShareClaim, signMessageBytes } from "./identity";
import { getAnnounceList, getP2pEnv, getTrackerStatsUrl } from "./env";
import { metadataFetch } from "./metadata-tls-fetch";
import { installNativeWebRtc } from "./webrtc";
import {
  flagPackage,
  reportPackageInstall,
  buildInstallClaimMessage,
  findPackagesByName,
  getPackage,
  getPackageStats,
  listPackages,
  metadataHealth,
  registerPackage,
} from "./metadata-client";
import { enrichPackagesWithLiveSwarm } from "./tracker-swarm";
import { loadP2pDownloadSession } from "./download-session-store";
import {
  adoptFailedTransfer,
  adoptQuarantinedTransfer,
  clearFinalizedContentHash,
  teardownP2pForContentHash,
  destroyWebTorrent,
  hasLiveTorrent,
  listP2pProgress,
  onP2pProgress,
  p2pAddMagnet,
  p2pApproveQuarantine,
  p2pPause,
  p2pRejectQuarantine,
  p2pRemove,
  p2pResume,
  p2pRevealQuarantine,
  p2pSeedPath,
  p2pStopTransfer,
  touchP2pProgress,
  waitForTorrentInfoHash,
} from "./webtorrent-service";
import {
  getTorrentMapEntry,
  listTorrentMapEntries,
  removeTorrentMapEntry,
  upsertTorrentMapEntry,
} from "./torrent-map-store";
import { syncLocalPackagesIntoTorrentMap } from "./local-packages";
import { stat, unlink } from "fs/promises";
import { basename, join } from "path";

function isLiveDownloadState(state: P2pTransferState): boolean {
  return (
    state === "connecting" ||
    state === "downloading" ||
    state === "checking" ||
    state === "paused" ||
    state === "quarantined"
  );
}

async function keepOrResumeLiveTransfer(
  existing: P2pTransferProgress,
): Promise<P2pTransferProgress | null> {
  if (!isLiveDownloadState(existing.state)) return null;
  if (existing.state === "quarantined") return existing;
  if (hasLiveTorrent(existing.id)) {
    if (existing.state === "paused") {
      return (await p2pResume(existing.id)) ?? existing;
    }
    return existing;
  }
  // Persisted row without a live torrent — drop the stub so we can re-add.
  await p2pRemove(existing.id, { deleteFiles: false });
  return null;
}

async function requireEnabled(): Promise<void> {
  const settings = await getSettings();
  if (!settings.p2pEnabled) {
    throw new Error(
      "P2P is disabled. Enable torrenting in Settings to continue.",
    );
  }
}

async function trackerAnnounceHealth(): Promise<{
  ok: boolean;
  message?: string;
}> {
  const url = getTrackerStatsUrl();
  if (!url) return { ok: false, message: "no tracker URL" };
  try {
    const res = await metadataFetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status >= 500) return { ok: false, message: `HTTP ${res.status}` };
    return { ok: true, message: `HTTP ${res.status}` };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function p2pStatus(): Promise<{
  enabled: boolean;
  metadataApiEnabled: boolean;
  identity: P2pIdentityPublic | null;
  env: ReturnType<typeof getP2pEnv>;
  announceList: string[];
  transfers: P2pTransferProgress[];
  metadata: Awaited<ReturnType<typeof metadataHealth>>;
  tracker: { ok: boolean; message?: string };
  webrtc: { ok: boolean; message: string; holePunch: boolean };
}> {
  const settings = await getSettings();
  const enabled = Boolean(settings.p2pEnabled);
  const metadataEnabled = settings.metadataApiEnabled !== false;
  const webrtc = await installNativeWebRtc();
  const [metadata, tracker] = await Promise.all([
    metadataEnabled
      ? metadataHealth()
      : Promise.resolve({ ok: false, message: "metadata API disabled" }),
    enabled
      ? trackerAnnounceHealth()
      : Promise.resolve({ ok: false, message: "p2p disabled" }),
  ]);
  return {
    enabled,
    metadataApiEnabled: metadataEnabled,
    identity: enabled ? await getP2pIdentity() : null,
    env: getP2pEnv(),
    announceList: getAnnounceList(),
    transfers: listP2pProgress(),
    metadata,
    tracker,
    webrtc: {
      ok: webrtc.ok,
      message: webrtc.message,
      holePunch: webrtc.ok && Boolean(getP2pEnv().trackerWebRtcUrl),
    },
  };
}

export async function p2pAdd(
  magnetOrPath: string,
  contentHash?: string,
): Promise<P2pTransferProgress> {
  await requireEnabled();
  if (magnetOrPath.startsWith("magnet:")) {
    return p2pAddMagnet(magnetOrPath, { contentHash });
  }
  return p2pSeedPath(magnetOrPath, { contentHash });
}

export async function p2pSeed(
  filePath: string,
  meta?: {
    contentHash?: string;
    gameName?: string;
    gameVersion?: string | null;
    f95ThreadId?: number | null;
    f95ThreadUrl?: string | null;
  },
): Promise<P2pTransferProgress> {
  await requireEnabled();
  const st = await stat(filePath);
  const contentHash = meta?.contentHash ?? (await hashFile(filePath));
  const normalizedName = normalizePackageFilename(filePath);
  let progress: P2pTransferProgress;
  try {
    progress = await p2pSeedPath(filePath, {
      contentHash,
      gameName: meta?.gameName,
      f95ThreadId: meta?.f95ThreadId ?? null,
      normalizedName,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Already in the client from a prior seed — reuse live progress if possible.
    if (/duplicate|already exists|Cannot add/i.test(msg)) {
      const existing = listP2pProgress().find(
        (t) =>
          (t.contentHash && t.contentHash === contentHash) ||
          (t.path &&
            t.path.replace(/\\/g, "/").toLowerCase() ===
              filePath.replace(/\\/g, "/").toLowerCase()),
      );
      if (!existing?.infoHash) throw error;
      progress = existing;
    } else {
      throw error;
    }
  }
  // Cold seed returns before create-torrent finishes; wait for infoHash then claim.
  if (!normalizeInfoHash(progress.infoHash)) {
    progress = await waitForTorrentInfoHash(progress.id);
  }
  const infoHash = normalizeInfoHash(progress.infoHash);
  if (!infoHash) {
    throw new Error(
      `WebTorrent seed produced no infoHash for ${normalizedName}`,
    );
  }
  await upsertTorrentMapEntry({
    contentHash,
    infoHash,
    path: filePath,
    normalizedName,
    sizeBytes: st.size,
    gameName: meta?.gameName,
    gameVersion: meta?.gameVersion ?? null,
    f95ThreadId: meta?.f95ThreadId ?? null,
    f95ThreadUrl: meta?.f95ThreadUrl ?? null,
  });
  // Map write can land after the last torrent progress tick (idle seeders emit nothing).
  touchP2pProgress();
  // Public-path: no LAN/Tailscale listenAddrs — peers meet via tracker WAN + WebRTC STUN.
  const settings = await getSettings();
  if (settings.metadataApiEnabled !== false) {
    try {
      const claim = await signShareClaim(
        {
          contentHash,
          infoHash,
          normalizedName,
        },
        {
          gameName: meta?.gameName,
          gameVersion: meta?.gameVersion,
          f95ThreadId: meta?.f95ThreadId,
          f95ThreadUrl: meta?.f95ThreadUrl,
          sizeBytes: st.size,
        },
      );
      await registerPackage(claim);
    } catch (error) {
      console.warn("[p2p] share-claim register failed", error);
    }
  }
  return { ...progress, infoHash, contentHash, normalizedName };
}

export async function p2pRemoveTransfer(
  id: string,
  deleteFiles = false,
): Promise<void> {
  await requireEnabled();
  if (deleteFiles) await p2pStopTransfer(id);
  else await p2pRemove(id, { deleteFiles: false });
}

export async function p2pPauseTransfer(
  id: string,
): Promise<P2pTransferProgress | null> {
  await requireEnabled();
  return p2pPause(id);
}

export async function p2pResumeTransfer(
  id: string,
): Promise<P2pTransferProgress | null> {
  await requireEnabled();
  const cur = listP2pProgress().find((t) => t.id === id);
  if (
    cur &&
    !hasLiveTorrent(id) &&
    cur.contentHash &&
    cur.state !== "quarantined"
  ) {
    return p2pDownloadByContentHash(cur.contentHash);
  }
  return p2pResume(id);
}

export function subscribeP2pProgress(
  listener: (items: P2pTransferProgress[]) => void,
): () => void {
  return onP2pProgress(listener);
}

export async function p2pListProgress(): Promise<P2pTransferProgress[]> {
  return listP2pProgress();
}

/**
 * When P2P turns on: sync library/download archives into torrent map, then seed.
 * WebTorrent load is best-effort — native rebuild may be missing; errors are collected.
 */

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Rejoin swarm for an already-mapped share.
 * Must seed(path) — magnet add only creates a leecher until metadata arrives, and with
 * 0 seeders that never happens (both clients stuck as leechers).
 */
async function p2pReseedMapped(entry: {
  contentHash: string;
  infoHash: string | null;
  path: string;
  normalizedName: string;
  gameName?: string | null;
  gameVersion?: string | null;
  f95ThreadId?: number | null;
  f95ThreadUrl?: string | null;
}): Promise<P2pTransferProgress> {
  const infoHash = normalizeInfoHash(entry.infoHash);
  if (!infoHash) throw new Error("mapped entry has no infoHash");
  await stat(entry.path);
  // Uses cached .torrent when present (skipVerify) — avoids multi-second create-torrent.
  return p2pSeed(entry.path, {
    contentHash: entry.contentHash,
    gameName: entry.gameName ?? undefined,
    gameVersion: entry.gameVersion ?? undefined,
    f95ThreadId: entry.f95ThreadId ?? null,
    f95ThreadUrl: entry.f95ThreadUrl ?? null,
  });
}

export async function seedAllLocalPackages(): Promise<{
  started: number;
  errors: string[];
  mapped: number;
  skippedUnhashed: number;
  candidates: number;
}> {
  await requireEnabled();
  const sync = await syncLocalPackagesIntoTorrentMap();
  const entries = await listTorrentMapEntries();
  // Only complete shares that never got an infoHash (avoid re-hashing known seeds).
  const pending = entries.filter((e) => !normalizeInfoHash(e.infoHash));
  let started = 0;
  const errors: string[] = [];
  await mapPool(pending, 2, async (entry) => {
    try {
      await stat(entry.path);
    } catch {
      errors.push(`${entry.contentHash}: missing file ${entry.path}`);
      return;
    }
    try {
      console.info(
        "[p2p] seedAll",
        entry.infoHash ? "reseed" : "complete-share",
        entry.normalizedName,
        "thread=",
        entry.f95ThreadId,
      );
      await p2pSeed(entry.path, {
        contentHash: entry.contentHash,
        gameName: entry.gameName,
        gameVersion: entry.gameVersion,
        f95ThreadId: entry.f95ThreadId,
        f95ThreadUrl: entry.f95ThreadUrl,
      });
      started += 1;
    } catch (error) {
      errors.push(
        `${entry.contentHash}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return {
    started,
    errors,
    mapped: sync.upserted,
    skippedUnhashed: sync.skippedUnhashed,
    candidates: sync.candidates,
  };
}

async function restorePersistedP2pDownloads(): Promise<void> {
  const entries = await loadP2pDownloadSession();
  for (const entry of entries) {
    try {
      if (entry.state === "quarantined") {
        const filePath = entry.filePath || entry.path;
        if (!filePath) {
          adoptFailedTransfer(entry, "Quarantined file path missing after restart.");
          continue;
        }
        try {
          await stat(filePath);
        } catch {
          adoptFailedTransfer(entry, "Quarantined file is missing from disk.");
          continue;
        }
        adoptQuarantinedTransfer(entry);
        continue;
      }

      let infoHash = normalizeInfoHash(entry.infoHash);
      if (!infoHash && entry.contentHash) {
        const pkg = await getPackage(entry.contentHash);
        infoHash = normalizeInfoHash(pkg?.infoHash);
      }
      if (!infoHash) {
        adoptFailedTransfer(
          entry,
          "Cannot resume download — missing infoHash after restart.",
        );
        continue;
      }
      const magnet = buildMagnet(
        infoHash,
        entry.gameName || entry.normalizedName || entry.contentHash,
      );
      await p2pAddMagnet(magnet, {
        contentHash: entry.contentHash,
        path: entry.savePath || getUntrustedDownloadsDirSync(),
        gameName: entry.gameName,
        gameVersion: entry.gameVersion,
        f95ThreadId: entry.f95ThreadId,
        f95ThreadUrl: entry.f95ThreadUrl,
        normalizedName: entry.normalizedName,
        startPaused: entry.state === "paused",
        snapshot: {
          downloaded: entry.downloaded,
          uploaded: entry.uploaded,
          length: entry.length,
          progress: entry.progress,
          path: entry.path || entry.filePath,
        },
      });
    } catch (error) {
      console.warn("[p2p] restore download failed", entry.normalizedName || entry.id, error);
      adoptFailedTransfer(
        entry,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export async function onP2pEnabledChanged(enabled: boolean): Promise<void> {
  if (!enabled) {
    await destroyWebTorrent();
    return;
  }
  await getP2pIdentity();
  // Resume mid-download / quarantine first, then keep known shares announcing.
  void (async () => {
    try {
      await restorePersistedP2pDownloads();
    } catch (error) {
      console.warn("[p2p] restore downloads failed", error);
    }
    try {
      const entries = await listTorrentMapEntries();
      const known = entries.filter((e) => normalizeInfoHash(e.infoHash));
      await mapPool(known, 4, async (entry) => {
        try {
          await p2pReseedMapped(entry);
          console.info("[p2p] reseeded", entry.normalizedName, entry.infoHash);
        } catch (error) {
          console.warn("[p2p] reseed failed", entry.normalizedName, error);
        }
      });
    } catch (error) {
      console.warn("[p2p] reseed pass failed", error);
    }
    try {
      await seedAllLocalPackages();
    } catch (error) {
      console.warn("[p2p] seedAll failed", error);
    }
  })();
}

export async function lookupPackageMeta(
  contentHash: string,
): Promise<PackageMetadata | null> {
  return getPackage(contentHash);
}

export async function lookupPackagesByFilename(
  filename: string,
  f95ThreadId: number | string,
): Promise<PackageMetadata[]> {
  return findPackagesByName(normalizePackageFilename(filename), f95ThreadId);
}

export async function flagPackageAs(
  contentHash: string,
  kind: PackageFlagKind,
  note?: string,
): Promise<PackageMetadata> {
  // Metadata-only — does not require torrenting to be enabled.
  const settings = await getSettings();
  if (settings.metadataApiEnabled === false) {
    throw new Error(
      "Metadata API is disabled. Enable it in Settings → General to flag packages.",
    );
  }
  const identity = await getP2pIdentity();
  const ts = Math.floor(Date.now() / 1000);
  const message = [
    "f95-gm:flag:v1",
    `contentHash=${contentHash.trim().toLowerCase()}`,
    `kind=${kind}`,
    `ts=${ts}`,
  ].join("\n");
  const { signature } = await signMessageBytes(message);
  return flagPackage(contentHash, {
    kind,
    seederPubkey: identity.seederPubkey,
    note,
    signature,
  });
}

/** Per-thread metadata discovery for the dedicated P2P UI (not F95 download rows). */
export async function listPackagesForDiscovery(
  query: PackageListQuery,
): Promise<PackageListResponse> {
  const settings = await getSettings();
  if (settings.metadataApiEnabled === false) {
    return { items: [], versions: [], limit: 50, offset: 0, total: 0 };
  }
  const page = await listPackages({
    limit: 50,
    offset: 0,
    sort: "popularity",
    includeFlagged: true,
    ...query,
  });
  // Metadata API may omit sizeBytes; fill from local torrent map when we know it.
  const local = await listTorrentMapEntries();
  const byHash = new Map(local.map((e) => [e.contentHash.toLowerCase(), e]));
  const withLocal = page.items.map((pkg) => {
    const mapped = byHash.get(pkg.contentHash.toLowerCase());
    if (!mapped) return pkg;
    return {
      ...pkg,
      sizeBytes:
        pkg.sizeBytes && pkg.sizeBytes > 0
          ? pkg.sizeBytes
          : mapped.sizeBytes || pkg.sizeBytes,
      gameVersion: pkg.gameVersion || mapped.gameVersion || null,
    };
  });
  // Live peer counts from WebSocket tracker scrape on tab enter — not metadata scrape.
  const items = await enrichPackagesWithLiveSwarm(withLocal);
  return { ...page, items };
}

function buildMagnet(infoHash: string, displayName?: string): string {
  const normalized = normalizeInfoHash(infoHash);
  if (!normalized) throw new Error("Invalid infoHash (need 40-char hex)");
  const { trackerWebRtcUrl } = getP2pEnv();
  // Do not use URLSearchParams for xt — it encodes ":" to %3A and WebTorrent
  // then throws "Invalid torrent identifier".
  const parts = [`xt=urn:btih:${normalized}`];
  if (displayName) parts.push(`dn=${encodeURIComponent(displayName)}`);
  if (trackerWebRtcUrl) parts.push(`tr=${encodeURIComponent(trackerWebRtcUrl)}`);
  return `magnet:?${parts.join("&")}`;
}

/**
 * Download a shared package by contentHash using tracker metadata + infoHash swarm.
 * Requires p2pEnabled. Soft metadata miss throws a clear error.
 */
export async function p2pDownloadByContentHash(
  contentHash: string,
): Promise<P2pTransferProgress> {
  await requireEnabled();
  const settings = await getSettings();
  if (settings.metadataApiEnabled === false) {
    throw new Error(
      "Metadata API is disabled. Enable it in Settings → General to download from the catalog.",
    );
  }
  const hash = contentHash.trim().toLowerCase();
  // Allow re-download after library remove / prior finalize.
  clearFinalizedContentHash(hash);

  const existing = listP2pProgress().find(
    (t) => t.contentHash?.toLowerCase() === hash,
  );
  if (existing) {
    const kept = await keepOrResumeLiveTransfer(existing);
    if (kept) return kept;
    // Seeding only counts if the file is still on disk. After library remove the
    // seed handle can linger and block re-download until app restart.
    if (existing.state === "seeding") {
      const seedPath = existing.path;
      let stillThere = false;
      if (seedPath) {
        try {
          await stat(seedPath);
          stillThere = true;
        } catch {
          stillThere = false;
        }
      }
      if (stillThere) return existing;
    }
    if (listP2pProgress().some((t) => t.id === existing.id)) {
      await p2pRemove(existing.id, { deleteFiles: false });
    }
  }

  const pkg = await getPackage(hash);
  if (!pkg) {
    throw new Error(
      "Package not found in metadata catalog for that contentHash.",
    );
  }
  if (!pkg.infoHash) {
    throw new Error("Package has no infoHash yet — cannot join swarm.");
  }
  const info = normalizeInfoHash(pkg.infoHash);
  const byInfo = listP2pProgress().find((t) => t.infoHash === info);
  if (byInfo) {
    const kept = await keepOrResumeLiveTransfer(byInfo);
    if (kept) return kept;
    if (byInfo.state === "seeding") {
      const seedPath = byInfo.path;
      let stillThere = false;
      if (seedPath) {
        try {
          await stat(seedPath);
          stillThere = true;
        } catch {
          stillThere = false;
        }
      }
      if (stillThere) return byInfo;
    }
    if (listP2pProgress().some((t) => t.id === byInfo.id)) {
      await p2pRemove(byInfo.id, { deleteFiles: false });
    }
  }

  const magnet = buildMagnet(
    pkg.infoHash,
    pkg.gameName || pkg.normalizedName || hash,
  );
  const downloadDir = getUntrustedDownloadsDirSync();
  // Only delete an orphan zip when we are NOT already seeding that path.
  const orphanName = pkg.normalizedName || "";
  if (orphanName) {
    const orphanPath = join(downloadDir, orphanName);
    const stillSeeding = listP2pProgress().some(
      (t) =>
        t.state === "seeding" &&
        t.path &&
        t.path
          .replace(/\\/g, "/")
          .toLowerCase()
          .endsWith("/" + orphanName.toLowerCase()),
    );
    if (!stillSeeding) {
      try {
        await unlink(orphanPath);
      } catch {
        /* none */
      }
    }
  }
  const progress = await p2pAddMagnet(magnet, {
    contentHash: pkg.contentHash,
    path: downloadDir,
    gameName: pkg.gameName || undefined,
    gameVersion: pkg.gameVersion || undefined,
    f95ThreadId: pkg.f95ThreadId,
    normalizedName: pkg.normalizedName || undefined,
    f95ThreadUrl: pkg.f95ThreadUrl || undefined,
    consensus: pkg.consensus ?? null,
  });
  return progress;
}

export async function approveQuarantinedDownload(
  id: string,
  tags: PackageInstallTags
): Promise<void> {
  await requireEnabled();
  const normalizedTags = normalizePackageInstallTags(tags);
  const before = listP2pProgress().find((t) => t.id === id);
  const contentHash = before?.contentHash?.trim().toLowerCase();
  const approved = await p2pApproveQuarantine(id, normalizedTags);
  try {
    addCompletedDownload({
      filename: approved.normalizedName || basename(approved.dest),
      savePath: approved.dest,
      sizeBytes: approved.sizeBytes,
      hash: approved.contentHash,
      gameThreadId: approved.f95ThreadId,
      gameTitle: approved.gameName || before?.gameName,
      gameVersion: normalizedTags.version,
    });
  } catch (error) {
    console.warn("[p2p] could not add approved file to Downloads list", error);
  }
  if (contentHash) {
    try {
      const ts = Math.floor(Date.now() / 1000);
      const msg = buildInstallClaimMessage(contentHash, ts, normalizedTags);
      const { seederPubkey, signature } = await signMessageBytes(msg);
      await reportPackageInstall(contentHash, {
        seederPubkey,
        ts,
        signature,
        tags: normalizedTags,
      });
    } catch (error) {
      console.warn("[p2p] install report after approve failed", error);
    }
  }
}

export async function rejectQuarantinedDownload(id: string): Promise<void> {
  await requireEnabled();
  await p2pRejectQuarantine(id);
}

export async function revealQuarantinedDownload(id: string): Promise<string> {
  await requireEnabled();
  return p2pRevealQuarantine(id);
}

/** Reject + vote the package harmful on the metadata catalog. */
export async function flagQuarantinedDownload(
  id: string,
  note?: string,
): Promise<void> {
  await requireEnabled();
  const row = listP2pProgress().find((t) => t.id === id);
  const contentHash = row?.contentHash?.trim().toLowerCase();
  await p2pRejectQuarantine(id);
  if (!contentHash) return;
  const settings = await getSettings();
  if (settings.metadataApiEnabled === false) {
    console.warn(
      "[p2p] skipped harmful flag — metadata API disabled",
      contentHash,
    );
    return;
  }
  await flagPackageAs(contentHash, "harmful", note);
}

/** After a library archive is deleted: stop seeding and drop torrent-map entry. */
export async function onLibraryPackageRemoved(
  contentHash?: string | null,
): Promise<void> {
  const h = contentHash?.trim().toLowerCase();
  if (!h) return;
  await teardownP2pForContentHash(h);
  try {
    await removeTorrentMapEntry(h);
  } catch (error) {
    console.warn("[p2p] torrent-map remove after library delete failed", error);
  }
}

/** When P2P is on, seed a newly indexed library archive so it shows up without restart. */
export async function onLibraryPackageAdded(opts: {
  filePath: string;
  contentHash: string;
  gameName?: string;
  gameVersion?: string | null;
  f95ThreadId?: number | null;
  f95ThreadUrl?: string | null;
}): Promise<void> {
  const settings = await getSettings();
  if (!settings.p2pEnabled) return;
  const contentHash = opts.contentHash.trim().toLowerCase();
  if (!contentHash) return;
  try {
    await p2pSeed(opts.filePath, {
      contentHash,
      gameName: opts.gameName,
      gameVersion: opts.gameVersion ?? null,
      f95ThreadId: opts.f95ThreadId ?? null,
      f95ThreadUrl: opts.f95ThreadUrl ?? null,
    });
  } catch (error) {
    console.warn("[p2p] auto-seed after library add failed", error);
  }
}

export async function getCachedOrHash(filePath: string): Promise<string> {
  // Prefer map lookup by path
  const entries = await listTorrentMapEntries();
  const hit = entries.find((e) => e.path === filePath);
  if (hit) return hit.contentHash;
  return hashFile(filePath);
}

/** Local packages we have registered for sharing (torrent map). Empty when P2P is off. */
export async function p2pListShared(): Promise<
  Awaited<ReturnType<typeof listTorrentMapEntries>>
> {
  const entries = await listTorrentMapEntries();
  // Only packages with an infoHash are actually shared/seedable on the swarm.
  return entries.filter((e) => Boolean(normalizeInfoHash(e.infoHash)));
}

export { getTorrentMapEntry, getPackageStats };
