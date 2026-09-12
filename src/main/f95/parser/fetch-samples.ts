import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'firstPost', 'samples')
const LINKS_FILE = join(SAMPLES_DIR, 'links.txt')
const COOKIES_FILE = join(SAMPLES_DIR, 'cookies.txt')
const USER_AGENT_FILE = join(SAMPLES_DIR, 'user-agent.txt')
const DELAY_MS = 1500

function readLinks(path: string): string[] {
  return readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function readUserAgent(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Missing user-agent file: ${path}`)
  }
  const value = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
  if (!value) {
    throw new Error(`Empty user-agent file: ${path}`)
  }
  return value
}

function curlBin(): string {
  return process.platform === 'win32' ? 'curl.exe' : 'curl'
}

function sleep(ms: number): void {
  Bun.sleepSync(ms)
}

function download(
  url: string,
  dest: string,
  userAgent: string
): { status: number; ok: boolean; error?: string } {
  mkdirSync(dirname(dest), { recursive: true })
  const args = [
    '-sS',
    '-L',
    '--compressed',
    '--max-time',
    '60',
    '-A',
    userAgent,
    '-H',
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H',
    'Accept-Language: en-US,en;q=0.9',
    '-o',
    dest,
    '-w',
    '%{http_code}',
    url
  ]
  if (existsSync(COOKIES_FILE)) args.splice(args.length - 1, 0, '-b', COOKIES_FILE)

  const result = spawnSync(curlBin(), args, { encoding: 'utf8' })
  if (result.error) {
    return { status: 0, ok: false, error: result.error.message }
  }
  if (result.status !== 0 && !result.stdout) {
    return { status: 0, ok: false, error: (result.stderr || `curl exited ${result.status}`).trim() }
  }

  const status = Number.parseInt((result.stdout || '').trim(), 10) || 0
  const ok = status >= 200 && status < 400
  return {
    status,
    ok,
    error: ok ? undefined : (result.stderr || `HTTP ${status}`).trim()
  }
}

const links = readLinks(LINKS_FILE)
if (!links.length) {
  console.error(`No links found in ${LINKS_FILE}`)
  process.exit(1)
}

const userAgent = readUserAgent(USER_AGENT_FILE)

console.log(`Downloading ${links.length} page(s) with ${curlBin()}`)
console.log(`Using user-agent from ${USER_AGENT_FILE}`)
if (existsSync(COOKIES_FILE)) console.log(`Using cookies from ${COOKIES_FILE}`)

let failed = 0
for (const [index, url] of links.entries()) {
  const id = String(index + 1)
  const dest = join(SAMPLES_DIR, id, 'input.html')
  process.stdout.write(`${id}/${links.length} ${url} ... `)
  const result = download(url, dest, userAgent)
  if (result.ok) {
    console.log(`${result.status} -> ${dest}`)
  } else {
    failed += 1
    console.log(`FAILED ${result.error ?? result.status}`)
  }
  if (index < links.length - 1) sleep(DELAY_MS)
}

if (failed) {
  console.error(`Finished with ${failed} failure(s).`)
  process.exit(1)
}

console.log('Done.')
