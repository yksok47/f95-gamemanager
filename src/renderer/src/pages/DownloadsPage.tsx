import type { JSX } from "react";
import type { DownloadRecord } from "@shared/types";
import type { PackageInstallTags, P2pTransferProgress } from "@shared/p2p";
import DownloadRow from "../components/DownloadRow";
import FooterPortal from "../components/FooterPortal";
import P2pTransferRow from "../components/P2pTransferRow";
import { isActiveP2pDownload } from "../lib/downloads";

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
  onPauseP2p?: (id: string) => void;
  onResumeP2p?: (id: string) => void;
  onStopP2p?: (id: string) => void;
  onRevealQuarantine?: (id: string) => void;
  onApproveQuarantine?: (id: string, tags: PackageInstallTags) => void;
  onRejectQuarantine?: (id: string) => void;
  onFlagQuarantine?: (id: string) => void;
  onOpenGame?: (threadId: number, title: string) => void;
};

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
  const downloading = p2pEnabled
    ? p2pTransfers.filter((t) => isActiveP2pDownload(t, p2pSharedHashes))
    : [];
  const totalCount = items.length + downloading.length;

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
            {downloading.map((item) => (
              <P2pTransferRow
                key={`p2p-dl-${item.id}`}
                item={item}
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
            ))}
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
                onApprove={(id, tags) => onApproveDownload?.(id, tags)}
                onReject={(id) => onRejectDownload?.(id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
