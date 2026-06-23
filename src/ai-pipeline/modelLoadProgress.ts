export type ModelLoadPhase = 'download' | 'init'

export interface ModelLoadProgress {
  status?: string
  phase?: ModelLoadPhase
  /** Per-file download 0–100 when applicable. */
  progress?: number
  /** Average across all model files seen so far. */
  aggregateProgress?: number
  file?: string
  filesCompleted?: number
}

/** Average download progress across all model files reported so far. */
export function aggregateModelFileProgress(fileProgress: Map<string, number>): number {
  if (fileProgress.size === 0) return 0
  let sum = 0
  for (const pct of fileProgress.values()) sum += pct
  return sum / fileProgress.size
}

/** Track per-file progress and derive aggregate for the UI. */
export class ModelLoadProgressTracker {
  private files = new Map<string, number>()

  ingest(raw: { status?: string; progress?: number; file?: string; name?: string }): ModelLoadProgress {
    const file = raw.file ?? raw.name
    const status = raw.status

    if ((status === 'download' || status === 'progress') && file && typeof raw.progress === 'number') {
      this.files.set(file, raw.progress)
      return {
        status,
        phase: 'download',
        file,
        progress: raw.progress,
        aggregateProgress: aggregateModelFileProgress(this.files),
        filesCompleted: this.countCompleted(),
      }
    }

    if (status === 'done' && file) {
      this.files.set(file, 100)
      return {
        status,
        phase: 'download',
        file,
        progress: 100,
        aggregateProgress: aggregateModelFileProgress(this.files),
        filesCompleted: this.countCompleted(),
      }
    }

    if (status === 'initializing') {
      return {
        status,
        phase: 'init',
        file: raw.file,
      }
    }

    if (status === 'initiate') {
      return { status, phase: 'download' }
    }

    return { status, phase: 'download' }
  }

  private countCompleted(): number {
    let n = 0
    for (const pct of this.files.values()) {
      if (pct >= 100) n++
    }
    return n
  }
}

export const MODEL_INIT_HINT: ModelLoadProgress = {
  status: 'initializing',
  phase: 'init',
}
