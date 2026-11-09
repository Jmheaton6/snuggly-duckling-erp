const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const TZ = 'America/Denver'

export const money = (n: number | null | undefined) => (n == null ? '—' : usd.format(n))
export const money0 = (n: number | null | undefined) => (n == null ? '—' : usd0.format(n))

export function qty(n: number | null | undefined, uom?: string) {
  if (n == null) return '—'
  const s = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return uom === 'lb' ? `${s} lb` : s
}

export const pct = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Plain dates (no time) come back as YYYY-MM-DD; show them without a timezone shift.
export const date = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { timeZone: d.length === 10 ? 'UTC' : TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Today's date in the store's timezone, as YYYY-MM-DD.
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

export const DOC_PREFIX = { sale: 'S', sales_order: 'SO', purchase_order: 'PO', production: 'WO', return: 'R', transfer: 'TR' } as const
export const docNo = (kind: keyof typeof DOC_PREFIX, id: number) => `${DOC_PREFIX[kind]}-${String(id).padStart(5, '0')}`

export const KIND_LABEL: Record<string, string> = {
  resale: 'Resale', component: 'Component', made: 'Made in-house', kit: 'Kit (box)',
}

export const TXN_LABEL: Record<string, string> = {
  po_receipt: 'PO receipt', sale: 'Sale', sale_kit: 'Used in kit sale', return: 'Customer return',
  transfer_out: 'Transfer out', transfer_in: 'Transfer in', adjust: 'Adjustment',
  prod_issue: 'Issued to production', prod_receipt: 'Production output',
}
