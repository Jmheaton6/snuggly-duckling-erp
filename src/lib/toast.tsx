import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'

type Tone = 'success' | 'error' | 'info'
type Toast = { id: number; tone: Tone; text: string }

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {})
let next = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = next++
    setToasts((t) => [...t.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])
  const Icon = { success: CheckCircle2, error: XCircle, info: Info }
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => {
          const I = Icon[t.tone]
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3.5 py-3 shadow-lg">
              <I className={`mt-0.5 size-4 shrink-0 ${t.tone === 'error' ? 'text-red-600' : t.tone === 'info' ? 'text-sky-600' : 'text-emerald-600'}`} />
              <p className="text-sm text-gray-800">{t.text}</p>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
