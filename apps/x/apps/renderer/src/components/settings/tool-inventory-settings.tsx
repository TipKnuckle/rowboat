import { useEffect, useState } from 'react'
import type { ipc } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Inventory = ipc.IPCChannels['tools:inventory']['res']
export function ToolInventorySettings() {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load(includeMcp: boolean) {
    setBusy(true)
    setError('')
    try { setInventory(await window.ipc.invoke('tools:inventory', { includeMcp })) }
    catch { setError('Could not load tool inventory.') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load(false) }, [])
  const tools = inventory?.tools.filter(tool => `${tool.name} ${tool.description} ${tool.source} ${tool.skills.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) ?? []
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Inspect the tools available to agents, their inputs, and permission policies. This list comes from the running app.</p>
    <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void load(false)}>Refresh built-ins</Button><Button disabled={busy} onClick={() => void load(true)}>{busy ? 'Loading…' : 'Load connected MCP tools'}</Button></div>
    <Input aria-label="Filter tools" placeholder="Search tools, descriptions, skills…" value={filter} onChange={e => setFilter(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    {inventory?.notices.map(notice => <p key={notice} className="text-xs text-muted-foreground">{notice}</p>)}
    <p className="text-sm">{tools.length} of {inventory?.tools.length ?? 0} tools</p>
    {tools.map(tool => <details key={`${tool.source}:${tool.name}`} className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{tool.name} <span className="font-normal text-muted-foreground">· {tool.source} · {tool.available ? 'Available' : 'Not configured'}</span></summary>
      <div className="space-y-2 pt-3 text-xs">
        <p className="whitespace-pre-wrap">{tool.description}</p>
        <p>Permission: {tool.permission} · {tool.activation}</p>
        {!!tool.skills.length && <p>Skills: {tool.skills.join(', ')}</p>}
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2">{tool.inputSchema}</pre>
      </div>
    </details>)}
  </div>
}
