import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProcessProgress } from '../../src/core/ui/ProcessProgress'
import { overallPercent } from '../../src/core/ui/progressUtils'
import { linkSaveStepIndex, linkSaveSteps } from '../../src/sources/addSongProgress'

describe('overallPercent', () => {
  it('weights the current step by task progress', () => {
    expect(overallPercent(0, 4, 50)).toBe(13)
    expect(overallPercent(1, 4, 100)).toBe(50)
    expect(overallPercent(3, 4, null)).toBe(75)
  })
})

describe('linkSaveSteps', () => {
  it('omits the audio step when no file is attached', () => {
    expect(linkSaveSteps(false)).toHaveLength(2)
    expect(linkSaveStepIndex('saving-song', false)).toBe(1)
  })
})

describe('ProcessProgress', () => {
  it('shows step labels and tabular overall percent', () => {
    render(
      <ProcessProgress
        steps={[
          { label: 'Saving audio', detail: 'Copying file to local storage' },
          { label: 'Saving song', detail: 'Writing to your library' },
        ]}
        currentStepIndex={0}
        taskProgress={40}
      />,
    )
    expect(screen.getByText('Saving audio')).toBeTruthy()
    expect(screen.getByText('Copying file to local storage')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows status text instead of a fake task bar when progress is unknown', () => {
    render(
      <ProcessProgress
        steps={[
          { label: 'Searching lyrics', detail: 'Looking for time-synced lyrics' },
          { label: 'Saving song', detail: 'Writing to your library' },
        ]}
        currentStepIndex={0}
        taskStatus="Checking the lyrics database for an exact match…"
      />,
    )
    expect(screen.getByText('Checking the lyrics database for an exact match…')).toBeTruthy()
    expect(screen.queryByRole('progressbar', { name: 'Current task progress' })).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeTruthy()
  })

  it('hides the pinned Overall bar and step counter for single-step indeterminate work', () => {
    render(
      <ProcessProgress
        steps={[{ label: 'Searching lyrics', detail: 'Looking for time-synced lyrics' }]}
        currentStepIndex={0}
        taskStatus="Checking the lyrics database for an exact match…"
        taskSubsteps={[
          { label: 'Exact match', state: 'active' },
          { label: 'Catalog search', state: 'pending' },
        ]}
      />,
    )
    expect(screen.queryByText('Overall')).toBeNull()
    expect(screen.queryByText('1/1')).toBeNull()
    expect(screen.queryByRole('progressbar', { name: 'Overall progress' })).toBeNull()
    // Status, substep checklist, and the step label stay.
    expect(screen.getByText('Searching lyrics')).toBeTruthy()
    expect(screen.getByText('Checking the lyrics database for an exact match…')).toBeTruthy()
    expect(screen.getByText('Exact match')).toBeTruthy()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the Overall bar for a single-step task with known progress', () => {
    render(
      <ProcessProgress
        steps={[{ label: 'Fetching song info' }]}
        currentStepIndex={0}
        taskProgress={40}
      />,
    )
    expect(screen.getByText('Overall')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeTruthy()
  })
})
