import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssistantIdentitySettings } from './assistant-identity-settings'

afterEach(cleanup)
it('loads the backend settings and saves only name and personality', async () => {
  const invoke = vi.fn(async (_channel, args) => args ?? { name: 'Assistant', personality: 'Be direct.' })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  render(<AssistantIdentitySettings />)
  await screen.findByDisplayValue('Assistant')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Merlin' } })
  fireEvent.change(screen.getByLabelText('Personality'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Saved. Start a new chat to use these settings.')
  expect(invoke).toHaveBeenCalledWith('assistant:saveIdentity', { name: 'Merlin', personality: '' })
})

it('keeps edits after a failed save and prevents empty names', async () => {
  const invoke = vi.fn(async channel => {
    if (channel === 'assistant:saveIdentity') throw new Error('offline')
    return { name: 'Assistant', personality: 'Be direct.' }
  })
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke } })
  render(<AssistantIdentitySettings />)
  await screen.findByDisplayValue('Assistant')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Merlin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/Your edits are still here/)
  expect(screen.getByLabelText('Name')).toHaveValue('Merlin')
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' ' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
})
