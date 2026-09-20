import { cloudSaveNameAllowed, isCloudMetaName } from './select'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export type CloudTreeItem = {
  id: string
  name: string
  mimeType: string
  modifiedTime: number
  size: number
  parentIds: string[]
  appProperties?: Record<string, string>
}

export type CloudTreeGame = {
  threadId: number
  title: string
  folderId: string
  saveCount: number
  bytes: number
  updatedAt: number | null
  files: Array<{
    name: string
    size: number
    modifiedAt: number
    folderKey: string
  }>
}

function isFolder(item: CloudTreeItem): boolean {
  return item.mimeType === FOLDER_MIME
}

function childrenOf(items: readonly CloudTreeItem[], parentId: string): CloudTreeItem[] {
  return items.filter((item) => item.parentIds.includes(parentId))
}

function folderTitle(folder: CloudTreeItem, fallback: string): string {
  const titled = folder.appProperties?.title?.trim()
  return titled || fallback
}

function collectSaves(
  items: readonly CloudTreeItem[],
  folder: CloudTreeItem,
  folderKey: string,
  into: CloudTreeGame['files']
): void {
  for (const child of childrenOf(items, folder.id)) {
    if (isFolder(child)) {
      collectSaves(items, child, child.name, into)
      continue
    }
    if (isCloudMetaName(child.name)) continue
    if (!cloudSaveNameAllowed(child.name)) continue
    into.push({
      name: child.name,
      size: child.size,
      modifiedAt: child.modifiedTime,
      folderKey
    })
  }
}

export function gamesFromCloudTree(
  rootId: string,
  items: readonly CloudTreeItem[],
  titles: ReadonlyMap<number, string> = new Map()
): CloudTreeGame[] {
  const games: CloudTreeGame[] = []
  for (const folder of childrenOf(items, rootId)) {
    if (!isFolder(folder)) continue
    const threadId = Number(folder.name)
    if (!Number.isFinite(threadId) || threadId <= 0) continue
    const files: CloudTreeGame['files'] = []
    collectSaves(items, folder, folder.name, files)
    const updatedAt = files.reduce((max, file) => Math.max(max, file.modifiedAt || 0), 0)
    games.push({
      threadId,
      title: titles.get(threadId) || folderTitle(folder, `Thread ${threadId}`),
      folderId: folder.id,
      saveCount: files.length,
      bytes: files.reduce((sum, file) => sum + (file.size || 0), 0),
      updatedAt: updatedAt || folder.modifiedTime || null,
      files
    })
  }
  games.sort((a, b) => a.title.localeCompare(b.title) || a.threadId - b.threadId)
  return games
}
