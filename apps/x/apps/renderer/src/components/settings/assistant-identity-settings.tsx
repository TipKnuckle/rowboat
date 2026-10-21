import { useEffect, useState } from 'react'
import { AssistantIdentity, DEFAULT_ASSISTANT_IDENTITY } from '@x/shared/dist/assistant-identity.js'
import type { ipc } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Identity = ipc.IPCChannels['assistant:getIdentity']['res']

export function AssistantIdentitySettings() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    window.ipc.invoke('assistant:getIdentity', null)
      .then(value => { if (active) setIdentity(value) })
      .catch(() => { if (active) setMessage('Could not load assistant settings. Reopen this section to retry.') })
    return () => { active = false }
  }, [])

  async function save() {
    const parsed = AssistantIdentity.safeParse(identity)
    if (!parsed.success) return
    setBusy(true)
    setMessage('')
    try {
      setIdentity(await window.ipc.invoke('assistant:saveIdentity', parsed.data))
      setMessage('Saved. Start a new chat to use these settings.')
    } catch {
      setMessage('Could not save assistant settings. Your edits are still here; try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Choose what your assistant calls itself and how it speaks. Its tools and task instructions stay intact. These settings are saved on the connected backend.</p>
    <label className="block space-y-2 text-sm">Name
      <Input value={identity?.name ?? ''} maxLength={80} disabled={!identity || busy}
        onChange={event => setIdentity(previous => previous && { ...previous, name: event.target.value })} />
    </label>
    <label className="block space-y-2 text-sm">Personality
      <Textarea value={identity?.personality ?? ''} maxLength={4000} rows={7} disabled={!identity || busy}
        placeholder="Describe the tone and style you prefer. Leave blank for no extra personality instructions."
        onChange={event => setIdentity(previous => previous && { ...previous, personality: event.target.value })} />
    </label>
    <p className="text-xs text-muted-foreground">Start a new chat after saving. Existing conversations may retain their earlier instructions and context.</p>
    <div className="flex gap-2">
      <Button disabled={busy || !AssistantIdentity.safeParse(identity).success} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
      <Button variant="outline" disabled={!identity || busy} onClick={() => { setIdentity({ ...DEFAULT_ASSISTANT_IDENTITY }); setMessage('Defaults restored in the form. Click Save to apply.') }}>Use defaults</Button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>
}
