import { useState, type JSX } from "react";
import type { DownloadRecord } from "@shared/types";
import type { P2pTransferProgress, TorrentMapEntry } from "@shared/p2p";
import DownloadRow from "../components/DownloadRow";
import FooterPortal from "../components/FooterPortal";
import P2pTransferRow from "../components/P2pTransferRow";
import { formatBytes, formatSpeed } from "../lib/downloads";

type DownloadsPageProps = {
  items: DownloadRecord[];
  p2pEnabled: boolean;
  p2pTransfers?: P2pTransferProgress[];
  p2pShared?: TorrentMapEntry[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onClearFinished: () => void;
  onOpenFolder: () => void;
  onPauseP2p?: (id: string) => void;
  onResumeP2p?: (id: string) => void;
  onStopP2p?: (id: string) => void;
  onRevealQuarantine?: (id: string) => void;
  onApproveQuarantine?: (id: string) => void;
  onRejectQuarantine?: (id: string) => void;
  onFlagQuarantine?: (id: string) => void;
  onOpenGame?: (threadId: number, title: string) => void;
};

function shortHash(value: string | null | undefined): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function SharedRow({
  entry,
  live,
  onOpenGame,
}: {
  entry: TorrentMapEntry;
  live?: P2pTransferProgress;
  onOpenGame?: (threadId: number, title: string) => void;
}): JSX.Element {
  const gameLabel =
    entry.gameName?.trim() ||
    (entry.f95ThreadId != null
      ? `Thread ${entry.f95ThreadId}`
      : "Unknown game");
  const packageLabel =
    entry.normalizedName || shortHash(entry.contentHash) || entry.path;
  const up = live ? `↑ ${formatSpeed(live.uploadSpeed || 0)}` : "";
  const connected = live?.numPeers ?? 0;
  const active = live?.numActivePeers ?? 0;
  const peers = live ? `${active} active / ${connected} connected` : "";

  return (
    <article className="download-row">
      <div className="download-row-main">
        <div className="download-row-title">
          {onOpenGame && entry.f95ThreadId != null ? (
            <button
              className="download-game-link"
              type="button"
              title={`Open ${gameLabel}`}
              onClick={() => onOpenGame(entry.f95ThreadId!, gameLabel)}
            >
              {gameLabel}
            </button>
          ) : (
            <strong title={gameLabel}>{gameLabel}</strong>
          )}
          <span className="download-status download-status-completed">
            Sharing
          </span>
        </div>
        <p className="muted download-url" title={entry.path}>
          {packageLabel}
        </p>
        <p className="muted download-meta">
          {[formatBytes(entry.sizeBytes), up, peers]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </article>
  );
}

export default function DownloadsPage({
  items,
  p2pEnabled,
  p2pTransfers = [],
  p2pShared = [],
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile,
  onClearFinished,
  onOpenFolder,
  onPauseP2p,
  onResumeP2p,
  onStopP2p,
  onRevealQuarantine,
  onApproveQuarantine,
  onRejectQuarantine,
  onFlagQuarantine,
  onOpenGame,
}: DownloadsPageProps): JSX.Element {
  const [p2pTab, setP2pTab] = useState<"downloading" | "uploading">(
    "downloading",
  );
  const finished = items.some(
    (item) => item.status === "completed" || item.status === "cancelled",
  );
  const shared = p2pEnabled ? p2pShared : [];
  const sharedHashes = new Set(
    shared.map((entry) => entry.contentHash.toLowerCase()),
  );
  const liveByHash = new Map(
    p2pTransfers
      .filter((t) => t.contentHash)
      .map((t) => [t.contentHash!.toLowerCase(), t] as const),
  );
  // In-flight only — completed downloads move to Files / shared list (no duplicate row).
  const downloading = p2pTransfers.filter((t) => {
    const inflight =
      t.state === "connecting" ||
      t.state === "downloading" ||
      t.state === "checking" ||
      t.state === "paused" ||
      t.state === "quarantined" ||
      t.state === "error";
    if (!inflight) return false;
    // Reseed of a mapped share must not sit above Sharing as "Downloading".
    if (
      t.id.startsWith("seed:") &&
      t.contentHash &&
      sharedHashes.has(t.contentHash.toLowerCase()) &&
      t.state !== "paused" &&
      t.state !== "error"
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="settings-page">
      <FooterPortal>
        <span className="muted pager-label">
          {items.length === 1 ? "1 download" : `${items.length} downloads`}
          {p2pEnabled
            ? p2pTab === "downloading"
              ? ` · ${downloading.length} p2p`
              : ` · ${shared.length} sharing`
            : ""}
        </span>
      </FooterPortal>
      <section className="settings-card">
        <div className="downloads-page-header">
          <div>
            <h1>Downloads</h1>
          </div>
          <div className="downloads-page-actions">
            <button className="ghost-btn" type="button" onClick={onOpenFolder}>
              Open folder
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={!finished}
              onClick={onClearFinished}
            >
              Clear finished
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="muted">
            No downloads yet. Use a download link from a game page.
          </p>
        ) : (
          <div className="downloads-page-list">
            {items.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                onCancel={onCancel}
                onPause={onPause}
                onResume={onResume}
                onRemove={onRemove}
                onShowInFolder={onShowInFolder}
                onOpenFile={onOpenFile}
                onOpenGame={onOpenGame}
              />
            ))}
          </div>
        )}
      </section>

      {p2pEnabled ? (
        <section className="settings-card downloads-p2p-card">
          <div className="downloads-page-header">
            <div>
              <h1>P2P</h1>
            </div>
          </div>

          <div
            className="downloads-p2p-tabs"
            role="tablist"
            aria-label="P2P transfers"
          >
            <button
              className={
                p2pTab === "downloading"
                  ? "details-tab details-tab-active"
                  : "details-tab"
              }
              type="button"
              role="tab"
              aria-selected={p2pTab === "downloading"}
              onClick={() => setP2pTab("downloading")}
            >
              Downloading
              <span className="details-tab-count">{downloading.length}</span>
            </button>
            <button
              className={
                p2pTab === "uploading"
                  ? "details-tab details-tab-active"
                  : "details-tab"
              }
              type="button"
              role="tab"
              aria-selected={p2pTab === "uploading"}
              onClick={() => setP2pTab("uploading")}
            >
              Uploading
              <span className="details-tab-count">{shared.length}</span>
            </button>
          </div>

          {p2pTab === "downloading" ? (
            downloading.length ? (
              <div className="downloads-page-list">
                {downloading.map((item) => (
                  <P2pTransferRow
                    key={`p2p-dl-${item.id}`}
                    item={item}
                    onPause={(id) => onPauseP2p?.(id)}
                    onResume={(id) => onResumeP2p?.(id)}
                    onStop={(id) => onStopP2p?.(id)}
                    onRevealQuarantine={(id) => onRevealQuarantine?.(id)}
                    onApproveQuarantine={(id) => onApproveQuarantine?.(id)}
                    onRejectQuarantine={(id) => onRejectQuarantine?.(id)}
                    onFlagQuarantine={(id) => onFlagQuarantine?.(id)}
                    onOpenGame={onOpenGame}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">No P2P downloads in progress.</p>
            )
          ) : shared.length ? (
            <div className="downloads-page-list">
              {shared.map((entry) => (
                <SharedRow
                  key={entry.contentHash}
                  entry={entry}
                  live={liveByHash.get(entry.contentHash.toLowerCase())}
                  onOpenGame={onOpenGame}
                />
              ))}
            </div>
          ) : (
            <p className="muted">No packages are being shared yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
