import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { ThreadAttachment } from '@shared/types'
import { applyBbCode, applyListBbCode, bbcodeToHtml, htmlToBbcode } from '../lib/bbcode'
import { notifyCaught } from './ErrorNotifications'

export type BbCodeComposerHandle = {
  focus: () => void
  el: () => HTMLElement | null
}

type BbCodeComposerProps = {
  value: string
  disabled: boolean
  placeholder: string
  threadId: number
  attachmentHash: string
  postId?: number
  ariaLabel?: string
  onChange: (value: string) => void
  onLinkClick?: (event: ReactMouseEvent<HTMLDivElement>) => void
}

type DialogKind = 'link' | 'image' | null
type MenuKind = 'color' | 'size' | null

const FONT_SIZES = ['9px', '10px', '12px', '15px', '18px', '22px', '26px', '36px']
const FONT_COLORS = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#b7b7b7',
  '#cccccc',
  '#d9d9d9',
  '#ffffff',
  '#980000',
  '#ff0000',
  '#ff9900',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#4a86e8',
  '#0000ff',
  '#9900ff',
  '#ff00ff',
  '#e6b8af',
  '#f4cccc',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#c9daf8',
  '#d9d2e9',
  '#cc4125',
  '#e06666',
  '#f6b26b',
  '#ffd966',
  '#93c47d',
  '#76a5af',
  '#6d9eeb',
  '#8e7cc3'
]

