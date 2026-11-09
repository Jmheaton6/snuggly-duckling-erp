import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { must, rpc, supabase } from '../../lib/supabase'
import { useSettings } from '../../lib/queries'
import { date, dateTime } from '../../lib/format'
import { useToast } from '../../lib/toast'
import type { Setting } from '../../lib/types'
import { Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Spinner } from '../../components/ui'

export function SettingsPage() {
  const { data, isLoading, error } = useSettings()
  const status = useQuery({
    queryKey: ['system_status'],
    queryFn: () => must(supabase.from('system_status').select('*').single()) as Promise<{ seed_end: string | null; reset_at: string | null }>,
  })
  const [resetOpen, setResetOpen] = useState(false)
  if (isLoading) return <Spinner />
  return (
    <>
      <PageHeader title="Settings" description="Inputs used across the system. Change one and every screen that depends on it (EOQ, reorder points, tax) recalculates for every user." />
      <ErrorNote error={error} />
      <Card title="Planning & pricing inputs" padded={false}>
        <div className="divide-y divide-gray-100">{(data ?? []).map((s) => <SettingRow key={s.key} s={s} />)}</div>
      </Card>
      <Card title="Demo data" className="mt-4" actions={<Button variant="danger" onClick={() => setResetOpen(true)}><RotateCcw className="size-4" />Reset demo…</Button>}>
        <p className="text-gray-600">
          The system launched with simulated history ending {date(status.data?.seed_end)}{status.data?.reset_at && <> (last reset {dateTime(status.data.reset_at)})</>}.
          Reset puts every table back to that starting point, shifted forward in whole weeks so the history still ends this week. Everyone signed in sees the reset immediately.
        </p>
      </Card>
      <ResetModal open={resetOpen} onClose={() => setResetOpen(false)} />
    </>
  )
}

function SettingRow({ s }: { s: Setting }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [value, setValue] = useState(String(s.value))
  const [busy, setBusy] = useState(false)
  const dirty = Number(value) !== s.value
  async function save() {
    setBusy(true)
    try {
      await must(supabase.from('settings').update({ value: Number(value) }).eq('key', s.key).select())
      await qc.invalidateQueries()
      toast(`${s.label} updated`)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="min-w-60 flex-1">
        <p className="font-medium">{s.label}</p>
        <p className="text-xs text-gray-500">{s.help}</p>
      </div>
      <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="w-32 text-right" />
      <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} busy={busy} onClick={save}>Save</Button>
    </div>
  )
}

function ResetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  async function reset() {
    setBusy(true); setError(null)
    try {
      const r = await rpc<{ history_ends: string }>('reset_demo', { p_pin: pin })
      await qc.invalidateQueries()
      toast(`Demo data restored; history now ends ${date(r.history_ends)}`)
      setPin(''); onClose()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Reset all demo data?"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" busy={busy} disabled={!pin} onClick={reset}>Reset everything</Button></>}>
      <p className="mb-3 text-gray-600">This erases every sale, order, receipt, production order and setting change made since the last reset. It can't be undone.</p>
      <Field label="Reset PIN"><Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus /></Field>
      <div className="mt-3"><ErrorNote error={error} /></div>
    </Modal>
  )
}
