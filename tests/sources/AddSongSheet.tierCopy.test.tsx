import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

vi.mock('../../src/sources/LinkParser', () => ({ LinkParser: () => <div>LINK_PARSER</div> }))
vi.mock('../../src/sources/UploadAudioFlow', () => ({ UploadAudioFlow: () => <div>UPLOAD_FLOW</div> }))

/* Manual tier has no on-device Whisper at all. The Add-song sheet nonetheless
 * listed "AI auto-align lyrics" as a reason to upload, which is a promise the
 * device can never keep — the most-repeated finding of the 2026-09 UI inventory
 * (docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md, defect D1). */
vi.mock('../../src/ai-pipeline/capability', () => ({
  canAutoAlign: () => false,
  getDeviceTier: () => 'manual',
}))

describe('Add-song sheet copy on a device that cannot auto-align', () => {
  it('does not offer AI auto-align as a reason to upload', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/AI auto-align lyrics/i)).toBeNull()
  })

  it('still recommends uploading, for the benefits that are real on this tier', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText(/A-B loop export/i)).toBeTruthy()
    expect(screen.getByText(/Offline playback/i)).toBeTruthy()
    expect(screen.getByText(/Reliable speed control/i)).toBeTruthy()
  })

  it('says why auto-align is absent instead of silently dropping it', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/can.t run AI auto-align/i)).toBeTruthy()
  })

  it('does not tell a manual-tier user the YouTube path costs them auto-align', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /youtube link/i }))
    // "No AI auto-align or clip export" frames auto-align as something the OTHER
    // tile would have given them. On this tier neither tile does, so naming it
    // here would be a second false promise by implication.
    expect(screen.queryByText(/No AI auto-align or clip export/i)).toBeNull()
    expect(screen.getByText(/^No clip export$/i)).toBeTruthy()
  })
})
