import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong as removeSong } from '../core/db/deleteSong'
import { useToast } from '../core/ui/Toast'
import { estimateStorageBreakdown, formatBytes, type StorageBreakdown } from '../core/storage/quota'
import { deleteOrphanedAudio, findOrphanedAudioIds } from '../core/storage/cleanup'
import { clearAiModelCache } from '../core/storage/modelCache'
import { sanitizeFilenamePart } from '../player/abLoopExport'
import { exportLRC, downloadFile } from '../lyrics/exporter'
import { useSettingsStore } from '../payment/SettingsStore'
import { useAbLoopPlaylistStore } from '../player/abLoopPlaylistStore'
import { LegalLinks } from '../core/ui/LegalLinks'
import { InlineError } from '../core/ui/InlineError'
import { ConfirmDialog } from '../core/ui/ConfirmDialog'
import { LEGAL_LAST_UPDATED, SUPPORT_URL } from '../core/legal'
import { APP_REPO_URL, appBuildTime, formatAppBuildTime } from '../core/appInfo'
import { getDeviceTier, canUseVocalSeparation } from '../ai-pipeline/capability'
import { refreshDemucsModelAvailability } from '../ai-pipeline/demucsSeparator'
import type { Language, Song } from '../core/types'

/** Build metadata is fixed for the life of the bundle, so it is read once here
 * rather than on every render. Empty strings hide the row entirely. */
const buildTime = appBuildTime()
const buildTimeLabel = formatAppBuildTime(buildTime)

/** A song with no timing exports an LRC stamped [00:00.00] on every line — a
 * file that looks valid and is useless, so the action is offered only when
 * there is timing to export. */
function songHasTiming(song: Song): boolean {
  return song.lyrics.lines.some((l) => l.startTime > 0 || l.endTime > 0)
}

/** Honest result line for orphan cleanup: only files that were really removed
 *  are reported, so a partial failure cannot read as a success. */
function orphanRemovalMessage(deleted: number, remaining: number): string {
  if (remaining > 0) {
    return `Removed ${deleted} orphaned audio file${deleted === 1 ? '' : 's'}; ${remaining} could not be deleted.`
  }
  return deleted > 0
    ? `Removed ${deleted} orphaned audio file${deleted === 1 ? '' : 's'}.`
    : 'No orphaned audio files were found.'
}

interface Props {
  onClose: () => void
  /** When true, omits full-page chrome for sheet embedding. */
  embedded?: boolean
  /** Called after a song is successfully deleted. */
  onSongDeleted?: (songId: string) => void
  /** Navigate to the public landing page, when available. */
  onViewLanding?: () => void
}

