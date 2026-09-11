/**
 * Collect host:port endpoints other Game Manager clients can dial when the
 * BitTorrent tracker only returns a shared WAN IP (hairpin NAT / AP isolation).
 * Published via metadata listenAddrs; max 8 (Tracker limit).
 */
import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX = 8

function isIpv4(family: string | number): boolean {
  return family === 'IPv4' || family === 4
}

function isUsefulPrivateIpv4(ip: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false
  if (ip.startsWith('127.') || ip.startsWith('169.254.')) return false
  // Skip WSL/Hyper-V default switch noise when possible.
  if (ip.startsWith('172.31.') || ip.startsWith('172.17.') || ip.startsWith('172.18.')) return false
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('100.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  if (m) {
    const n = Number(m[1])
    return n >= 16 && n <= 31
  }
  return false
}

function ipv4FromInterfaces(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (!isIpv4(info.family) || info.internal) continue
      if (!isUsefulPrivateIpv4(info.address)) continue
      if (!out.includes(info.address)) out.push(info.address)
    }
  }
  return out
}

async function ipv4FromTailscale(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['ip', '-4'], {
      timeout: 2500,
      windowsHide: true,
      encoding: 'utf8'
    })
    return String(stdout)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => isUsefulPrivateIpv4(s))
  } catch {
    return []
  }
}

/** Online Tailscale peer IPs (for dialing when tracker only has WAN). */
export async function listTailscalePeerIpv4s(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf8'
    })
    const raw = String(stdout).replace(/^\uFEFF/, '')
    const data = JSON.parse(raw) as {
      Peer?: Record<string, { Online?: boolean; TailscaleIPs?: string[] }>
    }
    const out: string[] = []
    for (const peer of Object.values(data.Peer ?? {})) {
      if (peer.Online === false) continue
      for (const ip of peer.TailscaleIPs ?? []) {
        if (isUsefulPrivateIpv4(ip) && !out.includes(ip)) out.push(ip)
      }
    }
    return out
  } catch {
    return []
  }
}

export async function collectListenAddrs(port: number): Promise<string[]> {
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return []
  const ips = ipv4FromInterfaces()
  for (const ip of await ipv4FromTailscale()) {
    if (!ips.includes(ip)) ips.push(ip)
  }
  // Prefer Tailscale (100.x) then RFC1918.
  ips.sort((a, b) => Number(b.startsWith('100.')) - Number(a.startsWith('100.')))
  return ips.slice(0, MAX).map((ip) => `${ip}:${port}`)
}

export function parseListenAddr(addr: string): { host: string; port: number } | null {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(addr.trim())
  if (!m) return null
  const port = Number(m[2])
  if (!Number.isFinite(port) || port <= 0) return null
  return { host: m[1]!, port }
}
