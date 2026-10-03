import { parseChangelog, parseChangelogEntries } from './changelogParser'
import { defineParserTests } from '../test-harness'
import { describe, expect, it } from 'vitest'

defineParserTests('changelog', parseChangelog)

const TOOL_CHANGELOG = `
<b>Changelog</b><br>
<div class="bbCodeSpoiler">
  <button type="button" class="bbCodeSpoiler-button"><span class="button-text">
    <span>Spoiler: <span class="bbCodeSpoiler-button-title">Changelog</span></span>
  </span></button>
  <div class="bbCodeSpoiler-content">
    <div class="bbCodeBlock bbCodeBlock--spoiler">
      <div class="bbCodeBlock-content">
        <b>v1.1</b><br>
        <ul><li>P2P downloads</li></ul><br>
        <b>v1.2</b><br>
        <ul><li>parser rewrite</li></ul>
        <a href="https://attachments.f95zone.to/2026/09/6489419_shot.png" class="js-lbImage">
          <img src="https://attachments.f95zone.to/2026/09/thumb/6489419_shot.png" alt="shot.png">
        </a>
        <b>v1.3</b><br>
        <ul><li>file management</li></ul>
      </div>
    </div>
  </div>
</div>
`

describe('changelog unit', () => {
  it('splits versions inside a Changelog spoiler and keeps images', () => {
    const entries = parseChangelogEntries(TOOL_CHANGELOG)
    expect(entries.map((entry) => entry.version)).toEqual(['v1.1', 'v1.2', 'v1.3'])
    expect(entries[0]?.text).toContain('P2P downloads')
    expect(entries[1]?.text).toContain('parser rewrite')
    expect(entries[1]?.html).toContain('6489419_shot.png')
    expect(entries[1]?.html).toMatch(/\/thumb\/6489419_shot\.png/)
    expect(entries[2]?.text).toContain('file management')
  })
})
