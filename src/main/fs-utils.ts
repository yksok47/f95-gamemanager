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

export function archiveKind(filePath: string): 'zip' | '7z' | 'rar' | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.zip') return 'zip'
  if (ext === '.7z') return '7z'
  if (ext === '.rar') return 'rar'
  return null
}
