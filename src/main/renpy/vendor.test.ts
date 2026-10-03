import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

describe('unrpyc python 3.12 import compatibility', () => {
  test('FakePackageLoader implements find_spec for Ren\'Py 8.3+ games', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(
      join(here, '../../../resources/unren/unrpyc-py3/decompiler/magic.py'),
      'utf8'
    )
    expect(source).toContain('from importlib.machinery import ModuleSpec')
    expect(source).toContain('def find_spec')
    expect(source).toContain('def create_module')
    expect(source).toContain('def exec_module')
    const unrpyc = readFileSync(join(here, '../../../resources/unren/unrpyc-py3/unrpyc.py'), 'utf8')
    expect(unrpyc).toContain('renpy.astsupport')
    expect(unrpyc).toContain('col_offset')
    expect(unrpyc).toContain('--file-list')
    const rpatool = readFileSync(join(here, '../../../resources/unren/rpatool-py3.py'), 'utf8')
    expect(rpatool).toContain('extract_files_parallel')
    expect(rpatool).toContain('F95_UNREN_WORKERS')
    const deob = readFileSync(join(here, '../../../resources/unren/unrpyc-py3/deobfuscate.py'), 'utf8')
    expect(deob).toContain('_count_keys_are_bytes')
    expect(deob).toMatch(/i in alphabet/)
  })
})

describe("unrpyc python: vs $ classification", () => {
  const here = dirname(fileURLToPath(import.meta.url))

  function pythonSourceIsBlock(code: string): boolean {
    return Boolean(code) && (code[0] === '\n' || code[0] === ' ' || code[0] === '\t')
  }

  function normalizePythonBlockSource(code: string): string {
    if (code.startsWith('\n')) code = code.slice(1)
    const lines = code.split('\n')
    let min = Infinity
    for (const line of lines) {
      if (!line.trim()) continue
      const indent = (line.match(/^[ \t]*/)?.[0] ?? '').length
      if (indent < min) min = indent
    }
    if (!Number.isFinite(min) || min === 0) return code
    return lines.map((line) => (line.trim() ? line.slice(min) : '')).join('\n')
  }

  function emitPython(code: string, indentLevel: number): string {
    const pad = '    '.repeat(indentLevel)
    if (!pythonSourceIsBlock(code)) return `${pad}$ ${code}`
    const body = normalizePythonBlockSource(code)
    const bodyPad = '    '.repeat(indentLevel + 1)
    const bodyText = body
      .split('\n')
      .map((line) => (line === '' ? '' : bodyPad + line))
      .join('\n')
    return `${pad}python:\n${bodyText}`
  }

  test('Ren\'Py 8.4 indented python blocks become python:, not init $', () => {
    expect(pythonSourceIsBlock('    register_pregnancy()\n    config.foo = 1')).toBe(true)
    expect(pythonSourceIsBlock('\nregister_pregnancy()')).toBe(true)
    expect(pythonSourceIsBlock('register_pregnancy()')).toBe(false)
    expect(pythonSourceIsBlock('')).toBe(false)
    expect(emitPython('    register_pregnancy()', 0)).toBe('python:\n    register_pregnancy()')
    expect(emitPython('\nregister_pregnancy()', 0)).toBe('python:\n    register_pregnancy()')
    expect(emitPython('register_pregnancy()', 0)).toBe('$ register_pregnancy()')
    expect(emitPython('    register_pregnancy()', 0)).not.toContain('init $')
  })

  test('nested 8.4 python bodies are re-indented under python:', () => {
    const stored = '    \n    from operator import attrgetter\n    date_choice.hour = hour'
    const nested = emitPython(stored, 1)
    expect(nested).toContain('    python:')
    expect(nested).toContain('        from operator import attrgetter')
    expect(nested).toContain('        date_choice.hour = hour')
    expect(nested).not.toMatch(/^    from operator/m)
  })

  test('py3 decompiler re-indents 8.4 python blocks', () => {
    const util = readFileSync(join(here, '../../../resources/unren/unrpyc-py3/decompiler/util.py'), 'utf8')
    const decompiler = readFileSync(
      join(here, '../../../resources/unren/unrpyc-py3/decompiler/__init__.py'),
      'utf8'
    )
    expect(util).toContain('def python_source_is_block')
    expect(util).toContain('def normalize_python_block_source')
    expect(util).toContain('textwrap.dedent')
    expect(decompiler).toContain('normalize_python_block_source')
    expect(decompiler).toContain('def can_inline_init_child')
    expect(decompiler).not.toContain('self.write("\\n%s" % code)')
  })
})

