import React, { createContext, useContext, useState, useCallback } from 'react'

interface ToastItem { id: number; message: string; type: 'info' | 'warning' | 'error' }

const ToastContext = createContext<(msg: string, type?: ToastItem['type']) => void>(() => {})

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id))

  const colorClass: Record<ToastItem['type'], string> = {
    info: 'bg-cinnabar-900 border-cinnabar-800',
    warning: 'bg-yellow-900/90 border-yellow-700/50',
    error: 'bg-red-900/90 border-red-700/50',
  }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50 w-full max-w-sm px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${colorClass[t.type]} text-white text-sm px-4 py-2.5 rounded-xl shadow-lg border flex items-start gap-3 animate-[progress-enter_200ms_ease-out_both] pointer-events-auto`}
          >
            <span className="flex-1 text-pretty leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-white/45 hover:text-white min-w-5 min-h-5 flex items-center justify-center -mr-1 touch-manipulation transition-colors duration-150"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
