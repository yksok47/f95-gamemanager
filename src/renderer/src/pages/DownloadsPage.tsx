import { useMemo, type JSX } from "react";
import type { DownloadRecord } from "@shared/types";
import type { PackageInstallTags, P2pTransferProgress } from "@shared/p2p";
import DownloadRow from "../components/DownloadRow";
import FooterPortal from "../components/FooterPortal";
import P2pTransferRow from "../components/P2pTransferRow";
import { isActiveP2pDownload } from "../lib/downloads";

function downloadRecency(item: DownloadRecord): number {
  return item.finishedAt ?? item.updatedAt ?? item.startedAt;
}

/** `add:1757…:abc` / `seed:…` ids embed a start timestamp. */
function p2pRecency(item: P2pTransferProgress): number {
  const match = /^(?:add|seed):(\d+):/.exec(item.id);
  return match ? Number(match[1]) : 0;
}

type DownloadsPageProps = {
  items: DownloadRecord[];
  p2pEnabled: boolean;
  p2pTransfers?: P2pTransferProgress[];
  p2pSharedHashes?: ReadonlySet<string>;
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onShowInFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onClearFinished: () => void;
  onOpenFolder: () => void;
  onApproveDownload?: (id: string, tags: PackageInstallTags) => void;
  onRejectDownload?: (id: string) => void;
  onFlagDownload?: (id: string) => void;
  onPauseP2p?: (id: string) => void;
  onResumeP2p?: (id: string) => void;
  onStopP2p?: (id: string) => void;
  onRevealQuarantine?: (id: string) => void;
  onApproveQuarantine?: (id: string, tags: PackageInstallTags) => void;
  onRejectQuarantine?: (id: string) => void;
  onFlagQuarantine?: (id: string) => void;
  onOpenGame?: (threadId: number, title: string) => void;
};

type DownloadListRow =
  | { kind: "http"; at: number; item: DownloadRecord }
  | { kind: "p2p"; at: number; item: P2pTransferProgress };

export default function DownloadsPage({
  items,
  p2pEnabled,
  p2pTransfers = [],
  p2pSharedHashes,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile,
  onClearFinished,
  onOpenFolder,
  onApproveDownload,
  onRejectDownload,
  onFlagDownload,
  onPauseP2p,
  onResumeP2p,
  onStopP2p,
  onRevealQuarantine,
  onApproveQuarantine,
  onRejectQuarantine,
  onFlagQuarantine,
  onOpenGame,
}: DownloadsPageProps): JSX.Element {
  const finished = items.some(
    (item) => item.status === "completed" || item.status === "cancelled",
  );
  const rows = useMemo(() => {
    const next: DownloadListRow[] = items.map((item) => ({
      kind: "http",
      at: downloadRecency(item),
      item,
    }));
    if (p2pEnabled) {
      for (const item of p2pTransfers) {
        if (!isActiveP2pDownload(item, p2pSharedHashes)) continue;
        next.push({ kind: "p2p", at: p2pRecency(item), item });
      }
    }
    return next.sort((a, b) => b.at - a.at);
  }, [items, p2pEnabled, p2pTransfers, p2pSharedHashes]);
  const totalCount = rows.length;

  return (
    <div className="settings-page">
      <FooterPortal>
        <span className="muted pager-label">
          {totalCount === 1 ? "1 download" : `${totalCount} downloads`}
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

        {totalCount === 0 ? (
          <p className="muted">
            No downloads yet. Use a download link from a game page.
          </p>
        ) : (
          <div className="downloads-page-list">
            {rows.map((row) =>
              row.kind === "p2p" ? (
                <P2pTransferRow
                  key={`p2p-dl-${row.item.id}`}
                  item={row.item}
                  onPause={(id) => onPauseP2p?.(id)}
                  onResume={(id) => onResumeP2p?.(id)}
                  onStop={(id) => onStopP2p?.(id)}
                  onRevealQuarantine={(id) => onRevealQuarantine?.(id)}
                  onApproveQuarantine={(id, tags) =>
                    onApproveQuarantine?.(id, tags)
                  }
                  onRejectQuarantine={(id) => onRejectQuarantine?.(id)}
                  onFlagQuarantine={(id) => onFlagQuarantine?.(id)}
                  onOpenGame={onOpenGame}
                />
              ) : (
                <DownloadRow
                  key={row.item.id}
                  item={row.item}
                  onCancel={onCancel}
                  onPause={onPause}
                  onResume={onResume}
                  onRemove={onRemove}
                  onShowInFolder={onShowInFolder}
                  onOpenFile={onOpenFile}
                  onOpenGame={onOpenGame}
                  onApprove={(id, tags) => onApproveDownload?.(id, tags)}
                  onReject={(id) => onRejectDownload?.(id)}
                  onFlag={(id) => onFlagDownload?.(id)}
                />
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
