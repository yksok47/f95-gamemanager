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
import { applyBbCode, applyListBbCode, applyStripBbCode, bbcodeToHtml, htmlToBbcode, moveCaretOutOfBbCodeTag, stripBbCode } from '../lib/bbcode'
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
    const pendingPreviewCaret = useRef<Range | null>(null)

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
        restorePendingPreviewCaret(node)
        return
      }
      skipPreviewSync.current = false
      node.innerHTML = value.trim() ? bbcodeToHtml(value, attachments) : ''
      setPreviewEmpty(composerLooksEmpty(node))
      pinComposerToModal(node)
    }, [value, preview, attachments])

    useEffect(() => {
      if (!preview) return
      function onSelectionChange(): void {
        rememberPreviewRange()
      }
      document.addEventListener('selectionchange', onSelectionChange)
      return () => document.removeEventListener('selectionchange', onSelectionChange)
    }, [preview])

    function restorePendingPreviewCaret(editor: HTMLElement): void {
      const caret = pendingPreviewCaret.current
      pendingPreviewCaret.current = null
      if (!caret || !rangeIsInEditor(editor, caret)) return
      editor.focus()
      const sel = window.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      sel.addRange(caret)
      savedRange.current = caret.cloneRange()
    }

    function capturePendingPreviewCaret(): void {
      const editor = previewRef.current
      const sel = window.getSelection()
      if (!editor || !sel || !sel.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!rangeIsInEditor(editor, range)) return
      pendingPreviewCaret.current = range.cloneRange()
    }

    function rememberPreviewRange(): void {
      const editor = previewRef.current
      const sel = window.getSelection()
      if (!editor || !sel || !sel.rangeCount) return
      const range = sel.getRangeAt(0)
      if (!rangeIsInEditor(editor, range)) return
      savedRange.current = range.cloneRange()
    }

    function restorePreviewRange(): Range | null {
      const editor = previewRef.current
      if (!editor) return null
      editor.focus()
      const sel = window.getSelection()
      if (!sel) return null
      const range = savedRange.current
      if (range && rangeIsInEditor(editor, range)) {
        const next = range.cloneRange()
        snapRangeIntoEditor(editor, next)
        sel.removeAllRanges()
        sel.addRange(next)
        savedRange.current = next.cloneRange()
        return next
      }
      const fallback = document.createRange()
      fallback.selectNodeContents(editor)
      fallback.collapse(false)
      sel.removeAllRanges()
      sel.addRange(fallback)
      return fallback
    }

    function commitPreview(opts?: { clearIfEmpty?: boolean }): void {
      const node = previewRef.current
      if (!node) return
      if (opts?.clearIfEmpty) {
        pruneEmptyBlockWraps(node)
        if (previewHasNoUserContent(node)) {
          node.innerHTML = ''
          savedRange.current = null
          skipPreviewSync.current = true
          setPreviewEmpty(true)
          onChange('')
          pinComposerToModal(node)
          return
        }
      }
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
          rememberPreviewRange()
          capturePendingPreviewCaret()
          commitPreview()
          return
        }
        const color = open.match(/^\[COLOR=(.+)\]$/i)?.[1]
        if (color) {
          document.execCommand('foreColor', false, color)
          rememberPreviewRange()
          capturePendingPreviewCaret()
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
      const hadSelection = !range.collapsed && Boolean(range.toString())
      const inner = hadSelection ? range.toString() : placeholderText
      const node = make(inner)
      const target = primaryInsertedNode(node)
      range.deleteContents()
      range.insertNode(node)
      if (target && editorContainsNode(editor, target)) {
        ensureCaretTarget(target)
        placeCaretInNode(target, {
          selectContents: Boolean(placeholderText) && !hadSelection,
          atStart: !hadSelection
        })
      }
      rememberPreviewRange()
      capturePendingPreviewCaret()
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

    function stripFormatting(): void {
      if (disabled) return
      if (preview) {
        const editor = previewRef.current
        const range = restorePreviewRange()
        if (!editor || !range) return
        if (!range.collapsed) {
          if (unwrapPreviewRange(editor, range)) {
            rememberPreviewRange()
            capturePendingPreviewCaret()
            commitPreview()
            return
          }
          const holder = document.createElement('div')
          holder.appendChild(range.cloneContents())
          savedRange.current = range.cloneRange()
          insertPreviewHtml(bbcodeToHtml(stripBbCode(htmlToBbcode(holder.innerHTML)), attachments))
          return
        }
        if (!exitPreviewFormatting(editor, range)) return
        rememberPreviewRange()
        capturePendingPreviewCaret()
        commitPreview()
        return
      }
      const node = textareaRef.current
      const start = node?.selectionStart ?? 0
      const end = node?.selectionEnd ?? start
      const next = applyStripBbCode(value, start, end)
      pendingSel.current = { start: next.start, end: next.end }
      onChange(next.value)
    }

    function selectedText(): string {
      if (preview) {
        const sel = window.getSelection()
        const editor = previewRef.current
        if (sel && editor && editorContainsNode(editor, sel.anchorNode)) return sel.toString()
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
      if (!event.altKey && !event.ctrlKey && !event.metaKey && isArrowKey(event.key)) {
        if (preview ? leavePreviewWrap(event) : leaveTextareaWrap(event)) return
      }
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

    function leavePreviewWrap(event: KeyboardEvent<HTMLElement>): boolean {
      const editor = previewRef.current
      const sel = window.getSelection()
      if (!editor || !sel || !sel.rangeCount) return false
      const range = sel.getRangeAt(0)
      if (!range.collapsed && !event.shiftKey) return false
      const wrap = findBbcodeWrap(editor, range.startContainer)
      if (!wrap) return false
      const block = isBlockBbcodeWrap(wrap)
      const leaveAfter =
        (event.key === 'ArrowRight' && isAtEditableEnd(wrap, range)) ||
        (event.key === 'ArrowDown' && (block ? isOnLastEditableLine(wrap, range) : isAtEditableEnd(wrap, range)))
      const leaveBefore =
        (event.key === 'ArrowLeft' && isAtEditableStart(wrap, range)) ||
        (event.key === 'ArrowUp' && (block ? isOnFirstEditableLine(wrap, range) : isAtEditableStart(wrap, range)))
      if (!leaveAfter && !leaveBefore) return false
      event.preventDefault()
      const added = placeCaretOutside(wrap, leaveAfter, event.shiftKey)
      rememberPreviewRange()
      if (added) commitPreview()
      return true
    }

    function leaveTextareaWrap(event: KeyboardEvent<HTMLElement>): boolean {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false
      const node = textareaRef.current
      if (!node) return false
      const start = node.selectionStart
      const end = node.selectionEnd
      if (start !== end && !event.shiftKey) return false
      const caret = event.key === 'ArrowLeft' ? start : end
      const next = moveCaretOutOfBbCodeTag(value, caret, event.key === 'ArrowLeft' ? 'left' : 'right')
      if (next == null) return false
      event.preventDefault()
      if (event.shiftKey) {
        if (event.key === 'ArrowLeft') node.setSelectionRange(Math.min(next, end), end)
        else node.setSelectionRange(start, Math.max(next, start))
      } else {
        node.setSelectionRange(next, next)
      }
      pendingSel.current = { start: node.selectionStart, end: node.selectionEnd }
      return true
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
          <ToolBtn disabled={busy} title="Remove BBCode from selection, or exit the current tag" onClick={() => stripFormatting()}>
            Clear
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
          onInput={(event) => {
            const inputType = (event.nativeEvent as InputEvent).inputType ?? ''
            commitPreview({
              clearIfEmpty: inputType.startsWith('delete') || inputType === 'historyUndo'
            })
          }}
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
  if (node.querySelector('img, a[data-attachment], video, iframe, pre, blockquote, details, ul, ol, li')) {
    return false
  }
  return previewHasNoUserContent(node)
}

function previewHasNoUserContent(node: HTMLElement): boolean {
  if (node.querySelector('img, a[data-attachment], video, iframe')) return false
  const clone = node.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[contenteditable="false"]').forEach((el) => el.remove())
  const text = (clone.innerText ?? '').replace(/\u00a0/g, ' ')
  return text === '' || text === '\n' || text === '\r\n'
}

function pruneEmptyBlockWraps(editor: HTMLElement): void {
  const blocks = [...editor.querySelectorAll('blockquote, pre, details, ul, ol')]
  for (const el of blocks.reverse()) {
    if (!(el instanceof HTMLElement) || !editor.contains(el)) continue
    if (isEmptyBlock(el)) el.remove()
  }
}

function isEmptyBlock(el: HTMLElement): boolean {
  if (el.querySelector('img, a[data-attachment], video, iframe')) return false
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[contenteditable="false"], .bbCodeBlock-title, summary').forEach((node) => node.remove())
  return !(clone.textContent ?? '').replace(/\u00a0/g, ' ').trim()
}

function isBbcodeWrap(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (
    tag === 'strong' ||
    tag === 'b' ||
    tag === 'em' ||
    tag === 'i' ||
    tag === 'u' ||
    tag === 's' ||
    tag === 'strike' ||
    tag === 'del' ||
    tag === 'pre' ||
    tag === 'code' ||
    tag === 'blockquote' ||
    tag === 'details' ||
    tag === 'ul' ||
    tag === 'ol' ||
    tag === 'a' ||
    tag === 'font'
  ) {
    return true
  }
  if (el.classList.contains('bbcode-preview-code')) return true
  if (el.classList.contains('bbcode-preview-icode')) return true
  if (el.classList.contains('bbcode-preview-ispoiler')) return true
  if (el.classList.contains('bbcode-preview-spoiler')) return true
  if (el.classList.contains('bbCodeBlock--quote')) return true
  return Boolean(el.style.color || el.style.fontSize)
}

function findBbcodeWrap(editor: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== editor) {
    if (current instanceof HTMLElement && isBbcodeWrap(current)) return current
    current = current.parentNode
  }
  return null
}

function splitElementAt(el: HTMLElement, container: Node, offset: number): HTMLElement | null {
  const rest = document.createRange()
  try {
    rest.setStart(container, offset)
    rest.setEnd(el, el.childNodes.length)
  } catch {
    return null
  }
  if (rest.collapsed) return null
  const frag = rest.extractContents()
  if (!frag.childNodes.length) return null
  const clone = el.cloneNode(false) as HTMLElement
  clone.appendChild(frag)
  el.after(clone)
  return clone
}

function unwrapElement(el: HTMLElement): { first: Node | null; last: Node | null } {
  const parent = el.parentNode
  const first = el.firstChild
  const last = el.lastChild
  if (!parent) return { first, last }
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  el.remove()
  return { first, last }
}

function clampRangeToNode(range: Range, node: HTMLElement): Range | null {
  const contents = document.createRange()
  contents.selectNodeContents(node)
  const next = range.cloneRange()
  try {
    if (next.compareBoundaryPoints(Range.START_TO_START, contents) < 0) {
      next.setStart(contents.startContainer, contents.startOffset)
    }
    if (next.compareBoundaryPoints(Range.END_TO_END, contents) > 0) {
      next.setEnd(contents.endContainer, contents.endOffset)
    }
  } catch {
    return null
  }
  return next
}

function splitWrapAroundRange(wrap: HTMLElement, range: Range): boolean {
  const clamped = clampRangeToNode(range, wrap)
  if (!clamped) return false
  splitElementAt(wrap, clamped.endContainer, clamped.endOffset)
  const middle = splitElementAt(wrap, clamped.startContainer, clamped.startOffset)
  if (middle) {
    const { first, last } = unwrapElement(middle)
    const sel = window.getSelection()
    if (sel && first && last) {
      const next = document.createRange()
      next.setStartBefore(first)
      next.setEndAfter(last)
      sel.removeAllRanges()
      sel.addRange(next)
    }
  }
  if (!wrap.childNodes.length || previewHasNoUserContent(wrap)) wrap.remove()
  return true
}

function findWrapIntersectingRange(editor: HTMLElement, range: Range): HTMLElement | null {
  const inner = findBbcodeWrap(editor, range.commonAncestorContainer)
  if (inner) return inner
  const hits: HTMLElement[] = []
  for (const node of editor.querySelectorAll('*')) {
    if (!(node instanceof HTMLElement) || !isBbcodeWrap(node)) continue
    try {
      if (range.intersectsNode(node)) hits.push(node)
    } catch {
      continue
    }
  }
  hits.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0))
  return hits[0] ?? null
}

