import { useEffect, useMemo, useState } from 'react'
import type { Estimate, ProjectSummary } from '@shared/types'
import { ledgerEntries, mergedLedger, reasonCounts, vocabulary, emptyReasons, type LedgerEntry } from '../analysis/knowledge'
import { leanings, MIN_TESTED_PAIRS } from '../analysis/learner'
import { PageHeader } from '../components/PageHeader'
import { useStore, type View } from '../store'

const pct = (v: number): string => `${Math.round(v * 100)}%`
const n = (v: number): string => String(Math.round(v))

/** A row with something learned on the left and what can be done with it on the right. */
function Row({ title, detail, children, off }: { title: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; off?: boolean }): React.JSX.Element {
  return (
    <div className={`list-row ${off ? 'off' : ''}`}>
      <div className="list-main">
        <div className="list-title">{title}</div>
        {detail && <div className="list-detail">{detail}</div>}
      </div>
      <div className="list-actions">{children}</div>
    </div>
  )
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): React.JSX.Element {
  return <input className="search" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
}

// --- overview ---------------------------------------------------------------------

export function Overview(): React.JSX.Element {
  const { knowledge, taste, emotions, gestures, training, guidance, setView, reestimateAll, estimating, notify } = useStore()
  const [history, setHistory] = useState<{ summary: ProjectSummary; estimates: Estimate[] }[]>([])
  useEffect(() => {
    if (estimating.running) return
    let live = true
    void (async () => {
      const out: { summary: ProjectSummary; estimates: Estimate[] }[] = []
      for (const summary of (await window.studio.projects.list()).slice(0, 40)) {
        const p = await window.studio.projects.load(summary.id).catch(() => null)
        if (p?.estimates?.length) out.push({ summary, estimates: p.estimates })
      }
      if (live) setHistory(out)
    })()
    return () => {
      live = false
    }
  }, [estimating.running])

  const words = vocabulary(knowledge.concepts)
  const taught = emotions.concepts.reduce((k, c) => k + c.examples.length, 0)
  const tiles: { view: View; label: string; value: string; note: string }[] = [
    { view: 'taste', label: 'Your eye', value: taste ? n(taste.report.decisions) : '0', note: taste ? `decision${taste.report.decisions === 1 ? '' : 's'} · ${pct(taste.trust)} say in suggestions` : 'decisions learned from' },
    { view: 'emotions', label: 'Emotions', value: String(emotions.concepts.length), note: `${taught} examples taught${emotions.pointers.length ? ` · ${emotions.pointers.length} waiting for a name` : ''}` },
    { view: 'gestures', label: 'Gestures', value: String(gestures.concepts.length), note: `${gestures.concepts.reduce((k, g) => k + g.examples.length, 0)} examples taught` },
    { view: 'words', label: 'What is happening', value: String(words.length), note: `words · ${words.filter((w) => w.usable).length} recognised by itself` },
    { view: 'reasons', label: 'Mistakes and reasons', value: String(Object.keys(knowledge.ledger.projects).length), note: `projects filed · ${reasonCounts(knowledge.reasons ?? emptyReasons()).length} reject reason${reasonCounts(knowledge.reasons ?? emptyReasons()).length === 1 ? '' : 's'}` },
    { view: 'claude', label: 'Claude', value: String(Object.values(knowledge.claude).reduce((k, r) => k + r.agreed + r.disagreed, 0)), note: 'judgements compared with yours' },
    { view: 'training', label: 'Teach with photos', value: String(training.log.length), note: 'training runs' },
    { view: 'review', label: "Claude's review", value: String(Object.keys(guidance.priors).length + guidance.forgive.length), note: guidance.reviews.length ? `guidance in use · last review ${new Date(guidance.reviews.at(-1)!.at).toLocaleDateString()}` : 'not reviewed yet' }
  ]
  return (
    <div className="page wide">
      <PageHeader title="Workshop" lead="Everything Sift has learned about your work, and the tools to teach it more. Look through any part, and remove what you do not want it to use." />
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.view} className="tile" onClick={() => setView(t.view)}>
            <span className="tile-label">{t.label}</span>
            <span className="tile-value">{t.value}</span>
            <span className="tile-note">{t.note}</span>
          </button>
        ))}
      </div>

      <h2>How well it predicts you</h2>
      <p className="muted small" style={{ maxWidth: 720 }}>
        A re-estimate scores each culled project again with everything known today, except what was learned from that
        project itself, and counts how many of your own calls it would have made. The number should rise as it learns.
      </p>
      <button className="primary" disabled={estimating.running} onClick={() => void reestimateAll().catch((err) => notify((err as Error).message))}>
        {estimating.running ? `Re-estimating… ${estimating.done} of ${estimating.total}` : 'Re-estimate all projects'}
      </button>
      {history.length > 0 && (
        <table className="chapter-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Project</th>
              <th>When culled</th>
              <th>First re-estimate</th>
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
    </div>
  )
}

