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

/* --- Hash routing (no server config needed) ---
 * The URL reflects which view is open so songs are linkable/bookmarkable and the
 * browser Back button returns to the library. The landing page is the pre-app
 * first-visit state and is intentionally not routed. */
function routeToHash(view: View, songId: string | null): string {
  return view === 'song' && songId ? `#/song/${encodeURIComponent(songId)}` : '#/'
}
function parseHash(): { view: View; songId: string | null } | null {
  const h = window.location.hash
  const m = h.match(/^#\/song\/(.+)$/)
  if (m) return { view: 'song', songId: decodeURIComponent(m[1]) }
  // An EXPLICIT '#/' means the library; an empty hash returns null so the caller
  // falls back to the first-visit rule (landing vs library), rather than forcing
  // library and stealing the landing page from a first-time visitor.
  if (h === '#/') return { view: 'library', songId: null }
  return null
}

export default function App() {
  // Initialise from the URL hash (deep link) when present, else the first-visit rule.
  const initialRoute = parseHash()
  const [view, setView] = useState<View>(() => initialRoute?.view ?? (hasSeenLanding() ? 'library' : 'landing'))
  const [songId, setSongId] = useState<string | null>(() => initialRoute?.songId ?? null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Bumped when Settings deletes a song, so the still-mounted LibraryScreen refetches.
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0)
  const [autoAlignOnOpen, setAutoAlignOnOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    estimateQuota().then(({ ratio }) => {
      if (ratio > 0.8) toast('Storage nearly full. Open Settings to free space.', 'warning')
    })
  }, [toast])

  // Reflect the routed view in the URL: push a history entry when forward-navigating
  // (open a song) so Back returns to the library and a song URL is shareable. The
  // landing view is not routed. pushState fires no event, so this can't loop with the
  // popstate listener below.
  useEffect(() => {
    if (view === 'landing') return
    const target = routeToHash(view, songId)
    if ((window.location.hash || '#/') !== target) window.history.pushState(null, '', target)
  }, [view, songId])

  // Back/Forward: reconcile state from the URL.
  useEffect(() => {
    const onPop = () => {
      const r = parseHash()
      if (!r) return
      setView(r.view)
      setSongId(r.songId)
      setAutoAlignOnOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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
