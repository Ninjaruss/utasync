import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong as removeSong } from '../core/db/deleteSong'
import { useToast } from '../core/ui/Toast'
import { estimateStorageBreakdown, formatBytes, type StorageBreakdown } from '../core/storage/quota'
import { deleteOrphanedAudio, findOrphanedAudioIds } from '../core/storage/cleanup'
import { clearAiModelCache } from '../core/storage/modelCache'
import { exportLRC, downloadFile } from '../lyrics/exporter'
import { useSettingsStore } from '../payment/SettingsStore'
import { useAbLoopPlaylistStore } from '../player/abLoopPlaylistStore'
import { LegalLinks } from '../core/ui/LegalLinks'
import { LEGAL_LAST_UPDATED, KOFI_URL } from '../core/legal'
import { getDeviceTier, canUseVocalSeparation } from '../ai-pipeline/capability'
import { refreshDemucsModelAvailability } from '../ai-pipeline/demucsSeparator'
import type { Language, Song } from '../core/types'

interface Props {
  onClose: () => void
  /** When true, omits full-page chrome for sheet embedding. */
  embedded?: boolean
  /** Called after a song is successfully deleted. */
  onSongDeleted?: (songId: string) => void
  /** Navigate to the public landing page, when available. */
  onViewLanding?: () => void
}

