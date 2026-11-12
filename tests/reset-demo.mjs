// Resets the live demo data (signs in as a manager; PIN and password come from .env.local).
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile('.env.local')
const c = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const { error: e1 } = await c.auth.signInWithPassword({ email: 'manager@snugglyduckling.example', password: process.env.DEMO_PASSWORD })
if (e1) throw e1
const { data, error } = await c.rpc('reset_demo', { p_pin: process.env.RESET_PIN })
if (error) throw error
console.log('reset:', data)
