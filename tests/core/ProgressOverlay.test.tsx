import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressOverlay } from '../../src/core/ui/ProgressOverlay'

describe('ProgressOverlay', () => {
  it('does not emit a competing live region at the outer level', () => {
    render(
      <ProgressOverlay
        steps={[
          { label: 'Step 1', detail: 'Doing work' },
          { label: 'Step 2', detail: 'More work' },
        ]}
        currentStepIndex={0}
        taskProgress={50}
      />,
    )

    // ProgressOverlay should NOT be a live region itself (announce={false})
    // because ProcessProgress inside it is already a live region.
    // There should be exactly one status region: the ProcessProgress inner one.
    const statusElements = screen.getAllByRole('status')
    expect(statusElements).toHaveLength(1)

    // The inner ProcessProgress should be the status region
    const innerStatus = statusElements[0]
    expect(innerStatus.getAttribute('aria-live')).toBe('polite')
    expect(innerStatus.getAttribute('aria-busy')).toBe('true')
    // The inner status should have its own aria-label with progress details
    expect(innerStatus.getAttribute('aria-label')).toMatch(/Step 1.*step 1 of 2/)
  })

  it('displays ProcessProgress with step and task details', () => {
    render(
      <ProgressOverlay
        steps={[
          { label: 'Processing', detail: 'Working on it' },
          { label: 'Finalizing', detail: 'Almost done' },
        ]}
        currentStepIndex={1}
        taskProgress={75}
      />,
    )

    expect(screen.getByText('Finalizing')).toBeTruthy()
    expect(screen.getByText('Almost done')).toBeTruthy()
    expect(screen.getByText('2/2')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
  })
})
