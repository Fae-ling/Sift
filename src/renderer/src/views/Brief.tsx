import { DEFAULT_BALANCE, STORY_PLANS } from '@shared/storyPlans'
import type { Beat, Brief as BriefType, Genre } from '@shared/types'
import { scoreAndSuggest } from '../analysis/scoring'
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
  const setPlan = (storyPlan: Beat[]): void => update((p) => ({ ...p, storyPlan }))
  // Changing the kind of shoot changes what the cull looks for, so suggestions are worked out again.
  const setGenre = (genre: Genre): void =>
    update((p) => ({
      ...p,
      genre,
      balance: DEFAULT_BALANCE[genre],
      storyPlan: STORY_PLANS[genre],
      shots: scoreAndSuggest(p.shots, { genre, balance: DEFAULT_BALANCE[genre] })
    }))

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

      <label htmlFor="genre">
        What kind of shoot is this?<span className="hint">sets what the cull looks for</span>
      </label>
      <select id="genre" style={{ width: 220 }} value={project.genre} onChange={(e) => setGenre(e.target.value as Genre)}>
        <option value="wedding">Wedding</option>
        <option value="event">Event</option>
        <option value="portrait">Portrait</option>
        <option value="fashion">Fashion</option>
        <option value="other">Other</option>
      </select>

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
      <h2>Story plan</h2>
      <p className="muted" style={{ maxWidth: 680 }}>
        The chapters this shoot should contain, and what makes a frame from each one worth keeping. The cull uses it to
        tell you which chapters are covered, and the editor's read sorts frames into it. Rewrite it for this job: an
        elopement has no speeches; a brand shoot has a product chapter.
      </p>
      {project.storyPlan.map((beat, i) => (
        <div className="plan-row" key={i}>
          <input value={beat.name} aria-label={`Chapter ${i + 1} name`} onChange={(e) => setPlan(project.storyPlan.map((b, j) => (j === i ? { ...b, name: e.target.value } : b)))} />
          <textarea value={beat.look} aria-label={`What to look for in ${beat.name}`} rows={2} onChange={(e) => setPlan(project.storyPlan.map((b, j) => (j === i ? { ...b, look: e.target.value } : b)))} />
          <button className="link small" onClick={() => setPlan(project.storyPlan.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setPlan([...project.storyPlan, { name: 'New chapter', look: '' }])}>Add a chapter</button>
        <button className="link small" onClick={() => setPlan(STORY_PLANS[project.genre])}>
          Reset to the usual {project.genre} plan
        </button>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <button className="primary" onClick={() => setView(project.shots.length ? 'cull' : 'import')}>
          {project.shots.length ? 'Continue culling' : 'Next: import the shoot'}
        </button>
      </div>
    </div>
  )
}