const BbCodeComposer = forwardRef<BbCodeComposerHandle, BbCodeComposerProps>(
  function BbCodeComposer(
    { value, disabled, placeholder, threadId, attachmentHash, postId, ariaLabel, onChange, onLinkClick },
    ref
  ): JSX.Element {
    const [preview, setPreview] = useState(true)
    const [menu, setMenu] = useState<MenuKind>(null)
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
    const [dialog, setDialog] = useState<DialogKind>(null)
    const [linkHref, setLinkHref] = useState('')
    const [linkText, setLinkText] = useState('')
    const [imageHref, setImageHref] = useState('')
    const [uploading, setUploading] = useState(false)
    const [attachments, setAttachments] = useState<ThreadAttachment[]>([])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const previewRef = useRef<HTMLDivElement>(null)
    const skipPreviewSync = useRef(false)
    const previewOpen = useRef(false)
    const pendingSel = useRef<{ start: number; end: number } | null>(null)
    const [previewEmpty, setPreviewEmpty] = useState(() => !value.trim())
    const savedRange = useRef<Range | null>(null)

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (preview) previewRef.current?.focus()
        else textareaRef.current?.focus()
      },
      el: () => (preview ? previewRef.current : textareaRef.current)
    }))

    useEffect(() => {
      setAttachments([])
    }, [attachmentHash])

    useLayoutEffect(() => {
      if (preview) return
      const node = textareaRef.current
      const sel = pendingSel.current
      if (sel && node) {
        node.focus()
        node.setSelectionRange(sel.start, sel.end)
        pendingSel.current = null
      }
      fitTextarea(node)
    }, [value, preview])

    useLayoutEffect(() => {
      if (!preview) {
        skipPreviewSync.current = false
        previewOpen.current = false
        return
      }
      const node = previewRef.current
      if (!node) return
      const opened = !previewOpen.current
      previewOpen.current = true
      if (!opened && skipPreviewSync.current) {
        skipPreviewSync.current = false
        setPreviewEmpty(composerLooksEmpty(node))
        return
      }
      skipPreviewSync.current = false
      node.innerHTML = value.trim() ? bbcodeToHtml(value, attachments) : ''
      setPreviewEmpty(composerLooksEmpty(node))
      pinComposerToModal(node)
    }, [value, preview, attachments])

    function rememberPreviewRange(): void {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount) return
      const range = sel.getRangeAt(0)
      if (previewRef.current?.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange()
      }
    }

    function restorePreviewRange(): Range | null {
      const editor = previewRef.current
      if (!editor) return null
      editor.focus()
      const sel = window.getSelection()
      if (!sel) return null
      const range = savedRange.current
      if (range && editor.contains(range.commonAncestorContainer)) {
        sel.removeAllRanges()
        sel.addRange(range)
        return range
      }
      const fallback = document.createRange()
      fallback.selectNodeContents(editor)
      fallback.collapse(false)
      sel.removeAllRanges()
      sel.addRange(fallback)
      return fallback
    }

    function commitPreview(): void {
      const node = previewRef.current
      if (!node) return
      skipPreviewSync.current = true
      setPreviewEmpty(composerLooksEmpty(node))
      onChange(htmlToBbcode(node.innerHTML))
      pinComposerToModal(node)
    }

    function applyWrap(open: string, close: string, placeholderText = ''): void {
      if (disabled) return
      if (preview) {
        restorePreviewRange()
        const command =
          open === '[B]'
            ? 'bold'
            : open === '[I]'
              ? 'italic'
              : open === '[U]'
                ? 'underline'
                : open === '[S]'
                  ? 'strikeThrough'
                  : null
        if (command) {
          document.execCommand(command)
          commitPreview()
          return
        }
        const color = open.match(/^\[COLOR=(.+)\]$/i)?.[1]
        if (color) {
          document.execCommand('foreColor', false, color)
          commitPreview()
          return
        }
        wrapPreview((inner) => {
          const html = bbcodeToHtml(`${open}${inner || placeholderText}${close}`, attachments)
          const holder = document.createElement('span')
          holder.innerHTML = html
          if (holder.childNodes.length === 1 && holder.firstChild) return holder.firstChild
          const frag = document.createDocumentFragment()
          while (holder.firstChild) frag.appendChild(holder.firstChild)
          return frag
        }, placeholderText)
        return
      }
      const node = textareaRef.current
      const start = node?.selectionStart ?? value.length
      const end = node?.selectionEnd ?? value.length
      const next = applyBbCode(value, start, end, open, close, placeholderText)
      pendingSel.current = { start: next.start, end: next.end }
      onChange(next.value)
    }

    function applyList(ordered: boolean): void {
      if (disabled) return
      if (preview) {
        restorePreviewRange()
        document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList')
        commitPreview()
        return
      }
      const node = textareaRef.current
      const start = node?.selectionStart ?? value.length
      const end = node?.selectionEnd ?? value.length
      const next = applyListBbCode(value, start, end, ordered)
      pendingSel.current = { start: next.start, end: next.end }
      onChange(next.value)
    }

    function wrapPreview(make: (inner: string) => Node, placeholderText = ''): void {
      const editor = previewRef.current
      if (!editor) return
      const range = restorePreviewRange()
      if (!range) return
      const inner = range.collapsed ? placeholderText : range.toString()
      const node = make(inner)
      range.deleteContents()
      range.insertNode(node)
      range.collapse(false)
      savedRange.current = range.cloneRange()
      commitPreview()
    }

    function insertPreviewHtml(html: string): void {
      const range = restorePreviewRange()
      if (!range) {
        const editor = previewRef.current
        if (!editor) return
        editor.insertAdjacentHTML('beforeend', html)
        commitPreview()
        return
      }
      range.deleteContents()
      const holder = document.createElement('span')
      holder.innerHTML = html
      const frag = document.createDocumentFragment()
      while (holder.firstChild) frag.appendChild(holder.firstChild)
      range.insertNode(frag)
      range.collapse(false)
      savedRange.current = range.cloneRange()
      commitPreview()
    }

    function insertBb(
      snippet: string,
      extras: readonly ThreadAttachment[] = [],
      selectStart = snippet.length,
      selectEnd = snippet.length
    ): void {
      if (preview) {
        insertPreviewHtml(bbcodeToHtml(snippet, [...attachments, ...extras]))
        return
      }
      const node = textareaRef.current
      const start = node?.selectionStart ?? value.length
      const end = node?.selectionEnd ?? value.length
      const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`
      pendingSel.current = { start: start + selectStart, end: start + selectEnd }
      onChange(next)
    }

    function selectedText(): string {
      if (preview) {
        const sel = window.getSelection()
        if (sel && previewRef.current?.contains(sel.anchorNode)) return sel.toString()
        return ''
      }
      const node = textareaRef.current
      if (!node) return ''
      return value.slice(node.selectionStart, node.selectionEnd)
    }

    function openDialog(kind: DialogKind): void {
      rememberPreviewRange()
      const selected = selectedText()
      if (kind === 'link') {
        const looksLikeUrl = /^https?:\/\//i.test(selected.trim())
        setLinkHref(looksLikeUrl ? selected.trim() : '')
        setLinkText(looksLikeUrl ? '' : selected)
        setDialog('link')
        return
      }
      setImageHref(looksLikeUrl(selected) ? selected.trim() : '')
      setDialog('image')
    }

    function insertLink(): void {
      const href = linkHref.trim()
      if (!isHttpUrl(href)) return
      const label = linkText.trim() || href
      applyWrap(`[URL=${href}]`, '[/URL]', label)
      setDialog(null)
    }

    function insertImageUrl(): void {
      const href = imageHref.trim()
      if (!isHttpUrl(href)) return
      insertBb(`[IMG]${href}[/IMG]`)
      setDialog(null)
    }

    function insertUploaded(uploaded: ThreadAttachment, asImage: boolean, filename = uploaded.filename): void {
      setAttachments((current) => [...current.filter((item) => item.id !== uploaded.id), uploaded])
      const image = asImage || uploaded.isImage || isImageName(filename)
      const snippet = image ? `[ATTACH=full]${uploaded.id}[/ATTACH]` : `[ATTACH]${uploaded.id}[/ATTACH]`
      insertBb(snippet, [uploaded])
    }

    async function uploadFromDialog(asImage: boolean): Promise<void> {
      if (disabled || uploading) return
      rememberPreviewRange()
      setUploading(true)
      try {
        const uploaded = await window.api.threads.pickAndUploadAttachments(threadId, attachmentHash, {
          images: asImage,
          postId
        })
        for (const item of uploaded) insertUploaded(item, asImage)
        if (uploaded.length) setDialog(null)
      } catch (err) {
        notifyCaught(err, 'Could not upload that file.')
      } finally {
        setUploading(false)
      }
    }

    async function uploadFiles(files: FileList | File[], asImage: boolean): Promise<void> {
      if (disabled || uploading) return
      const list = Array.from(files).filter((file) => file.size > 0)
      if (!list.length) return
      rememberPreviewRange()
      setUploading(true)
      try {
        for (const file of list) {
          const data = new Uint8Array(await file.arrayBuffer())
          const uploaded = await window.api.threads.uploadAttachment(
            threadId,
            attachmentHash,
            {
              name: file.name,
              mime: file.type || 'application/octet-stream',
              data
            },
            postId
          )
          insertUploaded(uploaded, asImage, file.name)
        }
        setDialog(null)
      } catch (err) {
        notifyCaught(err, 'Could not upload that file.')
      } finally {
        setUploading(false)
      }
    }

    function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        applyWrap('[B]', '[/B]')
      } else if (key === 'i') {
        event.preventDefault()
        applyWrap('[I]', '[/I]')
      } else if (key === 'u') {
        event.preventDefault()
        applyWrap('[U]', '[/U]')
      } else if (key === 'k') {
        event.preventDefault()
        openDialog('link')
      }
    }

    function onDrop(event: DragEvent<HTMLElement>): void {
      const files = event.dataTransfer?.files
      if (!files?.length) return
      event.preventDefault()
      void uploadFiles(files, Array.from(files).every((file) => file.type.startsWith('image/')))
    }

    function onPaste(event: ClipboardEvent<HTMLElement>): void {
      const files = event.clipboardData?.files
      if (!files?.length) return
      event.preventDefault()
      void uploadFiles(files, Array.from(files).every((file) => file.type.startsWith('image/')))
    }

    const busy = disabled || uploading
    const emptyPreview = preview && previewEmpty

    return (
      <div className="bbcode-composer">
        <div className="bbcode-toolbar">
          <ToolBtn disabled={busy} title="Bold" className="bbcode-tool-b" onClick={() => applyWrap('[B]', '[/B]')}>
            B
          </ToolBtn>
          <ToolBtn disabled={busy} title="Italic" className="bbcode-tool-i" onClick={() => applyWrap('[I]', '[/I]')}>
            I
          </ToolBtn>
          <ToolBtn disabled={busy} title="Underline" className="bbcode-tool-u" onClick={() => applyWrap('[U]', '[/U]')}>
            U
          </ToolBtn>
          <ToolBtn disabled={busy} title="Strikethrough" className="bbcode-tool-s" onClick={() => applyWrap('[S]', '[/S]')}>
            S
          </ToolBtn>
          <ToolBtn
            disabled={busy}
            title="Font color"
            onClick={(event) => {
              rememberPreviewRange()
              setMenuAnchor(event.currentTarget)
              setMenu((on) => (on === 'color' ? null : 'color'))
            }}
          >
            A
          </ToolBtn>
          <ToolBtn
            disabled={busy}
            title="Font size"
            onClick={(event) => {
              rememberPreviewRange()
              setMenuAnchor(event.currentTarget)
              setMenu((on) => (on === 'size' ? null : 'size'))
            }}
          >
            Size
          </ToolBtn>
          <ToolBtn disabled={busy} title="Link" onClick={() => openDialog('link')}>
            URL
          </ToolBtn>
          <ToolBtn disabled={busy} title="Image" onClick={() => openDialog('image')}>
            IMG
          </ToolBtn>
          <ToolBtn
            disabled={busy}
            title="Attach file"
            onClick={() => void uploadFromDialog(false)}
          >
            File
          </ToolBtn>
          <ToolBtn disabled={busy} title="Bullet list" onClick={() => applyList(false)}>
            •
          </ToolBtn>
          <ToolBtn disabled={busy} title="Numbered list" onClick={() => applyList(true)}>
            1.
          </ToolBtn>
          <ToolBtn disabled={busy} title="Quote" onClick={() => applyWrap('[QUOTE]\n', '\n[/QUOTE]')}>
            Quote
          </ToolBtn>
          <ToolBtn disabled={busy} title="Spoiler" onClick={() => applyWrap('[SPOILER]', '[/SPOILER]')}>
            Spoiler
          </ToolBtn>
          <ToolBtn
            disabled={busy}
            title="Inline spoiler"
            onClick={() => applyWrap('[ISPOILER]', '[/ISPOILER]', 'spoiler')}
          >
            Blur
          </ToolBtn>
          <ToolBtn disabled={busy} title="Code block" onClick={() => applyWrap('[CODE]\n', '\n[/CODE]')}>
            Code
          </ToolBtn>
          <ToolBtn disabled={busy} title="Inline code" onClick={() => applyWrap('[ICODE]', '[/ICODE]', 'code')}>
            {'</>'}
          </ToolBtn>
          <button
            className={
              preview
                ? 'ghost-btn bbcode-tool bbcode-preview-toggle is-active'
                : 'ghost-btn bbcode-tool bbcode-preview-toggle'
            }
            type="button"
            disabled={disabled && !value}
            title={preview ? 'Edit BBCode' : 'Preview'}
            aria-pressed={preview}
            onClick={() => {
              if (preview) commitPreview()
              skipPreviewSync.current = false
              setPreview((on) => !on)
            }}
          >
            {preview ? 'BBCode' : 'Preview'}
          </button>
        </div>

        <div
          ref={previewRef}
          className={
            emptyPreview
              ? 'review-prose thread-prose bbcode-preview is-empty'
              : 'review-prose thread-prose bbcode-preview'
          }
          contentEditable={!busy}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          hidden={!preview}
          aria-label={ariaLabel || 'Reply to this thread'}
          onInput={commitPreview}
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest('a')
            if (!link || !event.currentTarget.contains(link)) return
            event.preventDefault()
            onLinkClick?.(event)
          }}
          onKeyDown={onKeyDown}
          onMouseUp={rememberPreviewRange}
          onKeyUp={rememberPreviewRange}
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          onPaste={onPaste}
        />
        <textarea
          ref={textareaRef}
          className="thread-posts-draft"
          value={value}
          disabled={busy}
          spellCheck
          hidden={preview}
          placeholder={placeholder}
          aria-label={ariaLabel ? `${ariaLabel} as BBCode` : 'Reply to this thread as BBCode'}
          onChange={(event) => onChange(event.target.value)}
          onInput={(event) => fitTextarea(event.currentTarget)}
          onKeyDown={onKeyDown}
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          onPaste={onPaste}
        />

        {menu && menuAnchor
          ? createPortal(
              <ComposerMenu
                anchor={menuAnchor}
                onClose={() => setMenu(null)}
              >
                {menu === 'color' ? (
                  <div className="bbcode-color-grid" role="menu">
                    {FONT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="bbcode-color-swatch"
                        style={{ background: color }}
                        title={color}
                        aria-label={color}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          applyWrap(`[COLOR=${color}]`, '[/COLOR]')
                          setMenu(null)
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  FONT_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="menuitem"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        applyWrap(`[SIZE=${size}]`, '[/SIZE]')
                        setMenu(null)
                      }}
                    >
                      {size}
                    </button>
                  ))
                )}
              </ComposerMenu>,
              document.body
            )
          : null}

        {dialog
          ? createPortal(
              <div
                className="app-confirm-overlay"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setDialog(null)
                }}
              >
                <form
                  className="app-confirm-dialog bbcode-composer-dialog"
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault()
                    if (dialog === 'link') insertLink()
                    else insertImageUrl()
                  }}
                >
                  <h2 className="app-confirm-title">{dialog === 'link' ? 'Insert link' : 'Insert image'}</h2>
                  {dialog === 'link' ? (
                    <>
                      <label className="bbcode-dialog-field">
                        URL
                        <input
                          autoFocus
                          value={linkHref}
                          onChange={(event) => setLinkHref(event.target.value)}
                          placeholder="https://"
                        />
                      </label>
                      <label className="bbcode-dialog-field">
                        Text to display
                        <input
                          value={linkText}
                          onChange={(event) => setLinkText(event.target.value)}
                          placeholder="Optional"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="bbcode-dialog-field">
                        Image URL
                        <input
                          autoFocus
                          value={imageHref}
                          onChange={(event) => setImageHref(event.target.value)}
                          placeholder="https://"
                        />
                      </label>
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => void uploadFromDialog(true)}
                      >
                        {uploading ? 'Uploading…' : 'Upload image'}
                      </button>
                    </>
                  )}
                  <div className="app-confirm-actions">
                    <button className="ghost-btn" type="button" onClick={() => setDialog(null)}>
                      Cancel
                    </button>
                    <button className="primary-btn" type="submit">
                      Insert
                    </button>
                  </div>
                </form>
              </div>,
              document.body
            )
          : null}
      </div>
    )
  }
)

export default BbCodeComposer

type ToolBtnProps = {
  title: string
  disabled: boolean
  className?: string
  children: ReactNode
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

function ToolBtn({ title, disabled, className, children, onClick }: ToolBtnProps): JSX.Element {
  return (
    <button
      className={className ? `ghost-btn bbcode-tool ${className}` : 'ghost-btn bbcode-tool'}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ComposerMenu({
  anchor,
  onClose,
  children
}: {
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect()
    const menu = ref.current
    const width = menu?.offsetWidth || 180
    const height = menu?.offsetHeight || 0
    let left = rect.left
    let top = rect.bottom + 6
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6)
    }
    setPos({ top, left })
  }, [anchor])

  useEffect(() => {
    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return (
    <div ref={ref} className="card-menu bbcode-composer-menu" style={{ top: pos.top, left: pos.left }} role="menu">
      {children}
    </div>
  )
}

function fitTextarea(node: HTMLTextAreaElement | null): void {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.max(node.scrollHeight, 96)}px`
  pinComposerToModal(node)
}

function pinComposerToModal(from: HTMLElement): void {
  const modal = from.closest('.details-modal')
  if (!(modal instanceof HTMLElement)) return
  const composer = from.closest('.thread-posts-composer')
  if (!(composer instanceof HTMLElement)) return
  const overflow = composer.getBoundingClientRect().bottom - modal.getBoundingClientRect().bottom + 12
  if (overflow > 1) modal.scrollTop += overflow
}

function composerLooksEmpty(node: HTMLElement): boolean {
  const text = node.innerText ?? ''
  return text === '' || text === '\n' || text === '\r\n'
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name)
}
