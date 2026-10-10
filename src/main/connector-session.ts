import { session } from 'electron'
import type { ConnectorFetch } from '@shared/connector'

export function sessionUserAgent(): string {
  return session.defaultSession.getUserAgent()
}

export function sessionFetch(): ConnectorFetch {
  return (input, init) =>
    session.defaultSession.fetch(input, {
      method: init?.method,
      headers: {
        'User-Agent': sessionUserAgent(),
        ...init?.headers
      },
      body: init?.body,
      redirect: init?.redirect
    })
}

export async function setSessionCookie(opts: {
  url: string
  name: string
  value: string
  domain?: string
}): Promise<void> {
  await session.defaultSession.cookies.set({
    url: opts.url,
    name: opts.name,
    value: opts.value,
    domain: opts.domain,
    path: '/'
  })
}
