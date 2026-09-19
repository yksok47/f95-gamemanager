import { describe, expect, test } from 'bun:test'
import type { P2pTransferProgress } from '@shared/p2p'
import type { DownloadRecord } from '@shared/types'
import {
  collectThreadDownloads,
  isActiveDownload,
  isDockDownload
} from './downloads'

function httpDownload(partial: Partial<DownloadRecord> & Pick<DownloadRecord, 'id'>): DownloadRecord {
  return {
    filename: 'game.zip',
    url: 'https://example.test/game.zip',
    savePath: '/tmp/game.zip',
    receivedBytes: 50,
    totalBytes: 100,
    status: 'progressing',
    paused: false,
    canResume: false,
    bytesPerSecond: 1,
    startedAt: 100,
    updatedAt: 200,
    ...partial
  }
}

function p2pTransfer(
  partial: Partial<P2pTransferProgress> & Pick<P2pTransferProgress, 'id'>
): P2pTransferProgress {
  return {
    state: 'downloading',
    downloaded: 25,
    uploaded: 0,
    length: 100,
    downloadSpeed: 1,
    uploadSpeed: 0,
    progress: 0.25,
    numPeers: 1,
    ...partial
  }
}

describe('collectThreadDownloads', () => {
  test('includes in-progress HTTP downloads and skips cancelled ones', () => {
    const pending = collectThreadDownloads([
      httpDownload({
        id: 'a',
        gameThreadId: 11,
        gameTitle: 'Alpha',
        gameCoverUrl: 'https://cdn.test/a.jpg',
        receivedBytes: 40,
        totalBytes: 100
      }),
      httpDownload({
        id: 'b',
        status: 'cancelled',
        gameThreadId: 12,
        gameTitle: 'Beta'
      })
    ])

    expect([...pending.keys()]).toEqual([11])
    expect(pending.get(11)?.title).toBe('Alpha')
    expect(pending.get(11)?.coverUrl).toBe('https://cdn.test/a.jpg')
    expect(pending.get(11)?.percent).toBe(40)
    expect(pending.has(12)).toBe(false)
  })

  test('keeps hashing downloads until they are approved into the library', () => {
    const pending = collectThreadDownloads([
      httpDownload({
        id: 'c',
        status: 'completed',
        libraryStatus: 'hashing',
        gameThreadId: 21,
        receivedBytes: 100,
        totalBytes: 100
      })
    ])
    expect(pending.get(21)?.percent).toBe(100)
  })

  test('includes P2P downloads and drops them after they leave the swarm', () => {
    const active = collectThreadDownloads([], [
      p2pTransfer({
        id: 'p2p-1',
        f95ThreadId: 31,
        gameName: 'Gamma',
        progress: 0.6
      })
    ])
    expect(active.get(31)?.title).toBe('Gamma')
    expect(active.get(31)?.percent).toBe(60)

    const stopped = collectThreadDownloads([], [
      p2pTransfer({
        id: 'p2p-1',
        f95ThreadId: 31,
        gameName: 'Gamma',
        state: 'idle',
        progress: 0.6
      })
    ])
    expect(stopped.size).toBe(0)
  })
})

describe('download status helpers', () => {
  test('cancelled is not treated as an active or dock download', () => {
    const item = httpDownload({ id: 'x', status: 'cancelled', gameThreadId: 1 })
    expect(isActiveDownload(item)).toBe(false)
    expect(isDockDownload(item)).toBe(false)
  })
})
