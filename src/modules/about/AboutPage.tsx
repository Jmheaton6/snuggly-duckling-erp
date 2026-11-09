import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/ui'

const TOOLS: [string, string][] = [
  ['Claude Code (Anthropic, Claude Opus 5.5)', 'AI coding agent used to design the schema, write the database functions, the seed simulation and this interface. Every feature was then tested against the live database.'],
  ['Supabase', 'Hosted PostgreSQL database, user sign-in (Auth) and Realtime, which pushes every change to every signed-in screen.'],
  ['PostgreSQL functions (PL/pgSQL)', 'All business logic (sales, returns, receiving, production, transfers, adjustments) runs inside the database as one transaction each, so inventory and the books can never disagree.'],
  ['React 19 + TypeScript + Vite', 'The web application.'],
  ['Tailwind CSS 4, lucide icons', 'Styling and icons.'],
  ['TanStack Query', 'Data fetching and caching; Realtime events tell it which screens to refresh.'],
  ['Recharts', 'Charts.'],
  ['JsBarcode and ZXing', 'Printing UPC barcode labels, and scanning them with a phone or laptop camera. USB scanners work as keyboards.'],
  ['PGlite (Postgres in WebAssembly)', 'Runs the full database locally to test the functions and the generated history before anything touches the live project.'],
  ['GitHub + GitHub Pages', 'Source code for the team and hosting for the live site.'],
]

const COUNTS = ['items', 'locations', 'suppliers', 'customers', 'sales', 'sales_orders', 'purchase_orders', 'production_orders', 'inventory_txns', 'journal_lines'] as const

export function AboutPage() {
  const counts = useQuery({
    queryKey: ['stock', 'about-counts'],
    queryFn: async () => Object.fromEntries(await Promise.all(COUNTS.map(async (t) => {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
      return [t, count ?? 0] as const
    }))),
  })
  return (
    <>
      <PageHeader title="About this system" description="The Snuggly Duckling ERP: a mini-ERP for a local snack store with two shops and a warehouse kitchen, built for GSCM 401 (Operations Management, BYU Marriott)." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tools used to build it">
          <dl className="space-y-3">
            {TOOLS.map(([t, d]) => (
              <div key={t}><dt className="font-medium">{t}</dt><dd className="text-gray-600">{d}</dd></div>
            ))}
          </dl>
        </Card>
        <div className="space-y-4">
          <Card title="How the modules connect">
            <ul className="list-disc space-y-2 pl-5 text-gray-700">
              <li><b>One inventory ledger.</b> Every receipt, sale, transfer, adjustment, return and production step writes a row to the inventory ledger. On-hand at each location is the running total of that ledger, and nobody types it in.</li>
              <li><b>Weighted average cost.</b> Each receipt or production completion re-averages the item's cost. Sales and issues are costed at the current average, so cost of goods sold and inventory value always tie out.</li>
              <li><b>Double-entry journal.</b> The same transaction that moves stock posts balanced debits and credits (cash, inventory, work in process, payables, revenue, COGS, scrap). The P&L and valuation are read from it.</li>
              <li><b>Bills of materials.</b> Made items (trail mix, popcorn) consume components when production starts; gift boxes backflush their components when sold. MRP explodes open orders through the same BOMs.</li>
              <li><b>Everyone sees the same data.</b> Changes stream to every signed-in screen within about a second.</li>
            </ul>
          </Card>
          <Card title="Starting data (live counts)">
            <p className="mb-3 text-gray-600">The system launched with about 8 months of simulated history. A day-by-day simulation (seasonality, Sunday closures, a Halloween candy spike, football Saturdays, suppliers with different reliability) posted every sale, order, receipt and production run through the same database functions the app uses.</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {COUNTS.map((t) => (
                <div key={t} className="flex justify-between border-b border-gray-100 py-1">
                  <dt className="text-gray-500">{t.replace('_', ' ')}</dt>
                  <dd className="num font-medium">{counts.data?.[t]?.toLocaleString() ?? '…'}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  )
}
