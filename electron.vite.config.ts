import { resolve } from 'path'
import { cpSync, mkdirSync, existsSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = {
  '@shared': resolve('src/shared')
}

/** Copy ESM shims beside main bundle so registerWebtorrentCompat can find them. */
function copyP2pShimsPlugin() {
  return {
    name: 'copy-p2p-shims',
    writeBundle(options: { dir?: string; file?: string }) {
      const outDir = options.dir || (options.file ? resolve(options.file, '..') : resolve('out/main'))
      const srcDir = resolve('src/main/p2p/shims')
      const destDir = resolve(outDir, 'shims')
      if (!existsSync(srcDir)) return
      mkdirSync(destDir, { recursive: true })
      cpSync(srcDir, destDir, { recursive: true })
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [copyP2pShimsPlugin()]
  },
  preload: {
    resolve: { alias: sharedAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})