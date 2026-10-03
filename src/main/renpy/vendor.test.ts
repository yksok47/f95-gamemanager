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
