import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import { cx } from './ui'

export type Column<T> = {
  key: string
  header: ReactNode
  render?: (row: T) => ReactNode
  value?: (row: T) => string | number | null | undefined   // used for sorting and search
  align?: 'left' | 'right' | 'center'
  className?: string
}

type Props<T> = {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  search?: boolean
  searchPlaceholder?: string
  toolbar?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  footer?: ReactNode
  dense?: boolean
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, search, searchPlaceholder, toolbar, initialSort, empty, footer, dense }: Props<T>) {
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState(initialSort)

  const shown = useMemo(() => {
    const valueOf = (c: Column<T>, r: T) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key] as string | number | null | undefined)
    let out = rows
    const t = term.trim().toLowerCase()
    if (t) out = out.filter((r) => columns.some((c) => String(valueOf(c, r) ?? '').toLowerCase().includes(t)))
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col) out = [...out].sort((a, b) => {
        const va = valueOf(col, a), vb = valueOf(col, b)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, columns, term, sort])

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xs">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2.5">
          {search && (
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={searchPlaceholder ?? 'Search…'}
                className="h-8 w-full rounded-md border border-gray-300 pl-8 pr-2 text-sm focus:border-duck-500 focus:outline-none focus:ring-2 focus:ring-duck-200" />
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              {columns.map((c) => (
                <th key={c.key} scope="col"
                  className={cx(dense ? 'px-2.5' : 'px-3', 'py-2 text-xs font-semibold text-gray-600 whitespace-nowrap select-none cursor-pointer hover:text-gray-900',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.className)}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx(onRowClick && 'cursor-pointer hover:bg-duck-50/50')}>
                {columns.map((c) => (
                  <td key={c.key} className={cx('whitespace-nowrap', dense ? 'px-2.5 py-1.5' : 'px-3 py-2.5',
                    c.align === 'right' ? 'text-right num' : c.align === 'center' ? 'text-center' : 'text-left', c.className)}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-gray-200 bg-gray-50/80 font-medium">{footer}</tfoot>}
        </table>
      </div>
      {!shown.length && <div className="px-4 py-10 text-center text-sm text-gray-500">{empty ?? (term ? 'Nothing matches that search.' : 'Nothing here yet.')}</div>}
      <div className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">{shown.length} of {rows.length} rows</div>
    </div>
  )
}
