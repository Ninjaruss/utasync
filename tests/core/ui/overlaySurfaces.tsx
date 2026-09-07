import { vi, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Onboarding } from '../../../src/core/ui/Onboarding'
import { AddSongSheet } from '../../../src/sources/AddSongSheet'
import { SettingsSheet } from '../../../src/settings/SettingsSheet'
import { Overlay } from '../../../src/core/ui/Overlay'
import { ConfirmDialog } from '../../../src/core/ui/ConfirmDialog'
import { TapSyncEditor } from '../../../src/player/TapSyncEditor'
import { OffsetAlignScreen } from '../../../src/player/OffsetAlignScreen'
import { PlayerControls } from '../../../src/player/PlayerControls'
import { DisplayMenu } from '../../../src/player/DisplayMenu'
import { EditMode } from '../../../src/lyrics/EditMode'
import { WordLookupPopover } from '../../../src/lyrics/WordLookupPopover'
import { TimestampPopover } from '../../../src/lyrics/TimestampPopover'
import { TranslationRepairPopover } from '../../../src/lyrics/TranslationRepairPopover'

export interface OverlaySurface {
  /** Registry row name from docs/superpowers/audits/2026-09-05-ui-inventory-baseline.md */
  name: string
  /** Render the surface, and return a function that asserts it has closed. */
  open: () => () => Promise<void> | void
  /** The role this surface is announced with. Defaults to 'dialog'. */
  role?: 'dialog' | 'alertdialog' | 'menu'
}

/**
 * Every layered surface that has been migrated to <Overlay>, and how to open it.
 *
 * Append a row as each surface migrates: modal-dialogs.test.tsx runs the contract over this
 * array, so registering a surface is what enrols it — no test edit required. That is the
 * difference between this and tests/player/menus.escape.test.tsx, which covers two surfaces
 * because each had to be hand-written.
 *
 * `open` returns an assertion rather than taking an onClose, because some surfaces (Onboarding)
 * own their own dismissal and report to nobody.
 *
 * `BlockingOverlay` is deliberately NOT registered here. It's a transient progress layer with no
 * exit of its own — the work finishing dismisses it, not the user — so it doesn't satisfy this
 * table's "closes on Escape" assertion. Its absence is intentional, not an oversight; adding it
 * would just fail confusingly.
 *
 * Task 9: row 15 (`ProgressOverlay`, src/core/ui/ProgressOverlay.tsx) and row 20
 * (`LoadingOverlay`, src/core/ui/LoadingOverlay.tsx) are both now built on
 * `BlockingOverlay` for exactly the reason above — they are transient progress
 * layers with no exit by design, the work finishing is what dismisses them, and
 * registering either here would make this table's Escape-closes assertion fail
 * on a surface that was never supposed to close on Escape. Their coverage lives
 * in tests/core/LoadingOverlay.test.tsx and tests/core/ProcessProgress.test.tsx
 * (and tests/core/ui/BlockingOverlay.test.tsx for the shared component itself),
 * not here.
 *
 * IMPORTANT — mocks belong in the consuming test file, not here: a `vi.mock(...)` declared in
 * this fixture only patches modules that are first resolved *through* the fixture's own import
 * graph. `modal-dialogs.test.tsx` imports `AddSongSheet` and `SettingsSheet` directly, before it
 * imports this file, so by the time this file's (hoisted) `vi.mock` would run, those components
 * and their dependency subgraph — including the real `src/core/opfs/audio` — are already loaded
 * and cached under the unmocked module identity. Every file that consumes `OVERLAY_SURFACES` and
 * renders `AddSongSheet`/`SettingsSheet` must declare this mock itself:
 *
 *   vi.mock('../../../src/core/opfs/audio', () => ({
 *     getAudioFile: vi.fn(async () => new File([], 'x.mp3')),
 *     estimateOpfsAudioBytes: vi.fn(async () => 0),
 *     deleteAudio: vi.fn(async () => {}),
 *     saveAudio: vi.fn(async () => {}),
 *     audioStoragePath: (id: string) => `songs/${id}.mp3`,
 *   }))
 *
 * Vitest hoists `vi.mock` above every import within its own file, so this only works when placed
 * directly in the file doing the importing — not here.
 *
 * `WordLookupPopover` needs the same treatment for a different reason: its real dictionary lookup
 * (`lookupWord`) loads JMdict data, which is slow and unnecessary for a contract check that only
 * cares that the popover opens, is announced, and closes. Every consuming file must declare:
 *
 *   vi.mock('../../../src/language/japanese/wordLookup', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('../../../src/language/japanese/wordLookup')>()
 *     return { ...actual, lookupWord: async () => ({
 *       headword: 'x', reading: null, dictionaryReading: null, pos: null, posLabel: null,
 *       glosses: ['gloss'], senses: [], dictionaryAvailable: true,
 *     }) }
 *   })
 */