describe('unrpyc custom screen displayable fallback', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const reserved = new Set([
    'default',
    'define',
    'python',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'use',
    'has',
    'pass',
    'continue',
    'break',
    'screen',
    'style',
    'init',
    'jump',
    'call',
    'return',
    'menu'
  ])

  function slNameFromClass(name: string): string {
    const trimmed = name.replace(/^_+/, '')
    let out = ''
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      const upper = ch >= 'A' && ch <= 'Z'
      if (
        upper &&
        i &&
        ((trimmed[i - 1] >= 'a' && trimmed[i - 1] <= 'z') ||
          (i + 1 < trimmed.length && trimmed[i + 1] >= 'a' && trimmed[i + 1] <= 'z'))
      ) {
        out += '_'
      }
      out += ch.toLowerCase()
    }
    return out
  }

  function fallbackName(style: string, className: string, keywords: string[]): string {
    const classMap: Record<string, string> = {
      NearRect: 'nearrect',
      DismissBehavior: 'dismiss',
      AreaPicker: 'areapicker'
    }
    if (classMap[className]) return classMap[className]
    if (style && !reserved.has(style)) return style
    if (keywords.includes('action')) return 'button'
    const candidate = slNameFromClass(className)
    if (candidate && !reserved.has(candidate)) return candidate
    return 'fixed'
  }

  test('does not emit default as a widget name', () => {
    expect(fallbackName('default', 'FilterDropdown', ['action'])).toBe('button')
    expect(fallbackName('default', '', ['action'])).toBe('button')
    expect(fallbackName('default', 'CustomBox', [])).toBe('custom_box')
    expect(fallbackName('frame', 'CustomFrame', ['action'])).toBe('frame')
    expect(fallbackName('default', 'FilterDropdown', ['action'])).not.toBe('default')
  })

  test('maps Ren\'Py 8.x widgets instead of snake_case class names', () => {
    expect(fallbackName('default', 'NearRect', [])).toBe('nearrect')
    expect(fallbackName('default', 'NearRect', [])).not.toBe('near_rect')
    expect(fallbackName('default', 'DismissBehavior', ['action'])).toBe('dismiss')
    expect(fallbackName('default', 'AreaPicker', [])).toBe('areapicker')
  })

  test('py3 sl2 decompiler avoids reserved default widget names', () => {
    const sl2 = readFileSync(
      join(here, '../../../resources/unren/unrpyc-py3/decompiler/sl2decompiler.py'),
      'utf8'
    )
    expect(sl2).toContain('def sl_fallback_displayable_name')
    expect(sl2).toContain("'default'")
    expect(sl2).toContain("return ('button', 1)")
    expect(sl2).toContain('nameAndChildren = sl_fallback_displayable_name(ast)')
    expect(sl2).toContain('_SL_CLASS_FALLBACK')
    expect(sl2).toContain("('nearrect', 1)")
    expect(sl2).not.toContain("nameAndChildren = (ast.style, 'many')")
  })

  test('use expression survives fake vs real PyExpr class mismatch', () => {
    const sl2 = readFileSync(
      join(here, '../../../resources/unren/unrpyc-py3/decompiler/sl2decompiler.py'),
      'utf8'
    )
    expect(sl2).toContain('def is_sl_pyexpr')
    expect(sl2).toContain('if is_sl_pyexpr(ast.target):')
    expect(sl2).toContain("self.write(\"expression %s\" % ast.target)")
    expect(sl2).not.toContain('if isinstance(ast.target, PyExpr):')
  })
})
