import type { ReactNode } from 'react'
import { BlockingOverlay } from './BlockingOverlay'
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
    <BlockingOverlay
      label="Loading"
      className="animate-[progress-enter_220ms_ease-out_both]"
      // ProcessProgress (rendered below) has its own role="status" carrying the
      // detailed step/percentage announcement, so the wrapper must not add a
      // second, generic live region on top of it. Do not delete this thinking
      // the outer role is redundant: removing the inner region loses the
      // informative announcement, and removing the outer one (i.e. flipping
      // this to true elsewhere) breaks LoadingOverlay, which has no inner
      // region and relies on the wrapper's own announcement.
      announce={false}
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
    </BlockingOverlay>
  )
}