function SettingToggle({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string
  description: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-white/70 text-pretty">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onToggle}
        className="shrink-0 min-h-11 min-w-11 flex items-center justify-center touch-manipulation"
      >
        <span
          className={[
            'relative block w-11 h-6 rounded-full transition-colors duration-150 ease-out',
            checked ? 'bg-cinnabar-accent' : 'bg-cinnabar-800',
          ].join(' ')}
        >
          <span
            className={[
              // Animate transform (compositor-friendly) rather than `left`, so the
              // knob glides without per-frame layout. Travel = track − knob − 2×inset.
              'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-150 ease-out',
              checked ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </span>
      </button>
    </div>
  )
}

export function SettingsView({ onClose, embedded = false, onSongDeleted, onViewLanding }: Props) {
  // null while the library is still being read, so "No songs saved." can't be
  // shown to someone who simply has songs that haven't loaded yet.
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [storage, setStorage] = useState<StorageBreakdown | null>(null)
  const toast = useToast()
  const [orphanedAudio, setOrphanedAudio] = useState(0)
  const [cacheMessage, setCacheMessage] = useState<string | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [confirmClearCache, setConfirmClearCache] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmRemoveOrphans, setConfirmRemoveOrphans] = useState(false)
  const [removingOrphans, setRemovingOrphans] = useState(false)
  const { defaultSongLanguage, setDefaultSongLanguage, vocalSeparationEnabled, setVocalSeparationEnabled, readingMode, setReadingMode, tapLookupEnabled, setTapLookupEnabled } = useSettingsStore()

  /** Storage figures are cosmetic bookkeeping. `navigator.storage.estimate()`
   *  can reject (private mode, an embedded frame), and that rejection used to
   *  escape from the delete handler and be reported as "Could not delete song"
   *  — for a song that had in fact been deleted. It must never reject, and it
   *  must never be able to fail a caller's action. */
  const refreshStorage = async () => {
    try {
      setStorage(await estimateStorageBreakdown())
    } catch {
      // Keep the last known figures rather than blanking the card.
    }
  }

  /** Song ids exactly as the database knows them right now. Read late, never
   *  from a mount-time snapshot: an upload writes its OPFS audio file before
   *  its row, so an id that has no row *yet* looks identical to an orphan and
   *  deleting on a stale id set would destroy an upload in flight. */
  const currentSongIds = async (): Promise<string[]> =>
    (await db.songs.toArray()).map((s) => s.id)

  const refreshOrphanCount = async () => {
    try {
      setOrphanedAudio((await findOrphanedAudioIds(await currentSongIds())).length)
    } catch {
      // Keep the last known count.
    }
  }

  useEffect(() => {
    db.songs.toArray().then((library) => {
      setSongs(library)
      void refreshStorage()
      void refreshOrphanCount()
    })
  }, [])

  useEffect(() => {
    if (!canUseVocalSeparation(getDeviceTier())) return
    void refreshDemucsModelAvailability()
  }, [])

  const handleDelete = async (song: Song) => {
    setConfirmDeleteId(null)
    // deleteSong removes the row before the audio, so a failure here means
    // nothing was destroyed: the song and its audio are untouched and a retry
    // is safe. Only this case may be reported as a failed delete.
    const result = await removeSong(song).catch(() => null)
    if (!result) {
      toast('Could not delete song. Please try again.', 'error')
      return
    }
    useAbLoopPlaylistStore.getState().clearPlaylist(song.id)
    setSongs((songs ?? []).filter((s) => s.id !== song.id))
    if (result.audioDeleteFailed) {
      toast('Song removed, but the audio file could not be deleted. Use "Remove orphaned audio" below to reclaim space.', 'warning')
    }
    // The song is already gone from the database, so tell the parent before any
    // bookkeeping: a storage-number failure below must not be able to skip the
    // library refresh or leave the app parked on a deleted song.
    onSongDeleted?.(song.id)
    await refreshStorage()
    // A song whose audio could not be deleted is itself a new orphan.
    await refreshOrphanCount()
  }

  const clearModelCache = async () => {
    setClearingCache(true)
    setCacheMessage(null)
    try {
      const deleted = await clearAiModelCache()
      await refreshStorage()
      setCacheMessage(deleted > 0 ? `Cleared ${deleted} cached model file${deleted === 1 ? '' : 's'}.` : 'Model cache was already empty.')
    } catch {
      setCacheMessage('Could not clear model cache.')
    } finally {
      setClearingCache(false)
    }
  }

  /** Re-checks for orphans so the confirm states the count that is actually
   *  there now, not the one rendered when the settings opened. */
  const armOrphanRemoval = async () => {
    setCacheMessage(null)
    try {
      const orphans = await findOrphanedAudioIds(await currentSongIds())
      setOrphanedAudio(orphans.length)
      if (orphans.length === 0) {
        setCacheMessage('No orphaned audio files were found.')
        return
      }
      setConfirmRemoveOrphans(true)
    } catch {
      setCacheMessage('Could not check for orphaned audio.')
    }
  }

  const removeOrphanedAudio = async () => {
    setConfirmRemoveOrphans(false)
    setRemovingOrphans(true)
    setCacheMessage(null)
    try {
      // Ids are read as late as possible (see currentSongIds): the decision to
      // delete is never taken on a snapshot.
      const knownIds = await currentSongIds()
      const deleted = await deleteOrphanedAudio(knownIds)
      // Rescan rather than assume: a file whose deletion failed is still there.
      const remaining = (await findOrphanedAudioIds(knownIds)).length
      setOrphanedAudio(remaining)
      setCacheMessage(orphanRemovalMessage(deleted, remaining))
      await refreshStorage()
    } catch {
      setCacheMessage('Could not remove orphaned audio.')
    } finally {
      setRemovingOrphans(false)
    }
  }

  return (
    <div className={embedded ? 'bg-cinnabar-950 text-white px-4 py-4 space-y-5' : 'min-h-screen bg-cinnabar-950 text-white px-4 py-4 space-y-6 max-w-2xl mx-auto'}>
      {/* Sticky within the scroll container (embedded sheet) / page (standalone)
          so the only Close button stays reachable; -mx/-mt cancel the root
          padding so the opaque bar sits flush and content scrolls under it. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 px-4 pt-4 pb-2 bg-cinnabar-950 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-balance">Settings</h1>
        <button onClick={onClose} className="min-h-11 min-w-11 flex items-center justify-center text-white/60 hover:text-white text-xl touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]" aria-label="Close settings">✕</button>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Song language</p>
        <p className="text-xs text-white/70 text-pretty">
          Primary lyrics for new songs and online lyric search. Translation language is set automatically.
        </p>
        <div className="flex gap-2 pt-1" role="group" aria-label="Song language">
          {(['ja', 'en'] as const satisfies readonly Language[]).map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={defaultSongLanguage === lang}
              onClick={() => setDefaultSongLanguage(lang)}
              className={[
                'flex-1 min-h-11 rounded-lg text-sm font-medium touch-manipulation transition-[color,background-color,border-color] duration-150 ease-out',
                defaultSongLanguage === lang
                  ? 'bg-cinnabar-accent text-cinnabar-950'
                  : 'bg-cinnabar-800 text-white/50 hover:text-white/80',
              ].join(' ')}
            >
              {lang === 'ja' ? '日本語' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 divide-y divide-cinnabar-800/60">
        {canUseVocalSeparation(getDeviceTier()) && (
          <SettingToggle
            title="Isolate vocals for timing"
            description="On by default — improves lyric timing on songs with loud instrumentals. Downloads an extra AI model the next time a song is aligned. Turn off to align on the original mix."
            checked={vocalSeparationEnabled ?? true}
            onToggle={() => setVocalSeparationEnabled(!(vocalSeparationEnabled ?? true))}
          />
        )}
        <SettingToggle
          title="Sung readings in furigana"
          description="Show every detected sung reading. When off, furigana uses dictionary readings plus high-confidence sung ones."
          checked={readingMode === 'sung'}
          onToggle={() => setReadingMode(readingMode === 'sung' ? 'dictionary' : 'sung')}
        />
        <SettingToggle
          title="Tap word lookup"
          description="Tap a lyric word for its reading and meaning. Turn off if you use an extension like Yomitan."
          checked={tapLookupEnabled}
          onToggle={() => setTapLookupEnabled(!tapLookupEnabled)}
        />
      </div>

      {storage && (
        <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium">Storage</p>
          <div className="h-2 bg-cinnabar-800 rounded-full">
            <div
              className={`h-full rounded-full transition-[width,background-color] duration-300 ease-out ${storage.ratio > 0.8 ? 'bg-red-500' : 'bg-cinnabar-accent'}`}
              style={{ width: `${Math.min(storage.ratio * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-white/60">{formatBytes(storage.used)} of {formatBytes(storage.total)} used</p>
          <dl className="space-y-1 pt-1">
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">AI models (cached)</dt>
              <dd className="text-white/60 tabular-nums">{formatBytes(storage.modelCache)}</dd>
            </div>
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">Songs &amp; audio</dt>
              <dd className="text-white/60 tabular-nums">{formatBytes(storage.songsAudio)}</dd>
            </div>
            {storage.other > 0 && (
              <div className="flex justify-between text-xs">
                <dt className="text-white/50">App &amp; library data</dt>
                <dd className="text-white/60 tabular-nums">{formatBytes(storage.other)}</dd>
              </div>
            )}
          </dl>
          {storage.ratio > 0.8 && (
            <InlineError>Storage nearly full. Delete songs to free space.</InlineError>
          )}
          {orphanedAudio > 0 && (
            <p className="text-white/60 text-xs">
              {orphanedAudio} orphaned audio file{orphanedAudio === 1 ? '' : 's'} from interrupted uploads.
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
            {confirmClearCache ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* role="alert" so the question is announced when it appears, and
                    autoFocus so the safe action holds focus: arming this confirm
                    unmounts the button that was just activated, which otherwise
                    dropped focus to <body> and left the next Tab at the top of
                    the sheet. Same shape as ConfirmDialog, which focuses Cancel. */}
                <span role="alert" className="text-xs text-white/60 text-pretty">
                  Models re-download next time you align{storage.modelCache > 0 ? ` (${formatBytes(storage.modelCache)})` : ''}. Clear?
                </span>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmClearCache(false)}
                  className="min-h-11 flex items-center text-xs text-white/60 hover:text-white touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmClearCache(false); void clearModelCache() }}
                  disabled={clearingCache}
                  className="min-h-11 flex items-center text-xs text-red-400 hover:text-red-300 font-medium touch-manipulation disabled:opacity-50"
                >
                  {clearingCache ? 'Clearing…' : 'Clear'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClearCache(true)}
                disabled={clearingCache}
                className="min-h-11 flex items-center text-xs text-white/60 hover:text-white underline disabled:opacity-50 touch-manipulation"
              >
                {clearingCache ? 'Clearing…' : 'Clear AI model cache'}
              </button>
            )}
            {orphanedAudio > 0 && (
              confirmRemoveOrphans ? (
                // Arm-then-confirm, same shape as the cache clear above. This
                // used to be a single unconfirmed tap on a count and an id set
                // captured when Settings opened, so it could delete audio for a
                // row that had just been created and said nothing either way
                // afterwards.
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* Announced on appearance, and focus lands on the safe action
                      rather than falling to <body> when the trigger unmounts. */}
                  <span role="alert" className="text-xs text-white/60 text-pretty">
                    Permanently delete {orphanedAudio} orphaned audio file{orphanedAudio === 1 ? '' : 's'}? The audio cannot be recovered.
                  </span>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setConfirmRemoveOrphans(false)}
                    className="min-h-11 flex items-center text-xs text-white/60 hover:text-white touch-manipulation"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { void removeOrphanedAudio() }}
                    disabled={removingOrphans}
                    className="min-h-11 flex items-center text-xs text-red-400 hover:text-red-300 font-medium touch-manipulation disabled:opacity-50"
                  >
                    {removingOrphans ? 'Removing…' : 'Delete'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void armOrphanRemoval() }}
                  disabled={removingOrphans}
                  className="min-h-11 flex items-center text-xs text-white/60 hover:text-white underline touch-manipulation disabled:opacity-50"
                >
                  Remove orphaned audio
                </button>
              )
            )}
          </div>
          {cacheMessage && (
            <p className="text-xs text-white/50">{cacheMessage}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Song Library</p>
        {/* null = still reading. "No songs saved." used to be shown while the
            query was in flight, and for ever if it rejected. */}
        {songs === null && <p className="text-white/60 text-sm" role="status">Loading songs…</p>}
        {songs?.length === 0 && <p className="text-white/60 text-sm">No songs saved.</p>}
        {(songs ?? []).map((song) => {
          const confirming = confirmDeleteId === song.id
          return (
            <div key={song.id} className="relative bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between gap-2 min-h-[60px]">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{song.title}</p>
                <p className="text-xs text-white/60 truncate">{song.artist}</p>
              </div>
              {/* Same dialog and same stated consequence as the library card's
                  delete. Two different confirmations for one action — an inline
                  "Delete forever?" here, a dialog naming the audio and lyrics
                  there — taught the user that neither could be trusted. */}
              {confirming && (
                <ConfirmDialog
                  title="Delete song?"
                  message={`"${song.title}" and its saved audio/lyrics will be permanently removed.`}
                  confirmLabel="Delete"
                  cancelLabel="Cancel"
                  onConfirm={() => handleDelete(song)}
                  onCancel={() => setConfirmDeleteId(null)}
                />
              )}
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  // Same sanitizer as the EditMode export of the same artifact:
                  // a title is free text and may contain "/" or other characters
                  // that are invalid in a file name.
                  onClick={() => downloadFile(exportLRC(song.lyrics.lines), `${sanitizeFilenamePart(song.title) || 'lyrics'}.lrc`, 'text/plain')}
                  disabled={!songHasTiming(song)}
                  // Exporting an untimed song wrote an LRC where every line was
                  // stamped [00:00.00] — a file that looks valid and is useless.
                  title={songHasTiming(song) ? 'Export lyrics as LRC file' : 'This song has no timing yet'}
                  className="min-h-11 px-3 text-xs text-white/60 hover:text-white disabled:opacity-40 disabled:hover:text-white/60 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
                  aria-label={`Export lyrics as an LRC file for ${song.title}`}
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(song.id)}
                  className="min-h-11 px-3 text-xs text-white/60 hover:text-red-300 focus-visible:text-red-300 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
                  aria-label={`Delete ${song.title}`}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Support Utasync</p>
          <p className="text-xs text-white/70 text-pretty">
            Utasync is free and runs entirely on your device. If it helps your studies, you can support ongoing development.
          </p>
        </div>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-11 rounded-lg bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-cinnabar-950 text-sm font-medium flex items-center justify-center gap-2 touch-manipulation transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]"
        >
          ♥ Support on Patreon
        </a>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">App information</p>
        {buildTimeLabel && (
          <dl className="text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-white/50">App last updated</dt>
              <dd className="text-white/60">
                <time dateTime={buildTime} title={buildTime}>{buildTimeLabel}</time>
              </dd>
            </div>
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            href={APP_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-11 flex items-center text-xs text-white/60 hover:text-white underline underline-offset-2 touch-manipulation transition-colors duration-150 ease-out"
          >
            GitHub repository ↗
          </a>
          {onViewLanding && (
            <button
              type="button"
              onClick={onViewLanding}
              className="min-h-11 flex items-center text-xs text-white/60 hover:text-white underline underline-offset-2 touch-manipulation transition-colors duration-150 ease-out"
            >
              About 歌sync
            </button>
          )}
        </div>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Legal</p>
        <LegalLinks external />
        <p className="text-xs text-white/55 text-center">Last updated {LEGAL_LAST_UPDATED}</p>
      </div>
    </div>
  )
}
