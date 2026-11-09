import { useMemo, useState } from 'react'
import { useItems, useLocations } from '../../lib/queries'
import { KIND_LABEL, money, qty } from '../../lib/format'
import type { ItemOverview } from '../../lib/types'
import { DataTable, type Column } from '../../components/DataTable'
import { Badge, ErrorNote, Kpi, PageHeader, Select, Spinner } from '../../components/ui'
import { ItemDrawer } from '../items/ItemDrawer'

export function InventoryPage() {
  const { data: items, isLoading, error } = useItems()
  const { data: locations } = useLocations()
  const [kind, setKind] = useState('')
  const [category, setCategory] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const rows = useMemo(() => (items ?? []).filter((i) => (!kind || i.kind === kind) && (!category || i.category === category)), [items, kind, category])
  const categories = [...new Set((items ?? []).map((i) => i.category))].sort()

  const columns: Column<ItemOverview>[] = [
    { key: 'sku', header: 'SKU', className: 'text-gray-500' },
    { key: 'name', header: 'Item', render: (i) => <span className="font-medium">{i.name}</span> },
    { key: 'kind', header: 'Type', render: (i) => <Badge tone={i.kind === 'kit' ? 'purple' : i.kind === 'made' ? 'yellow' : i.kind === 'component' ? 'gray' : 'blue'}>{KIND_LABEL[i.kind]}</Badge> },
    ...(locations ?? []).map((l): Column<ItemOverview> => ({
      key: l.code, header: l.kind === 'hold' ? 'Hold' : l.name.replace(' Store', '').replace(' & Kitchen', ''), align: 'right',
      value: (i) => i.by_location[l.code] ?? 0,
      render: (i) => {
        const n = i.by_location[l.code] ?? 0
        return <span className={n === 0 ? 'text-gray-300' : l.kind === 'hold' ? 'text-red-700' : ''}>{qty(n)}</span>
      },
    })),
    { key: 'on_hand', header: 'On hand', align: 'right', render: (i) => <span className="font-semibold">{qty(i.on_hand, i.uom)}</span> },
    { key: 'on_order', header: 'On order', align: 'right', render: (i) => (i.on_order ? qty(i.on_order) : <span className="text-gray-300">0</span>) },
    { key: 'committed', header: 'On open orders', align: 'right', render: (i) => (i.committed ? qty(i.committed) : <span className="text-gray-300">0</span>) },
    { key: 'avg_cost', header: 'Avg cost', align: 'right', render: (i) => money(i.avg_cost) },
    { key: 'inventory_value', header: 'Value', align: 'right', render: (i) => money(i.inventory_value) },
  ]

  if (isLoading) return <Spinner />
  const total = rows.reduce((s, i) => s + i.inventory_value, 0)
  const held = (items ?? []).reduce((s, i) => s + i.on_hold, 0)

  return (
    <>
      <PageHeader title="Inventory" description="On-hand quantity by item and location, straight from the inventory ledger. Click a row for its locations, bill of materials and recent movements." />
      <ErrorNote error={error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Inventory value (shown rows)" value={money(total)} sub="On hand × weighted average cost" />
        <Kpi label="Items tracked" value={items?.length ?? 0} sub={`${(items ?? []).filter((i) => i.has_bom).length} have a bill of materials`} />
        <Kpi label="Units in Returns Hold" value={qty(held)} sub="Quality returns awaiting disposition" />
        <Kpi label="Items with stock on order" value={(items ?? []).filter((i) => i.on_order > 0).length} />
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(i) => i.id} onRowClick={(i) => setOpen(i.id)} search dense
        searchPlaceholder="Search SKU, name, barcode…" initialSort={{ key: 'sku', dir: 'asc' }}
        toolbar={<>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-40">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-44">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </>} />
      <ItemDrawer itemId={open} onClose={() => setOpen(null)} />
    </>
  )
}
