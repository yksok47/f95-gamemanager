export type HostPlatform = 'win32' | 'linux' | 'darwin'

const SKIP_LAUNCH =
  /^(pythonw?|python3(\.\d+)?|uninstall|unins\d*|crashpad|unitycrashhandler|vcredist|dxsetup|crashreporter|7za)/i

const NON_LAUNCH_EXT =
  /\.(dll|so|dylib|a|o|lib|py|pyc|pyo|rpy|rpyc|rpym|txt|md|json|xml|ini|cfg|html|js|css|png|jpg|jpeg|gif|webp|ogg|mp3|wav|rpa|rpu|save|rpgsave|rmmzsave|log|dat|pickle)$/i

function stem(name: string): string {
  return name.replace(/\.(exe|sh|command|x86_64|x86|arm64|aarch64)$/i, '')
}

export function hostPlatformOf(platform = process.platform): HostPlatform {
  if (platform === 'win32' || platform === 'linux' || platform === 'darwin') return platform
  return 'linux'
}

export function isLaunchCandidate(
  name: string,
  kind: 'file' | 'dir',
  platform: HostPlatform
): boolean {
  if (!name || name.startsWith('.')) return false
  if (kind === 'dir') return platform === 'darwin' && /\.app$/i.test(name)
  if (SKIP_LAUNCH.test(stem(name)) || SKIP_LAUNCH.test(name)) return false
  if (NON_LAUNCH_EXT.test(name)) return false
  if (platform === 'win32') return /\.exe$/i.test(name)
  if (/\.exe$/i.test(name)) return false
  if (/\.(sh|command|x86_64|x86|arm64|aarch64)$/i.test(name)) return true
  return !name.includes('.')
}

export function scoreLaunchPath(filePath: string, platform: HostPlatform, arch: string): number {
  const normalized = filePath.replace(/\\/g, '/')
  const name = (normalized.split('/').pop() || '').toLowerCase()
  const lower = normalized.toLowerCase()
  const parts = lower.split('/')
  let score = 0

  if (parts.includes('lib')) score -= 25
  if (parts.includes('renpy')) score -= 20
  if (parts.includes('contents')) score -= 5

  if (/(^|[^a-z])(32|x86|win32|ia32|i386|i686)([^a-z]|$)|32bit|[-_.]32(\.|$)/i.test(name)) {
    score -= 12
  }
  if (/(^|[^a-z])(64|x64|win64|amd64|x86_64)([^a-z]|$)|64bit|[-_.]64(\.|$)/i.test(name)) {
    score += 8
  }

  if (arch === 'x64' && /x86_64|amd64|x64/.test(lower)) score += 12
  if (arch === 'arm64' && /arm64|aarch64/.test(lower)) score += 12
  if (arch === 'x64' && /arm64|aarch64/.test(lower)) score -= 15
  if (arch === 'arm64' && /x86_64|amd64/.test(lower) && !/universal/.test(lower)) score -= 8

  if (platform === 'linux' && name.endsWith('.sh')) score += 28
  if (platform === 'linux' && /\.x86_64$/i.test(name)) score += 12
  if (platform === 'darwin' && name.endsWith('.app')) score += 40
  if (platform === 'darwin' && name.endsWith('.command')) score += 18
  if (platform === 'darwin' && name.endsWith('.sh')) score += 10
  if (platform === 'win32' && name.endsWith('.exe')) score += 10

  return score
}

export function compareLaunchCandidates(
  a: string,
  b: string,
  platform: HostPlatform,
  arch: string,
  isDosShort?: (filePath: string) => boolean
): number {
  if (isDosShort) {
    const dos = Number(isDosShort(a)) - Number(isDosShort(b))
    if (dos) return dos
  }
  const score = scoreLaunchPath(b, platform, arch) - scoreLaunchPath(a, platform, arch)
  if (score) return score
  return a.length - b.length
}

const SKIP_HTML_NAME =
  /^(readme|license|licence|changelog|credits|help|howto|how-to|instructions|patreon|discord|support|privacy|eula|tos|documentation|manual)(\.|$)/i

const PREFERRED_HTML = /^(index|game|start|play|main|launch)\.html?$/i

const HTML_ASSET_DIR = /^(resources|js|css|fonts|images|img|assets|lib|vendor|data|audio|video)$/i

export function isHtmlFileName(name: string): boolean {
  return /\.html?$/i.test(name)
}

export function isHtmlSkipDir(name: string): boolean {
  if (!name || name.startsWith('.')) return true
  return /^(lib|renpy|cache|__pycache__|tmp|temp|node_modules)$/i.test(name) || /\.app$/i.test(name)
}

export function scoreHtmlEntry(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const name = (parts[parts.length - 1] || '').toLowerCase()
  const depth = Math.max(0, parts.length - 1)
  let score = 40 - depth * 18
  if (name === 'index.html') score += 80
  else if (name === 'index.htm') score += 70
  else if (PREFERRED_HTML.test(name)) score += 40
  if (SKIP_HTML_NAME.test(name)) score -= 100
  if (parts.slice(0, -1).some((part) => HTML_ASSET_DIR.test(part))) score -= 35
  return score
}

export function compareHtmlEntries(a: string, b: string): number {
  const score = scoreHtmlEntry(b) - scoreHtmlEntry(a)
  if (score) return score
  return a.length - b.length
}
