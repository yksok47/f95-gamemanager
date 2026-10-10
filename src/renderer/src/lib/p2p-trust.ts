export type TrustInput = {
  installCount?: number
  flagCounts?: { broken: number; harmful: number }
}

export type TrustLevel = 'good' | 'uncertain' | 'caution' | 'bad' | 'none'

export type TrustSignal = { level: TrustLevel; label: string }

export function flagCountsOf(pkg: TrustInput): { broken: number; harmful: number; total: number } {
  const broken = Math.max(0, pkg.flagCounts?.broken ?? 0)
  const harmful = Math.max(0, pkg.flagCounts?.harmful ?? 0)
  return { broken, harmful, total: broken + harmful }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** installs:flags trust band. */
export function trustSignal(pkg: TrustInput): TrustSignal {
  const installs = Math.max(0, pkg.installCount ?? 0)
  const flags = flagCountsOf(pkg).total
  if (flags === 0 && installs === 0) return { level: 'none', label: 'No trust data yet' }
  if (flags === 0) return { level: 'good', label: `${plural(installs, 'install')} · no flags` }
  if (flags > installs) return { level: 'bad', label: `${installs} installs / ${flags} flags` }
  const ratio = installs / flags
  if (ratio >= 10) return { level: 'good', label: `${installs} installs / ${flags} flags (≥10:1)` }
  if (ratio > 2) return { level: 'uncertain', label: `${installs} installs / ${flags} flags` }
  return { level: 'caution', label: `${installs} installs / ${flags} flags (<2:1)` }
}

/** Warning shown under a flagged or untested file; null when installs look healthy. */
export function trustWarning(pkg: TrustInput): { text: string; tone: 'bad' | 'caution' } | null {
  const trust = trustSignal(pkg)
  const { harmful, broken } = flagCountsOf(pkg)
  const bits = [harmful > 0 ? `harmful ×${harmful}` : null, broken > 0 ? `broken ×${broken}` : null]
    .filter(Boolean)
    .join(', ')
  if (trust.level === 'bad') {
    return {
      tone: 'bad',
      text: `More flags${bits ? ` (${bits})` : ''} than installs — treat this file as untrusted and inspect it before opening.`
    }
  }
  if (trust.level === 'caution') {
    return {
      tone: 'caution',
      text: `Flags are high relative to installs${bits ? ` (${bits})` : ''}. Review the file before you open it.`
    }
  }
  if (trust.level === 'uncertain') {
    return { tone: 'caution', text: `This file has flags${bits ? ` (${bits})` : ''}. Check it before opening.` }
  }
  return null
}
