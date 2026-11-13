import { useMemo, useState } from 'react'
import type { Confidence } from '@shared/types'
import { PRIOR_STRENGTH, type Check, type Proposal } from '../analysis/guidance'
import { FORGIVE_PSEUDO } from '../analysis/knowledge'
import { FEATURES } from '../analysis/learner'
import { estimateCost } from '../components/AiCost'
import { PageHeader } from '../components/PageHeader'
import { useStore } from '../store'

const pct = (v: number): string => `${Math.round(v * 100)}%`
const KINDS: { kind: Proposal['kind']; title: string; hint: string }[] = [
  { kind: 'prior', title: 'What to lean on', hint: 'Starting weights for your taste model. Each counts for a number of decisions (10, 25 or 50 by confidence); your real decisions outweigh it as they accumulate.' },
  { kind: 'forgive', title: 'Which mistakes to forgive', hint: 'Rules that act at once, each worth a few frames of evidence (4, 8 or 16). Your own record takes over as it grows.' },
  { kind: 'exclude', title: 'What to stop using', hint: 'Patterns that look like coincidence or a measuring artefact rather than taste.' },
  { kind: 'style', title: 'Shoot styles', hint: 'Where the decisions made in a style disagree with how it is set.' }
]

/**
 * Claude reviews what the app has collected and proposes how it should shape
 * the cull. The photographer sees what is sent, approves proposals one by one,
 * and sees afterwards whether they helped on decisions held back from learning.
 */
