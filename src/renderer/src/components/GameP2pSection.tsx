import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { isContentHash, normalizeInfoHash } from "@shared/content-address";
import {
  isInFlightP2pState,
  type PackageListQuery,
  type PackageListSort,
  type PackageMetadata,
  type P2pTransferProgress,
} from "@shared/p2p";
import { formatBytes, formatSpeed } from "../lib/downloads";
import { confirm } from "./ConfirmDialog";
import SelectMenu from "./SelectMenu";

type GameP2pSectionProps = {
  threadId: number;
  gameName: string;
  onOpenFiles?: () => void;
};

function flagCountsOf(pkg: PackageMetadata): {
  broken: number;
  harmful: number;
  total: number;
} {
  const broken = Math.max(0, pkg.flagCounts?.broken ?? 0);
  const harmful = Math.max(0, pkg.flagCounts?.harmful ?? 0);
  return { broken, harmful, total: broken + harmful };
}

function trustNote(
  pkg: PackageMetadata,
  trust: ReturnType<typeof trustSignal>,
): { text: string; tone: "bad" | "caution" | "none" | "good" } | null {
  const { harmful, broken } = flagCountsOf(pkg);
  const flagBits = [
    harmful > 0 ? `harmful ×${harmful}` : null,
    broken > 0 ? `broken ×${broken}` : null,
  ].filter(Boolean);
  if (trust.level === "bad") {
    return {
      tone: "bad",
      text: flagBits.length
        ? `More flags (${flagBits.join(", ")}) than installs — treat this as untrusted and inspect the file carefully before opening.`
        : "More flags than installs — treat this as untrusted and inspect the file carefully before opening.",
    };
  }
  if (trust.level === "caution") {
    return {
      tone: "caution",
      text: `Flags are high relative to installs${flagBits.length ? ` (${flagBits.join(", ")})` : ""}. Review the file before you open or install it.`,
    };
  }
  if (trust.level === "uncertain") {
    return {
      tone: "caution",
      text: `This package has flags${flagBits.length ? ` (${flagBits.join(", ")})` : ""}. Check the file before opening.`,
    };
  }
  if (trust.level === "none") {
    return {
      tone: "none",
      text: "No installs or flags yet — be careful and scan the file before opening.",
    };
  }
  return {
    tone: "good",
    text: "Install reports look healthy, so this is likely a good file. Install counts can still be inflated — scan before opening.",
  };
}

/** installs:flags trust band. */
function trustSignal(pkg: PackageMetadata): {
  level: "good" | "uncertain" | "caution" | "bad" | "none";
  label: string;
} {
  const installs = Math.max(0, pkg.installCount ?? 0);
  const flags = flagCountsOf(pkg).total;
  if (flags === 0 && installs === 0)
    return { level: "none", label: "No trust data yet" };
  if (flags === 0)
    return {
      level: "good",
      label: `${installs} install${installs === 1 ? "" : "s"} · no flags`,
    };
  if (flags > installs)
    return { level: "bad", label: `${installs} installs / ${flags} flags` };
  const ratio = installs / flags;
  if (ratio >= 10)
    return {
      level: "good",
      label: `${installs} installs / ${flags} flags (≥10:1)`,
    };
  if (ratio > 2)
    return {
      level: "uncertain",
      label: `${installs} installs / ${flags} flags`,
    };
  return {
    level: "caution",
    label: `${installs} installs / ${flags} flags (<2:1)`,
  };
}

