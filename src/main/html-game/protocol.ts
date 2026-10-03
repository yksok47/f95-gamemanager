import { net, session } from 'electron'
import { relative } from 'path'
import { pathToFileURL } from 'url'
import { pathExists, resolveLongPath } from '../win-path'
import {
  HTML_GAME_PARTITION,
  HTML_GAME_SCHEME,
  htmlGameUrl,
  mimeForGameFile,
  parseHtmlGameRequest,
  safeGameFile
} from './paths'

export { HTML_GAME_SCHEME_PRIVILEGES, htmlGameOrigin, htmlGameUrl } from './paths'
export { HTML_GAME_PARTITION, HTML_GAME_SCHEME } from './paths'

type HtmlGameMount = {
  root: string
  entry: string
}

const mounts = new Map<number, HtmlGameMount>()
let registered = false

export function htmlGameSession(): Electron.Session {
  return session.fromPartition(HTML_GAME_PARTITION)
}

export function mountHtmlGame(threadId: number, root: string, entry: string): void {
  mounts.set(threadId, { root: resolveLongPath(root), entry: resolveLongPath(entry) })
}

export function unmountHtmlGame(threadId: number): void {
  mounts.delete(threadId)
}

export function htmlGameMount(threadId: number): HtmlGameMount | undefined {
  return mounts.get(threadId)
}

export function htmlGameEntryUrl(threadId: number, root: string, entry: string): string {
  const rel = relative(root, entry).replace(/\\/g, '/')
  return htmlGameUrl(threadId, rel || entry.split(/[/\\]/).pop() || 'index.html')
}

export function registerHtmlGameProtocol(): void {
  if (registered) return
  registered = true
  const ses = htmlGameSession()
  ses.setSpellCheckerEnabled(false)
  ses.protocol.handle(HTML_GAME_SCHEME, async (request) => {
    const parsed = parseHtmlGameRequest(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })
    const mount = mounts.get(parsed.threadId)
    if (!mount) return new Response('Not found', { status: 404 })
    const file =
      parsed.pathname === '/' || parsed.pathname === ''
        ? mount.entry
        : safeGameFile(mount.root, parsed.pathname)
    if (!file || !pathExists(file)) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(file).href)
    const mime = mimeForGameFile(file)
    if (!mime) return response
    const headers = new Headers(response.headers)
    headers.set('content-type', mime)
    return new Response(response.body, { status: response.status, headers })
  })
}
