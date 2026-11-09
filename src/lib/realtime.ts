import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useToast } from './toast'
import { money } from './format'

// Tables whose changes should refresh every open screen. Ledger detail tables
// (inventory_txns, journal_lines) are left out: each business action also
// changes one of these, and listening to both would refresh several times per sale.
const WATCHED = [
  'stock', 'sales', 'sales_orders', 'returns', 'purchase_orders', 'po_receipts', 'supplier_bills',
  'production_orders', 'transfers', 'adjustments', 'items', 'suppliers', 'customers', 'bom_lines',
  'settings', 'system_status',
]

// Subscribes once per signed-in session. Any change anywhere invalidates cached
// queries (debounced), so a sale on one laptop shows up on every other one.
export function useRealtimeSync(userId: string | undefined, locationName: (id: number) => string) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const timer = useRef<number | undefined>(undefined)
  const nameRef = useRef(locationName)
  useEffect(() => { nameRef.current = locationName })

  useEffect(() => {
    if (!userId) return
    const refresh = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => qc.invalidateQueries(), 250)
    }
    let channel = supabase.channel('erp-live')
    for (const table of WATCHED) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        refresh()
        const row = payload.new as Record<string, unknown>
        if (table === 'sales' && payload.eventType === 'INSERT' && row.user_id !== userId) {
          toast(`${nameRef.current(row.location_id as number)} just rang up a sale of ${money(row.total as number)}`, 'info')
        }
        if (table === 'system_status' && payload.eventType === 'UPDATE') toast('Demo data was reset', 'info')
      })
    }
    channel.subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'live' : s === 'CLOSED' || s === 'CHANNEL_ERROR' ? 'offline' : 'connecting'))
    return () => {
      window.clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [userId, qc, toast])

  return status
}
