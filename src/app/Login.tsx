import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { Button, ErrorNote, Field, Input } from '../components/ui'
import { Logo } from './Shell'

// Demo accounts (passwords are not stored in the app). Clicking one fills the email.
const DEMO = [
  { email: 'manager@snugglyduckling.example', label: 'Manager', note: 'Everything' },
  { email: 'cashier@snugglyduckling.example', label: 'Cashier', note: 'POS, orders, returns' },
  { email: 'warehouse@snugglyduckling.example', label: 'Warehouse', note: 'Buying and making' },
  { email: 'emma.larsen@example.com', label: 'Customer', note: 'Shop & order pickup' },
]

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await signIn(email.trim(), password) } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-base font-semibold">Sign in</h1>
            <p className="text-sm text-gray-500">Staff and customers use the same sign-in.</p>
          </div>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" busy={busy}>Sign in</Button>
        </form>
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-gray-500">Demo accounts</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button key={d.email} type="button" onClick={() => setEmail(d.email)}
                className="rounded-md border border-gray-200 px-2.5 py-2 text-left hover:border-duck-400 hover:bg-duck-50">
                <p className="text-sm font-medium">{d.label}</p>
                <p className="text-[11px] text-gray-500">{d.note}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
