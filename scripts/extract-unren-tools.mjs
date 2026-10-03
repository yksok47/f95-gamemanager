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

// Python 3.12 (Ren'Py 8.3+) dropped the meta_path find_module() fallback.
function patchFakePackageLoader(destDir) {
  const file = join(destDir, 'decompiler', 'magic.py')
  if (!existsSync(file)) return
  let source = readFileSync(file, 'utf8')
  if (source.includes('def find_spec')) return
  if (!source.includes('from importlib.machinery import ModuleSpec')) {
    source = source.replace(
      'import pickle\n',
      "import pickle\ntry:\n    from importlib.machinery import ModuleSpec\nexcept Exception:\n    ModuleSpec = None\n"
    )
  }
  const oldLoader = `    def find_module(self, fullname, path=None):
        if fullname == self.root or fullname.startswith(self.root + "."):
            return self
        else:
            return None

    def load_module(self, fullname):
        return FakePackage(fullname)
`
  const newLoader = `    def find_module(self, fullname, path=None):
        if fullname == self.root or fullname.startswith(self.root + "."):
            return self
        else:
            return None

    def find_spec(self, fullname, path, target=None):
        if ModuleSpec is None:
            return None
        if fullname == self.root or fullname.startswith(self.root + "."):
            return ModuleSpec(fullname, self)
        else:
            return None

    def create_module(self, spec):
        return FakePackage(spec.name)

    def exec_module(self, module):
        pass

    def load_module(self, fullname):
        return FakePackage(fullname)
`
  if (!source.includes(oldLoader)) return
  writeFileSync(file, source.replace(oldLoader, newLoader))
}

