import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Hammer } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { isConfigured } from '../lib/supabase'
import { Spinner, Card, PageHeader } from '../components/ui'
import { Shell } from './Shell'
import { Login } from './Login'
import { ALL_NAV } from './nav'
import { Dashboard } from '../modules/dashboard/Dashboard'
import { InventoryPage } from '../modules/inventory/InventoryPage'
import { ItemsPage } from '../modules/items/ItemsPage'
import { SuppliersPage } from '../modules/suppliers/SuppliersPage'
import { CustomersPage } from '../modules/customers/CustomersPage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { AboutPage } from '../modules/about/AboutPage'
import { ShopPage } from '../modules/shop/ShopPage'
import { PosPage } from '../modules/pos/PosPage'
import { SalesOrdersPage } from '../modules/sales-orders/SalesOrdersPage'
import { MovesPage } from '../modules/moves/MovesPage'
import { LabelsPage } from '../modules/labels/LabelsPage'

function Planned() {
  const { pathname } = useLocation()
  const nav = ALL_NAV.find((n) => n.path === pathname)
  return (
    <>
      <PageHeader title={nav?.label ?? 'Coming soon'} />
      <Card>
        <div className="flex gap-3">
          <Hammer className="mt-0.5 size-5 shrink-0 text-duck-600" />
          <div>
            <p className="font-medium">Planned for build phase {nav?.phase}</p>
            <p className="mt-1 max-w-2xl text-gray-600">{nav?.blurb}</p>
          </div>
        </div>
      </Card>
    </>
  )
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <PageHeader title="Connect a Supabase project" />
      <Card>
        <p>This build has no database settings. Copy <code>.env.example</code> to <code>.env.local</code>, fill in
          the Supabase URL and publishable key, and restart <code>npm run dev</code>. See the README.</p>
      </Card>
    </div>
  )
}

export function App() {
  const { session, profile, loading } = useAuth()
  if (!isConfigured) return <NotConfigured />
  if (loading) return <Spinner label="Signing in…" />
  if (!session) return <Login />
  if (!profile) return <div className="p-8"><Card>This login has no ERP profile yet. Ask the manager to add one.</Card></div>
  if (profile.role === 'customer') return <ShopPage />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="sales-orders" element={<SalesOrdersPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="moves" element={<MovesPage />} />
        <Route path="labels" element={<LabelsPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="about" element={<AboutPage />} />
        {ALL_NAV.filter((n) => n.phase).map((n) => <Route key={n.path} path={n.path.slice(1)} element={<Planned />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
