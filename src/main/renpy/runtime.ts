import { spawn } from 'child_process'
import { delimiter, dirname } from 'path'
import { makePathExecutable } from '../unix-exec'
import { childPath, listDirents, pathExists, resolveLongPath, stripNamespace } from '../win-path'

export type GamePython = {
  python: string
  pythonDir: string
  pythonLibDir: string
  major: 2 | 3
}

function findEncodingsDir(start: string): string | null {
  const queue = [start]
  const seen = new Set<string>()
  while (queue.length) {
    const dir = queue.shift()
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    if (pathExists(childPath(dir, 'encodings'))) return resolveLongPath(dir)
    if (seen.size > 80) break
    for (const entry of listDirents(dir)) {
      if (!entry.isDirectory()) continue
      if (/^(renpy|game|cache|__pycache__)$/i.test(entry.name)) continue
      queue.push(childPath(dir, entry.name))
    }
  }
  return null
}

export function findGamePython(gameRoot: string): string | null {
  const lib = childPath(gameRoot, 'lib')
  const found: string[] = []
  const queue = pathExists(lib) ? [lib] : []
  while (queue.length) {
    const dir = queue.shift()
    if (!dir) break
    for (const entry of listDirents(dir)) {
      const full = childPath(dir, entry.name)
      if (entry.isFile() && isPythonBinaryName(entry.name)) {
        found.push(resolveLongPath(full))
        continue
      }
      if (entry.isDirectory() && !/^(renpy|game|cache|__pycache__)$/i.test(entry.name)) queue.push(full)
    }
  }
  found.sort((a, b) => pythonScore(b) - pythonScore(a))
  return found[0] ?? null
}

function isPythonBinaryName(name: string): boolean {
  return /^python(\d+(\.\d+)?)?w?(\.exe)?$/i.test(name)
}

function pythonScore(pythonPath: string): number {
  const value = pythonPath.replace(/\\/g, '/').toLowerCase()
  const name = value.split('/').pop() || ''
  let score = 0
  if (value.includes('py3-') || value.includes('/python3') || /^python3/.test(name)) score += 100
  if (process.platform === 'linux' && value.includes('linux')) score += 50
  if (process.platform === 'darwin' && (value.includes('-mac-') || value.includes('/mac') || value.includes('darwin'))) {
    score += 50
  }
  if (process.platform === 'win32' && (value.includes('windows') || value.includes('-win') || name.endsWith('.exe'))) {
    score += 50
  }
  if (process.platform !== 'win32' && name.endsWith('.exe')) score -= 80
  if (/pythonw/i.test(name)) score -= 5
  if (process.arch === 'x64' && (value.includes('x86_64') || value.includes('amd64'))) score += 20
  if (process.arch === 'arm64' && (value.includes('aarch64') || value.includes('arm64'))) score += 20
  if (process.arch === 'x64' && (value.includes('arm64') || value.includes('aarch64'))) score -= 15
  if (value.includes('i686') || value.includes('i386')) score -= 10
  return score
}

function runPythonText(python: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Python timed out after ${Math.round(timeoutMs / 1000)}s.`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export async function detectGamePython(gameRoot: string): Promise<GamePython> {
  const python = findGamePython(gameRoot)
  if (!python) {
    throw new Error("Could not find this game's Python interpreter under lib/. Ren'Py ships it with the game.")
  }
  await makePathExecutable(python)
  const pythonDir = dirname(python)
  const pythonLibDir = findEncodingsDir(pythonDir) || findEncodingsDir(childPath(gameRoot, 'lib')) || pythonDir
  const root = stripNamespace(resolveLongPath(gameRoot))
  const env = pythonEnv(pythonDir, pythonLibDir)
  const probe = await runPythonText(python, ['-c', 'import sys; print(sys.version_info[0])'], root, env, 15000)
  const major = Number((probe.stdout || probe.stderr).trim().slice(0, 1))
  if (major !== 2 && major !== 3) {
    throw new Error(`Could not read this game's Python version.\n${probe.stderr || probe.stdout || 'No output.'}`)
  }
  return { python, pythonDir, pythonLibDir, major }
}

export function pythonEnv(pythonDir: string, pythonLibDir: string, extraPath: string[] = []): NodeJS.ProcessEnv {
  const pathParts = [...extraPath, pythonDir, pythonLibDir].map(stripNamespace).filter(Boolean)
  const pathValue = [stripNamespace(pythonDir), process.env.PATH || process.env.Path || ''].filter(Boolean).join(delimiter)
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.PATH
  delete env.Path
  env.PYTHONHOME = stripNamespace(pythonDir)
  env.PYTHONPATH = pathParts.join(delimiter)
  env.PYTHONUNBUFFERED = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONDONTWRITEBYTECODE = '1'
  env.PATH = pathValue
  env.Path = pathValue
  return env
}

function pyStr(value: string): string {
  return JSON.stringify(stripNamespace(value))
}

export async function runGamePython(
  runtime: GamePython,
  args: string[],
  cwd: string,
  extraPath: string[] = [],
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = pythonEnv(runtime.pythonDir, runtime.pythonLibDir, extraPath)
  return runPythonText(runtime.python, ['-O', ...args], stripNamespace(cwd), env, timeoutMs)
}

/** Run a .py file with sys.path forced, so Ren'Py's bundled Python cannot miss local packages. */
export async function runGamePythonScript(
  runtime: GamePython,
  script: string,
  scriptArgs: string[],
  extraPath: string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const scriptPath = stripNamespace(script)
  const pathDirs = [...extraPath, runtime.pythonDir, runtime.pythonLibDir].map(stripNamespace).filter(Boolean)
  const argv = [scriptPath, ...scriptArgs].map(pyStr).join(', ')
  const dirs = pathDirs.map(pyStr).join(', ')
  const bootstrap = [
    'import sys',
    'sys.path = [' + dirs + '] + [p for p in sys.path if p not in [' + dirs + ']]',
    'sys.argv = [' + argv + ']',
    'script = ' + pyStr(scriptPath),
    'try:',
    '    import runpy',
    'except ImportError:',
    '    runpy = None',
    'try:',
    '    if runpy is not None:',
    '        runpy.run_path(script, run_name="__main__")',
    '    else:',
    '        ns = {"__name__": "__main__", "__file__": script}',
    '        eval(compile(open(script, "rb").read(), script, "exec"), ns)',
    'except ImportError:',
    '    sys.stderr.write("sys.path=%r\\n" % (sys.path,))',
    '    raise'
  ].join('\n')
  return runGamePython(runtime, ['-c', bootstrap], cwd, pathDirs, timeoutMs)
}