// Ren'Py 8.4+ stores python: blocks indented, without a leading newline.
// UnRen's unrpyc treats those as `$` and emits invalid `init $`. Nested blocks
// must be re-indented relative to `python:` or Ren'Py sees an empty block.
function patchPython84Blocks(destDir) {
  const utilFile = join(destDir, 'decompiler', 'util.py')
  if (existsSync(utilFile)) {
    let util = readFileSync(utilFile, 'utf8')
    if (!util.includes('import textwrap')) {
      util = util.replace('import re\n', 'import re\nimport textwrap\n')
    }
    if (!util.includes('def python_source_is_block')) {
      const needle = "# keywords used by ren'py's parser"
      const helper = `def python_source_is_block(code):
    """True if PyCode.source is a python: block rather than a $ one-liner.

    Pre Ren'Py 8.4, blocks were stored un-indented with a leading newline.
    Ren'Py 8.4+ stores blocks already indented, without a leading newline.
    $ statements have neither, so init $ is not valid Ren'Py.
    """
    return bool(code) and (code[0] == '\\n' or code[0] == ' ' or code[0] == '\\t')

def normalize_python_block_source(code):
    """Strip storage indent/newline so a python: body can be re-indented."""
    if not code:
        return code
    if code[0] == '\\n':
        code = code[1:]
    return textwrap.dedent(code)

`
      if (util.includes(needle)) {
        util = util.replace(needle, helper + needle)
      }
    } else if (!util.includes('def normalize_python_block_source')) {
      util = util.replace(
        'def python_source_is_block(code):',
        `def normalize_python_block_source(code):
    """Strip storage indent/newline so a python: body can be re-indented."""
    if not code:
        return code
    if code[0] == '\\n':
        code = code[1:]
    return textwrap.dedent(code)

def python_source_is_block(code):`
      )
    }
    writeFileSync(utilFile, util)
  }

  const initFile = join(destDir, 'decompiler', '__init__.py')
  if (existsSync(initFile)) {
    let source = readFileSync(initFile, 'utf8')
    if (!source.includes('python_source_is_block')) {
      source = source.replace(
        'string_escape, split_logical_lines, Dispatcher',
        'string_escape, split_logical_lines, Dispatcher, python_source_is_block, normalize_python_block_source'
      )
    } else if (!source.includes('normalize_python_block_source')) {
      source = source.replace(
        'python_source_is_block',
        'python_source_is_block, normalize_python_block_source'
      )
    }
    if (!source.includes('def can_inline_init_child')) {
      source = source.replace(
        `    def require_init(self):
        if not self.in_init:
            self.missing_init = True
`,
        `    def require_init(self):
        if not self.in_init:
            self.missing_init = True

    def can_inline_init_child(self, node):
        # init $ ... is not valid Ren'Py; $ one-liners need an init block.
        if isinstance(node, (renpy.ast.Python, renpy.ast.EarlyPython)):
            code = getattr(getattr(node, 'code', None), 'source', None)
            return python_source_is_block(code)
        return True
`
      )
    }
    source = source.replace(
      `                if len(ast.block) == 1 and not self.should_come_before(ast, ast.block[0]):
                    self.write(" ")
                    self.skip_indent_until_write = True
                    self.print_nodes(ast.block)
`,
      `                if (len(ast.block) == 1 and not self.should_come_before(ast, ast.block[0])
                        and self.can_inline_init_child(ast.block[0])):
                    self.write(" ")
                    self.skip_indent_until_write = True
                    self.print_nodes(ast.block)
`
    )
    const oldPython = `        code = ast.code.source
        if code[0] == '\\n':
            code = code[1:]
            self.write("python")
            if early:
                self.write(" early")
            if ast.hide:
                self.write(" hide")
            if hasattr(ast, "store") and ast.store != "store":
                self.write(" in ")
                # Strip prepended "store."
                self.write(ast.store[6:])
            self.write(":")

            with self.increase_indent():
                self.write_lines(split_logical_lines(code))

        else:
            self.write("$ %s" % code)
`
    const asIsPython = `        indented = code[0] == ' '
        if not indented:
            code = code[1:]
        self.write("python")
        if early:
            self.write(" early")
        if ast.hide:
            self.write(" hide")
        if hasattr(ast, "store") and ast.store != "store":
            self.write(" in ")
            # Strip prepended "store."
            self.write(ast.store[6:])
        self.write(":")

        if indented:
            self.write("\\n%s" % code)
        else:
            with self.increase_indent():
                self.write_lines(split_logical_lines(code))
`
    const newPython = `        code = ast.code.source
        # pre ren'py 8.4, python blocks were stored un-indented with a leading \\n
        # after this, python blocks are stored with indentation, without a leading \\n.
        # Re-indent relative to this python: so nested blocks are not empty.
        if not python_source_is_block(code):
            self.write("$ %s" % code)
            return

        code = normalize_python_block_source(code)
        self.write("python")
        if early:
            self.write(" early")
        if ast.hide:
            self.write(" hide")
        if hasattr(ast, "store") and ast.store != "store":
            self.write(" in ")
            # Strip prepended "store."
            self.write(ast.store[6:])
        self.write(":")

        with self.increase_indent():
            self.write_lines(split_logical_lines(code))
`
    if (source.includes(oldPython)) source = source.replace(oldPython, newPython)
    else if (source.includes(asIsPython)) source = source.replace(asIsPython, newPython.replace('        code = ast.code.source\n', ''))
    writeFileSync(initFile, source)
  }

  const sl2File = join(destDir, 'decompiler', 'sl2decompiler.py')
  if (existsSync(sl2File)) {
    let source = readFileSync(sl2File, 'utf8')
    if (!source.includes('normalize_python_block_source')) {
      if (source.includes('python_source_is_block')) {
        source = source.replace(
          'Dispatcher, python_source_is_block',
          'Dispatcher, python_source_is_block, normalize_python_block_source'
        )
      } else {
        source = source.replace(
          'split_logical_lines, Dispatcher',
          'split_logical_lines, Dispatcher, python_source_is_block, normalize_python_block_source'
        )
      }
      const newSl2 = `        # Extract the source code from the slast.SLPython object.
        # Re-indent relative to this python: so nested 8.4+ blocks are not empty.
        code = ast.code.source
        if python_source_is_block(code):
            self.write("python:")
            with self.increase_indent():
                self.write_lines(split_logical_lines(normalize_python_block_source(code)))
        else:
            self.write("$ %s" % code)
`
      source = source.replace(
        `        # Extract the source code from the slast.SLPython object. If it starts with a
        # newline, print it as a python block, else, print it as a $ statement
        code = ast.code.source
        if code.startswith("\\n"):
            code = code[1:]
            self.write("python:")
            with self.increase_indent():
                self.write_lines(split_logical_lines(code))
        else:
            self.write("$ %s" % code)
`,
        newSl2
      )
      source = source.replace(
        `        # Extract the source code from the slast.SLPython object.
        # Pre Ren'Py 8.4, python blocks start with a newline. 8.4+ stores them indented.
        code = ast.code.source
        if python_source_is_block(code):
            indented = code[0] == ' '
            if not indented:
                code = code[1:]
            self.write("python:")
            if indented:
                self.write("\\n%s" % code)
            else:
                with self.increase_indent():
                    self.write_lines(split_logical_lines(code))
        else:
            self.write("$ %s" % code)
`,
        newSl2
      )
      writeFileSync(sl2File, source)
    }
  }

  const testFile = join(destDir, 'decompiler', 'testcasedecompiler.py')
  if (existsSync(testFile)) {
    let source = readFileSync(testFile, 'utf8')
    if (!source.includes('normalize_python_block_source')) {
      if (source.includes('python_source_is_block')) {
        source = source.replace(
          'python_source_is_block',
          'python_source_is_block, normalize_python_block_source'
        )
      } else {
        source = source.replace(
          'Dispatcher, string_escape',
          'Dispatcher, string_escape, python_source_is_block, normalize_python_block_source'
        )
      }
      const newTest = `        code = ast.code.source
        if python_source_is_block(code):
            self.write("python:")
            with self.increase_indent():
                self.write_lines(split_logical_lines(normalize_python_block_source(code)))
        else:
            self.write("$ %s" % code)
`
      source = source.replace(
        `        code = ast.code.source
        if code[0] == '\\n':
            self.write("python:")
            with self.increase_indent():
                self.write_lines(split_logical_lines(code[1:]))
        else:
            self.write("$ %s" % code)
`,
        newTest
      )
      source = source.replace(
        `        code = ast.code.source
        if python_source_is_block(code):
            indented = code[0] == ' '
            if indented:
                self.write("python:")
                self.write("\\n%s" % code)
            else:
                self.write("python:")
                with self.increase_indent():
                    self.write_lines(split_logical_lines(code[1:]))
        else:
            self.write("$ %s" % code)
`,
        newTest
      )
      writeFileSync(testFile, source)
    }
  }
}

