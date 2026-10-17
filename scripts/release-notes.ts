import { readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const [releaseDir = 'release', outFile = 'release-notes.md'] = process.argv.slice(2)
const repo = process.env.GITHUB_REPOSITORY ?? 'owner/repo'
const tag = process.env.GITHUB_REF_NAME ?? 'v0.0.0'

const files = readdirSync(releaseDir).filter((name) => statSync(join(releaseDir, name)).isFile())
const used = new Set<string>()

function find(suffix: string): string | undefined {
  const name = files.find((f) => f.endsWith(suffix))
  if (name) used.add(name)
  else console.warn(`No release file ending with ${suffix}`)
  return name
}

function size(name: string): string {
  const kb = statSync(join(releaseDir, name)).size / 1024
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(0)} MB`
}

function link(name: string | undefined): string {
  if (!name) return '—'
  const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`
  return `[⬇️ \`${name}\`](${url}) · ${size(name)}`
}

type Row = [label: string, description: string, file: string | undefined]

function table(rows: Row[]): string {
  const present = rows.filter(([, , file]) => file)
  if (present.length === 0) return '_Not available in this release._'
  return [
    '| Package | Download | Notes |',
    '| --- | --- | --- |',
    ...present.map(([label, description, file]) => `| **${label}** | ${link(file)} | ${description} |`)
  ].join('\n')
}

const windows = table([
  ['Installer', 'Recommended. Installs the app with Start Menu and desktop shortcuts.', find('-setup.exe')],
  ['Portable', 'No installation. Unzip anywhere and run `win-unpacked\\F95GameManager.exe`.', find('-win-unpacked.zip')]
])

const mac = table([
  ['Apple Silicon (M1 and newer) · Installer', 'Open the `.dmg` and drag the app into Applications.', find('-mac-arm64.dmg')],
  ['Apple Silicon (M1 and newer) · Portable', 'Unzip and run the `.app` from any folder.', find('-mac-arm64.zip')],
  ['Intel · Installer', 'Open the `.dmg` and drag the app into Applications.', find('-mac-x64.dmg')],
  ['Intel · Portable', 'Unzip and run the `.app` from any folder.', find('-mac-x64.zip')]
])

const linux = table([
  ['AppImage', 'Recommended. Single file, runs on most distributions.', find('.AppImage')],
  ['Portable', 'Unzip anywhere and run `linux-unpacked/F95GameManager`.', find('-linux-unpacked.zip')]
])

const checksums = find('SHA512SUMS')
const others = files.filter((f) => !used.has(f)).sort()

const sections = [
  '## 📥 Downloads',
  '',
  'Not sure which file you need? Pick your operating system below. **Installer** sets the app up on your system; **Portable** runs from any folder without installing.',
  '',
  '### 🪟 Windows (64-bit)',
  '',
  windows,
  '',
  '> If SmartScreen shows "Windows protected your PC", click **More info → Run anyway**. The app is not code-signed.',
  '',
  '### 🍎 macOS',
  '',
  'Not sure which Mac you have? Open the Apple menu → **About This Mac**. "Apple M1/M2/M3/M4…" means Apple Silicon, "Intel" means Intel.',
  '',
  mac,
  '',
  '> The app is not notarized. On first launch, right-click the app → **Open**, or run `xattr -cr "/Applications/F95 Game Manager.app"`.',
  '',
  '### 🐧 Linux (x86_64)',
  '',
  linux,
  '',
  '> Make the AppImage executable before running it: `chmod +x f95-gamemanager-*.AppImage`.',
  ''
]

if (checksums || others.length > 0) {
  sections.push('<details>', '<summary>Checksums and other files</summary>', '')
  if (checksums) sections.push(`- ${link(checksums)} — SHA-512 checksums for every file in this release`)
  for (const name of others) sections.push(`- ${link(name)}`)
  sections.push('', '</details>', '')
}

sections.push('---', '')

writeFileSync(outFile, sections.join('\n'))
console.log(`Wrote ${outFile}`)
