import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { normalizeInfoHash } from "@shared/content-address";
import {
  isInFlightP2pState,
  type PackageListQuery,
  type PackageListSort,
  type PackageMetadata,
  type PackageVersionWeight,
  type P2pTransferProgress,
} from "@shared/p2p";
import {
  CONTENT_KIND_BY_ID,
  CONTENT_KIND_IDS,
  CONTENT_KIND_LABELS,
  OS_KIND_BY_ID,
  OS_KIND_IDS,
  OS_KIND_LABELS,
  type ContentKind,
  type OsKind,
} from "@shared/types";
import { formatBytes } from "../lib/downloads";
import { confirm } from "./ConfirmDialog";
import {
  formatConsensusKind,
  formatConsensusOs,
} from "./PackageMetaTags";
import SelectMenu from "./SelectMenu";
import { KindIcon, OsIcon } from "./TagIcons";

const ALL = "all" as const;

const PLATFORM_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ALL, label: "All platforms" },
  ...(Object.keys(OS_KIND_IDS) as OsKind[]).map((key) => ({
    value: String(OS_KIND_IDS[key]),
    label: OS_KIND_LABELS[key],
  })),
];

const FILE_TYPE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ALL, label: "All file types" },
  ...(Object.keys(CONTENT_KIND_IDS) as ContentKind[])
    .filter((key) => key !== "other")
    .concat("other")
    .map((key) => ({
      value: String(CONTENT_KIND_IDS[key]),
      label: CONTENT_KIND_LABELS[key],
    })),
];

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
  const raw = pkg.activeSeeders ?? pkg.seeders ?? 0;
  const n = Math.max(0, Number(raw) || 0);
  return `${n} peer${n === 1 ? "" : "s"} seeding`;
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

