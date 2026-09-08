export type SupportedEngine = 'renpy'

export type EngineKind =
  | 'renpy'
  | 'rpgmaker'
  | 'unity'
  | 'unreal'
  | 'godot'
  | 'html'
  | 'webgl'
  | 'java'
  | 'wolfrpg'
  | 'vn'
  | 'flash'
  | 'adrift'
  | 'qsp'
  | 'tyrano'
  | 'other'

export function decodeHtmlEntities(value: string): string {
  if (!value.includes('&')) return value
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return ''
  return String.fromCodePoint(value)
}

export function normalizeEngine(name: string | undefined): string {
  const value = decodeHtmlEntities(name || '').trim()
  if (!value) return ''
  if (/ren['’]?py/i.test(value)) return "Ren'Py"
  if (/^(rpgm|rpg\s*maker)$/i.test(value) || /rpg\s*maker/i.test(value)) return 'RPG Maker'
  if (/unreal/i.test(value)) return 'Unreal'
  if (/godot/i.test(value)) return 'Godot'
  if (/unity/i.test(value)) return 'Unity'
  if (/webgl/i.test(value)) return 'WebGL'
  if (/html\s*5?|^html$/i.test(value)) return 'HTML'
  if (/wolf/i.test(value)) return 'Wolf RPG'
  if (/^(vn|visual novels?)$/i.test(value)) return 'VN'
  if (/flash/i.test(value)) return 'Flash'
  if (/adrift/i.test(value)) return 'Adrift'
  if (/qsp/i.test(value)) return 'QSP'
  if (/tyrano/i.test(value)) return 'Tyrano'
  if (/java/i.test(value)) return 'Java'
  if (/^(others?|other engine)$/i.test(value)) return ''
  return value
}

export function engineKind(name: string | undefined): EngineKind {
  const n = normalizeEngine(name)
  if (n === "Ren'Py") return 'renpy'
  if (n === 'RPG Maker') return 'rpgmaker'
  if (n === 'Unity') return 'unity'
  if (n === 'Unreal') return 'unreal'
  if (n === 'Godot') return 'godot'
  if (n === 'HTML') return 'html'
  if (n === 'WebGL') return 'webgl'
  if (n === 'Java') return 'java'
  if (n === 'Wolf RPG') return 'wolfrpg'
  if (n === 'VN') return 'vn'
  if (n === 'Flash') return 'flash'
  if (n === 'Adrift') return 'adrift'
  if (n === 'QSP') return 'qsp'
  if (n === 'Tyrano') return 'tyrano'
  return 'other'
}

export function supportedEngineId(name: string | undefined): SupportedEngine | null {
  if (engineKind(name) === 'renpy') return 'renpy'
  return null
}

export function engineFromTitle(title: string): string {
  const match = title.match(
    /\b(Ren'?Py|RPG\s*Maker|RPGM|Unity|Unreal(?:\s+Engine)?|Godot|HTML5?|Java|WebGL|Wolf\s*RPG|Adrift|Flash|QSP|Tyrano(?:Builder)?|Visual\s*Novel)\b/i
  )
  return normalizeEngine(match?.[1] || '')
}

export function compareGameVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const av = left[index] ?? { n: 0, s: '' }
    const bv = right[index] ?? { n: 0, s: '' }
    if (av.n !== bv.n) return av.n - bv.n
    const text = av.s.localeCompare(bv.s, undefined, { sensitivity: 'base' })
    if (text) return text
  }
  return 0
}

function versionParts(raw: string): Array<{ n: number; s: string }> {
  return raw
    .replace(/^[vV]/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+)(.*)$/)
      if (match) return { n: Number(match[1]), s: match[2] }
      return { n: 0, s: part }
    })
}
