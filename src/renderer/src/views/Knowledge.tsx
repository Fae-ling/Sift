import { useEffect, useMemo, useState } from 'react'
import type { Estimate, ProjectSummary } from '@shared/types'
import { assetLines, mergedLedger, tradeoffLines, vocabulary } from '../analysis/knowledge'
import { PageHeader } from '../components/PageHeader'
import { useStore } from '../store'

const pct = (v: number): string => `${Math.round(v * 100)}%`

/** Everything the app has learned beyond single measurements, and how well it predicts the photographer. */
export function KnowledgeView(): React.JSX.Element {
  const { knowledge, gestures, project, learned, forgetTag, forgetGestureNamed, reestimate, reestimateAll, estimating, relook, setFilter, setView, notify } = useStore()
  const styleId = project?.styleIds[0] ?? ''
  const ledger = useMemo(() => mergedLedger(knowledge.ledger, styleId), [knowledge.ledger, styleId])
  const trade = useMemo(() => tradeoffLines(ledger, 10), [ledger])
  const assets = useMemo(() => assetLines(ledger, 8), [ledger])
  const words = useMemo(() => vocabulary(knowledge.concepts), [knowledge.concepts])
  const records = Object.values(knowledge.claude)
  const agreed = records.reduce((n, r) => n + r.agreed, 0)
  const disagreed = records.reduce((n, r) => n + r.disagreed, 0)
  const [history, setHistory] = useState<{ summary: ProjectSummary; estimates: Estimate[] }[]>([])
  const styleName = learned.styles.find((s) => s.id === styleId)?.name

  // The history of re-estimates lives in each project; it is read when no project is open and after a run.
  useEffect(() => {
    if (project || estimating.running) return
    let live = true
    void (async () => {
      const list = await window.studio.projects.list()
      const out: { summary: ProjectSummary; estimates: Estimate[] }[] = []
      for (const summary of list.slice(0, 40)) {
        const p = await window.studio.projects.load(summary.id).catch(() => null)
        if (p?.estimates?.length) out.push({ summary, estimates: p.estimates })
      }
      if (live) setHistory(out)
    })()
    return () => {
      live = false
    }
  }, [project, estimating.running])

  const decided = Math.round(ledger.all.n)
  const last = project?.estimates?.at(-1)

  return (
    <div className="page">
      <PageHeader
        title="What it knows"
        lead="What the app has worked out from your culls and from Claude's descriptions: which mistakes you forgive for which assets, what it can recognise as happening in a frame, and how well it now predicts you."
      />

      <section className="card-group">
        <h2>How well it predicts you</h2>
        <p className="muted small">
          A re-estimate scores a culled project again with everything the app knows today, except what it learned from
          that project itself, and counts how many of your own calls it would have made. Run it now and then: the number
          should rise as the app learns.
        </p>
        {project ? (
          <>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <button
                className="primary"
                disabled={!project.shots.some((s) => s.decision !== null)}
                onClick={() => {
                  const e = reestimate()
                  notify(e ? (e.moments ? `Today the app would make ${pct(e.now)} of your calls in this project.` : 'No decisions made by hand to measure against yet.') : 'Decide some frames first.')
                }}
              >
                Re-estimate this project
              </button>
              {relook && relook.missed.length + relook.doubted.length > 0 && (
                <button
                  onClick={() => {
                    setFilter('relook')
                    setView('cull')
                  }}
                >
                  Look at {relook.missed.length + relook.doubted.length} frames again
                </button>
              )}
            </div>
            {last && (
              <p className="small" style={{ marginTop: 10 }}>
                Last re-estimate: the app's call matched yours in <b>{pct(last.now)}</b> of {last.moments} decision{last.moments === 1 ? '' : 's'}
                {last.then !== null ? ` (when you made them: ${pct(last.then)})` : ''}.
                {relook ? ` It turned up ${relook.missed.length} moment${relook.missed.length === 1 ? '' : 's'} you kept nothing from that it would now put forward, and ${relook.doubted.length} pick${relook.doubted.length === 1 ? '' : 's'} it would question.` : ''}
              </p>
            )}
            {(project.estimates?.length ?? 0) > 1 && <Trend estimates={project.estimates!} />}
          </>
        ) : (
          <>
            <button className="primary" disabled={estimating.running} onClick={() => void reestimateAll().catch((err) => notify((err as Error).message))}>
              {estimating.running ? `Re-estimating… ${estimating.done} of ${estimating.total}` : 'Re-estimate all projects'}
            </button>
            <p className="faint small" style={{ marginTop: 6 }}>
              Also rebuilds everything learned from every project's decisions, measured the way the app measures today.
            </p>
            {history.length > 0 && (
              <table className="chapter-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>When culled</th>
                    <th>First estimate</th>
                    <th>Latest</th>
                    <th>Decisions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(({ summary, estimates }) => (
                    <tr key={summary.id}>
                      <td>{summary.name}</td>
                      <td>{estimates.at(-1)!.then !== null ? pct(estimates.at(-1)!.then!) : '–'}</td>
                      <td>{pct(estimates[0].now)}</td>
                      <td>
                        <b>{pct(estimates.at(-1)!.now)}</b>
                      </td>
                      <td>{estimates.at(-1)!.moments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="card-group">
        <h2>Mistakes against assets</h2>
        <p className="muted small">
          Every frame you decide is filed by what was wrong with it and what it brought. From {decided} decided frames
          {styleName ? ` (those in “${styleName}” count most)` : ''}:
        </p>
        {trade.length === 0 && assets.valued.length === 0 ? (
          <p className="faint">Not enough decisions yet. This fills in as you cull: it needs a few kept and rejected frames with the same mistake.</p>
        ) : (
          <div className="two-col">
            <div>
              <h3>Mistakes</h3>
              <ul className="notes">{trade.length ? trade.map((t) => <li key={t}>{t}</li>) : <li className="faint">Nothing clear yet.</li>}</ul>
            </div>
            <div>
              <h3>You keep more often</h3>
              <ul className="notes">{assets.valued.length ? assets.valued.map((t) => <li key={t}>{t}</li>) : <li className="faint">Nothing clear yet.</li>}</ul>
              {assets.passed.length > 0 && (
                <>
                  <h3>You keep less often</h3>
                  <ul className="notes">{assets.passed.map((t) => <li key={t}>{t}</li>)}</ul>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card-group">
        <h2>What is happening</h2>
        <p className="muted small">
          Words for what goes on in a frame, learned from Claude's descriptions and from your own. Once a word has enough
          examples the app uses it by itself, on frames Claude never saw. A description counts fully once your decision
          agreed with Claude's judgement of that frame.
        </p>
        {words.length === 0 ? (
          <p className="faint">Nothing yet. Use “Cull with Claude”, or say what is happening in a frame under Cull.</p>
        ) : (
          <div className="chips">
            {words.slice(0, 80).map((w) => (
              <span key={w.name} className={`chip ${w.usable ? 'pick' : ''}`} title={`${w.examples} example${w.examples === 1 ? '' : 's'}, ${w.confirmed} confirmed by your decisions. ${w.usable ? 'The app recognises this by itself.' : 'Not enough examples yet for the app to use it by itself.'}`}>
                {w.name} <span className="faint">{w.examples}</span>
                <button className="chip-x" onClick={() => forgetTag(w.name)} aria-label={`Forget ${w.name}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card-group">
        <h2>Gestures</h2>
        <p className="muted small">What bodies are doing. Correct a gesture under a frame in Cull to teach it, or name a new one.</p>
        <div className="chips">
          {gestures.concepts.map((g) => (
            <span key={g.name} className="chip" title={`${g.description || 'Taught by example.'} ${g.examples.length} example${g.examples.length === 1 ? '' : 's'}.`}>
              {g.name}
              {g.examples.length > 0 && <span className="faint"> {g.examples.length}</span>}
              {(g.examples.length > 0 || !g.builtin) && (
                <button className="chip-x" onClick={() => forgetGestureNamed(g.name)} aria-label={`Forget what was taught about ${g.name}`}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </section>

      <section className="card-group">
        <h2>Your record with Claude</h2>
        {agreed + disagreed === 0 ? (
          <p className="faint">Nothing yet. Once Claude has read a shoot and you have decided its frames, this shows where you went with its judgement and where against it.</p>
        ) : (
          <>
            <p className="small">
              Where Claude gave a clear opinion, you went with it <b>{agreed}</b> times and against it <b>{disagreed}</b> times. Claude is shown this, with examples, before every new read.
            </p>
            <div className="two-col">
              <div>
                <h3>Kept although Claude rated it low</h3>
                <ul className="notes">{records.flatMap((r) => r.keptAnyway).slice(-6).map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
              <div>
                <h3>Dropped although Claude rated it high</h3>
                <ul className="notes">{records.flatMap((r) => r.droppedAnyway).slice(-6).map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            </div>
          </>
        )}
        {knowledge.notes.length > 0 && (
          <>
            <h3>Advice you acted on</h3>
            <ul className="notes">{knowledge.notes.slice(-6).map((n) => <li key={n.at}>{n.text}</li>)}</ul>
          </>
        )}
      </section>
    </div>
  )
}

/** A project's re-estimates over time, as a small bar per run. */
function Trend({ estimates }: { estimates: Estimate[] }): React.JSX.Element {
  return (
    <div className="trend" role="img" aria-label={`Re-estimates over time: ${estimates.map((e) => pct(e.now)).join(', ')}`}>
      {estimates.slice(-16).map((e) => (
        <div key={e.at} title={`${new Date(e.at).toLocaleDateString()}: ${pct(e.now)}`}>
          <i style={{ height: `${Math.max(4, e.now * 100)}%` }} />
          <span>{pct(e.now)}</span>
        </div>
      ))}
    </div>
  )
}
