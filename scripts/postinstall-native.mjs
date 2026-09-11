/**
 * Rebuild native deps for Electron when possible.
 * Optional modules (bufferutil, utf-8-validate from ws) need VS Build Tools on Windows;
 * missing them must not fail bun i / npm i — ws falls back to pure JS.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', 'install-app-deps'],
  { stdio: 'inherit', shell: false }
)

if (result.status === 0) {
  process.exit(0)
}

console.warn(
  '[postinstall] Native Electron rebuild failed (often missing VS Build Tools).'
)
console.warn(
  '[postinstall] Continuing install — optional natives like bufferutil are not required for P2P/dev.'
)
console.warn(
  '[postinstall] To retry later: bun run rebuild:native'
)
process.exit(0)
