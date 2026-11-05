/** Dev-only benchmark: real component, no truth or reference-derived offsets. */
import { createRoot } from 'react-dom/client'
import { AutoAlignFlow } from '../ai-pipeline/AutoAlignFlow'
import { db } from '../core/db/schema'
import { saveAudio, deleteAudio, audioStoragePath } from '../core/opfs/audio'
import { useSettingsStore } from '../settings/SettingsStore'
import { ToastProvider } from '../core/ui/Toast'
import type { Song } from '../core/types'

const sha = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('')
const beacon = (payload: object) => fetch('/__e2e-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benchmark: 1, ...payload }) })
export async function runSyncBenchmark(root: HTMLElement, key: string) {
  const runId = `${key}-${crypto.randomUUID()}`
  const songId = `benchmark-${runId}`
  const report: Record<string, unknown> = { runId, song: key, workflow: 'AutoAlignFlow', startedAt: new Date().toISOString(), userAgent: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated === true, hardwareConcurrency: navigator.hardwareConcurrency, status: 'started' }
  const previous = useSettingsStore.getState()
  const settings = { vocalSeparationEnabled: previous.vocalSeparationEnabled, modelDownloadConsented: previous.modelDownloadConsented }
  const heading = document.createElement('pre'); root.replaceChildren(heading)
  heading.textContent = `${key}: preparing verified inputs…`
  const mount = document.createElement('div'); root.appendChild(mount)
  const reactRoot = createRoot(mount)
  const logs: string[] = []
  const origInfo = console.info, origWarn = console.warn
  let timer: ReturnType<typeof setTimeout> | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  const start = performance.now()
  try {
    const res = await fetch(`/e2e/benchmark/${key}/input.json`)
    if (!res.ok) throw new Error('Benchmark input not staged')
    const input = await res.json() as { song: string; audioSha256: string; lyricsSha256: string; lyricsText: string; isolation: boolean | null; gitRevision: string; workingTreeDiffSha256: string; harnessVersion: number }
    Object.assign(report, { ...input, lyricsText: undefined })
    const audioRes = await fetch(`/e2e/benchmark/${key}/audio.mp3`)
    if (!audioRes.ok) throw new Error('Missing benchmark audio')
    const audio = await audioRes.arrayBuffer()
    if (await sha(audio) !== input.audioSha256 || await sha(new TextEncoder().encode(input.lyricsText)) !== input.lyricsSha256) throw new Error('Benchmark input hash mismatch')
    await saveAudio(songId, audio)
    const song: Song = { id: songId, title: key, artist: 'local benchmark', sources: [], audioStoredPath: audioStoragePath(songId), createdAt: new Date(), lyrics: { sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual', lines: input.lyricsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(original => ({ original, translation: '', startTime: 0, endTime: 0 })) } }
    await db.songs.put(song)
    useSettingsStore.setState({ modelDownloadConsented: true, vocalSeparationEnabled: input.isolation })
    console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); origInfo(...args) }
    console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); origWarn(...args) }
    await beacon({ status: 'started', runId, song: key })
    const completed = await new Promise<Song>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Benchmark timeout after 12 minutes')), 12 * 60_000)
      watch = setInterval(() => {
        heading.textContent = `${key}: running real AutoAlignFlow (${Math.round((performance.now() - start) / 1000)} s)`
        if (Array.from(mount.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Try again')) reject(new Error(`App error: ${mount.textContent}`))
      }, 1000)
      reactRoot.render(<ToastProvider><AutoAlignFlow song={song} autoStart onComplete={resolve} onClose={() => reject(new Error('Benchmark cancelled'))} /></ToastProvider>)
    })
    Object.assign(report, { status: 'completed', lines: completed.lyrics.lines, alignmentMode: completed.lyrics.alignmentMode, lineAlignmentQuality: completed.lyrics.lineAlignmentQuality, isolationVerdict: completed.audioIsolationVerdict ?? null })
  } catch (error) {
    Object.assign(report, { status: String(error).includes('timeout') ? 'timeout' : String(error).includes('cancelled') ? 'cancelled' : 'failed', error: String(error) })
  } finally {
    clearTimeout(timer); clearInterval(watch)
    console.info = origInfo; console.warn = origWarn
    report.elapsedSeconds = (performance.now() - start) / 1000; report.logs = logs
    report.finishedAt = new Date().toISOString()
    reactRoot.unmount()
    useSettingsStore.setState(settings)
    await db.songs.delete(songId)
    await deleteAudio(songId).catch(() => {})
    await beacon({ final: true, report })
    heading.textContent = JSON.stringify(report, null, 2)
  }
  return report
}

export async function runBenchmarkSuite(root: HTMLElement, key: string) {
  if (key !== 'pilot') return runSyncBenchmark(root, key)
  const res = await fetch('/e2e/benchmark/pilot.json')
  if (!res.ok) throw new Error('Pilot not staged')
  const keys = await res.json() as string[]
  const results = []
  for (const song of keys) {
    if (!/^[a-z0-9-]+$/.test(song)) throw new Error('Invalid pilot song key')
    const result = await runSyncBenchmark(root, song)
    results.push(result)
    if (result.status === 'timeout' || result.status === 'cancelled') break
  }
  root.textContent = JSON.stringify({ pilotFinished: true, attempted: results.length, planned: keys.length, runs: results }, null, 2)
}