// --- your eye ---------------------------------------------------------------------

export function Taste(): React.JSX.Element {
  const { taste, tasteData, setBlindBursts, relearn, forgetLearning, setIgnoredMeasurement, forgetProjectDecisions } = useStore()
  const [confirm, setConfirm] = useState(false)
  const [allLeans, setAllLeans] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => void window.studio.projects.list().then((l) => setNames(Object.fromEntries(l.map((p) => [p.id, p.name])))), [tasteData])
  const ignored = new Set(tasteData.ignored ?? [])
  const everyLean = taste ? leanings(taste.model) : []
  // Measurements it barely leans on say nothing yet; they stay one click away.
  const leans = allLeans ? everyLean : everyLean.filter((l) => Math.abs(l.w) >= 0.15 || ignored.has(l.key))
  const projects = Object.entries(tasteData.projects).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return (
    <div className="page wide">
      <PageHeader title="Your eye" lead="A small model of which frames you keep, trained on every decision and checked on bursts it never saw. It only gets a say in suggestions once it beats the built-in rules there.">
        <button onClick={relearn}>Learn now</button>
      </PageHeader>
      {taste ? (
        <div className="stats">
          <div className="card">
            <div className="stat">{taste.report.decisions}</div>
            <div className="muted small">decisions, {taste.report.projects} project{taste.report.projects === 1 ? '' : 's'}</div>
          </div>
          <div className="card">
            <div className="stat">{taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.rulesAgree) : '–'}</div>
            <div className="muted small">built-in rules agree with you</div>
          </div>
          <div className="card">
            <div className="stat" style={{ color: taste.trust > 0 ? 'var(--pick)' : undefined }}>{taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.blendedAgree) : '–'}</div>
            <div className="muted small">with what it learned from you</div>
          </div>
          <div className="card">
            <div className="stat">{pct(taste.trust)}</div>
            <div className="muted small">its say in each suggestion</div>
          </div>
        </div>
      ) : (
        <p className="muted">Nothing learned yet. Every pick and reject teaches it; choices made by hand teach more than accepted suggestions.</p>
      )}
      {taste && taste.report.testedPairs < MIN_TESTED_PAIRS && (
        <p className="small muted">
          Still gathering evidence: {taste.report.testedPairs} of {MIN_TESTED_PAIRS} comparisons from set-aside bursts so far. Until then the built-in rules decide.
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={tasteData.blindBursts} onChange={(e) => setBlindBursts(e.target.checked)} />
        <span>Show about one moment in ten without a suggestion, so my unprompted choice can be learned from</span>
      </label>

      <h2>What it leans on</h2>
      <p className="muted small">Strongest first. Switch a measurement off if it should not judge your work by it; the model is retrained without it.</p>
      <div className="list">
        {leans.length === 0 && <p className="faint small">Nothing clear yet: it needs more decisions before any measurement stands out.</p>}
        {leans.map((l) => (
          <Row
            key={l.key}
            off={ignored.has(l.key)}
            title={l.text.startsWith('you') ? l.text[0].toUpperCase() + l.text.slice(1) : `Favours ${l.text}`}
            detail={<span className="lean" style={{ ['--w' as string]: `${Math.min(100, Math.abs(l.w) * 40)}%` }} data-dir={l.w >= 0 ? 'up' : 'down'} />}
          >
            <label className="switch" title={ignored.has(l.key) ? 'Not used' : 'Used'}>
              <input type="checkbox" checked={!ignored.has(l.key)} onChange={(e) => setIgnoredMeasurement(l.key, !e.target.checked)} aria-label={`Use ${l.text}`} />
              <span />
            </label>
          </Row>
        ))}
      </div>

      {everyLean.length > leans.length && (
        <button className="link small" style={{ marginTop: 8 }} onClick={() => setAllLeans(true)}>
          Show all {everyLean.length} measurements
        </button>
      )}

      <h2>Learned from</h2>
      <div className="list">
        {projects.length === 0 && <p className="faint small">No projects yet.</p>}
        {projects.map(([id, p]) => (
          <Row key={id} title={names[id] ?? 'A deleted project'} detail={`${p.examples.length} frames · ${p.genre} · ${new Date(p.updatedAt).toLocaleDateString()}`}>
            <button className="ghost sm" onClick={() => forgetProjectDecisions(id)}>
              Forget
            </button>
          </Row>
        ))}
      </div>
      <div style={{ marginTop: 24 }}>
        {confirm ? (
          <div className="row">
            <button className="danger" onClick={() => void forgetLearning().then(() => setConfirm(false))}>
              Forget every decision learned
            </button>
            <button onClick={() => setConfirm(false)}>Keep</button>
          </div>
        ) : (
          taste && (
            <button className="ghost sm" onClick={() => setConfirm(true)}>
              Forget everything…
            </button>
          )
        )}
      </div>
    </div>
  )
}

