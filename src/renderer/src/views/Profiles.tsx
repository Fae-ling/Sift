import { useState } from 'react'
import { styleCacheId, type Beat, type Genre, type Style, type StyleProposal } from '@shared/types'
import { FAMILY_EMOTIONS } from '../analysis/emotion'
import { MIN_TESTED_PAIRS, tendencies } from '../analysis/learner'
import { thumbUrl } from '../analysis/pipeline'
import { emotionLifts, emotionWeights, profileFacts } from '../analysis/style'
import { estimateCost, formatCost } from '../components/AiCost'
import { useStore } from '../store'

const FAMILIES: { id: Genre; label: string }[] = [
  { id: 'wedding', label: 'Wedding-like' },
  { id: 'event', label: 'Event, action, reportage' },
  { id: 'portrait', label: 'Portrait-like' },
  { id: 'fashion', label: 'Fashion, editorial, product' },
  { id: 'other', label: 'Something else' }
]
const lines = (text: string): string[] => text.split('\n').map((t) => t.trim()).filter(Boolean)
const splitTags = (text: string): string[] => text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

export function Profiles(): React.JSX.Element {
  const { learned, learning, project, createProfile, taste, tasteData, setBlindBursts, forgetLearning, relearn } = useStore()
  const [confirmForget, setConfirmForget] = useState(false)
  const [name, setName] = useState('')
  const [feeling, setFeeling] = useState('')
  const [family, setFamily] = useState<Genre>('event')
  const [open, setOpen] = useState<string | null>(project?.styleIds[0] ?? null)
  const pct = (v: number): string => `${Math.round(v * 100)}%`

  return (
    <div className="page wide">
      <h1>Shoot styles</h1>
      <p className="lead">
        A style is a kind of work you do: a wedding, a LARP battle, a boudoir session, a birthday. It holds what the cull
        should look for there: the chapters that must not be missed, the emotions that carry it, the flaws nobody
        minds. Make your own, let Claude help develop them, and each one keeps learning from the shoots you cull in it.
      </p>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void createProfile(name.trim(), family, feeling.trim(), []).then(setOpen)
          setName('')
          setFeeling('')
        }}
      >
        <div className="row">
          <input style={{ flex: 1, minWidth: 200 }} placeholder="New style, e.g. Medieval battle re-enactment" value={name} onChange={(e) => setName(e.target.value)} aria-label="Style name" />
          <select style={{ width: 230 }} value={family} onChange={(e) => setFamily(e.target.value as Genre)} aria-label="Closest kind of work">
            {FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!name.trim()}>
            Create style
          </button>
        </div>
        <input style={{ marginTop: 8 }} placeholder="In a sentence: what are these pictures for, and what should they feel like? (Claude can develop the rest.)" value={feeling} onChange={(e) => setFeeling(e.target.value)} aria-label="What the style is for" />
      </form>

      {learning.running && (
        <div className="card" style={{ marginTop: 12 }}>
          Studying the gallery: {learning.done} of {learning.total}
          <div className="bar" style={{ marginTop: 8 }}>
            <div style={{ width: `${(100 * learning.done) / Math.max(1, learning.total)}%` }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        {learned.styles.map((s) => (
          <StyleCard key={s.id} style={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
        ))}
      </div>

      <h2 style={{ marginTop: 8 }}>Your eye</h2>
      <div className="card">
        {taste ? (
          <>
            <div className="stats" style={{ marginTop: 0 }}>
              <div>
                <div className="stat">{taste.report.decisions}</div>
                <div className="muted small">decisions learned from, across {taste.report.projects} project{taste.report.projects === 1 ? '' : 's'}</div>
              </div>
              <div>
                <div className="stat">{taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.rulesAgree) : '–'}</div>
                <div className="muted small">built-in rules agree with you</div>
              </div>
              <div>
                <div className="stat" style={{ color: taste.trust > 0 ? 'var(--pick)' : undefined }}>
                  {taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.blendedAgree) : '–'}
                </div>
                <div className="muted small">with what it has learned from you</div>
              </div>
              <div>
                <div className="stat">{pct(taste.trust)}</div>
                <div className="muted small">say your learned taste has in each suggestion</div>
              </div>
            </div>
            <p className="small muted">
              {taste.report.testedPairs < MIN_TESTED_PAIRS
                ? `Still gathering evidence. Agreement is measured on bursts set aside and never learned from: ${taste.report.testedPairs} comparisons so far, ${MIN_TESTED_PAIRS} needed before what it has learned may influence suggestions. Until then the built-in rules decide.`
                : taste.trust > 0
                  ? `Measured on ${taste.report.testedPairs} choices from bursts that were set aside and never learned from: how often the frame you kept was ranked above the one you passed over. The learned share is whatever gives the best agreement there, so it only grows when it earns it.`
                  : `Measured on ${taste.report.testedPairs} choices from bursts that were set aside. What it has learned does not yet beat the built-in rules there, so it is not used. It keeps learning with every decision.`}{' '}
              {taste.report.blindDecisions} of your decisions were made with no suggestion shown.
            </p>
            {tendencies(taste.model).length > 0 && (
              <>
                <h3>What it has noticed about your choices</h3>
                <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
                  {tendencies(taste.model).map((t) => (
                    <li key={t}>{t.startsWith('you') ? t[0].toUpperCase() + t.slice(1) : `You favour ${t}`}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing learned yet. Every pick and reject you make teaches Atelier your taste; choices you make by hand
            teach more than suggestions you accept. It retrains as you cull and whenever you close a project.
          </p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 400, margin: 0 }} className="row">
            <input type="checkbox" style={{ width: 'auto' }} checked={tasteData.blindBursts} onChange={(e) => setBlindBursts(e.target.checked)} />
            Show about one moment in ten without a suggestion, so my unprompted choice can be learned from
          </label>
          <div className="spacer" />
          <button onClick={relearn}>Learn now</button>
          {confirmForget ? (
            <>
              <button className="danger" onClick={() => void forgetLearning().then(() => setConfirmForget(false))}>
                Forget everything learned
              </button>
              <button onClick={() => setConfirmForget(false)}>Keep</button>
            </>
          ) : (
            taste && (
              <button className="link small" onClick={() => setConfirmForget(true)}>
                Forget
              </button>
            )
          )}
        </div>
      </div>

    </div>
  )
}

/** The style in plain text, for Claude. */
function describe(s: Style): string {
  const w = emotionWeights(s)
  return [
    `Feeling: ${s.feeling || 'not written yet'}`,
    `Atmosphere words: ${s.tags.join(', ') || 'none'}`,
    `Chapters: ${s.chapters.map((c) => `${c.name}${c.must ? ' (must not be missed)' : ''}: ${c.look}`).join(' | ')}`,
    `Emotion weights: ${Object.entries(w).map(([n, v]) => `${n} ${v.toFixed(1)}`).join(', ')}`,
    `Look for: ${s.lookFor.join('; ') || 'nothing yet'}`,
    `Forgive: ${s.forgive.join('; ') || 'nothing yet'}`,
    `Balance of moment against craft: ${s.balance.toFixed(2)}`
  ].join('\n')
}

function StyleCard({ style, open, onToggle }: { style: Style; open: boolean; onToggle: () => void }): React.JSX.Element {
  const { project, settings, learning, emotions, taste, editProfile, addGallery, rememberPicks, distil, removeStyle, chooseStyle, notify } = useStore()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [proposal, setProposal] = useState<StyleProposal | null>(null)
  const active = project?.styleIds.includes(style.id) ?? false
  const picks = active ? (project?.shots.filter((x) => x.decision === 'pick') ?? []) : []
  const weights = emotionWeights(style)
  const names = [...new Set([...emotions.concepts.map((c) => c.name), ...Object.keys(style.emotions)])]
  const edit = (patch: Partial<Style>): void => void editProfile(style.id, patch)
  const setChapter = (i: number, patch: Partial<Beat>): void => edit({ chapters: style.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  const guard = async (label: string, job: () => Promise<void>): Promise<void> => {
    setBusy(label)
    try {
      await job()
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }

  /** What this photographer's own culling in the style has shown, in words. */
  const evidence = (): string => {
    if (!active || !project) return ''
    const lifts = emotionLifts(project.shots)
    const decided = project.shots.filter((x) => x.decision).length
    if (decided < 30) return ''
    const byChapter = new Map<string, { kept: number; all: number }>()
    for (const x of project.shots) {
      const ch = x.chapter ?? x.read?.beat
      if (!ch) continue
      const c = byChapter.get(ch) ?? { kept: 0, all: 0 }
      c.all++
      if (x.decision === 'pick') c.kept++
      byChapter.set(ch, c)
    }
    return [
      `In "${project.name}": ${decided} frames decided, ${picks.length} kept.`,
      Object.keys(lifts).length ? `Emotions kept more or less often than average (lift -1..1): ${Object.entries(lifts).map(([n, l]) => `${n} ${l.w.toFixed(2)} over ${l.n} frames`).join(', ')}.` : '',
      byChapter.size ? `By chapter: ${[...byChapter].map(([n, c]) => `${n} ${c.kept} kept of ${c.all}`).join(', ')}.` : '',
      taste ? `Their general tendencies when choosing: ${tendencies(taste.model).join('; ')}.` : ''
    ].filter(Boolean).join('\n')
  }

  const develop = (): Promise<void> =>
    guard('develop', async () => {
      setProposal(
        await window.studio.ai.developStyle({
          name: style.name,
          family: style.family,
          current: describe(style),
          evidence: evidence(),
          vocabulary: emotions.concepts.map((c) => c.name),
          samples: active && project && picks.length >= 6 ? { cacheId: project.id, shotIds: picks.filter((_, i) => i % Math.ceil(picks.length / 16) === 0).slice(0, 16).map((x) => x.id) } : undefined
        })
      )
    })

  const apply = (p: StyleProposal): void => {
    edit({
      feeling: p.feeling,
      tags: p.tags,
      chapters: p.chapters,
      emotions: Object.fromEntries(p.emotions.map((e) => [e.name, e.weight])),
      lookFor: p.lookFor,
      forgive: p.forgive,
      balance: p.balance
    })
    setProposal(null)
    if (active) chooseStyle(style.id)
    notify(`“${style.name}” updated.`)
  }

  return (
    <div className="card" style={active ? { borderColor: 'var(--gem)' } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={onToggle}>
        <div>
          <b style={{ fontSize: 15 }}>{style.name}</b>
          <span className="muted small"> · {style.chapters.length} chapters, {style.chapters.filter((c) => c.must).length} not to be missed{style.sources.length ? ` · learned from ${style.sources.reduce((n, x) => n + x.count, 0)} photographs` : ''}</span>
          <div className="muted small">{style.feeling}</div>
        </div>
        <div className="row" onClick={(e) => e.stopPropagation()}>
          {project && (
            <button className={active ? 'primary' : ''} onClick={() => chooseStyle(active ? null : style.id)}>
              {active ? `Culling “${project.name}” in this style` : 'Use for this project'}
            </button>
          )}
          <button onClick={onToggle}>{open ? 'Close' : 'Open'}</button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <label htmlFor={`n-${style.id}`}>Name</label>
              <input id={`n-${style.id}`} defaultValue={style.name} onBlur={(e) => e.target.value.trim() && edit({ name: e.target.value.trim() })} />
            </div>
            <div>
              <label htmlFor={`t-${style.id}`}>
                Atmosphere<span className="hint">comma separated</span>
              </label>
              <input id={`t-${style.id}`} key={style.tags.join()} defaultValue={style.tags.join(', ')} onBlur={(e) => edit({ tags: splitTags(e.target.value) })} />
            </div>
          </div>
          <label htmlFor={`f-${style.id}`}>What these pictures are for</label>
          <textarea id={`f-${style.id}`} key={style.feeling} rows={2} defaultValue={style.feeling} onBlur={(e) => edit({ feeling: e.target.value })} />

          <div className="row" style={{ marginTop: 12 }}>
            {settings.hasApiKey ? (
              <button className="primary" disabled={busy !== null} onClick={() => void develop()}>
                {busy === 'develop' ? 'Thinking…' : evidence() ? 'Refine with Claude from my culling' : 'Develop with Claude'}{' '}
                <span className="small" style={{ opacity: 0.7 }}>{estimateCost(settings.model, 1500 + (active && picks.length >= 6 ? 16 * 150 : 0), 3500)}</span>
              </button>
            ) : (
              <span className="muted small">Add an API key in Settings and Claude can develop this style with you.</span>
            )}
            <span className="muted small">Claude proposes chapters, emotions and markers; nothing changes until you accept.</span>
          </div>

          {proposal && (
            <div className="note teach" style={{ marginTop: 12 }}>
              <p>
                <b>Claude's proposal.</b> {proposal.notes}
              </p>
              <p className="small">{proposal.feeling}</p>
              <p className="small">
                <b>Chapters:</b> {proposal.chapters.map((c) => `${c.name}${c.must ? ' ★' : ''}`).join(' · ')}
              </p>
              <p className="small">
                <b>Emotions:</b> {proposal.emotions.map((e) => `${e.name} ${e.weight > 0 ? '+' : ''}${e.weight.toFixed(1)}`).join(' · ')}
              </p>
              <p className="small">
                <b>Look for:</b> {proposal.lookFor.join(' · ')}
              </p>
              <p className="small">
                <b>Forgive:</b> {proposal.forgive.join(' · ')}
              </p>
              <div className="row">
                <button className="primary" onClick={() => apply(proposal)}>
                  Accept
                </button>
                <button onClick={() => setProposal(null)}>Discard</button>
                {proposal.usage && <span className="muted small">Cost {formatCost(proposal.usage.costUsd)}</span>}
              </div>
            </div>
          )}

          <h3>Chapters<span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}> · tick the ones a shoot must not come back without</span></h3>
          {style.chapters.map((c, i) => (
            <div className="plan-row" key={i} style={{ gridTemplateColumns: '24px 220px 1fr auto' }}>
              <input type="checkbox" style={{ width: 'auto', marginTop: 10 }} checked={!!c.must} onChange={(e) => setChapter(i, { must: e.target.checked })} aria-label={`${c.name} must not be missed`} />
              <input value={c.name} aria-label="Chapter name" onChange={(e) => setChapter(i, { name: e.target.value })} />
              <textarea value={c.look} rows={2} aria-label="What makes a keeper" onChange={(e) => setChapter(i, { look: e.target.value })} />
              <button className="link small" onClick={() => edit({ chapters: style.chapters.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button onClick={() => edit({ chapters: [...style.chapters, { name: 'New chapter', look: '' }] })}>Add a chapter</button>

          <h3>Emotions this style looks for</h3>
          <p className="muted small">
            Right: what the picture is for. Left: works against it. Middle: no opinion. The dot shows what your own
            decisions in this style have added.
          </p>
          <div className="emo-grid">
            {names.map((n) => {
              const declared = style.emotions[n] ?? FAMILY_EMOTIONS[style.family]?.[n] ?? 0.45
              const lift = style.emotionLift?.[n]
              return (
                <div key={n} className="emo-row">
                  <span>{n}</span>
                  <input type="range" min={-1} max={1} step={0.1} value={declared} aria-label={`How much this style values ${n}`} onChange={(e) => edit({ emotions: { ...style.emotions, [n]: Number(e.target.value) } })} />
                  <span className="muted small" title={lift ? `Learned from ${lift.n} of your decisions` : 'Nothing learned from your decisions yet'}>
                    {(weights[n] ?? declared).toFixed(1)}
                    {lift && lift.n >= 8 ? (lift.w > 0.05 ? ' ↑' : lift.w < -0.05 ? ' ↓' : '') : ''}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="grid-2">
            <div>
              <label htmlFor={`l-${style.id}`}>
                Look for<span className="hint">one marker per line</span>
              </label>
              <textarea id={`l-${style.id}`} key={style.lookFor.join()} rows={4} defaultValue={style.lookFor.join('\n')} onBlur={(e) => edit({ lookFor: lines(e.target.value) })} />
            </div>
            <div>
              <label htmlFor={`g-${style.id}`}>
                Forgive<span className="hint">flaws that do not matter here</span>
              </label>
              <textarea id={`g-${style.id}`} key={style.forgive.join()} rows={4} defaultValue={style.forgive.join('\n')} onBlur={(e) => edit({ forgive: lines(e.target.value) })} />
            </div>
          </div>
          <label htmlFor={`b-${style.id}`}>
            Craft against moment<span className="hint">{Math.round(style.balance * 100)}% moment</span>
          </label>
          <input id={`b-${style.id}`} type="range" min={0.1} max={0.9} step={0.05} value={style.balance} onChange={(e) => edit({ balance: Number(e.target.value) })} style={{ maxWidth: 320, padding: 0, border: 0, background: 'none' }} />

          <h3>Learned from photographs</h3>
          {style.profile ? (
            <>
              <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18, margin: '0 0 8px' }}>
                {profileFacts(style.profile).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <div className="muted small">From: {style.sources.map((x) => `${x.name} (${x.count})`).join(', ')}</div>
              {style.samples.length > 0 && (
                <div className="film" style={{ marginTop: 8 }}>
                  {style.samples.slice(-14).map((id) => (
                    <img key={id} src={thumbUrl(styleCacheId(style.id), id)} alt="" style={{ width: 70, height: 48, objectFit: 'cover', borderRadius: 3 }} loading="lazy" />
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="muted small">Nothing yet. Add a folder of photographs in this style (yours or someone's you admire), or your picks from a project.</p>
          )}
          {style.essence && (
            <div className="note" style={{ marginTop: 10 }}>
              <p className="small">{style.essence.summary}</p>
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
                {style.essence.principles.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button
              disabled={learning.running}
              onClick={() =>
                void guard('gallery', async () => {
                  const folder = await window.studio.pickFolder()
                  if (folder) await addGallery(style.id, folder.split(/[\\/]/).pop() ?? 'Gallery', folder)
                })
              }
            >
              Learn from a folder of photographs…
            </button>
            {active && project && (
              <button onClick={() => void guard('picks', () => rememberPicks(style.id))} disabled={picks.length < 10} title={picks.length < 10 ? 'Needs at least ten picks' : ''}>
                Learn from my {picks.length} picks in “{project.name}”
              </button>
            )}
            {style.samples.length >= 6 && settings.hasApiKey && (
              <button disabled={busy !== null} onClick={() => void guard('distil', () => distil(style.id))}>
                {busy === 'distil' ? 'Distilling…' : 'Put the gallery into words'}
              </button>
            )}
            <div className="spacer" />
            {confirm ? (
              <>
                <button className="danger" onClick={() => void removeStyle(style.id)}>
                  Delete style
                </button>
                <button onClick={() => setConfirm(false)}>Keep</button>
              </>
            ) : (
              <button className="link small" onClick={() => setConfirm(true)}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
