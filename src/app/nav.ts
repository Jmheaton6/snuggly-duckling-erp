import {
  ArrowLeftRight, BarChart3, Barcode, Boxes, ClipboardList, Factory, Gauge, Info, LineChart, Package,
  RotateCcw, Settings, ShoppingCart, Truck, Users, Warehouse, Workflow, type LucideIcon,
} from 'lucide-react'
import type { Role } from '../lib/types'

export type NavItem = {
  path: string
  label: string
  icon: LucideIcon
  roles: Role[]
  phase?: number          // not built yet: which build phase delivers it
  blurb?: string
}
export type NavGroup = { label: string; items: NavItem[] }

const ALL: Role[] = ['manager', 'cashier', 'warehouse']

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [
    { path: '/', label: 'Dashboard', icon: Gauge, roles: ALL },
  ] },
  { label: 'Sell', items: [
    { path: '/pos', label: 'Point of Sale', icon: ShoppingCart, roles: ['manager', 'cashier'] },
    { path: '/sales-orders', label: 'Sales Orders', icon: ClipboardList, roles: ALL },
    { path: '/returns', label: 'Returns & Exchanges', icon: RotateCcw, roles: ['manager', 'cashier'], phase: 5,
      blurb: 'Look up a receipt, return or exchange lines with a reason code. Quality failures go to Returns Hold; revenue and costs reverse.' },
  ] },
  { label: 'Stock', items: [
    { path: '/inventory', label: 'Inventory', icon: Warehouse, roles: ALL },
    { path: '/items', label: 'Items & BOMs', icon: Package, roles: ALL },
    { path: '/moves', label: 'Transfers & Counts', icon: ArrowLeftRight, roles: ALL },
    { path: '/labels', label: 'Barcode Labels', icon: Barcode, roles: ALL },
  ] },
  { label: 'Buy', items: [
    { path: '/purchasing', label: 'Purchase Orders', icon: Truck, roles: ['manager', 'warehouse'], phase: 3,
      blurb: 'Create and send POs with expected dates from supplier lead times, receive (scan to receive) into any location, and close.' },
    { path: '/suppliers', label: 'Suppliers', icon: Users, roles: ['manager', 'warehouse'] },
    { path: '/replenishment', label: 'Replenishment', icon: Boxes, roles: ['manager', 'warehouse'], phase: 3,
      blurb: 'Reorder points from lead-time demand, EOQ from sales history, and the periodic manual review.' },
  ] },
  { label: 'Make', items: [
    { path: '/production', label: 'Production', icon: Factory, roles: ['manager', 'warehouse'], phase: 4,
      blurb: 'Production orders: issue components per the BOM, record good / scrapped / reworked with reason codes, and see yield and cycle-time metrics.' },
    { path: '/mrp', label: 'MRP', icon: Workflow, roles: ['manager', 'warehouse'], phase: 4,
      blurb: 'Four-week plan: confirmed orders × BOM, less on-hand and open POs, with order-by dates backed off by lead time.' },
  ] },
  { label: 'Money', items: [
    { path: '/financials', label: 'Financials', icon: LineChart, roles: ['manager'], phase: 5,
      blurb: 'Profit & loss, inventory valuation at weighted average cost, and inventory turnover, all live from the journal.' },
    { path: '/reports', label: 'Reports', icon: BarChart3, roles: ['manager'], phase: 5,
      blurb: 'Sales by day and week, top sellers, low stock with order-by dates, inventory by location and supplier performance.' },
  ] },
  { label: 'Admin', items: [
    { path: '/customers', label: 'Customers', icon: Users, roles: ALL },
    { path: '/settings', label: 'Settings', icon: Settings, roles: ['manager'] },
    { path: '/about', label: 'About this system', icon: Info, roles: ALL },
  ] },
]

export const ALL_NAV = NAV.flatMap((g) => g.items)
