// Row shapes for the tables and views the screens read. Postgres numerics arrive
// from PostgREST as numbers.

export type Role = 'manager' | 'cashier' | 'warehouse' | 'customer'
export type ItemKind = 'resale' | 'component' | 'made' | 'kit'

export type Profile = {
  id: string
  full_name: string
  role: Role
  customer_id: number | null
  home_location_id: number | null
}

export type Location = { id: number; code: string; name: string; kind: 'store' | 'warehouse' | 'hold'; address: string | null }

export type Supplier = {
  id: number
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  lead_time_days: number
  payment_terms: string
  terms_days: number
  discount_pct: number
  discount_days: number
  active: boolean
}

export type Item = {
  id: number
  sku: string
  barcode: string
  name: string
  category: string
  kind: ItemKind
  uom: 'ea' | 'lb'
  price: number
  avg_cost: number
  supplier_id: number | null
  lead_time_days: number | null
  minutes_per_unit: number
  active: boolean
}

export type ItemOverview = Item & {
  effective_lead_time: number | null
  supplier_name: string | null
  on_hand: number
  on_hold: number
  on_order: number
  next_expected: string | null
  committed: number
  by_location: Record<string, number>
  inventory_value: number
  has_bom: boolean
}

export type BomLine = { parent_id: number; component_id: number; qty_per: number }

export type Customer = {
  id: number
  name: string
  email: string | null
  phone: string | null
  kind: 'individual' | 'business'
  city: string | null
  created_at: string
}

export type Setting = { key: string; value: number; label: string; help: string | null }

export type InventoryTxn = {
  id: number
  ts: string
  item_id: number
  location_id: number
  qty: number
  unit_cost: number
  txn_type: string
  ref_type: string | null
  ref_id: number | null
  reason_code: string | null
  note: string | null
}

export type DailySales = { day: string; location_id: number; tickets: number; net_sales: number; tax: number; cogs: number }

export type Availability = { item_id: number; location_id: number; available: number; eta: string }

export type SalesOrderRow = {
  id: number
  customer_id: number
  location_id: number
  status: 'placed' | 'fulfilled' | 'closed' | 'cancelled'
  order_date: string
  requested_date: string
  source: 'staff' | 'portal'
  note: string | null
  sale_id: number | null
  fulfilled_at: string | null
  closed_at: string | null
  customer_name: string
  customer_kind: string
  location_name: string
  lines: number
  total: number
  backordered_lines: number
  est_available_date: string | null
}

export type SalesOrderLineRow = {
  id: number
  sales_order_id: number
  item_id: number
  qty: number
  unit_price: number
  line_total: number
  location_id: number
  status: string
  sku: string
  item_name: string
  kind: ItemKind
  available: number | null
  backordered: number
  est_available_date: string | null
  available_elsewhere: number | null
}