function patchSlDefaultWidget(destDir) {
  const sl2File = join(destDir, 'decompiler', 'sl2decompiler.py')
  if (!existsSync(sl2File)) return
  let source = readFileSync(sl2File, 'utf8')
  const helper = `
# Screen statement names that are not displayables. Unknown widgets often use
# style "default"; emitting that as the widget name produces
# \`default action ...\` which Ren'Py parses as a default statement.
_SL_RESERVED_NAMES = frozenset([
    'default', 'define', 'python', 'if', 'elif', 'else', 'for', 'while',
    'use', 'has', 'pass', 'continue', 'break', 'screen', 'style', 'init',
    'jump', 'call', 'return', 'menu',
])

# SL names that do not match style or CamelCase-to-snake conversion.
# nearrect uses style "default"; naive fallback would emit invalid near_rect.
_SL_CLASS_FALLBACK = {
    'NearRect': ('nearrect', 1),
    'DismissBehavior': ('dismiss', 0),
    'AreaPicker': ('areapicker', 1),
}

def _sl_name_from_class(name):
    if not name:
        return ''
    name = name.lstrip('_')
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and (name[i - 1].islower() or (
                i + 1 < len(name) and name[i + 1].islower())):
            out.append('_')
        out.append(ch.lower())
    return ''.join(out)

def sl_fallback_displayable_name(ast):
    cls_name = getattr(ast.displayable, '__name__', '') or ''
    mapped = _SL_CLASS_FALLBACK.get(cls_name)
    if mapped:
        return mapped

    style = ast.style
    if isinstance(style, str) and style and style not in _SL_RESERVED_NAMES:
        return (style, 'many')

    keywords = getattr(ast, 'keyword', None) or []
    if any(k == 'action' for k, _ in keywords):
        return ('button', 1)

    candidate = _sl_name_from_class(cls_name)
    if candidate and candidate not in _SL_RESERVED_NAMES:
        return (candidate, 'many')

    return ('fixed', 'many')

`
  if (source.includes('_SL_RESERVED_NAMES')) {
    source = source.replace(
      /# Screen statement names that are not displayables[\s\S]*?return \('fixed', 'many'\)\n/,
      helper.trimStart()
    )
  } else {
    source = source.replace('# Main API\n', helper + '# Main API\n')
  }
  source = source.replace(
    'nameAndChildren = (ast.style, \'many\')',
    'nameAndChildren = sl_fallback_displayable_name(ast)'
  )
  if (!source.includes('("nearrect", 1)')) {
    source = source.replace(
      '(layout.MultiBox, "hbox"):         ("hbox", \'many\')\n    }',
      `(layout.MultiBox, "hbox"):         ("hbox", 'many')
    }

    if hasattr(layout, 'NearRect'):
        displayable_names[(layout.NearRect, "default")] = ("nearrect", 1)
    if hasattr(behavior, 'DismissBehavior'):
        displayable_names[(behavior.DismissBehavior, "default")] = ("dismiss", 0)
    if hasattr(behavior, 'AreaPicker'):
        displayable_names[(behavior.AreaPicker, "default")] = ("areapicker", 1)`
    )
  }
  writeFileSync(sl2File, source)
}

