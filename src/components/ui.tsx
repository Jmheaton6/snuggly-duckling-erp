import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  busy?: boolean
}
export function Button({ variant = 'secondary', size = 'md', busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-gold-500 text-zinc-900 hover:bg-gold-400',
        variant === 'secondary' && 'border border-zinc-300 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50',
        variant === 'ghost' && 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-zinc-200 bg-white shadow-xs', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-zinc-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  gray: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  green: 'bg-green-100 text-green-700 ring-green-200',
  yellow: 'bg-gold-100 text-gold-800 ring-gold-300',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const
export type Tone = keyof typeof TONES
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONES[tone])}>{children}</span>
}

// With `to`, the whole tile links to the page that explains the number.
export function Kpi({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad'; to?: string }) {
  const body = (
    <>
      <p className="flex items-center justify-between text-xs font-medium text-zinc-600">
        {label}{to && <ChevronRight className="size-4 text-zinc-400 group-hover:text-gold-700" />}
      </p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
      {sub && <p className={cx('mt-0.5 text-xs', tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-zinc-600')}>{sub}</p>}
    </>
  )
  const cls = 'rounded-lg border border-zinc-200 bg-white px-4 py-3.5 shadow-xs'
  if (!to) return <div className={cls}>{body}</div>
  return <Link to={to} className={cx(cls, 'group block hover:border-gold-500 focus-visible:border-gold-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-700/20')}>{body}</Link>
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-600">{hint}</span>}
    </label>
  )
}

const inputCls = 'block h-9 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-500 focus:border-gold-700 focus:outline-none focus:ring-2 focus:ring-gold-700/20 disabled:bg-zinc-50 disabled:text-zinc-600'
// Full width unless the caller sets a width.
const width = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? '' : 'w-full')
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, width(className), className)} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, width(className), 'pr-8', className)} />

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    // Capture phase + stop: Escape closes only this modal, not a drawer underneath it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" className={cx('w-full rounded-xl bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close"><X className="size-4" /></button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 rounded-b-xl border-t border-zinc-100 bg-zinc-50 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-zinc-950/35" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-zinc-600">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close"><X className="size-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center gap-2 py-10 text-sm text-zinc-600 justify-center"><Loader2 className="size-4 animate-spin" />{label}</div>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error instanceof Error ? error.message : String(error)}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-zinc-800">{title}</p>
      {children && <div className="mt-1 text-sm text-zinc-600">{children}</div>}
    </div>
  )
}

// Small "how this number is computed" block; the formula with live inputs filled in.
export function MathNote({ title, lines }: { title: string; lines: [string, ReactNode][] }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
      <p className="mb-1.5 font-semibold">{title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {lines.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-blue-700">{k}</dt><dd className="num font-medium">{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}
