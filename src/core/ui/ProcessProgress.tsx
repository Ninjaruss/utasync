import type { ReactNode } from 'react'
import { ProgressBar } from './ProgressBar'
import { overallPercent, type ProcessStep, type TaskSubstep } from './progressUtils'
import { useElapsedSeconds } from './useElapsedSeconds'

interface Props {
  steps: ProcessStep[]
  currentStepIndex: number
  /** 0–100 within the current step; omit or null when unknown. */
  taskProgress?: number | null
  /** Status line when task % is unknown — falls back to step detail. */
  taskStatus?: string | null
  /** Optional checklist for staged work within the current step. */
  taskSubsteps?: TaskSubstep[]
  /** Show elapsed seconds while task % is unknown. Default true. */
  showElapsed?: boolean
  /** Compact layout for inline panels (e.g. lyric search). */
  compact?: boolean
  action?: ReactNode
  className?: string
}

function SubstepIcon({ state }: { state: TaskSubstep['state'] }) {
  if (state === 'done') {
    return <span className="text-cinnabar-accent/80 shrink-0" aria-hidden>✓</span>
  }
  if (state === 'active') {
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-cinnabar-accent shrink-0 animate-pulse"
        aria-hidden
      />
    )
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/15 shrink-0" aria-hidden />
}

export function ProcessProgress({
  steps,
  currentStepIndex,
  taskProgress = null,
  taskStatus = null,
  taskSubsteps,
  showElapsed = true,
  compact = false,
  action,
  className = '',
}: Props) {
  const step = steps[currentStepIndex] ?? steps[steps.length - 1]
  const stepCount = steps.length
  const overall = overallPercent(currentStepIndex, stepCount, taskProgress)
  const taskPct = taskProgress == null ? null : Math.round(taskProgress)
  const hasTaskBar = taskPct != null
  // A single indeterminate step has no meaningful "Overall" percent or step
  // counter — a bar pinned at 0% and "1/1" just read as stalled work.
  const soloIndeterminate = stepCount === 1 && !hasTaskBar
  const statusText = taskStatus ?? step.detail ?? 'Working…'
  const elapsed = useElapsedSeconds(!hasTaskBar && showElapsed)

  return (
    <div
      className={[
        'animate-[progress-enter_220ms_ease-out_both]',
        compact ? 'space-y-2' : 'space-y-3',
        className,
      ].join(' ')}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={soloIndeterminate
        ? `${step.label}, in progress`
        : `${step.label}, step ${currentStepIndex + 1} of ${stepCount}, ${overall}% overall`}
    >
      <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
        <div className="flex items-baseline justify-between gap-3">
          <p className={[
            'font-medium text-white/85 text-pretty',
            compact ? 'text-xs' : 'text-sm',
          ].join(' ')}>
            {step.label}
          </p>
          {!soloIndeterminate && (
            <span className="text-[11px] text-white/40 tabular-nums shrink-0">
              {currentStepIndex + 1}/{stepCount}
            </span>
          )}
        </div>
        {step.detail && hasTaskBar && (
          <p className={[
            'text-white/35 text-pretty',
            compact ? 'text-[10px]' : 'text-xs',
          ].join(' ')}>
            {step.detail}
          </p>
        )}
      </div>

      {!soloIndeterminate && (
        <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-white/30">Overall</span>
            <span className="text-[11px] text-white/45 tabular-nums">{overall}%</span>
          </div>
          <ProgressBar value={overall} size={compact ? 'sm' : 'md'} aria-label="Overall progress" />
        </div>
      )}

      <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-white/30">Current task</span>
          {hasTaskBar ? (
            <span className="text-[11px] text-white/45 tabular-nums">{taskPct}%</span>
          ) : showElapsed && elapsed > 0 ? (
            <span className="text-[11px] text-white/45 tabular-nums">{elapsed}s</span>
          ) : null}
        </div>
        {hasTaskBar ? (
          <ProgressBar
            value={taskPct}
            size={compact ? 'sm' : 'md'}
            aria-label="Current task progress"
          />
        ) : (
          <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <p className={[
              'text-white/50 text-pretty',
              compact ? 'text-[11px]' : 'text-xs',
            ].join(' ')}>
              {statusText}
            </p>
            {taskSubsteps && taskSubsteps.length > 0 && (
              <ul className={compact ? 'space-y-0.5' : 'space-y-1'} aria-label="Task substeps">
                {taskSubsteps.map((sub) => (
                  <li
                    key={sub.label}
                    className={[
                      'flex items-center gap-2 text-pretty',
                      compact ? 'text-[10px]' : 'text-[11px]',
                      sub.state === 'active' ? 'text-white/55' : 'text-white/30',
                    ].join(' ')}
                  >
                    <SubstepIcon state={sub.state} />
                    <span>{sub.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {action}
    </div>
  )
}
