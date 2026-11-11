import type { Brief as BriefType } from '@shared/types'
import { useStore } from '../store'

const FIELDS: { key: keyof BriefType; label: string; hint: string; long?: boolean; placeholder: string }[] = [
  { key: 'client', label: 'Client', hint: 'who it is for', placeholder: 'Name, brand or publication' },
  { key: 'deadline', label: 'Delivery date', hint: '', placeholder: 'e.g. 14 December' },
  { key: 'clientAsk', label: 'What the client asked for', hint: 'in their words', long: true, placeholder: 'Bright, natural, lots of candid moments with family. Nothing too posed.' },
  { key: 'intention', label: 'What you want the work to say', hint: 'your own aim', long: true, placeholder: 'Quiet intimacy. I want it to feel like remembering, not like documentation.' },
  { key: 'moodWords', label: 'Mood words', hint: 'three to six', placeholder: 'warm, soft, nostalgic, unhurried' },
  { key: 'references', label: 'Colour and visual references', hint: 'films, photographers, palettes', long: true, placeholder: 'Muted greens and warm skin like Portra 400; the window light in "Carol".' },
  { key: 'deliverables', label: 'Deliverables', hint: 'what gets handed over', placeholder: 'Online gallery, 30x30 album with 40 spreads, 10 vertical crops for social' }
]

export function Brief(): React.JSX.Element {
  const { project, update, setView } = useStore()
  if (!project) return <></>
  const set = (patch: Partial<BriefType>): void => update((p) => ({ ...p, brief: { ...p.brief, ...patch } }))

  return (
    <div className="page">
      <h1>Brief</h1>
      <p className="lead">
        Write this before you look at a single frame. Every later choice — which frame to keep, how warm to grade — is
        only right or wrong relative to what the work is for.
      </p>
      <div className="note teach">
        <p>
          Keep the client's ask and your own intention separate. Where they differ is where the interesting decisions
          are, and the story and grading advice will point those places out.
        </p>
      </div>

      <div className="grid-2">
        {FIELDS.filter((f) => !f.long && f.key !== 'deliverables' && f.key !== 'moodWords').map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key}>
              {f.label}
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
            <input id={f.key} value={String(project.brief[f.key])} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })} />
          </div>
        ))}
      </div>
      {FIELDS.filter((f) => f.long || f.key === 'deliverables' || f.key === 'moodWords').map((f) => (
        <div key={f.key}>
          <label htmlFor={f.key}>
            {f.label}
            {f.hint && <span className="hint">{f.hint}</span>}
          </label>
          {f.long ? (
            <textarea id={f.key} value={String(project.brief[f.key])} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })} />
          ) : (
            <input id={f.key} value={String(project.brief[f.key])} placeholder={f.placeholder} onChange={(e) => set({ [f.key]: e.target.value })} />
          )}
        </div>
      ))}
      <label htmlFor="target">
        Number of final images<span className="hint">leave at 0 if undecided</span>
      </label>
      <input
        id="target"
        type="number"
        min={0}
        style={{ width: 140 }}
        value={project.brief.targetCount}
        onChange={(e) => set({ targetCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
      />
      <div className="note">
        <p className="small muted">
          A target keeps the cull honest. Delivering fewer, stronger frames almost always reads as better work than
          delivering everything that was in focus.
        </p>
      </div>
      <div className="row" style={{ marginTop: 20 }}>
        <button className="primary" onClick={() => setView(project.shots.length ? 'cull' : 'import')}>
          {project.shots.length ? 'Continue culling' : 'Next: import the shoot'}
        </button>
      </div>
    </div>
  )
}