// --- gestures ---------------------------------------------------------------------

export function Gestures(): React.JSX.Element {
  const { gestures, forgetGestureNamed } = useStore()
  const [q, setQ] = useState('')
  const list = gestures.concepts.filter((g) => g.name.includes(q.toLowerCase()))
  return (
    <div className="page wide">
      <PageHeader title="Gestures" lead="What bodies are doing. Each starts from a description and moves toward the examples it is taught. Correct a gesture under a frame in Cull to teach it, or type a new one.">
        <Search value={q} onChange={setQ} placeholder="Find a gesture" />
      </PageHeader>
      <div className="list">
        {list.map((g) => (
          <Row
            key={g.name}
            title={
              <>
                {g.name} {!g.builtin && <span className="chip">taught</span>}
              </>
            }
            detail={`${g.description || 'Learned from examples.'} ${g.examples.length ? `${g.examples.filter((e) => e.source === 'you').length} examples from you, ${g.examples.filter((e) => e.source === 'claude').length} from Claude.` : 'From its description only.'}`}
          >
            {(g.examples.length > 0 || !g.builtin) && (
              <button className="ghost sm" onClick={() => forgetGestureNamed(g.name)}>
                {g.builtin ? 'Forget examples' : 'Delete'}
              </button>
            )}
          </Row>
        ))}
      </div>
    </div>
  )
}

// --- what is happening ---------------------------------------------------------------

export function Words(): React.JSX.Element {
  const { knowledge, forgetTag } = useStore()
  const [q, setQ] = useState('')
  const words = useMemo(() => vocabulary(knowledge.concepts).filter((w) => w.name.includes(q.toLowerCase())), [knowledge.concepts, q])
  return (
    <div className="page wide">
      <PageHeader title="What is happening" lead="Words for what goes on in a frame, from Claude's descriptions and your own. With enough examples the app recognises a word by itself on frames Claude never saw.">
        <Search value={q} onChange={setQ} placeholder="Find a word" />
      </PageHeader>
      {words.length === 0 ? (
        <div className="empty-state">
          <p>No words yet.</p>
          <p className="small">Use “Cull with Claude”, or say what is happening in a frame under Cull.</p>
        </div>
      ) : (
        <div className="list">
          {words.map((w) => (
            <Row
              key={w.name}
              title={
                <>
                  {w.name} {w.usable ? <span className="chip pick">recognised by itself</span> : <span className="chip">needs more examples</span>}
                </>
              }
              detail={`${w.examples} example${w.examples === 1 ? '' : 's'}, ${w.confirmed} confirmed by your decisions`}
            >
              <button className="ghost sm" onClick={() => forgetTag(w.name)}>
                Remove
              </button>
            </Row>
          ))}
        </div>
      )}
    </div>
  )
}

// --- mistakes, assets and reasons ------------------------------------------------------

