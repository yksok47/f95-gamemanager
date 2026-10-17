import { readFileSync } from 'fs'

export type ChangelogEntry = {
  version: string
  date: string | null
  body: string
}

const HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)\]?(?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?\s*$/

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: { version: string; date: string | null; lines: string[] } | null = null
  const flush = (): void => {
    if (current) entries.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() })
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      flush()
      const match = line.match(HEADING)
      current = match ? { version: match[1], date: match[2] ?? null, lines: [] } : null
      continue
    }
    current?.lines.push(line)
  }
  flush()
  return entries
}

export function readChangelog(path = 'CHANGELOG.md'): ChangelogEntry[] {
  return parseChangelog(readFileSync(path, 'utf8'))
}

export function changelogEntry(entries: ChangelogEntry[], version: string): ChangelogEntry | undefined {
  const wanted = version.replace(/^v/i, '')
  return entries.find((entry) => entry.version === wanted)
}

if (import.meta.main) {
  const [command, arg, path] = process.argv.slice(2)
  const entries = readChangelog(path)
  if (command === 'latest') {
    if (!entries[0]) {
      console.error('No version sections found in the changelog')
      process.exit(1)
    }
    console.log(entries[0].version)
  } else if (command === 'notes' && arg) {
    const entry = changelogEntry(entries, arg)
    if (!entry) {
      console.error(`No changelog section for ${arg}`)
      process.exit(1)
    }
    console.log(entry.body)
  } else {
    console.error('Usage: bun scripts/changelog.ts latest [file] | notes <version> [file]')
    process.exit(1)
  }
}
