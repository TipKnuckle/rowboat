import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SearchSettings } from './search-settings'

const status = { provider: 'tavily', configured: { exa: false, tavily: true, firecrawl: false }, rowboatAvailable: false, available: true }
const invoke = vi.fn()
beforeEach(() => {
  invoke.mockReset().mockImplementation(async (channel: string) => channel === 'search:test' ? { success: true, count: 1 } : status)
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
})
afterEach(cleanup)

it('preserves untouched keys and clears a replacement from the UI after save', async () => {
  render(<SearchSettings />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled())
  expect(screen.getByLabelText('tavily API key')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('firecrawl API key'), { target: { value: 'new-secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Search settings saved.')
  expect(invoke).toHaveBeenCalledWith('search:saveSettings', { provider: 'tavily', keys: { firecrawl: 'new-secret' } })
  expect(screen.getByLabelText('firecrawl API key')).toHaveValue('')
})

it('tests only after saving the selected settings', async () => {
  render(<SearchSettings />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save & test' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Save & test' }))
  await screen.findByText('Connection works (1 results).')
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['search:getSettings', 'search:saveSettings', 'search:test'])
})
