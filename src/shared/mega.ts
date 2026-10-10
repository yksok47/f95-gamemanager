import { hostnameOf, parseHttpUrl } from './connector'

const PAGE_HOSTS = new Set(['mega.nz', 'mega.io', 'mega.co.nz'])
const FILE_PATH = /^\/(file|folder)\//i

export type MegaNode = {
  name?: string | null
  size?: number
  directory?: boolean
  children?: MegaNode[]
}

export function isMegaHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

/** True for MEGA file/folder shares. The decryption key lives in the URL fragment. */
export function isMegaPageUrl(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url || !isMegaHost(url.hostname)) return false
  if (FILE_PATH.test(url.pathname)) return true
  const pathAndHash = `${url.pathname}${url.hash}`
  return /\/#?!/.test(pathAndHash) || /\/#F!/i.test(pathAndHash)
}

/** Base64url ids and keys from a MEGA share link. `node` selects one entry inside a folder share. */
export type MegaLink =
  | { kind: 'file'; id: string; key: string }
  | { kind: 'folder'; id: string; key: string; node?: string }

const LINK_PATH = /^\/(file|folder|embed)\/([\w-]+)\/?$/i
const LEGACY_HASH = /^(F?)!([\w-]+)!([\w-]+)(?:!([\w-]+))?/

export function parseMegaLink(href: string): MegaLink | null {
  const url = parseHttpUrl(href)
  if (!url || !isMegaHost(url.hostname)) return null
  const hash = url.hash.replace(/^#/, '')
  const modern = LINK_PATH.exec(url.pathname)
  if (modern) {
    const [key, ...rest] = hash.split('/')
    if (!key || !/^[\w-]+$/.test(key)) return null
    const id = modern[2]
    if (modern[1].toLowerCase() !== 'folder') return { kind: 'file', id, key }
    const node = rest.length >= 2 && /^(file|folder)$/i.test(rest[0]) ? rest[1] : undefined
    return node ? { kind: 'folder', id, key, node } : { kind: 'folder', id, key }
  }
  const legacy = LEGACY_HASH.exec(hash)
  if (!legacy) return null
  const [, folder, id, key, node] = legacy
  if (!folder) return { kind: 'file', id, key }
  return node ? { kind: 'folder', id, key, node } : { kind: 'folder', id, key }
}

export function megaHasKey(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url) return false
  const hash = url.hash.replace(/^#/, '')
  if (hash.includes('!')) return hash.split('!').filter(Boolean).length >= 2
  return hash.length > 8
}

export function listMegaFiles<T extends MegaNode>(root: T): T[] {
  if (!root.directory) return [root]
  const files: T[] = []
  const walk = (node: T): void => {
    if (!node.directory) files.push(node)
    for (const child of (node.children ?? []) as T[]) walk(child)
  }
  walk(root)
  return files
}
