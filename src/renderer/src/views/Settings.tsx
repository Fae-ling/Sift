import { useEffect, useState } from 'react'
import { MODELS, type UpdateStatus } from '@shared/types'
import { useStore } from '../store'
import { PageHeader } from '../components/PageHeader'

export function SettingsView(): React.JSX.Element {
  const { settings, saveSettings, notify } = useStore()
  const [key, setKey] = useState('')
  const [spend, setSpend] = useState<Record<string, number>>({})
  useEffect(() => void window.studio.spend().then(setSpend), [])
  const month = new Date().toISOString().slice(0, 7)
  const total = Object.values(spend).reduce((a, b) => a + b, 0)

  return (
    <div className="page">
      <PageHeader title="Settings" lead="Claude is optional. Everything except the buttons marked with Claude runs on this computer at no cost.">
        <button onClick={() => void saveSettings({ guide: { step: 0, done: false } })}>Run the setup guide</button>
      </PageHeader>

      <Updates />

      <h2>What runs where</h2>
      <div className="note teach">
        <p>
          <b>On this computer, free:</b> reading RAW previews, focus, eyes, exposure, emotions on faces, grouping,
          composition, the ultrafast cull, training, and Learn. Your photos never leave the machine for any of it.
        </p>
        <p>
          <b>Optional, paid per use:</b> the buttons marked with Claude (Cull with Claude, naming faces, developing a
          style, the story sequence, the photo diagnosis, shaping a look). They send small previews and your text to
          Anthropic's Claude API. Each shows an estimate first and the real cost after.</p>
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
      <select style={{ maxWidth: 560 }} value={settings.model} onChange={(e) => void saveSettings({ model: e.target.value })} aria-label="Model">
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

/** Updating in place, and backing up what the app has learned. */
function Updates(): React.JSX.Element {
  const { notify } = useStore()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [token, setToken] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      setStatus(await window.studio.update.check())
    } finally {
      setChecking(false)
    }
  }
  useEffect(() => {
    void check()
    return window.studio.update.onProgress(setProgress)
  }, [])
  const fail = (err: unknown): void => {
    setProgress(null)
    notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }

  return (
    <>
      <h2>Updates</h2>
      <div className="card update-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="stat" style={{ fontSize: 18 }}>Sift {status?.current ?? ''}</div>
            <div className="muted small">
              {status?.latest
                ? `Version ${status.latest.version} is available (${new Date(status.latest.published).toLocaleDateString()}).`
                : status?.hasToken
                  ? status.error ?? 'This is the newest version.'
                  : 'Updates are found on GitHub once a token is added below, or installed from a file you downloaded.'}
            </div>
          </div>
          <div className="row">
            {status?.hasToken && (
              <button disabled={checking} onClick={() => void check()}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
            )}
            {status?.latest && (
              <button className="primary" disabled={progress !== null} onClick={() => void window.studio.update.download(status.latest!.assetId).catch(fail)}>
                {progress !== null ? `Downloading ${Math.round(progress * 100)}%…` : `Update to ${status.latest.version}`}
              </button>
            )}
            <button onClick={() => void window.studio.update.installFile().catch(fail)} title="Choose a Sift installer you downloaded from GitHub">
              Install from a file…
            </button>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          An update installs over this version and restarts the app. What it has learned and all your projects stay where
          they are ({status?.dataFolder ?? 'the app data folder'}), and a backup of them is made first, just in case.
        </p>
      </div>
      {!status?.hasToken ? (
        <details className="update-token">
          <summary>Find updates automatically</summary>
          <p className="small muted">
            The project's code is private, so the app needs permission to look for new versions. On GitHub, open Settings
            → Developer settings → Fine-grained tokens, create a token for the repository with <b>Contents: read-only</b>,
            and paste it here. It is stored encrypted on this computer and only sent to GitHub.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              void window.studio.update
                .setToken(token)
                .then(() => (setToken(''), check()))
                .catch(fail)
            }}
          >
            <input type="password" style={{ flex: 1, minWidth: 260 }} placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub token" autoComplete="off" />
            <button disabled={!token.trim()}>Save token</button>
          </form>
        </details>
      ) : (
        <button className="ghost sm" style={{ marginTop: 6 }} onClick={() => void window.studio.update.setToken('').then(check)}>
          Remove the GitHub token
        </button>
      )}

      <h2>Your data</h2>
      <p className="muted small">Everything learned and every project's decisions, as plain files. A backup can be put back on this or another computer.</p>
      <div className="row">
        <button onClick={() => void window.studio.backup.save().then((f) => f && notify(`Backed up to ${f}.`)).catch(fail)}>Back up…</button>
        <button onClick={() => void window.studio.backup.restore().then((n) => n !== null && notify(`Restored ${n} files.`)).catch(fail)}>Restore from a backup…</button>
        <button className="ghost" onClick={() => void window.studio.backup.reveal()}>
          Open the data folder
        </button>
      </div>
      <AutoBackups notify={notify} fail={fail} />
    </>
  )
}

/** The learning backups Sift takes by itself before something wipes what it has learned. */
function AutoBackups(props: { notify: (m: string) => void; fail: (e: unknown) => void }): React.JSX.Element | null {
  const [list, setList] = useState<{ name: string; at: number; reason: string }[]>([])
  const [sure, setSure] = useState<string | null>(null)
  useEffect(() => void window.studio.backup.list().then(setList).catch(() => {}), [])
  if (list.length === 0) return <p className="faint small">Before “forget all learning” and the like, Sift saves a copy of what it has learned here, so a slip can be put right.</p>
  return (
    <>
      <h3>Saved automatically before something was forgotten</h3>
      <p className="muted small">Only what was learned is put back; your projects are left as they are.</p>
      <div className="list">
        {list.map((b) => (
          <div className="list-row" key={b.name}>
            <div className="list-main">
              <div className="list-title">{new Date(b.at).toLocaleString()}</div>
              <div className="list-detail">Before: {b.reason}</div>
            </div>
            <div className="list-actions">
              {sure === b.name ? (
                <>
                  <span className="small">Replace what is learned now with this?</span>
                  <button className="primary sm" onClick={() => void window.studio.backup.restoreNamed(b.name).catch(props.fail)}>
                    Yes, restore
                  </button>
                  <button className="ghost sm" onClick={() => setSure(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="ghost sm" onClick={() => setSure(b.name)}>
                  Restore
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
