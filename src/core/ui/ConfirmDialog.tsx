import { Overlay } from './Overlay'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Small inline confirmation for destructive or interrupting actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Discard',
  cancelLabel = 'Keep working',
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Overlay
      // Escape means "don't do the destructive thing", so it maps to cancel.
      // <Overlay>'s stacking rule keeps this confirm — not the sheet it sits
      // inside — the owner of that keystroke, and returns focus to whatever
      // opened it.
      onClose={onCancel}
      placement="contained"
      role="alertdialog"
      labelledBy="confirm-dialog-title"
      describedBy="confirm-dialog-message"
      backdropClassName="bg-black/50 rounded-inherit"
    >
      <div className="w-full max-w-sm rounded-xl border border-cinnabar-800 bg-cinnabar-950 p-4 space-y-3 shadow-xl shadow-black/40">
        <h3 id="confirm-dialog-title" className="text-sm font-semibold text-white text-balance">
          {title}
        </h3>
        <p id="confirm-dialog-message" className="text-xs text-white/55 text-pretty">
          {message}
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 px-4 rounded-lg text-sm font-medium text-white/70 bg-cinnabar-900 border border-cinnabar-800 touch-manipulation hover:bg-cinnabar-800 hover:text-white/85 transition-[background-color,color] duration-150 ease-out"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 px-4 rounded-lg text-sm font-medium text-white bg-red-600/90 hover:bg-red-600 touch-manipulation"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