export function ReviewView(): React.JSX.Element {
  const { settings, guidance, reviewing, reviewLearning, reviewDigest, applyReview, dismissReview, forgetPrior, forgetForgive, forgetGuidance, tasteData } = useStore()
  const [showData, setShowData] = useState(false)
  const req = useMemo(() => reviewDigest(), [reviewDigest, tasteData, guidance])
  const latest = guidance.reviews.at(-1)
  const pending = latest && !latest.applied ? latest : null
  const decided = Object.values(tasteData.projects).reduce((n, p) => n + p.examples.filter((e) => e.y !== -1).length, 0)
  const estimate = estimateCost(settings.model, req.digest.length / 3.6 + 1800, 6000)
  const active = Object.entries(guidance.priors)

  return (
    <div className="page wide">
      <PageHeader
        title="Review with Claude"
        lead="Counting decisions is slow and cannot tell taste from coincidence. Claude reads everything collected so far, reasons about it, and proposes how it should shape the cull. You approve each proposal; the app then checks it against decisions it never learned from."
      >
        {settings.hasApiKey && (
          <button className="primary" disabled={reviewing || !!pending} onClick={() => void reviewLearning()} title={pending ? 'Decide on the open review first' : undefined}>
            {reviewing ? 'Claude is reviewing…' : guidance.reviews.length ? 'Review again' : 'Ask Claude to review'}
            {!reviewing && <span className="cost-hint">{estimate}</span>}
          </button>
        )}
      </PageHeader>

      {!settings.hasApiKey && <p className="note">Add an Anthropic API key in Settings (main window) to use this.</p>}
      {decided < 30 && !pending && (
        <p className="note teach">
          {decided} decisions collected so far. A review is most useful after a few hundred, for example after learning from two or three past shoots. With
          fewer it can still propose sensible starting points for your kind of work, at low confidence.
        </p>
      )}

      <details className="review-data" open={showData} onToggle={(e) => setShowData((e.target as HTMLDetailsElement).open)}>
        <summary>
          What Claude is sent <span className="faint">· numbers and words only, no photographs, no names · about {Math.round(req.digest.length / 1000)}k characters</span>
        </summary>
        <pre>{req.digest}</pre>
      </details>

      {pending && <PendingReview key={pending.at} onApply={applyReview} onDismiss={dismissReview} />}

      {latest?.applied && latest.check && (
        <section className="card review-result">
          <h2 className="card-title">Last review, {new Date(latest.at).toLocaleDateString()}</h2>
          <p className="small">{latest.reading}</p>
          <p className="small">
            You applied {latest.applied.length} of {latest.proposals.length} proposals.
          </p>
          <CheckResult before={latest.check.before} after={latest.check.after} />
          {latest.questions.length > 0 && (
            <>
              <h3>Claude asked</h3>
              <ul className="notes">{latest.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </>
          )}
        </section>
      )}

      <h2>Guidance in use</h2>
      {active.length === 0 && guidance.forgive.length === 0 ? (
        <p className="faint">None. Approved proposals appear here, each removable.</p>
      ) : (
        <>
          <div className="list">
            {active.map(([key, p]) => {
              const f = FEATURES.find((x) => x.key === key)
              return (
                <div className="list-row" key={key}>
                  <div className="list-main">
                    <div className="list-title">
                      {Math.abs(p.weight) < 0.1 ? `Do not judge by ${f?.more}` : p.weight > 0 ? `Lean toward ${f?.more}` : `Lean away: ${f?.less}`} <span className="chip">{p.confidence} · worth {PRIOR_STRENGTH[p.confidence]} decisions</span>
                    </div>
                    <div className="list-detail">{p.why}</div>
                  </div>
                  <div className="list-actions">
                    <button className="ghost sm" onClick={() => forgetPrior(key)}>
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
            {guidance.forgive.map((f) => (
              <div className="list-row" key={`${f.flaw}|${f.asset}`}>
                <div className="list-main">
                  <div className="list-title">
                    {f.factor >= 0.6 ? 'Forgive' : f.factor <= 0.3 ? 'Do not forgive' : 'Case by case'}: {f.flaw}
                    {f.asset ? ` when there is ${f.asset}` : ''} <span className="chip">{f.confidence} · worth {FORGIVE_PSEUDO[f.confidence]} frames</span>
                  </div>
                  <div className="list-detail">{f.why}</div>
                </div>
                <div className="list-actions">
                  <button className="ghost sm" onClick={() => forgetForgive(f.flaw, f.asset)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="ghost sm" style={{ marginTop: 8 }} onClick={forgetGuidance}>
            Remove all of Claude's guidance
          </button>
        </>
      )}

      {guidance.reviews.length > 0 && (
        <>
          <h2>Earlier reviews</h2>
          <div className="list">
            {[...guidance.reviews].reverse().map((r) => (
              <div className="list-row" key={r.at}>
                <div className="list-main">
                  <div className="list-title">{new Date(r.at).toLocaleString()}</div>
                  <div className="list-detail">
                    {r.applied ? `${r.applied.length} of ${r.proposals.length} applied` : 'waiting for your decision'} · {r.costUsd < 0.01 ? 'under $0.01' : `$${r.costUsd.toFixed(2)}`}
                    {r.check?.after.guidance ? ` · held-back check: ${pct(r.check.after.guidance.guided)} with, ${pct(r.check.after.guidance.unguided)} without` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PendingReview({ onApply, onDismiss }: { onApply: (ids: string[]) => void; onDismiss: () => void }): React.JSX.Element {
  const review = useStore((s) => s.guidance.reviews.at(-1))!
  // Proposals Claude is reasonably sure of start ticked; a low-confidence one waits for the photographer.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(review.proposals.filter((p) => p.confidence !== 'low').map((p) => p.id)))
  const toggle = (id: string): void => setChosen((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])))
  return (
    <section className="card review-pending">
      <h2 className="card-title">What Claude sees in your culls</h2>
      <p>{review.reading}</p>
      {review.questions.length > 0 && (
        <>
          <h3>Questions only you can answer</h3>
          <ul className="notes">{review.questions.map((q) => <li key={q}>{q}</li>)}</ul>
          <p className="faint small">Answer them by how you cull, or by editing a style or switching things off in the Workshop.</p>
        </>
      )}
      {review.proposals.length === 0 && <p className="faint">Claude proposes no changes: the evidence does not support any yet.</p>}
      {KINDS.map(({ kind, title, hint }) => {
        const list = review.proposals.filter((p) => p.kind === kind)
        if (!list.length) return null
        return (
          <div key={kind} className="proposal-group">
            <h3>{title}</h3>
            <p className="faint small">{hint}</p>
            <div className="list">
              {list.map((p) => (
                <label key={p.id} className={`list-row proposal ${chosen.has(p.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                  <div className="list-main">
                    <div className="list-title">
                      {p.text} <Conf c={p.confidence} />
                      {p.prior && (
                        <span className="faint small">
                          {' '}
                          {p.prior.current === null ? '' : `${p.prior.current.toFixed(2)} → `}
                          {p.prior.weight.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="list-detail">{p.why}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )
      })}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={() => onApply([...chosen])} disabled={review.proposals.length > 0 && chosen.size === 0}>
          {review.proposals.length ? `Apply ${chosen.size} of ${review.proposals.length}` : 'Done'}
        </button>
        <button className="ghost" onClick={onDismiss}>
          Apply none
        </button>
        <span className="faint small">Everything applied can be removed again below, one by one.</span>
      </div>
    </section>
  )
}

const Conf = ({ c }: { c: Confidence }): React.JSX.Element => <span className={`chip conf-${c}`}>{c}</span>

/** What the self-check said before and after the guidance was applied. */
function CheckResult({ before, after }: { before: Check; after: Check }): React.JSX.Element {
  const g = after.guidance
  return (
    <div className="check-result">
      {g && g.pairs >= 10 ? (
        <p className="small">
          On {g.pairs} choices held back from learning, your learned taste ranks the frame you kept first <b>{pct(g.guided)}</b> of the time with Claude's guidance,{' '}
          {pct(g.unguided)} without. {g.used ? 'The guidance is in use.' : 'It did not help, so the model has set it aside; the other approved changes still apply.'}
        </p>
      ) : (
        <p className="small">
          Too few choices held back from learning yet ({g?.pairs ?? after.testedPairs}) to test the guidance on; it is in use on your approval and will be tested as decisions
          accumulate.
        </p>
      )}
      <p className="faint small">
        Say of your learned taste in suggestions: {pct(before.trust)} before, {pct(after.trust)} after. It only rises once the model beats the built-in rules on held-back
        choices, with or without guidance.
      </p>
    </div>
  )
}
