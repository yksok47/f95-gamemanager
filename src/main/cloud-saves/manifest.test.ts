import { describe, expect, test } from 'bun:test'
import { planFolderSync, planHasWork, planNeedsCloudManifest } from './diff'
import {
  abandonUnsourcedFolders,
  applyFolderDelete,
  applyFolderEdit,
  applyFolderRename,
  collectSyncFolders,
  emptyManifest,
  localFolderHasFile,
  parseManifest,
  recheckFolder,
  withRemoteName,
  upsertFolder,
  type DiskSaveFile,
  type SaveManifestFile,
  type SaveManifestFolder
} from './manifest'
import { cloudBlobName } from './select'

function file(
  name: string,
  hash: string,
  extra: Partial<SaveManifestFile> = {}
): SaveManifestFile {
  return withRemoteName({
    hash,
    name,
    remoteName: extra.remoteName ?? (hash ? cloudBlobName(hash) : ''),
    size: extra.size ?? 10,
    modifiedAt: extra.modifiedAt ?? 100,
    kind: extra.kind ?? 'slot',
    updatedAt: extra.updatedAt ?? extra.modifiedAt ?? 100
  })
}

function folder(
  files: SaveManifestFile[],
  deleted: SaveManifestFolder['deleted'] = []
): SaveManifestFolder {
  return { key: 'saves', files, deleted }
}

function disk(name: string, hash: string, extra: Partial<DiskSaveFile> = {}): DiskSaveFile {
  return {
    hash,
    name,
    size: extra.size ?? 10,
    modifiedAt: extra.modifiedAt ?? 100,
    kind: extra.kind ?? 'slot'
  }
}

describe('recheckFolder', () => {
  test('tombstones a file that disappeared from disk', () => {
    const prev = folder([file('1-1.save', 'aaa', { modifiedAt: 50 })])
    const next = recheckFolder(prev, [], 200)
    expect(next.files).toEqual([])
    expect(next.deleted).toEqual([{ hash: 'aaa', name: '1-1.save', deletedAt: 200 }])
  })

  test('treats a slot rename as the same hash and keeps the remote blob name', () => {
    const prev = folder([file('1-1.save', 'aaa', { modifiedAt: 50, updatedAt: 50 })])
    const next = recheckFolder(prev, [disk('1-2.save', 'aaa', { modifiedAt: 50 })], 200)
    expect(next.files).toEqual([
      file('1-2.save', 'aaa', {
        modifiedAt: 50,
        updatedAt: 200,
        remoteName: cloudBlobName('aaa')
      })
    ])
    expect(next.deleted).toEqual([])
  })

  test('records an in-place edit as a new hash and tombstones the old one', () => {
    const prev = folder([file('1-1.save', 'aaa', { modifiedAt: 50 })])
    const next = recheckFolder(prev, [disk('1-1.save', 'bbb', { modifiedAt: 80, size: 12 })], 200)
    expect(next.files).toEqual([
      file('1-1.save', 'bbb', {
        modifiedAt: 80,
        size: 12,
        updatedAt: 200,
        remoteName: cloudBlobName('bbb')
      })
    ])
    expect(next.deleted).toEqual([{ hash: 'aaa', name: '1-1.save', deletedAt: 200 }])
  })

  test('resurrects a hash that was tombstoned then restored', () => {
    const prev = folder([], [{ hash: 'aaa', name: '1-1.save', deletedAt: 10 }])
    const next = recheckFolder(prev, [disk('1-1.save', 'aaa')], 200)
    expect(next.files.map((item) => item.hash)).toEqual(['aaa'])
    expect(next.deleted).toEqual([])
  })

  test('keeps a previous row when the file is skipped as unstable', () => {
    const prev = folder([file('1-1.save', 'aaa')])
    const next = recheckFolder(prev, [], 200, ['1-1.save'])
    expect(next.files).toEqual([file('1-1.save', 'aaa')])
    expect(next.deleted).toEqual([])
  })
})

