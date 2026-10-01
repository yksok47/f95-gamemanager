import { describe, expect, test } from 'bun:test'
import { encodeMultipartForm } from './multipart'

function parseParts(body: Buffer, contentType: string): Array<{ headers: string; data: Buffer }> {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1]
  if (!boundary) throw new Error('missing boundary')
  const text = body.toString('latin1')
  const chunks = text.split(`--${boundary}`).slice(1, -1)
  return chunks.map((chunk) => {
    const raw = chunk.replace(/^\r\n/, '').replace(/\r\n$/, '')
    const split = raw.indexOf('\r\n\r\n')
    return {
      headers: raw.slice(0, split),
      data: Buffer.from(raw.slice(split + 4), 'latin1')
    }
  })
}

describe('encodeMultipartForm', () => {
  test('keeps text fields and file bytes intact', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    const encoded = encodeMultipartForm(
      { hash: 'abc', 'context[thread_id]': '12' },
      {
        fieldName: 'upload',
        filename: 'shot.png',
        mime: 'image/png',
        bytes: png
      }
    )
    const parts = parseParts(encoded.body, encoded.contentType)
    expect(parts).toHaveLength(3)
    expect(parts[0]?.headers).toContain('name="hash"')
    expect(parts[0]?.data.toString()).toBe('abc')
    expect(parts[1]?.headers).toContain('name="context[thread_id]"')
    expect(parts[1]?.data.toString()).toBe('12')
    expect(parts[2]?.headers).toContain('name="upload"')
    expect(parts[2]?.headers).toContain('filename="shot.png"')
    expect(parts[2]?.headers).toContain('Content-Type: image/png')
    expect(Buffer.from(parts[2]?.data ?? [])).toEqual(png)
  })
})
