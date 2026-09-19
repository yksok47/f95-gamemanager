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
