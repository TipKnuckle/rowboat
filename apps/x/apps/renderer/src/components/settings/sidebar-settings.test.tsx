import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SidebarSettings } from './sidebar-settings'
import { useSidebarPreferences } from '@/lib/sidebar-preferences'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)
function Observer() {
  const preferences = useSidebarPreferences()
  return <p>{preferences.meetings ? 'Meetings visible' : 'Meetings hidden'}</p>
}
it('updates other subscribers immediately and persists across remounts', () => {
  const view = render(<><SidebarSettings /><Observer /></>)
  expect(screen.getByText('Meetings hidden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'Meetings' }))
  expect(screen.getByText('Meetings visible')).toBeInTheDocument()
  view.unmount()
  render(<Observer />)
  expect(screen.getByText('Meetings visible')).toBeInTheDocument()
})