/** Minimal PlayerControls props for the two rows below — copied from
 * tests/player/PlayerControls.seek-dock.test.tsx's baseProps, trimmed to what
 * rendering the dock at all requires. */
export const playerControlsBaseProps = {
  mode: 'play' as const,
  playbackState: 'paused' as const,
  position: 65,
  duration: 120,
  progress: 65 / 120,
  speed: 1,
  speedPct: 100,
  volume: 0.75,
  volumePct: 75,
  onSpeedChange: () => {},
  onVolumeChange: () => {},
  abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 },
  armingAB: null,
  abLoopError: null,
  onTogglePlay: () => {},
  onSeek: () => {},
  onToggleArm: () => {},
  onClearAB: () => {},
  playlistEntries: [],
  playlistActive: false,
  playlistIndex: 0,
  playlistRepeatCount: 3,
  canSaveToPlaylist: false,
}

export const OVERLAY_SURFACES: OverlaySurface[] = [
  {
    // Not registered in OVERLAY_SURFACES beyond this row's own contract check:
    // Onboarding takes no props and owns its own dismiss, so there is no onClose
    // to inject into the contract's render(onClose) shape. Giving it one is a
    // Phase 3 concern, when the screen model owns first-run state.
    name: 'Onboarding',
    open: () => {
      render(<Onboarding />)
      // It closes itself rather than reporting up, so observe the DOM.
      return () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    },
  },
  {
    name: 'row 5 — add-song sheet',
    open: () => {
      const onClose = vi.fn()
      render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    name: 'row 10 — settings sheet',
    open: () => {
      const onClose = vi.fn()
      render(<SettingsSheet onClose={onClose} />)
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    name: 'row 23 — generic confirm dialog',
    role: 'alertdialog',
    open: () => {
      const onCancel = vi.fn()
      render(
        <ConfirmDialog
          title="Discard changes?"
          message="Your edits will be lost."
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      )
      return () => waitFor(() => expect(onCancel).toHaveBeenCalled())
    },
  },
  {
    name: 'primitive — bare sheet',
    open: () => {
      const onClose = vi.fn()
      render(
        <Overlay onClose={onClose} label="Bare sheet">
          <button type="button">inside</button>
        </Overlay>,
      )
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    // The August critical: no Back, no Escape, and rendering it used to unmount
    // the only <YouTubePlayer> in the tree. tests/player/PlayerView.tap-sync-overlay.test.tsx
    // covers that regression directly (it needs a real PlayerView + YouTube song to
    // reproduce); this row covers the generic dialog contract on the standalone component.
    name: 'row 17 — tap-sync editor',
    open: () => {
      const onCancel = vi.fn()
      render(
        <TapSyncEditor
          plainLines={['line one']}
          translations={['']}
          audioPosition={() => 0}
          onComplete={vi.fn()}
          onCancel={onCancel}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          volume={1}
          onVolumeChange={vi.fn()}
          speed={1}
          onSpeedChange={vi.fn()}
        />,
      )
      return () => waitFor(() => expect(onCancel).toHaveBeenCalled())
    },
  },
  {
    // The September dead end: fixed inset-0 z-50 over the app header with no
    // exit. onKeepTimings is the safe, non-destructive close — it leaves
    // timings exactly as they arrived rather than committing a drag or
    // kicking off a transcription.
    name: 'row 18 — offset-align screen',
    open: () => {
      const onKeepTimings = vi.fn()
      render(
        <OffsetAlignScreen
          lineIndex={0}
          startSec={0}
          onPreview={vi.fn()}
          onCommit={vi.fn()}
          onUseFullAlignment={vi.fn()}
          onKeepTimings={onKeepTimings}
        />,
      )
      return () => waitFor(() => expect(onKeepTimings).toHaveBeenCalled())
    },
  },
  // row 19 — auto-align flow (src/ai-pipeline/AutoAlignFlow.tsx): migrated to
  // <Overlay placement="fullscreen">, but NOT registered here. Rendering the
  // real component means loading the whole auto-align pipeline (capability,
  // demucsSeparator, whisperTranscriber, SettingsStore, opfs/audio, an
  // AudioContext stub — the mock set tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx
  // declares for itself), and per the doc comment above, that mock set has to
  // live in whatever file renders the component — this fixture can't carry it
  // for every consumer. Its close-and-report contract (onClose fires from the
  // done/error "Close" button and from the "Not now" consent-skip button) is
  // exercised directly in tests/ai-pipeline/AutoAlignFlow.autostart.test.tsx
  // (search that file for `onClose`). The generic Escape/Back/focus-trap
  // behavior <Overlay> now adds is new — this screen previously had none of
  // it — and is not yet covered by a dedicated assertion; see the task-7
  // report for this gap.
  //
  // row 16 — replace-lyrics dialog (src/player/PlayerView.tsx): also not
  // registered here, for the same reason but heavier still: it isn't its own
  // component, so reaching it means rendering all of PlayerView, switching to
  // Edit mode, and opening a nested "More" menu. Its full dialog contract
  // (announced as a modal, initial focus lands on a real control rather than
  // the aria-hidden backdrop, closes on Escape, closes on a backdrop click,
  // and the visible Close button still works) is covered directly in
  // tests/player/PlayerView.replaceLyrics.test.tsx, written as part of this
  // migration since no prior test touched this dialog at all.
  {
    // Task 8: the "Repeats before next loop" menu was a role="dialog" panel
    // dismissed by pointerdown only, with no Escape at all — <Overlay
    // placement="anchored"> is what gives it one.
    name: 'row 27 — playlist repeat-count menu',
    open: () => {
      render(
        <PlayerControls
          {...playerControlsBaseProps}
          playlistActive
          playlistEntries={[{ id: 'e1', a: 0, b: 4 }]}
          onTogglePlaylist={vi.fn()}
          onLoadPlaylistEntry={vi.fn()}
          onPlaylistRepeatCountChange={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /repeats:/i }))
      // No onClose prop to spy on — the menu's open state is internal, so
      // observe the DOM the same way the Onboarding row above does.
      return () => waitFor(() => expect(screen.queryByRole('dialog', { name: /repeats before next loop/i })).toBeNull())
    },
  },
  {
    // Task 8: the "More playback options" menu — same gap, same fix, as row 27.
    name: 'row 28 — playback more-options menu',
    open: () => {
      render(<PlayerControls {...playerControlsBaseProps} showAbExport onExportAb={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /more playback options/i }))
      return () => waitFor(() => expect(screen.queryByRole('dialog', { name: /more playback options/i })).toBeNull())
    },
  },
  {
    // Task 8: already had a hand-rolled Escape (useModalDialog) plus a manual
    // outside-pointerdown listener on each layout; both are now <Overlay>'s.
    name: 'row 21 — lyrics display options menu',
    open: () => {
      render(
        <DisplayMenu
          isJapanese
          hasTranslation
          furiganaMode="furigana"
          showTranslation
          lyricsLayout="stacked"
          onFuriganaCycle={vi.fn()}
          onToggleTranslation={vi.fn()}
          onToggleLayout={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
      return () => waitFor(() => expect(screen.queryByRole('dialog', { name: /lyrics display options/i })).toBeNull())
    },
  },
  {
    // Task 8: this is the same "More" menu tests/player/menus.escape.test.tsx covers by hand.
    // Registering it here is what lets a later task retire that file once this contract is
    // proven to cover it by name (see that test's own comment, and the doc comment above
    // OVERLAY_SURFACES).
    name: 'row 22 — edit-mode more menu',
    role: 'menu',
    open: () => {
      render(
        <EditMode
          lines={[{ startTime: 0, endTime: 2, original: 'a', translation: 'A' }]}
          playhead={() => 0}
          hasLocalAudio
          onChangeLines={vi.fn()}
          onAutoAlign={vi.fn()}
          title="t"
          artist="a"
          sourceLanguage="ja"
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /^more$/i }))
      return () => waitFor(() => expect(screen.queryByRole('menu', { name: /more lyric actions/i })).toBeNull())
    },
  },
  {
    // Task 8: dismissed on a capture-phase pointerdown that also swallows the
    // completing click (so a dismissing tap doesn't fall through and seek the
    // lyric row underneath) but had no Escape. <Overlay> adds Escape; the
    // pointerdown/swallow effect still owns the actual outside-tap dismissal
    // (see the comment on that effect in the component for why both now fire
    // harmlessly on the same event).
    name: 'row 24 — word-lookup popover',
    open: () => {
      const onClose = vi.fn()
      render(
        <WordLookupPopover
          token={{ surface: 'テスト', reading: 'テスト', pos: '名詞', baseForm: 'テスト', startIndex: 0, endIndex: 1 }}
          anchorRect={null}
          onClose={onClose}
        />,
      )
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    // Task 8: advertised "tap outside to cancel" without ever wiring Escape, and
    // without a real outside-dismiss either — <Overlay placement="anchored">
    // makes both real.
    name: 'row 25 — timestamp popover',
    open: () => {
      const onClose = vi.fn()
      render(
        <TimestampPopover
          line={{ startTime: 0, endTime: 2, original: 'a', translation: 'A' }}
          autoEnd={4}
          onCommit={vi.fn()}
          onClose={onClose}
        />,
      )
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
  {
    name: 'row 26 — translation repair popover',
    open: () => {
      const onClose = vi.fn()
      render(
        <TranslationRepairPopover
          lineIndex={0}
          candidates={[{ text: 'a nearby translation', score: 0.9, source: 'nearby' }]}
          onChoose={vi.fn()}
          onClose={onClose}
        />,
      )
      return () => waitFor(() => expect(onClose).toHaveBeenCalled())
    },
  },
]