function unwrapPreviewRange(editor: HTMLElement, range: Range): boolean {
  let current = range
  let changed = false
  for (let i = 0; i < 8; i++) {
    const wrap = findWrapIntersectingRange(editor, current)
    if (!wrap) break
    if (!splitWrapAroundRange(wrap, current)) break
    changed = true
    const sel = window.getSelection()
    if (!sel?.rangeCount) break
    current = sel.getRangeAt(0)
  }
  return changed
}

function exitPreviewFormatting(editor: HTMLElement, range: Range): boolean {
  const fromTitle = range.startContainer instanceof Node
    ? (range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
      )?.closest('.bbCodeBlock-title, summary')
    : null
  const wrap = findBbcodeWrap(editor, fromTitle || range.startContainer)
  if (!wrap) return false

  if (fromTitle || rangeIsAtEndOf(wrap, range)) {
    placeCaretAfter(wrap)
    return true
  }

  const tail = document.createRange()
  try {
    tail.setStart(range.startContainer, range.startOffset)
    tail.setEnd(wrap, wrap.childNodes.length)
  } catch {
    placeCaretAfter(wrap)
    return true
  }

  const fragment = tail.extractContents()
  const marker = document.createTextNode('')
  wrap.parentNode?.insertBefore(marker, wrap.nextSibling)
  if (fragment.childNodes.length) wrap.parentNode?.insertBefore(fragment, marker.nextSibling)
  if (isEmptyBlock(wrap) || previewHasNoUserContent(wrap)) wrap.remove()

  const sel = window.getSelection()
  if (!sel) return true
  const caret = document.createRange()
  caret.setStartAfter(marker)
  caret.collapse(true)
  sel.removeAllRanges()
  sel.addRange(caret)
  marker.remove()
  return true
}