function formatUploadedAt(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Uploaded ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function availabilityMeta(pkg: PackageMetadata): string {
  // Swarm availability for the catalog tile — tracker probe, not our connected wires.
  const raw = pkg.activeSeeders != null ? pkg.activeSeeders : pkg.seeders;
  if (raw == null) return "peers ?";
  const n = Math.max(0, Number(raw) || 0);
  return `${n} peer${n === 1 ? "" : "s"} seeding`;
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function transferMatchesPackage(
  t: P2pTransferProgress,
  pkg: PackageMetadata,
): boolean {
  const ch = pkg.contentHash?.toLowerCase();
  const ih = normalizeInfoHash(pkg.infoHash);
  return Boolean(
    (ch && t.contentHash?.toLowerCase() === ch) || (ih && t.infoHash === ih),
  );
}

function isInFlightDownload(t: P2pTransferProgress): boolean {
  if (t.state === "error") return t.id.startsWith("add:");
  return isInFlightP2pState(t.state);
}

function activeDownloadLabel(state: P2pTransferProgress["state"]): string {
  if (state === "error") return "Error";
  if (state === "paused") return "Paused";
  if (state === "quarantined") return "Needs review";
  if (state === "seeding") return "Downloaded";
  if (state === "connecting") return "Connecting";
  if (state === "checking") return "Checking";
  return "Downloading";
}

export default function GameP2pSection({
  threadId,
  gameName,
  onOpenFiles,
}: GameP2pSectionProps): JSX.Element {
  const [p2pEnabled, setP2pEnabled] = useState(false);
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<PackageListSort>("popularity");
  const [items, setItems] = useState<PackageMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<P2pTransferProgress[]>([]);
  const [ownedContentHashes, setOwnedContentHashes] = useState<Set<string>>(
    () => new Set(),
  );

  const gameDownloads = useMemo(
    () =>
      transfers.filter(
        (t) =>
          isInFlightDownload(t) &&
          (t.f95ThreadId === threadId ||
            (t.gameName != null && t.gameName === gameName)),
      ),
    [transfers, threadId, gameName],
  );

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const status = (await window.api.p2p.status()) as { enabled?: boolean };
      setP2pEnabled(Boolean(status?.enabled));
    } catch {
      setP2pEnabled(false);
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const raw = q.trim();
      const query: PackageListQuery = {
        f95ThreadId: threadId,
        sort,
        includeFlagged: true,
        limit,
        offset,
      };
      const info = normalizeInfoHash(raw);
      if (isContentHash(raw)) {
        query.contentHash = raw.toLowerCase();
      } else if (info) {
        query.infoHash = info;
      } else if (raw) {
        query.q = raw;
      }
      const page = await window.api.p2p.listPackages(query);
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load P2P packages for this game",
      );
    } finally {
      setBusy(false);
    }
  }, [threadId, q, sort, limit, offset]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void load();
    const onFocus = (): void => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    const poll = window.setInterval(() => {
      void load();
    }, 12_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQ(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    void window.api.p2p.progress().then((rows) => {
      if (!cancelled) setTransfers(rows);
    });
    const stop = window.api.p2p.onProgress((rows) => {
      setTransfers(rows);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshOwned = async (): Promise<void> => {
      try {
        const files = await window.api.library.list(threadId);
        if (cancelled) return;
        const next = new Set<string>();
        for (const f of files) {
          if (!f.hasArchive) continue;
          const h =
            typeof f.hash === "string" ? f.hash.trim().toLowerCase() : "";
          if (h) next.add(h);
        }
        setOwnedContentHashes(next);
      } catch {
        if (!cancelled) setOwnedContentHashes(new Set());
      }
    };
    void refreshOwned();
    const stop = window.api.library.onChange(() => {
      void refreshOwned();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [threadId]);

  async function download(pkg: PackageMetadata): Promise<void> {
    if (!p2pEnabled) {
      setActionError("Enable P2P in Settings before downloading.");
      return;
    }
    if (ownedContentHashes.has(pkg.contentHash.toLowerCase())) {
      setActionError("This package is already in your library.");
      return;
    }
    if (
      transfers.some(
        (t) => transferMatchesPackage(t, pkg) && isInFlightDownload(t),
      )
    ) {
      setActionError("Already downloading this package.");
      return;
    }
    const { harmful, broken } = flagCountsOf(pkg);
    const trust = trustSignal(pkg);
    if (harmful > 0 && trust.level !== "good") {
      const bits = [
        `harmful ×${harmful}`,
        broken > 0 ? `broken ×${broken}` : null,
        `${pkg.installCount ?? 0} reported installs`,
      ].filter(Boolean);
      if (
        !(await confirm({
          title: "Flagged package",
          message: `This package has harm reports (${bits.join(" · ")}). Download anyway?`,
          confirmLabel: "Download",
          danger: true,
        }))
      )
        return;
    }
    if (
      (pkg.uniqueSeederPubkeyCount || 0) <= 0 &&
      (pkg.seeders == null || pkg.seeders <= 0)
    ) {
      if (
        !(await confirm({
          title: "No peers reported",
          message:
            "No sharers reported for this package — download may stall. Continue?",
          confirmLabel: "Download anyway",
        }))
      )
        return;
    }
    setPendingHash(pkg.contentHash);
    setActionError(null);
    try {
      await window.api.p2p.downloadByHash(pkg.contentHash);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "P2P download failed",
      );
    } finally {
      setPendingHash(null);
    }
  }

  async function pauseTransfer(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.pause(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not pause P2P download",
      );
    }
  }

  async function resumeTransfer(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.resume(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not resume P2P download",
      );
    }
  }

  async function stopTransfer(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.remove(id, true);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not stop P2P download",
      );
    }
  }

  async function revealQuarantine(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.revealQuarantine(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not open quarantine folder",
      );
    }
  }

  async function approveQuarantine(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.approveQuarantine(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not approve download",
      );
    }
  }

  async function rejectQuarantine(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.rejectQuarantine(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not reject download",
      );
    }
  }

  async function flagQuarantine(id: string): Promise<void> {
    setActionError(null);
    try {
      await window.api.p2p.flagQuarantine(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not flag package",
      );
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + items.length, total);

  return (
    <section className="download-section game-p2p-section">
      <h2>P2P downloads</h2>

      {gameDownloads.length ? (
        <div className="downloads-page-list game-p2p-active">
          {gameDownloads.map((t) => {
            const pct = Math.round((t.progress || 0) * 100);
            const down =
              t.downloadSpeed > 0 ? formatSpeed(t.downloadSpeed) : "";
            return (
              <article key={t.id} className="download-row download-row-compact">
                <div className="download-row-main">
                  <div className="download-row-title">
                    <strong title={t.normalizedName || t.contentHash}>
                      {t.normalizedName || shortHash(t.contentHash) || t.id}
                    </strong>
                    <span className="download-status download-status-progressing">
                      {activeDownloadLabel(t.state)}
                    </span>
                  </div>
                  <div
                    className="download-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="muted download-meta">
                    {t.state === "quarantined"
                      ? "Saved to untrusted quarantine — review before opening or installing."
                      : [
                          `${pct}%`,
                          t.length > 0
                            ? `${formatBytes(t.downloaded)} / ${formatBytes(t.length)}`
                            : formatBytes(t.downloaded),
                          down,
                          t.state === "connecting"
                            ? "finding peers"
                            : `${t.numActivePeers ?? 0} active / ${t.numPeers} connected`,
                          t.error,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </p>
                </div>
                <div className="download-row-actions">
                  {t.state === "quarantined" ? (
                    <>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => void revealQuarantine(t.id)}
                      >
                        View in folder
                      </button>
                      <button
                        className="primary-btn"
                        type="button"
                        onClick={() => void approveQuarantine(t.id)}
                      >
                        Approve
                      </button>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => void rejectQuarantine(t.id)}
                      >
                        Reject
                      </button>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => void flagQuarantine(t.id)}
                      >
                        Flag malicious
                      </button>
                    </>
                  ) : t.state === "paused" || t.state === "error" ? (
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => void resumeTransfer(t.id)}
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => void pauseTransfer(t.id)}
                    >
                      Pause
                    </button>
                  )}
                  {t.state === "quarantined" ? null : (
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => void stopTransfer(t.id)}
                    >
                      Stop
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="filter-row game-p2p-controls">
        <input
          className="tag-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Name or hash"
          aria-label="Search P2P packages for this game"
        />
        <SelectMenu
          value={sort}
          ariaLabel="Sort packages"
          options={[
            { value: "popularity", label: "Popularity" },
            { value: "updated", label: "Updated" },
          ]}
          onChange={(next) => {
            setOffset(0);
            setSort(next);
          }}
        />
        <button
          className="ghost-btn"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {busy ? <p className="muted">Loading shared packages…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}
      {!busy && items.length === 0 && !error ? (
        <p className="muted">No shared packages for this game yet.</p>
      ) : null}

      <ul className="p2p-discovery-list">
        {items.map((pkg) => {
          const trust = trustSignal(pkg);
          const warn = trustNote(pkg, trust);
          const active = pendingHash === pkg.contentHash;
          const owned = ownedContentHashes.has(pkg.contentHash.toLowerCase());
          const matchedTransfer = transfers.find(
            (t) => transferMatchesPackage(t, pkg) && isInFlightDownload(t),
          );
          const inFlight = Boolean(matchedTransfer);
          const size =
            pkg.sizeBytes && pkg.sizeBytes > 0
              ? formatBytes(pkg.sizeBytes)
              : "";
          const noSharers =
            (pkg.uniqueSeederPubkeyCount || 0) <= 0 &&
            (pkg.seeders == null || pkg.seeders <= 0);
          const label = owned
            ? "In library"
            : matchedTransfer?.state === "quarantined"
              ? "Needs review"
              : matchedTransfer?.state === "paused"
                ? "Paused"
                : matchedTransfer?.state === "connecting"
                  ? "Connecting…"
                  : inFlight
                    ? "Downloading…"
                    : active
                      ? "Starting…"
                      : size
                        ? `Download · ${size}`
                        : "Download";
          const canDownload =
            p2pEnabled && !active && Boolean(pkg.infoHash) && !owned && !inFlight;
          const title = !p2pEnabled
            ? "Enable P2P in Settings"
            : !pkg.infoHash
              ? "Missing infoHash"
              : owned
                ? "Open the Files tab"
                : inFlight
                  ? "Download already in progress"
                  : noSharers
                    ? "No sharers reported — download may stall"
                    : "Download via P2P";
          return (
            <li key={pkg.contentHash} className="p2p-discovery-item">
              <div className="p2p-discovery-main">
                <div>
                  <div className="p2p-discovery-title-row">
                    <strong>
                      {pkg.normalizedName || pkg.gameName || "Untitled package"}
                      {pkg.gameVersion ? ` · ${pkg.gameVersion}` : ""}
                    </strong>
                    <span
                      className={`p2p-trust-badge p2p-trust-${trust.level}`}
                      title="Installs vs flags (unique reports)"
                    >
                      {trust.label}
                    </span>
                  </div>
                  <p className="muted download-meta">
                    {[
                      availabilityMeta(pkg),
                      size,
                      formatUploadedAt(pkg.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {owned ? (
                  <button
                    className="download-link"
                    type="button"
                    title={title}
                    onClick={() => onOpenFiles?.()}
                  >
                    {label}
                  </button>
                ) : canDownload ? (
                  <button
                    className="download-link"
                    type="button"
                    title={title}
                    onClick={() => void download(pkg)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="download-link download-link-static" title={title}>
                    {label}
                  </span>
                )}
              </div>
              {warn ? (
                <p className={`p2p-flag-warning p2p-trust-note-${warn.tone}`}>{warn.text}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {total > 0 ? (
        <div className="filter-row game-p2p-pager">
          <span className="muted">
            {pageStart}–{pageEnd} of {total}
          </span>
          <button
            className="ghost-btn"
            type="button"
            disabled={busy || offset <= 0}
            onClick={() => setOffset((v) => Math.max(0, v - limit))}
          >
            Prev
          </button>
          <button
            className="ghost-btn"
            type="button"
            disabled={busy || offset + limit >= total}
            onClick={() => setOffset((v) => v + limit)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