const KIND_LABEL: Record<LedgerEntry['kind'], string> = { flaw: 'Mistakes', trade: 'Mistakes forgiven with an asset', asset: 'Assets' }

export function Reasons(): React.JSX.Element {
  const { knowledge, forgetReason, setExcluded } = useStore()
  const entries = useMemo(() => ledgerEntries(mergedLedger(knowledge.ledger, '')), [knowledge.ledger])
  const excluded = new Set(knowledge.excluded ?? [])
  const reasons = reasonCounts(knowledge.reasons ?? emptyReasons())
  return (
    <div className="page wide">
      <PageHeader title="Mistakes and reasons" lead="Every decided frame is filed by what was wrong with it and what it brought. From that the app learns which mistakes you forgive for which assets. Switch off anything it should not use." />

      <h2>Why you reject</h2>
      <p className="muted small">The reasons you gave. Frames that look like ones you rejected for a reason are marked down a little, with a note saying so.</p>
      <div className="list">
        {reasons.length === 0 && <p className="faint small">No reasons given yet. When you reject a frame in Cull, a row of reasons appears.</p>}
        {reasons.map((r) => (
          <Row key={r.name} title={r.name} detail={`${r.count} frame${r.count === 1 ? '' : 's'}`}>
            <button className="ghost sm" onClick={() => forgetReason(r.name)}>
              Forget
            </button>
          </Row>
        ))}
      </div>

      {(['trade', 'flaw', 'asset'] as const).map((kind) => {
        const list = entries.filter((e) => e.kind === kind)
        return (
          <div key={kind}>
            <h2>{KIND_LABEL[kind]}</h2>
            <div className="list">
              {list.length === 0 && <p className="faint small">Not enough decisions yet.</p>}
              {list.map((e) => (
                <Row key={e.key} off={excluded.has(e.key)} title={e.text} detail={`kept ${n(e.k)} of ${n(e.n)} (${pct(e.k / Math.max(1, e.n))})`}>
                  <label className="switch" title={excluded.has(e.key) ? 'Not used' : 'Used'}>
                    <input type="checkbox" checked={!excluded.has(e.key)} onChange={(ev) => setExcluded(e.key, !ev.target.checked)} aria-label={`Use ${e.text}`} />
                    <span />
                  </label>
                </Row>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Claude --------------------------------------------------------------------------

export function ClaudeRecord(): React.JSX.Element {
  const { knowledge, forgetClaudeRecord, forgetNote } = useStore()
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => void window.studio.projects.list().then((l) => setNames(Object.fromEntries(l.map((p) => [p.id, p.name])))), [])
  const records = Object.entries(knowledge.claude)
  return (
    <div className="page wide">
      <PageHeader title="Claude" lead="Where Claude gave a clear opinion about a frame and what you then decided. Claude is shown this record, and the advice you acted on, before every new assessment, so it judges for you rather than for photographers in general." />
      <h2>Its judgement against yours</h2>
      <div className="list">
        {records.length === 0 && <p className="faint small">Nothing yet. Once Claude has read a shoot and you have decided its frames, this fills in.</p>}
        {records.map(([id, r]) => (
          <Row
            key={id}
            title={names[id] ?? 'A deleted project'}
            detail={
              <>
                With it {r.agreed}, against it {r.disagreed}.
                {r.keptAnyway.length > 0 && <> Kept anyway: {r.keptAnyway.slice(0, 3).join('; ')}.</>}
                {r.droppedAnyway.length > 0 && <> Dropped anyway: {r.droppedAnyway.slice(0, 3).join('; ')}.</>}
              </>
            }
          >
            <button className="ghost sm" onClick={() => forgetClaudeRecord(id)}>
              Remove
            </button>
          </Row>
        ))}
      </div>
      <h2>Advice you acted on</h2>
      <div className="list">
        {knowledge.notes.length === 0 && <p className="faint small">None yet. A story lesson is kept when you use Claude's sequence.</p>}
        {[...knowledge.notes].reverse().map((note) => (
          <Row key={note.at} title={note.text} detail={new Date(note.at).toLocaleDateString()}>
            <button className="ghost sm" onClick={() => forgetNote(note.at)}>
              Remove
            </button>
          </Row>
        ))}
      </div>
    </div>
  )
}
