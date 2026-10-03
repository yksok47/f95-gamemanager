# Bundled Ren'Py script tools

These files are extracted from UnRen 1.0.11d and run with the **game's own** Python interpreter (`python.exe` on Windows, `python` on Linux and macOS).
No system Python install is required.

- `rpatool-py2.py` / `rpatool-py3.py` — [rpatool](https://github.com/Shizmob/rpatool) by Shizmob
- `rpa-fallback.py` — [rpa.py](https://github.com/Taricorp) by Peter Marheine
- `unrpyc-*` — [unrpyc](https://github.com/CensoredUsername/unrpyc), F95Sam edit (no multiprocessing).
  Each tree has `unrpyc.py` + `deobfuscate.py` next to a `decompiler/` package.
  `unrpyc-py3` includes a Python 3.12 `find_spec` patch so fake `renpy` imports work on Ren'Py 8.3+ games,
  and a Ren'Py 8.4+ python-block patch so `python:` is not decompiled as invalid `init $`.
  Unknown screen widgets whose style is `default` are not emitted as the `default` statement.
  Ren'Py 8.2+ `nearrect` / `dismiss` / `areapicker` keep their screen-language names.
  `use expression` is kept when the target is an 8.3+ `PyExpr`.

Regenerate from `UnRen-1.0.11d/UnRen-1.0.11d.bat` with:

```
node scripts/extract-unren-tools.mjs
```
