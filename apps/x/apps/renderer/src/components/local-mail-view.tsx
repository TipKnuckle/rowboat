import { useEffect, useRef, useState } from 'react'
import type { ipc } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Thread = ipc.IPCChannels['localMail:search']['res'][number]
type Message = ipc.IPCChannels['localMail:read']['res'][number]
export function LocalMailView() {
  const [query, setQuery] = useState('tag:inbox')
  const [appliedQuery, setAppliedQuery] = useState('tag:inbox')
  const [offset, setOffset] = useState(0)
  const [threads, setThreads] = useState<Thread[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<ipc.IPCChannels['localMail:status']['res'] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const readVersion = useRef(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setMessages([])
    setSelected(null)
    setReading(false)
    readVersion.current++
    void (async () => {
      try {
        const next = await window.ipc.invoke('localMail:status', null)
        if (cancelled) return
        setStatus(next)
        if (!next.available) { setThreads([]); return }
        const results = await window.ipc.invoke('localMail:search', { query: appliedQuery, offset, limit: 50 })
        if (!cancelled) setThreads(results)
      } catch { if (!cancelled) { setThreads([]); setError('Could not search local mail. Check your notmuch query and configuration.') } }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; readVersion.current++ }
  }, [appliedQuery, offset, refresh])
  async function read(thread: string) {
    const version = ++readVersion.current
    setSelected(thread)
    setMessages([])
    setReading(true)
    setError('')
    try {
      const results = await window.ipc.invoke('localMail:read', { thread })
      if (version === readVersion.current) setMessages(results)
    } catch { if (version === readVersion.current) setError('Could not read this thread. It may exceed the size limit or have moved since the last sync.') }
    finally { if (version === readVersion.current) setReading(false) }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="space-y-2 border-b p-4">
      <h2 className="font-medium">Local mail <span className="text-sm font-normal text-muted-foreground">· Read only</span></h2>
      <p className="text-xs text-muted-foreground">Reads your existing notmuch index. Your sync service still updates mail. Rowboat does not mark messages read, send mail, or load remote images.</p>
      {status?.available && <p className="text-xs text-muted-foreground">{status.count?.toLocaleString()} indexed messages · {status.path}</p>}
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setOffset(0); setAppliedQuery(query); setRefresh(v => v + 1) }}>
        <Input aria-label="Search local mail" value={query} onChange={e => setQuery(e.target.value)} placeholder="from:someone subject:hello or tag:inbox" />
        <Button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search / refresh'}</Button>
      </form>
      <p className="text-xs text-muted-foreground">Use * for all mail. Search accepts notmuch query syntax.</p>
      {(error || status?.error) && <p role="alert" className="text-sm text-destructive">{error || status?.error}</p>}
    </div>
    <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-r">
        <div className="min-h-0 flex-1 overflow-auto">
          {!loading && status?.available && !threads.length && <p className="p-4 text-sm text-muted-foreground">No matching mail.</p>}
          {threads.map(thread => <button key={thread.thread} type="button" aria-pressed={selected === thread.thread} onClick={() => void read(thread.thread)} className={`block w-full border-b p-3 text-left hover:bg-muted ${selected === thread.thread ? 'bg-muted' : ''}`}>
            <div className="truncate text-sm font-medium">{thread.subject || '(No subject)'}</div>
            <div className="truncate text-xs text-muted-foreground">{thread.authors}</div>
            <div className="mt-1 text-xs text-muted-foreground">{new Date(thread.timestamp * 1000).toLocaleDateString()} · {thread.total} messages</div>
          </button>)}
        </div>
        <div className="flex justify-between gap-2 border-t p-2">
          <Button variant="outline" size="sm" disabled={loading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={loading || threads.length < 50} onClick={() => setOffset(v => v + 50)}>Next</Button>
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {reading ? <p role="status">Reading…</p> : !selected ? <p className="text-sm text-muted-foreground">Select a thread to read it.</p> : !messages.length ? <p className="text-sm text-muted-foreground">No readable messages found.</p> : null}
        {messages.map(message => <article key={message.id} className="mb-6 rounded-lg border p-4">
          <h3 className="font-medium">{message.subject}</h3>
          <div className="my-2 space-y-1 break-words text-xs text-muted-foreground"><p>From: {message.from}</p><p>To: {message.to}</p><p>{message.date}</p></div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{message.text}</pre>
          {!!message.attachments.length && <p className="mt-3 text-xs text-muted-foreground">Attachments (open in your mail client): {message.attachments.join(', ')}</p>}
        </article>)}
      </div>
    </div>
  </div>
}
