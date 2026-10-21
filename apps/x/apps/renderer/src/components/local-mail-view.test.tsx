import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalMailView } from './local-mail-view'

afterEach(cleanup)
it('searches and reads locally without requesting any mailbox mutation', async () => {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'localMail:status') return { available: true, count: 3, path: '/example/Mail' }
    if (channel === 'localMail:search') return [{ thread: '0000000000000001', timestamp: 1000, subject: 'A message', authors: 'Sender', total: 1, tags: ['inbox'] }]
    if (channel === 'localMail:read') return [{ id: 'message', from: 'Sender', to: 'Recipient', date: 'Today', subject: 'A message', text: '<img src="https://tracker.invalid"> literal text', attachments: [] }]
    throw new Error(`Unexpected call: ${channel}`)
  })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  render(<LocalMailView />)
  fireEvent.click(await screen.findByRole('button', { name: /A message/ }))
  await screen.findByText(/literal text/)
  expect(document.querySelector('img')).toBeNull()
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['localMail:status', 'localMail:search', 'localMail:read'])
})
