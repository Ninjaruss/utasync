import { SettingsView } from './SettingsView'

interface Props {
  onClose: () => void
}

export function SettingsSheet({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative bg-cinnabar-950 border-t border-white/12 rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SettingsView onClose={onClose} />
      </div>
    </div>
  )
}
