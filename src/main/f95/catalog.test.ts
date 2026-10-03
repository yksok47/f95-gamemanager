import { afterEach, describe, expect, mock, test } from 'bun:test'
import { F95Error } from './errors'

type FetchResult = { body: string; response: Response }

const f95Fetch = mock(async (_path: string, _init?: RequestInit): Promise<FetchResult> => {
  throw new Error('unmocked f95Fetch')
})

mock.module('./http', () => ({
  F95Error,
  f95Fetch: (path: string, init?: RequestInit) => f95Fetch(path, init)
}))

const { fetchCatalog, fetchCatalogFilters, mapGame, resetCatalogRequestState } = await import('./catalog')

function okResponse(body: string): FetchResult {
  return { body, response: new Response(body, { status: 200 }) }
}

function listBody(threadId = 1): string {
  return JSON.stringify({
    status: 'ok',
    msg: {
      data: [
        {
          thread_id: threadId,
          title: 'Forest Walk',
          creator: 'Alice',
          version: '1.0',
          views: 10,
          likes: 2,
          rating: 4.5,
          date: '2026-01-01',
          ts: 1700000000,
          prefixes: [7]
        }
      ],
      pagination: { page: 1, total: 3 },
      count: 180
    }
  })
}

function commandOf(path: string): string {
  if (path.includes('cmd=options')) return 'options'
  if (path.includes('cmd=filters')) return 'filters'
  if (path.includes('cmd=list')) return 'list'
  if (path.includes('/sam/latest_alpha/') && !path.includes('latest_data.php')) return 'html'
  return path
}

afterEach(() => {
  resetCatalogRequestState()
  f95Fetch.mockReset()
  f95Fetch.mockImplementation(async () => {
    throw new Error('unmocked f95Fetch')
  })
})

describe('fetchCatalog', () => {
  test('sets session options then lists, without fetching filters', async () => {
    const calls: string[] = []
    f95Fetch.mockImplementation(async (path) => {
      calls.push(commandOf(path))
      if (commandOf(path) === 'options') return okResponse('{"status":"ok"}')
      if (commandOf(path) === 'list') return okResponse(listBody())
      throw new Error(`unexpected ${path}`)
    })

    const page = await fetchCatalog({ page: 1, rows: 60, sort: 'date' })
    expect(calls).toEqual(['options', 'list'])
    expect(page.games).toHaveLength(1)
    expect(page.games[0]?.threadId).toBe(1)
    expect(page.totalPages).toBe(3)
  })

  test('coalesces overlapping identical list requests', async () => {
    const calls: string[] = []
    let releaseList: ((result: FetchResult) => void) | null = null
    let listStarted!: () => void
    const listGate = new Promise<void>((resolve) => {
      listStarted = resolve
    })
    f95Fetch.mockImplementation(async (path) => {
      const cmd = commandOf(path)
      calls.push(cmd)
      if (cmd === 'options') return okResponse('{"status":"ok"}')
      if (cmd === 'list') {
        return await new Promise<FetchResult>((resolve) => {
          releaseList = resolve
          listStarted()
        })
      }
      throw new Error(`unexpected ${path}`)
    })

    const first = fetchCatalog({ page: 1, rows: 60 })
    const second = fetchCatalog({ page: 1, rows: 60 })
    await listGate
    expect(calls.filter((cmd) => cmd === 'list')).toHaveLength(1)
    expect(calls.filter((cmd) => cmd === 'options')).toHaveLength(1)

    releaseList?.(okResponse(listBody(42)))
    const [a, b] = await Promise.all([first, second])
    expect(a.games[0]?.threadId).toBe(42)
    expect(b.games[0]?.threadId).toBe(42)
  })

  test('does not reuse a finished list request', async () => {
    let lists = 0
    f95Fetch.mockImplementation(async (path) => {
      const cmd = commandOf(path)
      if (cmd === 'options') return okResponse('{"status":"ok"}')
      if (cmd === 'list') {
        lists += 1
        return okResponse(listBody(lists))
      }
      throw new Error(`unexpected ${path}`)
    })

    const first = await fetchCatalog({ page: 1, rows: 60 })
    const second = await fetchCatalog({ page: 1, rows: 60 })
    expect(lists).toBe(2)
    expect(first.games[0]?.threadId).toBe(1)
    expect(second.games[0]?.threadId).toBe(2)
  })
})

describe('mapGame', () => {
  test('stringifies numeric title, creator, and version from SAM JSON', () => {
    const game = mapGame({
      thread_id: 42,
      title: 365,
      creator: 7,
      version: 1.2,
      views: 10,
      likes: 2,
      rating: 4.5,
      date: '2026-01-01',
      ts: 1700000000
    })
    expect(game.title).toBe('365')
    expect(game.creator).toBe('7')
    expect(game.version).toBe('1.2')
  })
})

describe('fetchCatalogFilters', () => {
  test('reads prefixes and tags from the latest_alpha page, not cmd=filters', async () => {
    const calls: string[] = []
    f95Fetch.mockImplementation(async (path) => {
      calls.push(commandOf(path))
      if (commandOf(path) !== 'html') throw new Error(`unexpected ${path}`)
      return okResponse(`
        <script>
          window.SAM = {
            "prefixes": [{ "id": 99, "name": "Unity" }],
            "tags": [{ "id": 9, "name": "NTR" }]
          }
        </script>
      `)
    })

    const filters = await fetchCatalogFilters()
    expect(calls).toEqual(['html'])
    expect(filters.tags).toEqual([{ id: 9, name: 'NTR' }])
    expect(filters.prefixes.some((prefix) => prefix.id === 99 && prefix.name === 'Unity')).toBe(true)
  })
})
