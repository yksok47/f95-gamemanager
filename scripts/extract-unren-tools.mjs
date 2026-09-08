import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const batPath = join(root, 'UnRen-1.0.11d', 'UnRen-1.0.11d.bat')
const outRoot = join(root, 'resources', 'unren')

function collectVars(source) {
  const vars = new Map()
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^set ([A-Za-z0-9]+)=(.*)$/)
    if (!match) continue
    vars.set(match[1], match[2])
  }
  return vars
}

function joinVars(vars, prefix, from, to) {
  const parts = []
  for (let i = from; i <= to; i += 1) {
    const key = `${prefix}${String(i).padStart(2, '0')}`
    const value = vars.get(key)
    if (value == null) throw new Error(`Missing ${key}`)
    parts.push(value)
  }
  return Buffer.from(parts.join(''), 'base64')
}

function expandCab(cabPath, destDir) {
  mkdirSync(destDir, { recursive: true })
  execFileSync('expand.exe', ['-F:*', cabPath, destDir], { stdio: 'inherit' })
}

// UnRen expands the cab into a folder named decompiler, then moves unrpyc.py
// (and deobfuscate.py) up one level. unrpyc does `import decompiler`.
function layoutUnrpyc(destDir) {
  const pkg = join(destDir, 'decompiler')
  if (existsSync(join(pkg, '__init__.py'))) return
  mkdirSync(pkg, { recursive: true })
  const keep = new Set(['unrpyc.py', 'deobfuscate.py'])
  for (const name of readdirSync(destDir)) {
    if (name === 'decompiler' || keep.has(name.toLowerCase())) continue
    const src = join(destDir, name)
    if (!statSync(src).isFile()) continue
    renameSync(src, join(pkg, name))
  }
}

const unrpycDirs = ['unrpyc-old', 'unrpyc-py2', 'unrpyc-py3']

if (process.argv.includes('--layout-only')) {
  for (const name of unrpycDirs) layoutUnrpyc(join(outRoot, name))
  console.log('Laid out unrpyc packages in', outRoot)
  process.exit(0)
}

const source = readFileSync(batPath, 'latin1')
const vars = collectVars(source)
mkdirSync(outRoot, { recursive: true })

writeFileSync(join(outRoot, 'rpatool-py2.py'), joinVars(vars, 'rpatool', 1, 6))
writeFileSync(join(outRoot, 'rpatool-py3.py'), joinVars(vars, 'rpatool', 7, 12))
writeFileSync(join(outRoot, 'rpa-fallback.py'), joinVars(vars, 'rpatool', 20, 20))

const cabs = join(outRoot, '_cabs')
mkdirSync(cabs, { recursive: true })
writeFileSync(join(cabs, 'unrpyc-old.cab'), joinVars(vars, 'decompcab', 1, 16))
writeFileSync(join(cabs, 'unrpyc-py2.cab'), joinVars(vars, 'decompcab', 20, 33))
writeFileSync(join(cabs, 'unrpyc-py3.cab'), joinVars(vars, 'decompcab', 40, 53))

expandCab(join(cabs, 'unrpyc-old.cab'), join(outRoot, 'unrpyc-old'))
expandCab(join(cabs, 'unrpyc-py2.cab'), join(outRoot, 'unrpyc-py2'))
expandCab(join(cabs, 'unrpyc-py3.cab'), join(outRoot, 'unrpyc-py3'))
for (const name of unrpycDirs) layoutUnrpyc(join(outRoot, name))

console.log('Wrote UnRen tools to', outRoot)
if (!existsSync(join(outRoot, 'unrpyc-py3', 'unrpyc.py'))) {
  console.warn('Cab expand may have nested files; listing...')
}
