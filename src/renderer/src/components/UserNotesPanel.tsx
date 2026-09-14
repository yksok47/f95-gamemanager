import { useEffect, useRef, useState, type JSX } from 'react'

type UserNotesPanelProps = {
  threadId: number
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function UserNotesPanel({ threadId }: UserNotesPanelProps): JSX.Element {
  const [text, setText] = useState('')
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef(text)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef('')

  textRef.current = text

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    setSaveState('idle')
    setText('')
    lastSaved.current = ''

    void window.api.gameNotes
      .get(threadId)
      .then((next) => {
        if (cancelled) return
        setText(next)
        lastSaved.current = next
        setReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load notes.')
        setReady(true)
      })

    return () => {
      cancelled = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (savedClearTimer.current) clearTimeout(savedClearTimer.current)
      const pending = textRef.current
      if (pending !== lastSaved.current) {
        void window.api.gameNotes.set(threadId, pending).catch(() => undefined)
      }
    }
  }, [threadId])

  function markSaved(next: string): void {
    lastSaved.current = next
    setSaveState('saved')
    if (savedClearTimer.current) clearTimeout(savedClearTimer.current)
    savedClearTimer.current = setTimeout(() => setSaveState('idle'), 1500)
  }

  async function persist(next: string): Promise<void> {
    if (next === lastSaved.current) {
      setSaveState('idle')
      return
    }
    setSaveState('saving')
    setError(null)
    try {
      const saved = await window.api.gameNotes.set(threadId, next)
      if (textRef.current !== next) return
      markSaved(saved)
    } catch (err) {
      if (textRef.current !== next) return
      setSaveState('error')
      setError(err instanceof Error ? err.message : 'Could not save notes.')
    }
  }

  function scheduleSave(next: string): void {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = setTimeout(() => {
      void persist(next)
    }, 400)
  }

  function onChange(value: string): void {
    setText(value)
    scheduleSave(value)
  }

  function onBlur(): void {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    void persist(text)
  }

  const statusLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Save failed'
          : ready
            ? 'Autosaves as you type'
            : 'Loading…'

  return (
    <div className="user-notes-panel">
      <div className="user-notes-head">
        <p className="muted user-notes-hint">
          Private scratch pad for this game — passwords, progress, reminders, whatever you want to keep.
        </p>
        <span
          className={
            saveState === 'error'
              ? 'user-notes-status user-notes-status-error'
              : saveState === 'saved'
                ? 'user-notes-status user-notes-status-saved'
                : 'user-notes-status'
          }
        >
          {statusLabel}
        </span>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <textarea
        className="user-notes-pad"
        value={text}
        disabled={!ready}
        spellCheck
        placeholder="Write anything about this game…"
        aria-label="Your notes for this game"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </div>
  )
}
