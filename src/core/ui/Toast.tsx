import React, { createContext, useContext, useState, useCallback } from 'react'

interface ToastItem { id: number; message: string; type: 'info' | 'warning' | 'error' }

const ToastContext = createContext<(msg: string, type?: ToastItem['type']) => void>(() => {})

export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const color: Record<ToastItem['type'], string> = {
    info: 'bg-cinnabar-900',
    warning: 'bg-yellow-900',
    error: 'bg-red-900',
  }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`${color[t.type]} text-white text-sm px-4 py-2 rounded-xl shadow-lg`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
