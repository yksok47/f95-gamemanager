import type { JSX } from "react";
import type { P2pTransferProgress, TorrentMapEntry } from "@shared/p2p";
import FooterPortal from "../components/FooterPortal";
import { formatBytes, formatSpeed } from "../lib/downloads";

type UploadsPageProps = {
  shared: TorrentMapEntry[];
  liveTransfers?: P2pTransferProgress[];
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

export default function UploadsPage({
  shared,
  liveTransfers = [],
  onOpenGame,
}: UploadsPageProps): JSX.Element {
  const liveByHash = new Map(
    liveTransfers
      .filter((t) => t.contentHash)
      .map((t) => [t.contentHash!.toLowerCase(), t] as const),
  );

  return (
    <div className="settings-page">
      <FooterPortal>
        <span className="muted pager-label">
          {shared.length === 1
            ? "1 package sharing"
            : `${shared.length} packages sharing`}
        </span>
      </FooterPortal>
      <section className="settings-card">
        <div className="downloads-page-header">
          <div>
            <h1>Uploads</h1>
          </div>
        </div>

        {shared.length ? (
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
    </div>
  );
}
