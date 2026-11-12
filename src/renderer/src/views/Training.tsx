import { PageHeader } from '../components/PageHeader'
import { PastShootForm } from '../components/PastShootForm'
import { limitsFrom, trainingSummary } from '../analysis/training'
import { useStore } from '../store'

const KIND = { finished: 'Finished photographs', look: 'Before/after pairs', decisions: 'Past decisions' }

/** Teaching the app with the photographer's own photographs. Lives in the workshop window. */
export function TrainingView(): React.JSX.Element {
  const { training, teaching, learned, trainFinished, trainLook, resetTraining, setView, notify } = useStore()
  const summary = trainingSummary(training)
  const limits = limitsFrom(training)
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  const run = async (job: () => Promise<void>): Promise<void> => {
    try {
      await job()
    } catch (err) {
      notify((err as Error).message)
    }
  }
  const folder = (): Promise<string | null> => window.studio.pickFolder()

  return (
    <div className="page wide">
      <PageHeader title="Teach with photographs" lead="Each part learns from your own work. Everything is learned on this computer, and every run adds to what it already knows." />

      {teaching.running && (
        <div className="card" style={{ marginBottom: 12 }}>
          {teaching.label}: {teaching.done} of {teaching.total}
          <div className="bar" style={{ marginTop: 8 }}>
            <div style={{ width: `${(100 * teaching.done) / Math.max(1, teaching.total)}%` }} />
          </div>
        </div>
      )}

      <div className="train-grid">
        <section className="card">
          <h2 className="card-title">Culling: what you keep</h2>
          <p className="small muted">
            A shoot you already culled elsewhere. Decisions made before Atelier count as unprompted choices, the strongest
            evidence there is. Two or three past shoots of each kind of work give it a real start.
          </p>
          <PastShootForm compact />
        </section>

        <section className="card">
          <h2 className="card-title">Diagnosis: your finished work</h2>
          <p className="small muted">
            Finished photographs you are happy with. A new photo is then flagged when it is worse than 85% of your own
            work, not against a general standard.
          </p>
          <p className="small">{summary.diagnosis}</p>
          {limits.basis && (
            <p className="small faint">
              Your limits: outline lost above {pct(limits.mergedSome)}; attention on the subject below {pct(limits.attentionLow)}; skin hue outside{' '}
              {limits.skinHue[0].toFixed(0)}° to {limits.skinHue[1].toFixed(0)}°.
            </p>
          )}
          <div className="row">
            <button className="primary" disabled={teaching.running} onClick={() =>
                void run(async () => {
                  const f = await folder()
                  if (f) await trainFinished(f)
                })
              }>
              Choose finished photographs…
            </button>
            {Object.keys(training.norms).length > 0 && (
              <button className="ghost sm" onClick={() => resetTraining('norms')}>
                Forget norms
              </button>
            )}
            {Object.keys(training.feedback).length > 0 && (
              <button className="ghost sm" onClick={() => resetTraining('feedback')}>
                Forget my feedback
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Look: your own colour</h2>
          <p className="small muted">
            Two folders: unedited frames, and the finished versions with the same file names. The change is averaged into
            your house look, which the Look extractor turns into a LUT or preset.
          </p>
          <p className="small">{summary.look}</p>
          <div className="row">
            <button
              className="primary"
              disabled={teaching.running}
              onClick={() =>
                void run(async () => {
                  notify('First choose the folder of unedited frames, then the folder of finished photos.')
                  const before = await folder()
                  const after = before ? await folder() : null
                  if (before && after) await trainLook(before, after)
                })
              }
            >
              Choose before and after…
            </button>
            {training.houseLook && (
              <button className="ghost sm" onClick={() => resetTraining('houseLook')}>
                Forget this look
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Shoot styles</h2>
          <p className="small muted">
            A folder of photographs that share a feeling: a photographer you admire, or your own best work of one kind.
          </p>
          <p className="small">
            {learned.styles.filter((s) => s.profile).length} of {learned.styles.length} styles have learned from photographs.
          </p>
          <button onClick={() => setView('profiles')}>Open shoot styles</button>
        </section>
      </div>

      <h2>Training log</h2>
      {training.log.length === 0 && <p className="muted small">No training runs yet.</p>}
      <div className="list">
        {[...training.log].reverse().map((e, i) => (
          <div className="list-row" key={i}>
            <span className="muted" style={{ width: 160 }}>{new Date(e.at).toLocaleString()}</span>
            <b style={{ width: 180 }}>{KIND[e.kind]}</b>
            <span>
              {e.count} from {e.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
