import { useEffect, useState } from 'react'
import { MODELS } from '@shared/types'
import { useStore } from '../store'

export function SettingsView(): React.JSX.Element {
  const { settings, saveSettings, notify } = useStore()
  const [key, setKey] = useState('')
  const [spend, setSpend] = useState<Record<string, number>>({})
  useEffect(() => void window.studio.spend().then(setSpend), [])
  const month = new Date().toISOString().slice(0, 7)
  const total = Object.values(spend).reduce((a, b) => a + b, 0)

  return (
    <div className="page">
      <h1>Settings</h1>

      <h2>What runs where</h2>
      <div className="note teach">
        <p>
          <b>On this computer, free:</b> reading RAW previews, focus, closed eyes, exposure, grouping repeats, colour
          measurements, the editing notes, and everything in Learn. Your photos never leave the machine for any of it.
        </p>
        <p>
          <b>Optional, paid per use:</b> the story sequence and the per-image grading plan. These send small previews
          and your brief to Anthropic's Claude API. A typical shoot costs a few cents; each button shows an estimate
          first and the real cost after.
        </p>
      </div>

      <h2>Spent on advice</h2>
      <div className="stats" style={{ maxWidth: 420 }}>
        <div className="card">
          <div className="stat">${(spend[month] ?? 0).toFixed(2)}</div>
          <div className="muted small">this month</div>
        </div>
        <div className="card">
          <div className="stat">${total.toFixed(2)}</div>
          <div className="muted small">in total</div>
        </div>
      </div>
      <p className="muted small">Counted from what each request actually used, at the list prices below. Your Anthropic console has the authoritative figure.</p>

      <h2>Anthropic API key</h2>
      <p className="muted small">
        {settings.hasApiKey ? 'A key is saved.' : 'No key saved: AI advice is off, everything else works.'} Create a key at
        console.anthropic.com. It is stored encrypted on this computer and only ever sent to Anthropic.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void saveSettings({ apiKey: key }).then(() => {
            setKey('')
            notify(key ? 'API key saved.' : 'API key removed.')
          })
        }}
      >
        <input type="password" style={{ flex: 1, minWidth: 260 }} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="API key" autoComplete="off" />
        <button className="primary" disabled={!key.trim()}>
          Save key
        </button>
        {settings.hasApiKey && (
          <button type="button" className="danger" onClick={() => void saveSettings({ apiKey: '' }).then(() => notify('API key removed.'))}>
            Remove key
          </button>
        )}
      </form>

      <h2>Model for advice</h2>
      <select style={{ maxWidth: 420 }} value={settings.model} onChange={(e) => void saveSettings({ model: e.target.value })} aria-label="Model">
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} (${m.inPerM} in / ${m.outPerM} out per million tokens)
          </option>
        ))}
      </select>
      <p className="muted small" style={{ marginTop: 8 }}>
        The stronger model gives more perceptive critique of sequence and colour. The cheaper ones are fine for a second
        opinion. Prices are Anthropic's list prices at the time this version was built.
      </p>
    </div>
  )
}
