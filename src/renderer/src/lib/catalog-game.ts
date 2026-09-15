import type { CatalogGame } from '@shared/types'

type CatalogLike = {
  threadId: number
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes?: number
  views?: number
  updatedAt?: string
  timestamp?: number
  threadUrl: string
  prefixes?: number[]
  tags?: number[]
  screens?: string[]
  engine?: string
  isNew?: boolean
}

export function toCatalogGame(game: CatalogLike): CatalogGame {
  return {
    threadId: game.threadId,
    title: game.title,
    creator: game.creator,
    version: game.version,
    views: game.views ?? 0,
    likes: game.likes ?? 0,
    rating: game.rating,
    coverUrl: game.coverUrl,
    updatedAt: game.updatedAt || '',
    timestamp: game.timestamp || 0,
    isNew: Boolean(game.isNew),
    threadUrl: game.threadUrl,
    prefixes: game.prefixes ?? [],
    tags: game.tags ?? [],
    screens: game.screens ?? [],
    engine: game.engine
  }
}
