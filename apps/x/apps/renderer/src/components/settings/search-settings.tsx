import { useEffect, useState } from 'react'
import type { ipc } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Status = ipc.IPCChannels['search:getSettings']['res']
const providers = ['exa', 'tavily', 'firecrawl'] as const

export function SearchSettings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [provider, setProvider] = useState<Status['provider']>('disabled')
  const [keys, setKeys] = useState<Partial<Record<typeof providers[number], string>>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    window.ipc.invoke('search:getSettings', null).then(value => { setStatus(value); setProvider(value.provider) })
      .catch(() => setMessage('Could not load search settings.'))
  }, [])
  async function save(test: boolean) {
    setBusy(true)
    setMessage('')
    try {
      const next = await window.ipc.invoke('search:saveSettings', { provider, keys })
      setStatus(next)
      setKeys({})
      window.dispatchEvent(new Event('search-settings-changed'))
      if (test) {
        const result = await window.ipc.invoke('search:test', { provider })
        setMessage(result.success ? `Connection works (${result.count ?? 0} results).` : result.error ?? 'Search failed.')
      } else setMessage('Search settings saved.')
    } catch { setMessage('Could not save or test search settings.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Use your own search API keys without a Rowboat account. Keys are stored in a local configuration file and are never shown again here.</p>
    <label className="block space-y-2 text-sm">Default search provider
      <Select value={provider} onValueChange={value => setProvider(value as Status['provider'])} disabled={busy || !status}>
        <SelectTrigger aria-label="Default search provider"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="disabled">Disabled</SelectItem>
          {providers.map(name => <SelectItem key={name} value={name}>{name === 'exa' ? 'Exa' : name === 'tavily' ? 'Tavily' : 'Firecrawl'}</SelectItem>)}
          <SelectItem value="rowboat" disabled={!status?.rowboatAvailable}>Rowboat account</SelectItem>
        </SelectContent>
      </Select>
    </label>
    {providers.map(name => <div key={name} className="space-y-2">
      <label htmlFor={`search-${name}`} className="text-sm font-medium capitalize">{name} API key</label>
      <div className="flex gap-2">
        <Input id={`search-${name}`} type="password" autoComplete="off" disabled={busy || !status} value={keys[name] ?? ''}
          placeholder={keys[name] === '' ? 'Key will be removed on save' : status?.configured[name] ? 'Configured — enter a replacement' : 'Paste your API key'}
          onChange={event => setKeys(previous => ({ ...previous, [name]: event.target.value }))} />
        <Button variant="outline" disabled={busy || !status} onClick={() => setKeys(previous => ({ ...previous, [name]: '' }))}>Remove</Button>
      </div>
    </div>)}
    <p className="text-xs text-muted-foreground">Search uses only your selected provider. Save &amp; test sends one search request and uses that provider’s quota. Start a new chat after enabling search if the current chat has no search tool.</p>
    <div className="flex gap-2">
      <Button disabled={busy || !status} onClick={() => void save(false)}>Save</Button>
      <Button variant="outline" disabled={busy || !status || provider === 'disabled'} onClick={() => void save(true)}>{busy ? 'Working…' : 'Save & test'}</Button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>
}
