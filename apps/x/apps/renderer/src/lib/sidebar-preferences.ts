import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'x:sidebar-preferences'
const CHANGE_EVENT = 'x:sidebar-preferences-changed'

export const SIDEBAR_OPTIONS = {
  meetings: 'Meetings',
  apps: 'Apps',
  tour: 'Take a tour',
  signIn: 'Sign in to Rowboat',
  connections: 'Connect accounts',
} as const

export type SidebarPreference = keyof typeof SIDEBAR_OPTIONS
export type SidebarPreferences = Record<SidebarPreference, boolean>
const defaults: SidebarPreferences = { meetings: false, apps: false, tour: false, signIn: false, connections: false }
let cachedRaw: string | null | undefined
let cached = defaults

function read(): SidebarPreferences {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch { return cached }
  if (raw === cachedRaw) return cached
  cachedRaw = raw
  cached = { ...defaults }
  try {
    const value = JSON.parse(raw ?? '{}')
    for (const key of Object.keys(defaults) as SidebarPreference[]) {
      if (typeof value?.[key] === 'boolean') cached[key] = value[key]
    }
  } catch { /* Malformed preferences fall back to the local-first defaults. */ }
  return cached
}

function subscribe(notify: () => void) {
  window.addEventListener(CHANGE_EVENT, notify)
  window.addEventListener('storage', notify)
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify)
    window.removeEventListener('storage', notify)
  }
}

export function useSidebarPreferences() {
  return useSyncExternalStore(subscribe, read, () => defaults)
}

export function setSidebarPreference(key: SidebarPreference, visible: boolean) {
  const next = { ...read(), [key]: visible }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
