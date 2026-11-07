// Message composer: text, file picker and drag-and-drop. Files are read in the renderer and sent as base64
// (the sandboxed renderer has no file paths); main stores them.
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type AttachmentUpload } from '../../../shared/chat'

export interface ComposerProps {
  disabled?: boolean
  onSend: (body: string, attachments: AttachmentUpload[]) => Promise<void>
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function readFile(file: File): Promise<AttachmentUpload> {
  return { name: file.name, mime: file.type || 'application/octet-stream', dataBase64: toBase64(await file.arrayBuffer()) }
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]): void => {
    const next = [...files, ...incoming]
    if (next.length > MAX_ATTACHMENTS) return setError(`At most ${MAX_ATTACHMENTS} attachments per message`)
    const big = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (big) return setError(`${big.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    setError(null)
    setFiles(next)
  }

  const send = async (): Promise<void> => {
    if (sending || disabled || (text.trim() === '' && files.length === 0)) return
    setSending(true)
    setError(null)
    try {
      await onSend(text, await Promise.all(files.map(readFile)))
      setText('')
      setFiles([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className={dragging ? 'chat-composer dragging' : 'chat-composer'}
      data-testid="composer"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {files.length > 0 && (
        <ul className="chat-attachments" data-testid="composer-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="chip">
              📎 {f.name}
              <button className="chip-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="chat-composer-row">
        <button className="icon-button" aria-label="Attach files" onClick={() => picker.current?.click()}>
          📎
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="composer-file-input"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <textarea
          className="input chat-input"
          rows={1}
          aria-label="Message"
          placeholder={dragging ? 'Drop files to attach' : 'Message…'}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className="button primary"
          aria-label="Send"
          disabled={disabled || sending || (text.trim() === '' && files.length === 0)}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
