import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="w-full bg-cinnabar-accent text-white text-xs flex items-center justify-center gap-3 py-1.5 px-3"
    >
      <span>New version available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="underline font-medium"
      >
        Update
      </button>
    </div>
  )
}
