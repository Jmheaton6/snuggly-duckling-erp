import { useQuery } from '@tanstack/react-query'
import { must, supabase } from './supabase'
import type { BomLine, Customer, ItemOverview, Location, Setting, Supplier } from './types'

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