export function SettingsView({ onClose, embedded = false, onSongDeleted, onViewLanding }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [storage, setStorage] = useState<StorageBreakdown | null>(null)
  const toast = useToast()
  const [orphanedAudio, setOrphanedAudio] = useState(0)
  const [cacheMessage, setCacheMessage] = useState<string | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const { defaultSongLanguage, setDefaultSongLanguage, vocalSeparationEnabled, setVocalSeparationEnabled, readingMode, setReadingMode } = useSettingsStore()

  const refreshStorage = async (library: Song[]) => {
    setStorage(await estimateStorageBreakdown())
    setOrphanedAudio((await findOrphanedAudioIds(library.map((s) => s.id))).length)
  }

  useEffect(() => {
    db.songs.toArray().then(async (library) => {
      setSongs(library)
      await refreshStorage(library)
    })
  }, [])

  useEffect(() => {
    if (!canUseVocalSeparation(getDeviceTier())) return
    void refreshDemucsModelAvailability()
  }, [])

  const handleDelete = async (song: Song) => {
    setConfirmDeleteId(null)
    try {
      const { audioDeleteFailed } = await removeSong(song)
      useAbLoopPlaylistStore.getState().clearPlaylist(song.id)
      const next = songs.filter((s) => s.id !== song.id)
      if (audioDeleteFailed) {
        toast('Song removed, but the audio file could not be deleted. Use "Clean up orphaned audio" below to reclaim space.', 'warning')
      }
      setSongs(next)
      await refreshStorage(next)
      onSongDeleted?.(song.id)
    } catch {
      toast('Could not delete song. Please try again.', 'error')
    }
  }

  const clearModelCache = async () => {
    setClearingCache(true)
    setCacheMessage(null)
    try {
      const deleted = await clearAiModelCache()
      await refreshStorage(songs)
      setCacheMessage(deleted > 0 ? `Cleared ${deleted} cached model file${deleted === 1 ? '' : 's'}.` : 'Model cache was already empty.')
    } catch {
      setCacheMessage('Could not clear model cache.')
    } finally {
      setClearingCache(false)
    }
  }

  const clearOrphanedAudio = async () => {
    await deleteOrphanedAudio(songs.map((s) => s.id))
    await refreshStorage(songs)
  }

  return (
    <div className={embedded ? 'bg-cinnabar-950 text-white px-4 py-4 space-y-5' : 'min-h-screen bg-cinnabar-950 text-white px-4 py-4 space-y-6 max-w-2xl mx-auto'}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-balance">Settings</h1>
        <button onClick={onClose} className="min-h-11 min-w-11 flex items-center justify-center text-white/40 hover:text-white text-xl touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]" aria-label="Close settings">✕</button>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Support Utasync</p>
          <p className="text-xs text-white/45 text-pretty">
            Utasync is free and runs entirely on your device. If it helps your studies, you can support ongoing development.
          </p>
        </div>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-11 rounded-lg bg-cinnabar-accent hover:bg-cinnabar-accent/90 text-white text-sm font-medium flex items-center justify-center gap-2 touch-manipulation transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]"
        >
          ☕ Support on Ko-fi
        </a>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Song language</p>
        <p className="text-xs text-white/45 text-pretty">
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
                  ? 'bg-cinnabar-accent text-white'
                  : 'bg-cinnabar-800 text-white/50 hover:text-white/80',
              ].join(' ')}
            >
              {lang === 'ja' ? '日本語' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {canUseVocalSeparation(getDeviceTier()) && (
        <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium">Auto-align</p>
          <p className="text-xs text-white/45 text-pretty">
            Isolate vocals before speech recognition on busy mixes. Adds a separate step and downloads the Demucs model.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={vocalSeparationEnabled}
            onClick={() => setVocalSeparationEnabled(!vocalSeparationEnabled)}
            className={[
              'w-full min-h-11 rounded-lg text-sm font-medium touch-manipulation transition-[color,background-color] duration-150 ease-out text-left px-4',
              vocalSeparationEnabled
                ? 'bg-cinnabar-accent text-white'
                : 'bg-cinnabar-800 text-white/50 hover:text-white/80',
            ].join(' ')}
          >
            {vocalSeparationEnabled ? 'Vocal separation: On' : 'Vocal separation: Off'}
          </button>
        </div>
      )}

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Furigana</p>
        <p className="text-xs text-white/45 text-pretty">
          By default the furigana shows dictionary readings, plus sung readings the audio confirms with high confidence; weaker detections show in a tooltip. Turn this on to show every detected sung reading in the furigana.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={readingMode === 'sung'}
          onClick={() => setReadingMode(readingMode === 'sung' ? 'dictionary' : 'sung')}
          className={[
            'w-full min-h-11 rounded-lg text-sm font-medium touch-manipulation transition-[color,background-color] duration-150 ease-out text-left px-4',
            readingMode === 'sung'
              ? 'bg-cinnabar-accent text-white'
              : 'bg-cinnabar-800 text-white/50 hover:text-white/80',
          ].join(' ')}
        >
          {readingMode === 'sung' ? 'Show sung readings in furigana' : 'Show dictionary readings in furigana'}
        </button>
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
          <p className="text-xs text-white/40">{formatBytes(storage.used)} of {formatBytes(storage.total)} used</p>
          <dl className="space-y-1 pt-1">
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">AI models (cached)</dt>
              <dd className="text-white/40 tabular-nums">{formatBytes(storage.modelCache)}</dd>
            </div>
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">Songs &amp; audio</dt>
              <dd className="text-white/40 tabular-nums">{formatBytes(storage.songsAudio)}</dd>
            </div>
            {storage.other > 0 && (
              <div className="flex justify-between text-xs">
                <dt className="text-white/50">App &amp; library data</dt>
                <dd className="text-white/40 tabular-nums">{formatBytes(storage.other)}</dd>
              </div>
            )}
          </dl>
          {storage.ratio > 0.8 && (
            <p className="text-red-400 text-xs">Storage nearly full. Delete songs to free space.</p>
          )}
          {orphanedAudio > 0 && (
            <p className="text-white/40 text-xs">
              {orphanedAudio} orphaned audio file{orphanedAudio === 1 ? '' : 's'} from interrupted uploads.
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
            <button
              type="button"
              onClick={clearModelCache}
              disabled={clearingCache}
              className="text-xs text-white/30 hover:text-white underline disabled:opacity-50"
            >
              {clearingCache ? 'Clearing…' : 'Clear AI model cache'}
            </button>
            {orphanedAudio > 0 && (
              <button onClick={clearOrphanedAudio} className="text-xs text-white/30 hover:text-white underline">
                Remove orphaned audio
              </button>
            )}
          </div>
          {cacheMessage && (
            <p className="text-xs text-white/50">{cacheMessage}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Song Library</p>
        {songs.length === 0 && <p className="text-white/30 text-sm">No songs saved.</p>}
        {songs.map((song) => {
          const confirming = confirmDeleteId === song.id
          return (
            <div key={song.id} className="bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between gap-2 min-h-[60px]">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{song.title}</p>
                <p className="text-xs text-white/40 truncate">{song.artist}</p>
              </div>
              {confirming ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-red-400/80">Delete forever?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="min-h-9 px-3 text-xs text-white/50 hover:text-white touch-manipulation transition-colors duration-150 ease-out"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(song)}
                    className="min-h-9 px-3 text-xs text-red-400 hover:text-red-300 font-medium touch-manipulation transition-colors duration-150 ease-out"
                    aria-label={`Confirm delete ${song.title}`}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadFile(exportLRC(song.lyrics.lines), `${song.title}.lrc`, 'text/plain')}
                    className="min-h-11 px-3 text-xs text-white/40 hover:text-white touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
                    aria-label={`Export LRC for ${song.title}`}
                    title="Export lyrics as LRC file"
                  >
                    LRC
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(song.id)}
                    className="min-h-11 px-3 text-xs text-red-400 hover:text-red-300 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
                    aria-label={`Delete ${song.title}`}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
        <p className="text-sm font-medium">Legal</p>
        <LegalLinks external />
        <p className="text-xs text-white/30 text-center">Last updated {LEGAL_LAST_UPDATED}</p>
        {onViewLanding && (
          <button
            type="button"
            onClick={onViewLanding}
            className="block mx-auto min-h-11 px-3 text-xs text-white/35 hover:text-white/70 underline underline-offset-2 touch-manipulation transition-colors duration-150"
          >
            About 歌sync
          </button>
        )}
      </div>
    </div>
  )
}
