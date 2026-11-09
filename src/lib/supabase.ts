import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing-key', {
  realtime: { params: { eventsPerSecond: 20 } },
})

type Result<T> = { data: T | null; error: { message: string } | null }

// Unwraps a Supabase response so callers (react-query) get data or a thrown error.
export async function must<T>(query: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as T
}

// Calls a business function (Postgres RPC) and surfaces its friendly error text.
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
