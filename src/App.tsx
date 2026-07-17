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
  // Bumped when Settings deletes a song, so the still-mounted LibraryScreen refetches.
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0)
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

  const goToLanding = () => {
    setSettingsOpen(false)
    setView('landing')
  }

  return (
    <>
      {/* Normal document flow: the banners are static rows that push the active
          view down instead of a fixed overlay painting over the header. The
          shell owns the viewport height; each inner view fills the flex-1 slot
          (they use h-full, not their own 100dvh, so a shown banner can't cause
          the page to overflow). */}
      <div
        className="flex flex-col h-[100dvh]"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <OfflineBanner />
        <UpdateBanner />
        <div className="flex-1 min-h-0 overflow-hidden">
          {view === 'landing' ? (
            <Suspense fallback={<div className="h-full bg-cinnabar-950" />}>
              <LandingScreen onOpenApp={leaveLanding} />
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
                refreshKey={libraryRefreshKey}
              />
              <Onboarding />
            </>
          )}
        </div>
      </div>

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
            setLibraryRefreshKey((k) => k + 1)
            if (songId === deletedId) {
              setView('library')
              setSongId(null)
              setAutoAlignOnOpen(false)
            }
          }}
          onViewLanding={goToLanding}
        />
      )}
    </>
  )
}
