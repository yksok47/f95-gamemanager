export type MultipartFile = {
  fieldName: string
  filename: string
  mime: string
  bytes: Uint8Array
}

export function encodeMultipartForm(
  fields: Record<string, string>,
  file?: MultipartFile
): { body: Buffer; contentType: string } {
  const boundary = `----F95GM${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  const chunks: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisp(name)}"\r\n\r\n${value}\r\n`
      )
    )
  }

  if (file) {
    const filename = sanitizeFilename(file.filename)
    const encoded = encodeURIComponent(file.filename)
    const mime = file.mime.trim() || 'application/octet-stream'
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisp(file.fieldName)}"; filename="${filename}"; filename*=UTF-8''${encoded}\r\nContent-Type: ${mime}\r\n\r\n`
      )
    )
    chunks.push(Buffer.from(file.bytes))
    chunks.push(Buffer.from('\r\n'))
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  }
}

function escapeDisp(value: string): string {
  return value.replace(/[\r\n"]/g, '_')
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, '_').replace(/[\\/]/g, '_') || 'file'
}
