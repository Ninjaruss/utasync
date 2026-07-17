import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapSyncEditor } from '../../src/player/TapSyncEditor'

describe('TapSyncEditor', () => {
  it('explains the flow, labels the tap button, and finishes with "Save timing"', () => {
    const onComplete = vi.fn()
    render(
      <TapSyncEditor
        plainLines={['line one']}
        translations={['']}
        audioPosition={() => 1.5}
        onComplete={onComplete}
      />,
    )

    expect(screen.getByText('Play the song and tap when each line starts.')).toBeTruthy()

    const tapButton = screen.getByRole('button', { name: 'Mark line start' })
    fireEvent.click(tapButton)

    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    expect(onComplete).toHaveBeenCalledWith([
      { startTime: 1.5, endTime: 6.5, original: 'line one', translation: '' },
    ])
  })
})
