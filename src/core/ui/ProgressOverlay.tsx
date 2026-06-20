import type { ReactNode } from 'react'
import { ProcessProgress } from './ProcessProgress'
import type { ProcessStep, TaskSubstep } from './progressUtils'

interface Props {
  steps: ProcessStep[]
  currentStepIndex: number
  taskProgress?: number | null
  taskStatus?: string | null
  taskSubsteps?: TaskSubstep[]
  showElapsed?: boolean
  action?: ReactNode
}

/** Full-screen dimmed overlay with staged overall + task progress. */
export function ProgressOverlay({
  steps,
  currentStepIndex,
  taskProgress = null,
  taskStatus = null,
  taskSubsteps,
  showElapsed = true,
  action,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 animate-[progress-enter_220ms_ease-out_both]"
      role="presentation"
    >
      <div className="w-full max-w-xs px-6">
        <ProcessProgress
          steps={steps}
          currentStepIndex={currentStepIndex}
          taskProgress={taskProgress}
          taskStatus={taskStatus}
          taskSubsteps={taskSubsteps}
          showElapsed={showElapsed}
          action={action}
        />
      </div>
    </div>
  )
}