function rangeIsAtEndOf(node: HTMLElement, range: Range): boolean {
  const end = document.createRange()
  end.selectNodeContents(node)
  end.collapse(false)
  try {
    return range.collapsed && range.compareBoundaryPoints(Range.START_TO_START, end) >= 0
  } catch {
    return false
  }
}

function placeCaretAfter(node: Node): void {
  const sel = window.getSelection()
  if (!sel) return
  const caret = document.createRange()
  caret.setStartAfter(node)
  caret.collapse(true)
  sel.removeAllRanges()
  sel.addRange(caret)
}

function isBlockBbcodeWrap(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'pre' ||
    tag === 'blockquote' ||
    tag === 'details' ||
    tag === 'ul' ||
    tag === 'ol' ||
    el.classList.contains('bbcode-preview-code') ||
    el.classList.contains('bbcode-preview-spoiler') ||
    el.classList.contains('bbCodeBlock--quote')
  )
}

function editableTextAroundCaret(wrap: HTMLElement, range: Range, before: boolean): string {
  const slice = document.createRange()
  try {
    if (before) {
      slice.selectNodeContents(wrap)
      slice.setEnd(range.startContainer, range.startOffset)
    } else {
      slice.selectNodeContents(wrap)
      slice.setStart(range.startContainer, range.startOffset)
    }
  } catch {
    return before ? 'x' : 'x'
  }
  const holder = document.createElement('div')
  holder.appendChild(slice.cloneContents())
  holder.querySelectorAll('[contenteditable="false"], .bbCodeBlock-title, summary').forEach((node) => node.remove())
  holder.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  return (holder.textContent ?? '').replace(/\u00a0/g, ' ')
}

