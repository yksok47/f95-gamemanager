import { describe, expect, test } from 'bun:test'
import {
  createInstallReportQueue,
  isMetadataNotFoundError,
  type InstallReportPayload
} from './install-report'

function payload(id: string): InstallReportPayload {
  return {
    seederPubkey: 'pk',
    ts: 1,
    signature: 'sig',
    tags: { os: [0], contentKind: 1, version: id }
  }
}

function notFound(hash: string): Error {
  return new Error(`metadata POST /api/v1/packages/${hash}/installs → 404 {"error":"package not found"}`)
}

describe('isMetadataNotFoundError', () => {
  test('matches metadata-client 404 errors', () => {
    expect(isMetadataNotFoundError(notFound('abc'))).toBe(true)
    expect(isMetadataNotFoundError(new Error('metadata POST /x → 500 boom'))).toBe(false)
    expect(isMetadataNotFoundError('nope')).toBe(false)
  })
})

describe('createInstallReportQueue', () => {
  test('posts immediately when the package already exists', async () => {
    const posted: string[] = []
    const queue = createInstallReportQueue(async (hash, body) => {
      posted.push(`${hash}:${body.tags?.version}`)
    })
    await queue.report('AA', payload('1.0'))
    expect(posted).toEqual(['aa:1.0'])
  })

  test('keeps a 404 and flushes it after register', async () => {
    const posted: string[] = []
    let exists = false
    const queue = createInstallReportQueue(async (hash, body) => {
      if (!exists) throw notFound(hash)
      posted.push(`${hash}:${body.tags?.version}`)
    })
    await queue.report('bb', payload('2.0'))
    expect(posted).toEqual([])
    exists = true
    await queue.onPackageRegistered('BB')
    expect(posted).toEqual(['bb:2.0'])
  })

  test('does not lose a report that 404s while register is in flight', async () => {
    const posted: string[] = []
    let releasePost!: () => void
    const started = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    let calls = 0
    const queue = createInstallReportQueue(async (hash, body) => {
      calls += 1
      if (calls === 1) {
        await started
        throw notFound(hash)
      }
      posted.push(`${hash}:${body.tags?.version}`)
    })
    const report = queue.report('cc', payload('3.0'))
    const registered = queue.onPackageRegistered('cc')
    releasePost()
    await Promise.all([report, registered])
    expect(posted).toEqual(['cc:3.0'])
  })

  test('drops non-404 failures instead of retrying forever', async () => {
    let calls = 0
    const queue = createInstallReportQueue(async () => {
      calls += 1
      throw new Error('metadata POST /x → 400 bad tags')
    })
    await expect(queue.report('dd', payload('4.0'))).rejects.toThrow(/400/)
    await queue.onPackageRegistered('dd')
    expect(calls).toBe(1)
  })
})
