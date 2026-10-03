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

function overlayBaseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || ''
}

/** Loose Ren'Py scripts that can be stored and applied as uncensor/mod overlays. */
export function isRenpyScriptPath(filePath: string): boolean {
  return /\.rpyc?$/i.test(overlayBaseName(filePath))
}

/** Packed Ren'Py archives that drop into an installed game `/game` folder. */
export function isRenpyArchiveAssetPath(filePath: string): boolean {
  return /\.rp[au]$/i.test(overlayBaseName(filePath))
}

/** Scripts or .rpa/.rpu archives that can be applied as a Ren'Py overlay. */
export function isRenpyOverlayFilePath(filePath: string): boolean {
  return isRenpyScriptPath(filePath) || isRenpyArchiveAssetPath(filePath)
}

/** Packages that should hash and wait for tag approval before library insert. */
export function isReviewablePackagePath(filePath: string): boolean {
  return isArchivePath(filePath) || isRenpyOverlayFilePath(filePath)
}

export function archiveKind(filePath: string): 'zip' | '7z' | 'rar' | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.zip') return 'zip'
  if (ext === '.7z') return '7z'
  if (ext === '.rar') return 'rar'
  return null
}
