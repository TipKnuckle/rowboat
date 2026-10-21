import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from '@/contexts/theme-context'
import { MeetingDetectedPopup } from '@/components/meeting-detected-popup'
import { QuickAskBar } from '@/components/quick-ask-bar'
import { ScreenPointerOverlay } from '@/components/screen-pointer-overlay'
import { setAssistantPreferenceBackend } from './lib/assistant-dock'

// React's development build records a performance.measure entry (with a
// serialized `detail`) for every component render — its DevTools
// "Components ⚛" track — and never clears them. Chromium keeps user-timing
// entries until told otherwise, ~1 KB each, so a dev window left open for
// hours accumulates millions of entries until Blink's allocator gives up and
// the renderer dies (blank window, `render-process-gone` exitCode=5). Clear
// the buffer periodically: the Performance panel still shows React's tracks,
// since those are emitted as trace events at call time, not read back from
// this buffer. Production React has no performance tracks, so this is dev-only.
if (import.meta.env.DEV) {
  setInterval(() => {
    performance.clearMeasures()
    performance.clearMarks()
  }, 10_000)
}

async function bootstrap() {
  try {
    const connection = await window.ipc.invoke('server:getConnection', null)
    setAssistantPreferenceBackend(connection.mode === 'remote' ? connection.url : null)
  } catch (err) {
    console.error('[Workspace] Failed to identify backend:', err)
    setAssistantPreferenceBackend('unknown-backend')
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="system">
          <App />
        </ThemeProvider>
    </StrictMode>,
  )

}

// Utility windows load the same bundle with a hash route and render only
// their own UI — no app bootstrap needed.
if (window.location.hash === '#meeting-detected') {
  // "Meeting detected — Take Notes?" popup window; same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MeetingDetectedPopup />
    </StrictMode>,
  )
} else if (window.location.hash === '#quick-ask') {
  // The hover companion (global ⌥⇧Space); same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QuickAskBar />
    </StrictMode>,
  )
} else if (window.location.hash === '#screen-pointer') {
  // Assistant's pointer over the shared screen; same pattern.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ScreenPointerOverlay />
    </StrictMode>,
  )
} else {
  bootstrap()
}
