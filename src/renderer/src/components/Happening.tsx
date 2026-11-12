import { useEffect, useState } from 'react'
import type { Shot } from '@shared/types'
import { readGesture } from '../analysis/gesture'
import { useStore } from '../store'

/**
 * What is happening in a frame, what it brings and what is wrong with it.
 * Everything here can be corrected, and every correction teaches the app.
 */
export function Happening({ shot, hide }: { shot: Shot; hide: boolean }): React.JSX.Element | null {
  const { setTags, teachGestureNamed, gestures } = useStore()
  const [editing, setEditing] = useState<'words' | 'gesture' | null>(null)
  const [text, setText] = useState('')
  useEffect(() => setEditing(null), [shot.id])
  const score = shot.score
  if (!score) return null
  const words = score.happens ?? []
  const mine = new Set(shot.tags ?? [])
  const claudes = new Set(shot.read?.tags ?? [])
  // The body a gesture correction applies to: the largest one that is doing anything.
  const body = (shot.analysis?.bodies ?? []).find((b) => readGesture(b.g, gestures).intensity >= 0.3) ?? shot.analysis?.bodies?.[0]

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (editing === 'words') setTags(shot.id, text.split(','))
    else if (editing === 'gesture' && body && text.trim()) teachGestureNamed(text, body.g)
    setEditing(null)
  }

  return (
    <section className="insp-section">
      <h3>What is happening</h3>
      <p className="small" style={{ margin: '0 0 6px' }}>
        {shot.read?.what ?? score.happening}
        <span className="faint"> {shot.read?.what ? '(Claude)' : '(the app)'}</span>
      </p>
      <div className="chips">
        {words.map((w) => (
          <span className="chip" key={w} title={mine.has(w) ? 'Your word' : claudes.has(w) ? "Claude's word" : 'Recognised by the app from what it has been taught'}>
            {w}
            {!mine.has(w) && !claudes.has(w) && <span className="faint"> ?</span>}
          </span>
        ))}
        {score.gesture && <span className="chip">{score.gesture.name}</span>}
        {score.keyPeople?.map((n) => (
          <span className="chip pick" key={n}>
            {n}
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 12, marginTop: 4 }}>
        <button className="link small" onClick={() => (setEditing(editing === 'words' ? null : 'words'), setText([...mine].join(', ') || words.join(', ')))}>
          {words.length ? 'Correct the words' : 'Say what is happening'}
        </button>
        {body && (
          <button className="link small" onClick={() => (setEditing(editing === 'gesture' ? null : 'gesture'), setText(score.gesture?.name ?? ''))}>
            {score.gesture ? 'Correct the gesture' : 'Name the gesture'}
          </button>
        )}
      </div>
      {editing && (
        <form className="row" style={{ marginTop: 6 }} onSubmit={submit}>
          <input
            style={{ flex: 1 }}
            autoFocus
            list={editing === 'gesture' ? 'cull-gestures' : undefined}
            placeholder={editing === 'words' ? 'first dance, toast (commas between)' : 'What is the body doing?'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={editing === 'words' ? 'What is happening, in your words' : 'Gesture'}
          />
          <datalist id="cull-gestures">
            {gestures.concepts.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <button className="primary">Teach</button>
        </form>
      )}

      {!hide && ((score.assets?.length ?? 0) > 0 || (score.flaws?.length ?? 0) > 0) && (
        <div className="ledger">
          <div>
            <h4>It brings</h4>
            {score.assets?.length ? (
              <ul>
                {score.assets.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : (
              <p className="faint small">Nothing the app can name.</p>
            )}
          </div>
          <div>
            <h4>Against it</h4>
            {score.flaws?.length ? (
              <ul className="against">
                {score.flaws.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="faint small">Nothing measured.</p>
            )}
          </div>
        </div>
      )}
      {!hide && score.tradeoff && <p className="small tradeoff">{score.tradeoff}</p>}
    </section>
  )
}
