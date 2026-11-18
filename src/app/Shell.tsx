import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { NAV, ALL_NAV } from './nav'
import { ROLE_LABEL, useAuth } from '../lib/auth'
import { useRealtimeSync } from '../lib/realtime'
import { useLocations } from '../lib/queries'
import { cx } from '../components/ui'

export function Logo({ small, dark }: { small?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="./favicon.svg" alt="" className={small ? 'size-7' : 'size-8'} />
      <div className="leading-tight">
        <p className={cx('text-sm font-semibold', dark ? 'text-zinc-50' : 'text-zinc-900')}>The Snuggly Duckling</p>
        {!small && <p className={cx('text-[11px]', dark ? 'text-zinc-300' : 'text-zinc-600')}>Snacks · Provo & Orem</p>}
      </div>
    </div>
  )
}

export function Shell() {
  const { profile, session, signOut } = useAuth()
  const { data: locations } = useLocations()
  const live = useRealtimeSync(session?.user.id, (id) => locations?.find((l) => l.id === id)?.name ?? 'Another register')
  const { pathname } = useLocation()
  const role = profile?.role ?? 'cashier'
  const current = ALL_NAV.find((n) => (n.path === '/' ? pathname === '/' : pathname.startsWith(n.path)))

  return (
    <div className="flex h-full print:block print:h-auto">
      <aside className="no-print hidden w-60 shrink-0 flex-col border-r border-zinc-600 bg-zinc-700 md:flex">
        <div className="border-b border-zinc-600 px-4 py-4"><Logo dark /></div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.roles.includes(role))
            if (!items.length) return null
            return (
              <div key={g.label} className="mb-4">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{g.label}</p>
                {items.map((i) => (
                  <NavLink key={i.path} to={i.path} end={i.path === '/'}
                    className={({ isActive }) => cx(
                      'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                      isActive ? 'bg-gold-500 font-medium text-zinc-900' : 'text-zinc-300 hover:bg-zinc-600 hover:text-zinc-50',
                    )}>
                    {({ isActive }) => (
                      <>
                        <i.icon className={cx('size-4 shrink-0', isActive ? 'text-zinc-900' : 'text-zinc-300 group-hover:text-zinc-50')} />
                        <span className="flex-1 truncate">{i.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="no-print flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="md:hidden"><Logo small /></div>
            <p className="hidden text-sm text-zinc-600 md:block">{current?.label ?? ''}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-zinc-600" title="Changes from every user appear here automatically">
              <span className={cx('size-2 rounded-full', live === 'live' ? 'bg-green-500' : live === 'connecting' ? 'bg-gold-500 animate-pulse' : 'bg-red-500')} />
              {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
            <div className="text-right leading-tight">
              <p className="text-sm font-medium text-zinc-900">{profile?.full_name}</p>
              <p className="text-[11px] text-zinc-600">{ROLE_LABEL[role]}</p>
            </div>
            <button onClick={signOut} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <nav className="no-print flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-2 py-1.5 md:hidden">
          {ALL_NAV.filter((i) => i.roles.includes(role)).map((i) => (
            <NavLink key={i.path} to={i.path} end={i.path === '/'}
              className={({ isActive }) => cx('whitespace-nowrap rounded px-2 py-1 text-xs', isActive ? 'bg-gold-500 font-medium text-zinc-900' : 'text-zinc-700')}>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 print:overflow-visible print:p-0"><Outlet /></main>
      </div>
    </div>
  )
}
