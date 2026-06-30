import { lazy, Suspense, useEffect, useState } from 'react'
import { LibraryScreen } from './sources/LibraryScreen'
import { AddSongSheet } from './sources/AddSongSheet'
import { PlayerView } from './player/PlayerView'
import { SettingsSheet } from './settings/SettingsSheet'
import { estimateQuota } from './core/storage/quota'
import { useToast } from './core/ui/Toast'
import { OfflineBanner } from './core/ui/OfflineBanner'
import { UpdateBanner } from './core/ui/UpdateBanner'
import { Onboarding } from './core/ui/Onboarding'
import { ensureDemoSong } from './landing/demoSong'

const LandingScreen = lazy(() =>
  import('./landing/LandingScreen').then((m) => ({ default: m.LandingScreen })),
)

type View = 'landing' | 'library' | 'song'

const LANDING_SEEN_KEY = 'utasync_landing_seen'

/** First-time visitors see the landing page; returning visitors go to the library.
 * localStorage can throw (Safari private mode) — fall back to skipping the landing. */
function hasSeenLanding(): boolean {
  try {
    return localStorage.getItem(LANDING_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function markLandingSeen(): void {
  try {
    localStorage.setItem(LANDING_SEEN_KEY, '1')
  } catch {
    // Storage unavailable — the landing just won't be suppressed next time.
  }
}

export default function App() {
  const [view, setView] = useState<View>(() => (hasSeenLanding() ? 'library' : 'landing'))
  const [songId, setSongId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    estimateQuota().then(({ ratio }) => {
      if (ratio > 0.8) toast('Storage nearly full. Open Settings to free space.', 'warning')
    })
  }, [toast])

  const [autoAlignOnOpen, setAutoAlignOnOpen] = useState(false)

  const openSong = (id: string, opts?: { autoAlign?: boolean }) => {
    setSongId(id)
    setAutoAlignOnOpen(opts?.autoAlign ?? false)
    setAddOpen(false)
    setView('song')
  }

  const leaveLanding = () => {
    markLandingSeen()
    setView('library')
  }

  const tryDemo = async () => {
    markLandingSeen()
    try {
      const id = await ensureDemoSong()
      openSong(id)
    } catch {
      toast('Could not load the demo song. Opening the library instead.', 'error')
      setView('library')
    }
  }

  return (
    <>
      <div className="fixed top-0 inset-x-0 z-[65] flex flex-col">
        <OfflineBanner />
        <UpdateBanner />
      </div>
      {view === 'landing' ? (
        <Suspense fallback={<div className="h-[100dvh] bg-cinnabar-950" />}>
          <LandingScreen onTryDemo={tryDemo} onOpenApp={leaveLanding} />
        </Suspense>
      ) : view === 'song' && songId ? (
        <PlayerView
          songId={songId}
          autoAlignOnOpen={autoAlignOnOpen}
          onBack={() => { setView('library'); setAutoAlignOnOpen(false) }}
          onSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <>
          <LibraryScreen
            onOpen={openSong}
            onAdd={() => setAddOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />
          <Onboarding />
        </>
      )}

      {addOpen && (
        <AddSongSheet
          onSongReady={(id) => openSong(id, { autoAlign: true })}
          onClose={() => setAddOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          onSongDeleted={(deletedId) => {
            if (songId === deletedId) {
              setView('library')
              setSongId(null)
              setAutoAlignOnOpen(false)
            }
          }}
        />
      )}
    </>
  )
}
