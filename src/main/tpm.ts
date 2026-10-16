import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'crypto'
import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const PROVIDER = 'Microsoft Platform Crypto Provider'

const publicKeys = new Map<string, Promise<KeyObject>>()

function powershellExe(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function base64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function runScript(lines: string[]): Promise<string> {
  const script = ['$ErrorActionPreference = "Stop"', ...lines].join('\n')
  const { stdout } = await execFileAsync(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 30_000, encoding: 'utf8' }
  )
  return stdout.trim()
}

function openKeyLines(keyName: string, create: boolean): string[] {
  const lines = [
    `$provider = New-Object System.Security.Cryptography.CngProvider(${powershellLiteral(PROVIDER)})`,
    `$name = ${powershellLiteral(keyName)}`
  ]
  if (!create) return [...lines, '$key = [System.Security.Cryptography.CngKey]::Open($name, $provider)']
  return [
    ...lines,
    'if ([System.Security.Cryptography.CngKey]::Exists($name, $provider)) {',
    '  $key = [System.Security.Cryptography.CngKey]::Open($name, $provider)',
    '} else {',
    '  $params = New-Object System.Security.Cryptography.CngKeyCreationParameters',
    '  $params.Provider = $provider',
    '  $params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None',
    "  $params.Parameters.Add((New-Object System.Security.Cryptography.CngProperty('Length', [BitConverter]::GetBytes(2048), [System.Security.Cryptography.CngPropertyOptions]::None)))",
    '  try {',
    '    $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, $name, $params)',
    '  } catch {',
    '    $key = [System.Security.Cryptography.CngKey]::Open($name, $provider)',
    '  }',
    '}'
  ]
}

async function loadPublicKey(keyName: string): Promise<KeyObject> {
  const out = await runScript([
    ...openKeyLines(keyName, true),
    '$rsa = New-Object System.Security.Cryptography.RSACng($key)',
    '$pub = $rsa.ExportParameters($false)',
    "[Console]::Out.Write([Convert]::ToBase64String($pub.Modulus) + '.' + [Convert]::ToBase64String($pub.Exponent))"
  ])
  const [n, e] = out.split('.')
  if (!n || !e) throw new Error('The TPM did not return a public key.')
  return createPublicKey({ key: { kty: 'RSA', n: base64Url(n), e: base64Url(e) }, format: 'jwk' })
}

function publicKey(keyName: string): Promise<KeyObject> {
  let pending = publicKeys.get(keyName)
  if (!pending) {
    pending = loadPublicKey(keyName)
    pending.catch(() => publicKeys.delete(keyName))
    publicKeys.set(keyName, pending)
  }
  return pending
}

export function tpmSupported(): boolean {
  return process.platform === 'win32'
}

export async function tpmWrap(keyName: string, plain: Buffer): Promise<Buffer> {
  const key = await publicKey(keyName)
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, plain)
}

export async function tpmUnwrap(keyName: string, wrapped: Buffer): Promise<Buffer> {
  const out = await runScript([
    ...openKeyLines(keyName, false),
    '$rsa = New-Object System.Security.Cryptography.RSACng($key)',
    `$wrapped = [Convert]::FromBase64String(${powershellLiteral(wrapped.toString('base64'))})`,
    '$plain = $rsa.Decrypt($wrapped, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))'
  ])
  const plain = Buffer.from(out, 'base64')
  if (!plain.length) throw new Error('The TPM did not unwrap the key.')
  return plain
}
