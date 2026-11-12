import { useState } from 'react'
import { MODELS, type Genre } from '@shared/types'
import { PastShootForm } from '../components/PastShootForm'
import { useStore } from '../store'

const STEPS = ['Welcome', 'Your work', 'Past shoots', 'Finished work', 'Your colour', 'Claude', 'Ready']
const FAMILIES: { id: Genre; label: string }[] = [
  { id: 'wedding', label: 'Wedding' },
  { id: 'event', label: 'Event' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'other', label: 'Other' }
]

/**
 * The first-run guide: teaches the app with the photographer's own work before
 * the first real cull, so that it does not start from nothing. Every step can
 * be skipped; the guide remembers where it was and can be run again from Settings.
 */
export function Guide(): React.JSX.Element {
  const { settings, saveSettings, learned, tasteData, training, teaching, createProfile, trainFinished, trainLook, notify } = useStore()
  const step = Math.min(settings.guide.step, STEPS.length - 1)
  const go = (n: number): void => void saveSettings({ guide: { step: n, done: false } })
  const close = (): void => void saveSettings({ guide: { step, done: true } })
  const [styleName, setStyleName] = useState('')
  const [family, setFamily] = useState<Genre>('portrait')
  const [feeling, setFeeling] = useState('')
  const [key, setKey] = useState('')
  const pastShoots = Object.keys(tasteData.projects).length
  const decisions = Object.values(tasteData.projects).reduce((n, p) => n + p.examples.length, 0)
  const finished = Object.values(training.norms)[0]?.length ?? 0

  const run = async (job: () => Promise<void>): Promise<void> => {
    try {
      await job()
    } catch (err) {
      notify((err as Error).message)
    }
  }

  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label="Setting up Atelier">
      <div className="guide">
        <ol className="guide-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'now' : i < step ? 'done' : ''}>
              <button className="ghost" onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
                <span className="dot">{i < step ? '✓' : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>

        <div className="guide-body">
          {step === 0 && (
            <>
              <h1>Welcome to Atelier</h1>
              <p className="lead">
                Atelier culls with you: it suggests keepers and learns from every choice you make. It gets good faster if
                it first studies work you have already done. This guide takes about ten minutes of your time, plus reading
                time for the photos, and every step can be skipped.
              </p>
              <ul className="guide-list">
                <li><b>Past shoots</b> you culled in Lightroom teach it what you keep, and which flaws you forgive for a moment.</li>
                <li><b>Finished photographs</b> teach it your standard for composition and skin.</li>
                <li><b>Before and after pairs</b> teach it your colour.</li>
              </ul>
              <p className="muted small">Everything is learned on this computer. Your photos are read, never changed or uploaded.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h1>The kinds of work you do</h1>
              <p className="lead">
                A shoot style tells the cull what matters in a kind of shoot: its chapters, the moments not to miss, the
                emotions it looks for. These are ready to use:
              </p>
              <div className="chips" style={{ marginBottom: 16 }}>
                {learned.styles.map((s) => (
                  <span key={s.id} className="chip big">
                    {s.name}
                  </span>
                ))}
              </div>
              <h3>Add one of your own</h3>
              <form
                className="guide-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(async () => {
                    await createProfile(styleName.trim(), family, feeling.trim(), [])
                    notify(`“${styleName.trim()}” added. You can develop it further in the Workshop.`)
                    setStyleName('')
                    setFeeling('')
                  })
                }}
              >
                <input placeholder="Name, e.g. LARP battles, boudoir, newborn" value={styleName} onChange={(e) => setStyleName(e.target.value)} aria-label="Style name" />
                <select value={family} onChange={(e) => setFamily(e.target.value as Genre)} aria-label="Closest kind of work">
                  {FAMILIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      closest to {f.label.toLowerCase()}
                    </option>
                  ))}
                </select>
                <input placeholder="What these pictures should feel like, in a sentence" value={feeling} onChange={(e) => setFeeling(e.target.value)} aria-label="Feeling" />
                <button disabled={!styleName.trim()}>Add style</button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Teach it what you keep</h1>
              <p className="lead">
                Choose a shoot you have already culled. The app reads every frame, then takes your choices from the star
                ratings or from the files you delivered. Two or three shoots of each kind of work give it a real start;
                one is already useful.
              </p>
              {pastShoots > 0 && (
                <p className="guide-ok">
                  ✓ Learned from {decisions} frame{decisions === 1 ? '' : 's'} in {pastShoots} shoot{pastShoots === 1 ? '' : 's'}. Add another, or continue.
                </p>
              )}
              <div className="card">
                <PastShootForm />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>Show it your finished work</h1>
              <p className="lead">
                A folder of finished photographs you are proud of: exports, a portfolio. It measures how your subjects
                stand out, where the eye goes and how skin looks, and judges new photos against your standard instead of a
                general one. Thirty to a hundred photos is plenty.
              </p>
              {finished > 0 && <p className="guide-ok">✓ Learned from {finished} finished photographs.</p>}
              {teaching.running ? (
                <Progress label={teaching.label} done={teaching.done} total={teaching.total} />
              ) : (
                <button className="primary" onClick={() =>
                    void run(async () => {
                      const f = await window.studio.pickFolder()
                      if (f) await trainFinished(f)
                    })
                  }>
                  Choose finished photographs…
                </button>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h1>Your colour</h1>
              <p className="lead">
                Optional. Two folders: unedited frames, and your finished versions of them with the same file names. The
                app works out your house look and can turn it into a LUT or Lightroom preset.
              </p>
              {training.houseLook && <p className="guide-ok">✓ Learned your look from {training.houseLook.pairs} pairs.</p>}
              {teaching.running ? (
                <Progress label={teaching.label} done={teaching.done} total={teaching.total} />
              ) : (
                <button
                  className="primary"
                  onClick={() =>
                    void run(async () => {
                      notify('First the folder of unedited frames, then the folder of finished ones.')
                      const before = await window.studio.pickFolder()
                      const after = before ? await window.studio.pickFolder() : null
                      if (before && after) await trainLook(before, after)
                    })
                  }
                >
                  Choose before and after…
                </button>
              )}
            </>
          )}

          {step === 5 && (
            <>
              <h1>Claude, if you want it</h1>
              <p className="lead">
                Everything so far is free and runs on this computer. Claude is an optional second pair of eyes: it reads
                a shoot moment by moment, says what is happening in each frame, names emotions the app cannot, and
                everything it says is kept for the app to learn from. It costs a few cents per shoot, shown before each
                use.
              </p>
              {settings.hasApiKey ? (
                <p className="guide-ok">✓ An API key is saved ({MODELS.find((m) => m.id === settings.model)?.label ?? settings.model}).</p>
              ) : (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void saveSettings({ apiKey: key }).then(() => setKey(''))
                  }}
                >
                  <input type="password" style={{ flex: 1, minWidth: 260 }} placeholder="Anthropic API key, sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="API key" autoComplete="off" />
                  <button disabled={!key.trim()}>Save key</button>
                </form>
              )}
              <p className="faint small" style={{ marginTop: 10 }}>Keys are made at console.anthropic.com. It is stored encrypted on this computer.</p>
            </>
          )}

          {step === 6 && (
            <>
              <h1>Ready</h1>
              <p className="lead">{decisions || finished ? 'This is what Atelier starts with:' : 'Atelier will learn from your first cull. Every choice you make teaches it.'}</p>
              <div className="stats">
                <div className="card">
                  <div className="stat">{decisions}</div>
                  <div className="muted small">frames of past shoots</div>
                </div>
                <div className="card">
                  <div className="stat">{finished}</div>
                  <div className="muted small">finished photographs</div>
                </div>
                <div className="card">
                  <div className="stat">{training.houseLook ? '✓' : '–'}</div>
                  <div className="muted small">your colour</div>
                </div>
                <div className="card">
                  <div className="stat">{settings.hasApiKey ? '✓' : '–'}</div>
                  <div className="muted small">Claude</div>
                </div>
              </div>
              <ul className="guide-list">
                <li>Create a project, choose its style, and import the shoot.</li>
                <li>When you reject a frame, say why with one key: it learns faster.</li>
                <li>Everything it has learned is in the <b>Workshop</b> (bottom left), where you can look through it and remove anything.</li>
              </ul>
            </>
          )}
        </div>

        <div className="guide-foot">
          <button className="ghost" onClick={close}>
            {step === STEPS.length - 1 ? 'Close' : 'Skip the guide'}
          </button>
          <div className="spacer" />
          {step > 0 && <button onClick={() => go(step - 1)}>Back</button>}
          {step < STEPS.length - 1 ? (
            <button className="primary" disabled={teaching.running} onClick={() => go(step + 1)}>
              {step === 0 ? 'Start' : [2, 3, 4, 5].includes(step) ? 'Continue' : 'Next'}
            </button>
          ) : (
            <button className="primary" onClick={close}>
              Start culling
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Progress({ label, done, total }: { label: string; done: number; total: number }): React.JSX.Element {
  return (
    <div>
      <p className="small">
        {label}: {done} of {total}
      </p>
      <div className="bar">
        <div style={{ width: `${(100 * done) / Math.max(1, total)}%` }} />
      </div>
    </div>
  )
}
