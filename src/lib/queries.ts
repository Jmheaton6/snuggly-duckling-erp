import { useQuery } from '@tanstack/react-query'
import { must, rpc, supabase } from './supabase'
import type { Availability, BomLine, Customer, ItemOverview, Location, Setting, Supplier } from './types'

// Shared lookups used across modules. Realtime invalidation keeps them fresh.

export const useLocations = () =>
  useQuery({ queryKey: ['locations'], queryFn: () => must(supabase.from('locations').select('*').order('id')) as Promise<Location[]>, staleTime: 60_000 })

export const useItems = () =>
  useQuery({ queryKey: ['items', 'overview'], queryFn: () => must(supabase.from('v_item_overview').select('*').order('sku')) as Promise<ItemOverview[]> })

export const useSuppliers = () =>
  useQuery({ queryKey: ['suppliers'], queryFn: () => must(supabase.from('suppliers').select('*').order('name')) as Promise<Supplier[]> })

export const useCustomers = () =>
  useQuery({ queryKey: ['customers'], queryFn: () => must(supabase.from('customers').select('*').order('name')) as Promise<Customer[]> })

export const useBoms = () =>
  useQuery({ queryKey: ['bom_lines'], queryFn: () => must(supabase.from('bom_lines').select('*')) as Promise<BomLine[]> })

export function useSettings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => must(supabase.from('settings').select('*').order('key')) as Promise<Setting[]> })
  const get = (key: string) => q.data?.find((s) => s.key === key)?.value
  return { ...q, get }
}

// Sellable quantity by item and location (kits include what components can pack) and the
// estimated date more arrives. Computed in the database; see item_availability().
export function useAvailability() {
  const q = useQuery({ queryKey: ['stock', 'availability'], queryFn: () => rpc<Availability[]>('item_availability') })
  const at = (itemId: number, locationId: number) => q.data?.find((a) => a.item_id === itemId && a.location_id === locationId)
  return { ...q, at }
}

// Barcode or SKU → item. Scanners sometimes report a UPC-A as 13-digit EAN with a leading 0.
export function findByCode<T extends { barcode: string; sku: string }>(items: T[] | undefined, raw: string): T | undefined {
  const code = raw.trim()
  const upc = /^0\d{12}$/.test(code) ? code.slice(1) : code
  return items?.find((i) => i.barcode === upc || i.barcode === code || i.sku.toLowerCase() === code.toLowerCase())
}
