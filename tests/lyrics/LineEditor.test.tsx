import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LineEditor } from '../../src/lyrics/LineEditor'
import type { TimedLine } from '../../src/core/types'

const line: TimedLine = { startTime: 14, endTime: 18, original: '二人だけの空', translation: 'just us' }

describe('LineEditor', () => {
  it('stamps the current playhead onto the line', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 21.5} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set start/i }))
    expect(onChange).toHaveBeenCalledWith({ startTime: 21.5 })
  })

  it('nudges the start time by -0.1', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '−0.1' }))
    expect(onChange).toHaveBeenCalledWith({ startTime: 13.9 })
  })

  it('edits original text on blur', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    const input = screen.getByDisplayValue('二人だけの空')
    fireEvent.change(input, { target: { value: '新しい歌詞' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith({ original: '新しい歌詞' })
  })

  it('does not commit text on change, only on blur', () => {
    const onChange = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={onChange} onAdd={vi.fn()} onDelete={vi.fn()} />)
    const input = screen.getByDisplayValue('二人だけの空')
    fireEvent.change(input, { target: { value: 'x' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith({ original: 'x' })
  })

  it('fires onAdd and onDelete', () => {
    const onAdd = vi.fn(); const onDelete = vi.fn()
    render(<LineEditor line={line} playhead={() => 0} onChange={vi.fn()} onAdd={onAdd} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete line' }))
    expect(onDelete).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(onAdd).toHaveBeenCalled()
  })
})
