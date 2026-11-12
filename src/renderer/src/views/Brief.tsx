import { STORY_PLANS } from '@shared/storyPlans'
import type { Beat, Brief as BriefType } from '@shared/types'
import { useStore } from '../store'
import { PageHeader } from '../components/PageHeader'

const FIELDS: { key: keyof BriefType; label: string; hint: string; long?: boolean; placeholder: string }[] = [
  { key: 'client', label: 'Client', hint: 'who it is for', placeholder: 'Name, brand or publication' },
  { key: 'deadline', label: 'Delivery date', hint: '', placeholder: 'e.g. 14 December' },
  { key: 'clientAsk', label: 'What the client asked for', hint: 'in their words', long: true, placeholder: 'Bright, natural, lots of candid moments with family. Nothing too posed.' },
  { key: 'intention', label: 'What you want the work to say', hint: 'your own aim', long: true, placeholder: 'Quiet intimacy. I want it to feel like remembering, not like documentation.' },
  { key: 'moodWords', label: 'Mood words', hint: 'three to six', placeholder: 'warm, soft, nostalgic, unhurried' },
  { key: 'references', label: 'Colour and visual references', hint: 'films, photographers, palettes', long: true, placeholder: 'Muted greens and warm skin like Portra 400; the window light in "Carol".' },
  { key: 'deliverables', label: 'Deliverables', hint: 'what gets handed over', placeholder: 'Online gallery, 30x30 album with 40 spreads, 10 vertical crops for social' }
]

/** One field of the brief, by key. */
function Field({ k, first }: { k: keyof BriefType; first?: boolean }): React.JSX.Element {
  const { project, update } = useStore()
  const f = FIELDS.find((x) => x.key === k)!
  if (!project) return <></>
  const set = (value: string): void => update((p) => ({ ...p, brief: { ...p.brief, [k]: value } }))
  return (
    <div>
      <label htmlFor={k} style={first ? { marginTop: 0 } : undefined}>
        {f.label}
        {f.hint && <span className="hint">{f.hint}</span>}
      </label>
      {f.long ? (
        <textarea id={k} rows={2} value={String(project.brief[k])} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
      ) : (
        <input id={k} value={String(project.brief[k])} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
      )}
    </div>
  )
}

export function Brief(): React.JSX.Element {
  const { project, update, setView, learned, chooseStyle } = useStore()
  if (!project) return <></>
  const set = (patch: Partial<BriefType>): void => update((p) => ({ ...p, brief: { ...p.brief, ...patch } }))
  const setPlan = (storyPlan: Beat[]): void => update((p) => ({ ...p, storyPlan }))
  return (
    <div className="page">
      <PageHeader title="Brief" lead="Which style this shoot is, and what it is for. Every suggestion later is made against this." />
      <section className="card form-section">
        <h3>The shoot</h3>
        <div className="grid-2">
          <div>
            <label htmlFor="style" style={{ marginTop: 0 }}>Shoot style</label>
            <select id="style" value={project.styleIds[0] ?? ''} onChange={(e) => chooseStyle(e.target.value || null)}>
              <option value="">No style</option>
              {learned.styles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <p className="field-help">
              Sets the chapters, the emotions looked for and the balance.{' '}
              <button className="link" onClick={() => setView('profiles')}>
                Edit styles
              </button>
            </p>
          </div>
          <Field k="client" first />
          <Field k="deadline" />
          <div>
            <label htmlFor="target">
              Final images<span className="hint">0 if undecided</span>
            </label>
            <input id="target" type="number" min={0} value={project.brief.targetCount} onChange={(e) => set({ targetCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </div>
        </div>
        <Field k="deliverables" />
      </section>

      <section className="card form-section">
        <h3>What it is for</h3>
        <p className="field-help" style={{ marginTop: 0 }}>Keep the client's ask and your own aim apart: where they differ is where the interesting choices are.</p>
        <Field k="clientAsk" />
        <Field k="intention" />
        <Field k="moodWords" />
        <Field k="references" />
      </section>

      <section className="card form-section">
        <div className="section-head">
          <h3 style={{ margin: 0 }}>Story plan</h3>
          <button className="link small" onClick={() => setPlan(STORY_PLANS[project.genre])}>
            Reset to the style's plan
          </button>
        </div>
        <p className="field-help" style={{ marginTop: 0 }}>The chapters this shoot should contain. Tick the ones you must not come back without: the cull protects their frames.</p>
        <div className="plan-row with-must faint small" style={{ marginBottom: 4 }}>
          <span>Must</span>
          <span>Chapter</span>
          <span>What makes a keeper</span>
          <span />
        </div>
        {project.storyPlan.map((beat, i) => (
          <div className="plan-row with-must" key={i}>
            <span className="must">
              <input type="checkbox" checked={!!beat.must} aria-label={`${beat.name} must not be missed`} onChange={(e) => setPlan(project.storyPlan.map((b, j) => (j === i ? { ...b, must: e.target.checked } : b)))} />
            </span>
            <input value={beat.name} aria-label={`Chapter ${i + 1} name`} onChange={(e) => setPlan(project.storyPlan.map((b, j) => (j === i ? { ...b, name: e.target.value } : b)))} />
            <textarea value={beat.look} aria-label={`What to look for in ${beat.name}`} rows={2} onChange={(e) => setPlan(project.storyPlan.map((b, j) => (j === i ? { ...b, look: e.target.value } : b)))} />
            <button className="ghost remove" onClick={() => setPlan(project.storyPlan.filter((_, j) => j !== i))} aria-label={`Remove ${beat.name}`} title="Remove chapter">
              ×
            </button>
          </div>
        ))}
        <button onClick={() => setPlan([...project.storyPlan, { name: 'New chapter', look: '' }])}>Add a chapter</button>
      </section>

      <div className="row" style={{ marginTop: 24 }}>
        <button className="primary" onClick={() => setView(project.shots.length ? 'cull' : 'import')}>
          {project.shots.length ? 'Continue culling' : 'Next: import the shoot'}
        </button>
      </div>
    </div>
  )
}
