import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isConfigured } from '../lib/supabase'
import { Spinner, Card, PageHeader } from '../components/ui'
import { Shell } from './Shell'
import { Login } from './Login'
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
import { MrpPage } from '../modules/mrp/MrpPage'
import { PurchasingPage } from '../modules/purchasing/PurchasingPage'
import { ReplenishmentPage } from '../modules/replenishment/ReplenishmentPage'
import { ProductionPage } from '../modules/production/ProductionPage'
import { ReturnsPage } from '../modules/returns/ReturnsPage'
import { FinancialsPage } from '../modules/financials/FinancialsPage'
import { ReportsPage } from '../modules/reports/ReportsPage'

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
        <Route path="mrp" element={<MrpPage />} />
        <Route path="purchasing" element={<PurchasingPage />} />
        <Route path="replenishment" element={<ReplenishmentPage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="returns" element={<ReturnsPage />} />
        <Route path="financials" element={<FinancialsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
