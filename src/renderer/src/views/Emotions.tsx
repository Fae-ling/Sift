import { useState } from 'react'
import { signature, type EmotionConcept, type Pointer } from '../analysis/emotion'
import { estimateCost } from '../components/AiCost'
import { useStore } from '../store'
import { PageHeader } from '../components/PageHeader'

/** How many unnamed expressions are shown to Claude in one request. */
const ASK_AT_ONCE = 24

export function Emotions(): React.JSX.Element {
  const { emotions, settings, project, learned, namePointerAs, dropPointer, forgetEmotionNamed, forgetEmotionExample, notify, undoable } = useStore()
  const [asking, setAsking] = useState(false)
  const waiting = [...emotions.pointers].filter((p) => p.thumbs.length > 0).sort((a, b) => b.count - a.count)
  const style = learned.styles.find((s) => project?.styleIds.includes(s.id))

  const ask = async (): Promise<void> => {
    setAsking(true)
    try {
      const batch = waiting.slice(0, ASK_AT_ONCE)
      const result = await window.studio.ai.nameFaces({
        faces: batch.map((p) => ({ id: p.id, jpeg: p.thumbs[0].replace(/^data:image\/jpeg;base64,/, '') })),
        vocabulary: emotions.concepts.map((c) => ({ name: c.name, description: c.description })),
        context: style ? `${style.name}: ${style.feeling}` : ''
      })
      for (const n of result.names) namePointerAs(n.id, n.emotion, 'claude', { description: n.description, valence: n.valence, arousal: n.arousal })
      notify(`Claude named ${result.names.length} of ${batch.length} expressions. It left the rest as unclear.`)
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="page wide">
      <PageHeader title="Emotions" lead="What Sift can read on a face. Every emotion becomes more exact with each example you or Claude give it, and you can teach it any emotion your work needs." />

      <h2>What is this?</h2>
      {waiting.length === 0 ? (
        <p className="muted small">
          Nothing waiting. Strong expressions the app cannot name are collected here during import; similar ones are
          grouped, so one answer teaches it about all of them.
        </p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted small">
              {waiting.length} kinds of expression, seen {waiting.reduce((n, p) => n + p.count, 0)} times, have no name yet.
            </span>
            {settings.hasApiKey && (
              <button disabled={asking} onClick={() => void ask()}>
                {asking ? 'Asking…' : `Ask Claude to name ${Math.min(ASK_AT_ONCE, waiting.length)}`}{' '}
                <span className="muted small">{estimateCost(settings.model, 600 + Math.min(ASK_AT_ONCE, waiting.length) * 60, 1800)}</span>
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {waiting.slice(0, 30).map((p) => (
              <PointerRow key={p.id} pointer={p} names={emotions.concepts.map((c) => c.name)} onName={(name) => namePointerAs(p.id, name)} onDrop={() => dropPointer(p.id)} />
            ))}
          </div>
        </>
      )}

      <h2>What it knows</h2>
      <p className="muted small">
        To teach it more, open a frame in Cull and click the emotion under a face: confirm it, correct it, or type a new
        one. Hover an example to remove it.
      </p>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {emotions.concepts.map((c) => (
          <ConceptCard key={c.name} concept={c} onForget={() => undoable(c.builtin ? `Forgot the examples of “${c.name}”.` : `Deleted “${c.name}”.`, () => forgetEmotionNamed(c.name))} onForgetExample={(at) => undoable('Removed the example.', () => forgetEmotionExample(c.name, at))} />
        ))}
      </div>
    </div>
  )
}

function PointerRow({ pointer, names, onName, onDrop }: { pointer: Pointer; names: string[]; onName: (name: string) => void; onDrop: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <div className="card row" style={{ padding: 10 }}>
      <div className="faces">
        {pointer.thumbs.slice(0, 5).map((t, i) => (
          <img key={i} src={t} alt="An expression waiting for a name" />
        ))}
      </div>
      <span className="muted small" style={{ width: 70 }}>
        seen {pointer.count}×
      </span>
      <form
        className="row"
        style={{ flex: 1 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onName(name.trim())
        }}
      >
        <input list="emotion-names" style={{ flex: 1, minWidth: 160 }} placeholder="Name it: an emotion you know, or a new one" value={name} onChange={(e) => setName(e.target.value)} aria-label="Emotion name" />
        <datalist id="emotion-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <button className="primary" disabled={!name.trim()}>
          Teach
        </button>
        <button type="button" className="link small" onClick={onDrop} title="Not an emotion worth learning (a yawn, a sneeze, a face mid-word)">
          Not an emotion
        </button>
      </form>
    </div>
  )
}

function ConceptCard({ concept: c, onForget, onForgetExample }: { concept: EmotionConcept; onForget: () => void; onForgetExample: (at: number) => void }): React.JSX.Element {
  const yours = c.examples.filter((e) => e.source === 'you').length
  const claudes = c.examples.length - yours
  const thumbs = c.examples.filter((e) => e.thumb).slice(-12)
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 15 }}>{c.name}</b>
        <span className="chip">{c.builtin ? 'starting emotion' : 'taught'}</span>
      </div>
      <p className="small muted" style={{ margin: '4px 0 8px' }}>{c.description || 'No description yet.'}</p>
      <p className="small" style={{ marginBottom: 8 }}>
        Looks for: {signature(c).join(', ') || 'nothing distinctive yet'}.
      </p>
      {thumbs.length > 0 && (
        <div className="faces" style={{ marginBottom: 8 }}>
          {thumbs.map((e, i) => (
            <span key={i} className="example">
              <img src={e.thumb} alt={`An example of ${c.name}, from ${e.source === 'you' ? 'you' : 'Claude'}`} />
              <button className="example-x" onClick={() => onForgetExample(e.at)} aria-label={`Remove this example of ${c.name}`} title="Remove this example">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>
          {c.examples.length === 0 ? 'From its description only' : `${yours} example${yours === 1 ? '' : 's'} from you, ${claudes} from Claude`}
        </span>
        {(c.examples.length > 0 || !c.builtin) && (
          <button className="link small" onClick={onForget}>
            {c.builtin ? 'Forget examples' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}
