import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'

const HOST = 'https://f95zone.to'

/**
 * Banner / header art URL from first-post HTML.
 * Prefers the leading single-image lightbox (typical thread header), then the
 * first non-thumbnail `img.bbImage`.
 */
export function parseBanner(html: string): string {
  const $ = load(html)

  const single = $('[data-lb-single-image="1"]').first()
  if (single.length) {
    const fromSingle = urlFromContainer($, single)
    if (fromSingle) return fromSingle
  }

  for (const el of $('img.bbImage').toArray()) {
    const url = urlFromImage($, $(el))
    if (url) return url
  }

  return ''
}

function urlFromContainer($: CheerioAPI, container: Cheerio<AnyNode>): string | null {
  const zoomer = container.find('.lbContainer-zoomer').first().attr('data-src')
  const fromZoomer = acceptUrl(zoomer)
  if (fromZoomer) return fromZoomer

  const img = container.find('img.bbImage, img').first()
  if (img.length) return urlFromImage($, img)

  return acceptUrl(container.attr('data-src') || container.attr('href'))
}

function urlFromImage(_$: CheerioAPI, $img: Cheerio<AnyNode>): string | null {
  if (!$img.length || $img.is('.smilie, .reaction, .avatar')) return null

  const $zoomer = $img.closest('.lbContainer--inline, .lbContainer').find('.lbContainer-zoomer').first()
  const parentHref = $img.parent().is('a') ? $img.parent().attr('href') : undefined
  const candidates = [
    $zoomer.attr('data-src'),
    $img.attr('data-url'),
    $img.attr('data-fullurl'),
    $img.attr('data-original'),
    $img.attr('data-src'),
    parentHref,
    $img.attr('src')
  ]

  for (const candidate of candidates) {
    const url = acceptUrl(candidate)
    if (url) return url
  }
  return null
}

function acceptUrl(raw: string | undefined | null): string | null {
  const abs = absolutize(raw)
  if (!abs) return null
  if (abs.startsWith('data:') || abs.startsWith('javascript:')) return null
  if (isThumbnailUrl(abs)) return null
  if (!isImageAsset(abs)) return null
  return upgradeImageUrl(abs)
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed, HOST).href
  } catch {
    return null
  }
}

function isThumbnailUrl(url: string): boolean {
  return (
    /preview\.f95zone\./i.test(url) ||
    /\.thumb\.|_thumb\b|\/thumb(nails?)?\//i.test(url)
  )
}

function isImageAsset(url: string): boolean {
  return (
    /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(url) ||
    /attachments\.f95zone|preview\.f95zone/.test(url)
  )
}

function upgradeImageUrl(url: string): string {
  return url
    .replace(/^https?:\/\/preview\.f95zone\.(?:to|com|ninja)\//i, 'https://attachments.f95zone.to/')
    .replace(/\.thumb\.(jpe?g|png|gif|webp|avif)/i, '.$1')
    .replace(/([?&])thumb=\d+(?=&|$)/i, '')
    .replace(/\/thumb(nails?)?\//gi, '/')
}
