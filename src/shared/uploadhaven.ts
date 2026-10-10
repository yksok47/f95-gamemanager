import { hostnameOf, parseHttpUrl } from './connector'

const PAGE_HOSTS = new Set(['uploadhaven.com'])
const PAGE_PATH = /^\/download\/([^/?#]+)/i
const SKIP = new Set([
  'account',
  'api',
  'contact',
  'css',
  'faq',
  'help',
  'img',
  'js',
  'login',
  'premium',
  'pricing',
  'privacy',
  'register',
  'support',
  'tos'
])

export function isUploadHavenHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function uploadHavenIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isUploadHavenHost(url.hostname)) return null
  const id = url.pathname.match(PAGE_PATH)?.[1]?.trim()
  if (!id || SKIP.has(id.toLowerCase())) return null
  return id
}

export function isUploadHavenPageUrl(href: string): boolean {
  return Boolean(uploadHavenIdFromUrl(href))
}

export function uploadHavenPageUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  const id = uploadHavenIdFromUrl(href)
  if (!url || !id) return null
  return `https://${hostnameOf(url.hostname)}/download/${id}`
}
