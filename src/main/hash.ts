import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { toFsPath } from './win-path'

export function hashBytes(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(toFsPath(filePath))
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
