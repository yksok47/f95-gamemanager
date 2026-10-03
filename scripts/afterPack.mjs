import { chmodSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * AppImage squashfs is read-only, so a runtime chmod on bundled 7za fails and
 * spawn returns EACCES. Set +x here so the permission is stored in the image.
 */
function walkFiles(dir, visit) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, visit)
    else visit(full, entry.name)
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName === 'win32') return

  const resourcesDir =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : join(context.appOutDir, 'resources')

  let fixed = 0
  walkFiles(resourcesDir, (full, name) => {
    if (name !== '7za') return
    chmodSync(full, 0o755)
    console.log(`afterPack: chmod 755 ${full}`)
    fixed += 1
  })

  if (fixed === 0) {
    throw new Error(`afterPack: no 7za binaries found under ${resourcesDir}`)
  }
}