function patchSlUseExpression(destDir) {
  const sl2File = join(destDir, 'decompiler', 'sl2decompiler.py')
  if (!existsSync(sl2File)) return
  let source = readFileSync(sl2File, 'utf8')
  if (!source.includes('def is_sl_pyexpr')) {
    source = source.replace(
      'from renpy.ast import PyExpr\n',
      `from renpy.ast import PyExpr

def is_sl_pyexpr(value):
    # Unpickled targets are fake PyExpr/PyExprSupport; this module may import
    # the game's real PyExpr. isinstance against that type drops \`expression\`.
    return type(value).__name__ == 'PyExpr'

`
    )
  }
  source = source.replace(
    'if isinstance(ast.target, PyExpr):',
    'if is_sl_pyexpr(ast.target):'
  )
  writeFileSync(sl2File, source)
}

const unrpycDirs = ['unrpyc-old', 'unrpyc-py2', 'unrpyc-py3']

if (process.argv.includes('--layout-only')) {
  for (const name of unrpycDirs) {
    const dest = join(outRoot, name)
    layoutUnrpyc(dest)
    patchFakePackageLoader(dest)
    patchPython84Blocks(dest)
    patchSlDefaultWidget(dest)
    patchSlUseExpression(dest)
  }
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
for (const name of unrpycDirs) {
  layoutUnrpyc(join(outRoot, name))
  patchFakePackageLoader(join(outRoot, name))
  patchPython84Blocks(join(outRoot, name))
  patchSlDefaultWidget(join(outRoot, name))
  patchSlUseExpression(join(outRoot, name))
}

console.log('Wrote UnRen tools to', outRoot)
if (!existsSync(join(outRoot, 'unrpyc-py3', 'unrpyc.py'))) {
  console.warn('Cab expand may have nested files; listing...')
}
