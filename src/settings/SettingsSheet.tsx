import { SettingsView } from './SettingsView'

interface Props {
  onClose: () => void
}

export function SettingsSheet({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative bg-cinnabar-950 border-t md:border border-cinnabar-900 rounded-t-2xl md:rounded-2xl w-full md:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SettingsView onClose={onClose} embedded />
        </div>
      </div>
    </div>
  )
}
