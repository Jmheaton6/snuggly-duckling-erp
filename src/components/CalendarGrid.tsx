import type { ReactNode } from 'react'
import { addDays, date, today, weekStart } from '../lib/format'
import { cx } from './ui'

export type CalendarEvent = { date: string; key: string | number; label: ReactNode; count?: number; tone?: 'red' | 'gold' | 'gray' }

const TONE = {
  red: 'bg-red-50 text-red-800 ring-red-200',
  gold: 'bg-gold-100 text-gold-900 ring-gold-300',
  gray: 'bg-zinc-100 text-zinc-800 ring-zinc-200',
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const short = (d: string) => date(d).replace(/, \d{4}$/, '')

// Whole weeks, Sunday → Saturday (same weeks as MRP), starting the week of `from`.
// Each day lists its events; clicking a day selects it so the page can show that day's detail.
export function CalendarGrid({ from, weeks, events, selected, onSelect }: {
  from: string; weeks: number; events: CalendarEvent[]; selected?: string; onSelect: (day: string) => void
}) {
  const start = weekStart(from)
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  const t = today()
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200">
        {DOW.map((d) => <div key={d} className="bg-zinc-50 px-2 py-1.5 text-xs font-semibold text-zinc-700">{d}</div>)}
        {days.map((d, i) => {
          const list = events.filter((e) => e.date === d)
          return (
            <button key={d} type="button" onClick={() => onSelect(d)} aria-pressed={selected === d}
              className={cx('flex min-h-24 flex-col items-start gap-1 p-1.5 text-left hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-700',
                d < t ? 'bg-zinc-50' : 'bg-white', selected === d && 'ring-2 ring-inset ring-gold-500')}>
              <span className={cx('num rounded-full px-1.5 text-xs leading-6', d === t ? 'bg-zinc-900 font-semibold text-white' : d < t ? 'text-zinc-500' : 'text-zinc-700')}>
                {i === 0 || d.endsWith('-01') ? short(d) : Number(d.slice(8))}
              </span>
              {list.map((e) => (
                <span key={e.key} className={cx('flex w-full gap-1 rounded px-1.5 py-0.5 text-xs ring-1 ring-inset', TONE[e.tone ?? 'gray'])}>
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {e.count != null && <span className="num shrink-0 font-semibold">{e.count}</span>}
                </span>
              ))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