export default function GameP2pSection({
  threadId,
  gameName: _gameName,
  onOpenFiles,
}: GameP2pSectionProps): JSX.Element {
  const [p2pEnabled, setP2pEnabled] = useState(false);
  const [metadataApiEnabled, setMetadataApiEnabled] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<string>(ALL);
  const [filterFileType, setFilterFileType] = useState<string>(ALL);
  const [filterVersion, setFilterVersion] = useState<string>(ALL);
  const [sort, setSort] = useState<PackageListSort>("popularity");
  const [items, setItems] = useState<PackageMetadata[]>([]);
  const [versions, setVersions] = useState<PackageVersionWeight[]>([]);
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

  const versionFilterOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [
      { value: ALL, label: "All versions" },
    ];
    const seen = new Set<string>();
    for (const v of versions) {
      const name = v.name?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      opts.push({ value: name, label: name });
    }
    if (filterVersion !== ALL && !seen.has(filterVersion)) {
      opts.push({ value: filterVersion, label: filterVersion });
    }
    return opts;
  }, [versions, filterVersion]);

  const filteredItems = useMemo(() => {
    const osId = filterPlatform === ALL ? null : Number(filterPlatform);
    const kindId = filterFileType === ALL ? null : Number(filterFileType);
    const ver = filterVersion === ALL ? null : filterVersion;
    return items.filter((pkg) => {
      const c = pkg.consensus;
      if (osId != null) {
        if (!c?.os?.includes(osId)) return false;
      }
      if (kindId != null) {
        if (c?.contentKind !== kindId) return false;
      }
      if (ver != null) {
        const pkgVer = (c?.version?.trim() || pkg.gameVersion?.trim() || "");
        if (pkgVer !== ver) return false;
      }
      return true;
    });
  }, [items, filterPlatform, filterFileType, filterVersion]);

  const filtersActive =
    filterPlatform !== ALL || filterFileType !== ALL || filterVersion !== ALL;

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const status = (await window.api.p2p.status()) as {
        enabled?: boolean;
        metadataApiEnabled?: boolean;
      };
      setP2pEnabled(Boolean(status?.enabled));
      setMetadataApiEnabled(status?.metadataApiEnabled !== false);
    } catch {
      setP2pEnabled(false);
      setMetadataApiEnabled(true);
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const status = (await window.api.p2p.status()) as {
        enabled?: boolean;
        metadataApiEnabled?: boolean;
      };
      setP2pEnabled(Boolean(status?.enabled));
      const metaOn = status?.metadataApiEnabled !== false;
      setMetadataApiEnabled(metaOn);
      if (!metaOn) {
        setItems([]);
        setVersions([]);
        setTotal(0);
        return;
      }
      const query: PackageListQuery = {
        f95ThreadId: threadId,
        sort,
        includeFlagged: true,
        limit,
        offset,
      };
      const page = await window.api.p2p.listPackages(query);
      setItems(page.items);
      setVersions(page.versions ?? []);
      setTotal(page.total);
    } catch (err) {
      setItems([]);
      setVersions([]);
      setTotal(0);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load P2P packages for this game",
      );
    } finally {
      setBusy(false);
    }
  }, [threadId, sort, limit, offset]);

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

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + items.length, total);

  return (
    <section className="download-section game-p2p-section">
      {busy ? (
        <div
          className="game-p2p-spinner"
          role="status"
          aria-label="Loading shared packages"
        >
          <span />
        </div>
      ) : null}
      <h2>P2P downloads</h2>

      <div className="filter-row game-p2p-controls">
        <SelectMenu
          value={filterPlatform}
          ariaLabel="Filter by platform"
          options={PLATFORM_FILTER_OPTIONS}
          onChange={(next) => {
            setOffset(0);
            setFilterPlatform(next);
          }}
        />
        <SelectMenu
          value={filterFileType}
          ariaLabel="Filter by file type"
          options={FILE_TYPE_FILTER_OPTIONS}
          onChange={(next) => {
            setOffset(0);
            setFilterFileType(next);
          }}
        />
        <SelectMenu
          value={filterVersion}
          ariaLabel="Filter by version"
          options={versionFilterOptions}
          onChange={(next) => {
            setOffset(0);
            setFilterVersion(next);
          }}
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

      {error ? <p className="error-text">{error}</p> : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}
      {!busy && filteredItems.length === 0 && !error ? (
        <p className="muted">
          {metadataApiEnabled
            ? filtersActive
              ? "No packages match these filters."
              : "No shared packages for this game yet."
            : "Metadata API is disabled. Enable it in Settings → General to browse the catalog."}
        </p>
      ) : null}

      <ul className="p2p-discovery-list">
        {filteredItems.map((pkg) => {
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
          const kindKey =
            pkg.consensus != null
              ? (CONTENT_KIND_BY_ID[
                  pkg.consensus.contentKind as keyof typeof CONTENT_KIND_BY_ID
                ] ?? null)
              : null;
          const kindLabel =
            pkg.consensus != null
              ? formatConsensusKind(pkg.consensus.contentKind)
              : "Untagged";
          const version =
            pkg.consensus?.version?.trim() ||
            pkg.gameVersion?.trim() ||
            "Unknown version";
          const osIds = pkg.consensus?.os ?? [];
          return (
            <li key={pkg.contentHash} className="p2p-discovery-item">
              <div className="p2p-discovery-main">
                <div className="p2p-discovery-body">
                  <aside
                    className="p2p-discovery-kind"
                    title={kindLabel}
                    aria-label={kindLabel}
                  >
                    <span className="p2p-discovery-kind-icon">
                      <KindIcon kind={kindKey ?? "other"} />
                    </span>
                    <span className="p2p-discovery-kind-label">{kindLabel}</span>
                  </aside>
                  <div className="p2p-discovery-content">
                    <div className="p2p-discovery-title-row">
                      <strong className="p2p-discovery-version">{version}</strong>
                      {osIds.length ? (
                        <span
                          className="p2p-discovery-platforms"
                          aria-label={formatConsensusOs(osIds)}
                        >
                          {osIds.map((id) => {
                            const key =
                              OS_KIND_BY_ID[id as keyof typeof OS_KIND_BY_ID];
                            if (!key) return null;
                            return (
                              <span
                                key={id}
                                className="p2p-discovery-platform"
                                title={OS_KIND_LABELS[key]}
                              >
                                <OsIcon os={key} />
                                <span className="p2p-discovery-platform-label">
                                  {OS_KIND_LABELS[key]}
                                </span>
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                      <span
                        className={`p2p-trust-badge p2p-trust-${trust.level}`}
                        title="Installs vs flags (unique reports)"
                      >
                        {trust.label}
                      </span>
                    </div>
                    <p className="p2p-discovery-filename">
                      {pkg.normalizedName || pkg.gameName || "Untitled package"}
                    </p>
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
            {filtersActive
              ? `${filteredItems.length} match${filteredItems.length === 1 ? "" : "es"} on this page · ${pageStart}–${pageEnd} of ${total}`
              : `${pageStart}–${pageEnd} of ${total}`}
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
