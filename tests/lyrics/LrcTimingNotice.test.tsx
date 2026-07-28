import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LrcTimingNotice } from '../../src/lyrics/LrcTimingNotice'

const lrc = '[00:03.72]a\n[00:06.76]b\n[00:10.08]c'

describe('LrcTimingNotice', () => {
  it('shows the count when the paste is timed and not ignored', () => {
    render(<LrcTimingNotice pasted={lrc} ignored={false} onAlignFromScratch={() => {}} />)
    expect(screen.getByText(/Using your pasted timings/)).toBeTruthy()
    expect(screen.getByText(/3 lines/)).toBeTruthy()
  })

  it('renders nothing for plain text', () => {
    const { container } = render(
      <LrcTimingNotice pasted={'plain one\nplain two'} ignored={false} onAlignFromScratch={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when ignored', () => {
    const { container } = render(
      <LrcTimingNotice pasted={lrc} ignored={true} onAlignFromScratch={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('fires onAlignFromScratch when the escape hatch is clicked', () => {
    const onAlign = vi.fn()
    render(<LrcTimingNotice pasted={lrc} ignored={false} onAlignFromScratch={onAlign} />)
    fireEvent.click(screen.getByRole('button', { name: /Align from scratch/ }))
    expect(onAlign).toHaveBeenCalledOnce()
  })

  it('renders nothing when timing is only partial (router would align from scratch)', () => {
    const partial = '[00:01.00]intro\n[00:02.00]hook\nplain three\nplain four\nplain five'
    const { container } = render(
      <LrcTimingNotice pasted={partial} ignored={false} onAlignFromScratch={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