describe('planFolderSync', () => {
  test('updates only the manifest when the local slot name changes', () => {
    const plan = planFolderSync(
      folder([file('1-2.save', 'aaa', { modifiedAt: 50, updatedAt: 200 })]),
      folder([file('1-1.save', 'aaa', { modifiedAt: 50, updatedAt: 50 })]),
      3,
      false
    )
    expect(plan.remoteRenames).toEqual([])
    expect(plan.uploads).toEqual([])
    expect(plan.downloads).toEqual([])
    expect(plan.remoteDeletes).toEqual([])
    expect(plan.nextCloud.files[0]).toMatchObject({
      name: '1-2.save',
      hash: 'aaa',
      remoteName: cloudBlobName('aaa')
    })
    expect(planHasWork(plan)).toBe(false)
    expect(
      planNeedsCloudManifest(
        plan,
        folder([file('1-1.save', 'aaa', { modifiedAt: 50, updatedAt: 50 })])
      )
    ).toBe(true)
  })

  test('uploads an edited save under a new remote blob and deletes the old one', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'bbb', { modifiedAt: 80, size: 12 })], [
        { hash: 'aaa', name: '1-1.save', deletedAt: 80 }
      ]),
      folder([file('1-1.save', 'aaa', { modifiedAt: 50 })]),
      3,
      false
    )
    expect(plan.uploads.map((item) => item.remoteName)).toEqual([cloudBlobName('bbb')])
    expect(plan.uploads.map((item) => item.name)).toEqual(['1-1.save'])
    expect(plan.downloads).toEqual([])
    expect(plan.remoteDeletes.map((item) => item.remoteName)).toEqual([cloudBlobName('aaa')])
  })

  test('deletes a cloud save that was removed locally', () => {
    const plan = planFolderSync(
      folder([], [{ hash: 'aaa', name: '1-1.save', deletedAt: 90 }]),
      folder([file('1-1.save', 'aaa', { modifiedAt: 50 })]),
      3,
      false
    )
    expect(plan.remoteDeletes).toEqual([
      { name: '1-1.save', remoteName: cloudBlobName('aaa'), hash: 'aaa' }
    ])
    expect(plan.downloads).toEqual([])
    expect(plan.uploads).toEqual([])
  })

  test('drops extra cloud slot saves beyond the keep limit', () => {
    const local = folder([
      file('1-1.save', 'a', { modifiedAt: 10 }),
      file('1-2.save', 'b', { modifiedAt: 20 }),
      file('1-3.save', 'c', { modifiedAt: 30 }),
      file('1-4.save', 'd', { modifiedAt: 40 })
    ])
    const cloud = folder([
      file('1-1.save', 'a', { modifiedAt: 10 }),
      file('1-2.save', 'b', { modifiedAt: 20 }),
      file('1-3.save', 'c', { modifiedAt: 30 }),
      file('1-4.save', 'd', { modifiedAt: 40 })
    ])
    const plan = planFolderSync(local, cloud, 3, false)
    expect(plan.remoteDeletes.map((item) => item.name).sort()).toEqual(['1-1.save'])
    expect(plan.nextCloud.files.map((item) => item.name).sort()).toEqual([
      '1-2.save',
      '1-3.save',
      '1-4.save'
    ])
    expect(plan.nextLocal.files).toHaveLength(4)
  })

  test('does not upload auto saves when they are excluded', () => {
    const plan = planFolderSync(
      folder([
        file('persistent', 'p', { kind: 'always', modifiedAt: 1 }),
        file('auto-1.save', 'q', { kind: 'auto', modifiedAt: 9 }),
        file('1-1.save', 'a', { modifiedAt: 5 })
      ]),
      folder([]),
      3,
      false
    )
    expect(plan.uploads.map((item) => item.name).sort()).toEqual(['1-1.save', 'persistent'])
    expect(plan.uploads.every((item) => item.remoteName.startsWith('f95gm-'))).toBe(true)
  })

  test('downloads a cloud-only save that is within the keep limit', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'a', { modifiedAt: 10 })]),
      folder([
        file('1-1.save', 'a', { modifiedAt: 10 }),
        file('1-2.save', 'b', { modifiedAt: 40 })
      ]),
      3,
      false
    )
    expect(plan.downloads.map((item) => item.name)).toEqual(['1-2.save'])
    expect(plan.downloads.map((item) => item.remoteName)).toEqual([cloudBlobName('b')])
  })

  test('applies a newer cloud tombstone by dropping the local file', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'aaa', { updatedAt: 10, modifiedAt: 10 })]),
      folder([], [{ hash: 'aaa', name: '1-1.save', deletedAt: 50 }]),
      3,
      false
    )
    expect(plan.localDeletes).toEqual([
      { name: '1-1.save', remoteName: cloudBlobName('aaa'), hash: 'aaa' }
    ])
    expect(plan.nextLocal.files).toEqual([])
    expect(plan.uploads).toEqual([])
  })

  test('skips work when hashes already match', () => {
    const files = [file('1-1.save', 'a'), file('persistent', 'p', { kind: 'always' })]
    const plan = planFolderSync(folder(files), folder(files), 3, false)
    expect(planHasWork(plan)).toBe(false)
  })

  test('migrates a legacy readable Drive name to an opaque blob name', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'aaa', { size: 10, modifiedAt: 100 })]),
      folder([
        {
          hash: 'aaa',
          name: '1-1.save',
          remoteName: '1-1.save',
          size: 10,
          modifiedAt: 100,
          kind: 'slot',
          updatedAt: 100
        }
      ]),
      3,
      false
    )
    expect(plan.remoteRenames).toEqual([
      { from: '1-1.save', to: cloudBlobName('aaa'), hash: 'aaa' }
    ])
    expect(plan.uploads).toEqual([])
    expect(plan.downloads).toEqual([])
  })

  test('treats unhashed cloud files with the same name and mtime as already synced', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'aaa', { size: 10, modifiedAt: 100 })]),
      folder([
        {
          hash: '',
          name: '1-1.save',
          remoteName: '1-1.save',
          size: 10,
          modifiedAt: 100,
          kind: 'slot',
          updatedAt: 100
        }
      ]),
      3,
      false
    )
    expect(plan.uploads).toEqual([])
    expect(plan.downloads).toEqual([])
    expect(plan.remoteRenames).toEqual([
      { from: '1-1.save', to: cloudBlobName('aaa'), hash: 'aaa' }
    ])
  })

  test('wipes cloud files when the local save location is gone', () => {
    const plan = planFolderSync(
      folder([file('1-1.save', 'aaa', { modifiedAt: 50 })]),
      folder([
        file('1-1.save', 'aaa', { modifiedAt: 50 }),
        file('1-2.save', 'bbb', { modifiedAt: 80 })
      ]),
      3,
      false,
      200,
      true
    )
    expect(plan.uploads).toEqual([])
    expect(plan.downloads).toEqual([])
    expect(plan.remoteDeletes.map((item) => item.remoteName).sort()).toEqual([
      cloudBlobName('aaa'),
      cloudBlobName('bbb')
    ])
    expect(plan.nextLocal.files).toEqual([])
    expect(plan.nextCloud.files).toEqual([])
    expect(plan.nextLocal.deleted.map((item) => item.hash).sort()).toEqual(['aaa', 'bbb'])
    expect(planHasWork(plan)).toBe(true)
  })
})

