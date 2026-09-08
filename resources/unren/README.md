# Bundled Ren'Py script tools

These files are extracted from UnRen 1.0.11d and run with the **game's own** `python.exe`.
No system Python install is required.

- `rpatool-py2.py` / `rpatool-py3.py` — [rpatool](https://github.com/Shizmob/rpatool) by Shizmob
- `rpa-fallback.py` — [rpa.py](https://github.com/Taricorp) by Peter Marheine
- `unrpyc-*` — [unrpyc](https://github.com/CensoredUsername/unrpyc), F95Sam edit (no multiprocessing).
  Each tree has `unrpyc.py` + `deobfuscate.py` next to a `decompiler/` package.

Regenerate from `UnRen-1.0.11d/UnRen-1.0.11d.bat` with:

```
node scripts/extract-unren-tools.mjs
```
