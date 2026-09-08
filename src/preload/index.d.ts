import type { GameManagerApi } from './index'

declare global {
  interface Window {
    api: GameManagerApi
  }
}

export {}
