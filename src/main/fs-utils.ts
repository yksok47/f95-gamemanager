import { extname } from 'path'

export function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return cleaned || 'untitled'
}

export function isArchivePath(filePath: string): boolean {
  return /\.(zip|7z|rar)$/i.test(filePath)
}

/** Loose Ren'Py scripts that can be stored and applied as uncensor patches. */
export function isRenpyScriptPath(filePath: string): boolean {
  return /\.(?:rpy|rpyc)$/i.test(filePath)
}

/** Packages that should hash and wait for tag approval before library insert. */
export function isReviewablePackagePath(filePath: string): boolean {
  return isArchivePath(filePath) || isRenpyScriptPath(filePath)
}

export function archiveKind(filePath: string): 'zip' | '7z' | 'rar' | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.zip') return 'zip'
  if (ext === '.7z') return '7z'
  if (ext === '.rar') return 'rar'
  return null
}
