import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/main/f95/parser/**/*.test.ts'],
    globalSetup: './src/main/f95/parser/vitest-setup.ts',
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  }
})