function isAtEditableStart(wrap: HTMLElement, range: Range): boolean {
  return !editableTextAroundCaret(wrap, range, true).trim()
}

function isAtEditableEnd(wrap: HTMLElement, range: Range): boolean {
  return !editableTextAroundCaret(wrap, range, false).trim()
}

function isOnFirstEditableLine(wrap: HTMLElement, range: Range): boolean {
  return !editableTextAroundCaret(wrap, range, true).replace(/^\s+/, '').includes('\n')
}

function isOnLastEditableLine(wrap: HTMLElement, range: Range): boolean {
  return !editableTextAroundCaret(wrap, range, false).replace(/\s+$/, '').includes('\n')
}

function placeCaretOutside(wrap: HTMLElement, after: boolean, extend: boolean): boolean {
  let added = false
  const sel = window.getSelection()
  if (!sel) return false
  const caret = document.createRange()
  if (after) {
    if (!wrap.nextSibling) {
      if (isBlockBbcodeWrap(wrap)) {
        wrap.after(document.createElement('br'))
        added = true
        caret.setStartAfter(wrap)
      } else {
        const spacer = document.createTextNode('\u200b')
        wrap.after(spacer)
        added = true
        caret.setStart(spacer, 1)
      }
    } else {
      caret.setStartAfter(wrap)
    }
  } else {
    if (!wrap.previousSibling) {
      const spacer = document.createTextNode('\u200b')
      wrap.before(spacer)
      added = true
      caret.setStart(spacer, 0)
    } else {
      caret.setStartBefore(wrap)
    }
  }
  caret.collapse(true)
  if (extend && sel.rangeCount) {
    try {
      sel.extend(caret.startContainer, caret.startOffset)
    } catch {
      sel.removeAllRanges()
      sel.addRange(caret)
    }
  } else {
    sel.removeAllRanges()
    sel.addRange(caret)
  }
  return added
}

function isArrowKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
}

function editorContainsNode(editor: HTMLElement, node: Node | null): boolean {
  return Boolean(node && (node === editor || editor.contains(node)))
}

function rangeIsInEditor(editor: HTMLElement, range: Range): boolean {
  try {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false
  } catch {
    return false
  }
  return editorContainsNode(editor, range.commonAncestorContainer)
}

function snapRangeIntoEditor(editor: HTMLElement, range: Range): void {
  if (range.startContainer === editor) {
    const child = editor.childNodes[range.startOffset] ?? editor.firstChild
    if (child) range.setStart(child, 0)
  }
  if (range.endContainer === editor) {
    const child = editor.childNodes[Math.max(0, range.endOffset - 1)] ?? editor.lastChild
    if (child) {
      const offset = child.nodeType === Node.TEXT_NODE ? (child.textContent?.length ?? 0) : child.childNodes.length
      range.setEnd(child, offset)
    }
  }
}

function primaryInsertedNode(node: Node): Node | null {
  if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return node
  const elements = Array.from(node.childNodes).filter((child) => child.nodeType === Node.ELEMENT_NODE)
  return elements[0] || node.firstChild
}

function ensureCaretTarget(node: Node): void {
  if (!(node instanceof HTMLElement) || node.childNodes.length) return
  node.appendChild(document.createElement('br'))
}

function placeCaretInNode(node: Node, opts: { selectContents?: boolean; atStart?: boolean }): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  try {
    range.selectNodeContents(node)
    if (!opts.selectContents) range.collapse(Boolean(opts.atStart))
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {
    return
  }
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