describe('manifest helpers', () => {
  test('parses a game identity even without files', () => {
    const parsed = parseManifest({ version: 1, threadId: 99, title: 'Demo', folders: [] })
    expect(parsed).toMatchObject({ threadId: 99, title: 'Demo', folders: [] })
  })

  test('parses remoteName and fills it from hash when missing', () => {
    const parsed = parseManifest({
      version: 1,
      threadId: 7,
      title: 'Demo',
      folders: [
        {
          key: 'saves',
          files: [{ name: '1-1.save', hash: 'abcd', kind: 'slot', size: 1, modifiedAt: 1 }],
          deleted: []
        }
      ]
    })
    expect(parsed?.folders[0]?.files[0]?.remoteName).toBe(cloudBlobName('abcd'))
  })

  test('apply helpers update tombstones and names while preserving remote blobs on rename', () => {
    const start = folder([file('1-1.save', 'aaa')])
    const renamed = applyFolderRename(start, '1-1.save', '1-2.save', 5)
    expect(renamed.files[0]?.name).toBe('1-2.save')
    expect(renamed.files[0]?.remoteName).toBe(cloudBlobName('aaa'))
    const edited = applyFolderEdit(
      renamed,
      '1-2.save',
      disk('1-2.save', 'bbb', { size: 8, modifiedAt: 9 }),
      6
    )
    expect(edited.files[0]?.hash).toBe('bbb')
    expect(edited.files[0]?.remoteName).toBe(cloudBlobName('bbb'))
    expect(edited.deleted[0]?.hash).toBe('aaa')
    const gone = applyFolderDelete(edited, '1-2.save', 'bbb', 7)
    expect(gone.files).toEqual([])
    expect(gone.deleted.map((item) => item.hash).sort()).toEqual(['aaa', 'bbb'])
  })

  test('tombstones files in folders that are no longer local sources', () => {
    const manifest = emptyManifest(12, 'Demo', 10)
    manifest.folders = [
      folder([file('1-1.save', 'aaa', { modifiedAt: 50 })]),
      { key: 'other', files: [file('2-1.save', 'ccc', { modifiedAt: 40 })], deleted: [] }
    ]
    const next = abandonUnsourcedFolders(manifest, new Set(['other']), 200)
    const abandoned = next.folders.find((item) => item.key === 'saves')
    const kept = next.folders.find((item) => item.key === 'other')
    expect(abandoned?.files).toEqual([])
    expect(abandoned?.deleted).toEqual([{ hash: 'aaa', name: '1-1.save', deletedAt: 200 }])
    expect(kept?.files.map((item) => item.hash)).toEqual(['ccc'])
    expect(kept?.deleted).toEqual([])
  })

  test('collects unmapped manifest folders as gone so cloud copies can be deleted', () => {
    const manifest = emptyManifest(12, 'Demo')
    manifest.folders = [{ key: 'saves', files: [file('1-1.save', 'aaa')], deleted: [] }]
    expect(collectSyncFolders([], manifest, () => false)).toEqual([
      { key: 'saves', title: 'Demo', localDir: '', localGone: true }
    ])
    expect(
      collectSyncFolders(
        [{ key: 'saves', title: 'Demo', localDir: 'C:\\saves\\demo' }],
        emptyManifest(12, 'Demo'),
        () => true
      )[0]?.localGone
    ).toBe(false)
    expect(
      collectSyncFolders(
        [{ key: 'saves', title: 'Demo', localDir: 'C:\\saves\\demo' }],
        emptyManifest(12, 'Demo'),
        () => false
      )[0]?.localGone
    ).toBe(true)
  })
})

describe('localFolderHasFile', () => {
  test('does not treat a file in another save directory as local', () => {
    let local = emptyManifest(4, 'Game')
    local = upsertFolder(local, { key: 'Game', files: [file('1-1.save', 'aaa')], deleted: [] })
    local = upsertFolder(local, { key: 'Game-old', files: [file('1-2.save', 'bbb')], deleted: [] })
    expect(localFolderHasFile(local, 'Game', '1-1.save', 'aaa')).toBe(true)
    expect(localFolderHasFile(local, 'Game', '1-2.save', 'bbb')).toBe(false)
    expect(localFolderHasFile(local, 'Game-old', '1-1.save', 'aaa')).toBe(false)
    expect(localFolderHasFile(local, 'Game-old', '1-2.save')).toBe(true)
  })
})
