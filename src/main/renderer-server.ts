import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp'
}

let server: Server | null = null

/** Map a request path onto a file under the renderer build. Null if it escapes the root. */
export function safeRendererFile(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '')
  const relativePath = !decoded || decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const base = resolve(root)
  const file = resolve(base, relativePath)
  const rel = relative(base, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return file
}

/**
 * Packaged Electron used file://, which YouTube rejects (error 152-4).
 * Dev serve works because the UI is http://localhost — mirror that on loopback.
 */
export function startRendererServer(root: string): Promise<string> {
  if (server) {
    const addr = server.address()
    if (addr && typeof addr !== 'string') return Promise.resolve(`http://127.0.0.1:${addr.port}`)
  }

  const base = resolve(root)
  return new Promise((resolvePromise, reject) => {
    const next = createServer((req, res) => {
      void (async () => {
        const file = safeRendererFile(base, req.url || '/')
        if (!file) {
          res.writeHead(403)
          res.end()
          return
        }
        try {
          const bytes = await readFile(file)
          res.writeHead(200, {
            'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-cache'
          })
          res.end(bytes)
        } catch {
          res.writeHead(404)
          res.end()
        }
      })()
    })
    next.once('error', reject)
    next.listen(0, '127.0.0.1', () => {
      const addr = next.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('renderer server has no port'))
        return
      }
      server = next
      resolvePromise(`http://127.0.0.1:${addr.port}`)
    })
  })
}

export function stopRendererServer(): void {
  server?.close()
  server = null
}
