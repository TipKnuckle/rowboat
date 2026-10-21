import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PhonePairingSettings } from './phone-pairing-settings'

afterEach(cleanup)
it('pairs with the authoritative remote server and hides local administration controls', async () => {
  Object.defineProperty(window, 'ipc', { configurable: true, value: { invoke: vi.fn(async () => ({
    running: true, remote: true, name: 'Dagonet', port: 3220, lanEnabled: true,
    urls: ['http://192.168.50.60:3220', 'http://192.168.50.61:3220'], token: 'test-token',
  })) } })
  render(<PhonePairingSettings dialogOpen />)
  await screen.findByText('Pair directly with Dagonet. Network access and key rotation are managed on that server.')
  expect(screen.getByText('Pair your phone')).toBeInTheDocument()
  expect(screen.getByText('http://192.168.50.60:3220')).toBeInTheDocument()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset pairing code' })).toBeNull()
})
