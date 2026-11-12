import { useEffect, useState } from 'react'
import { styleCacheId, type Beat, type Genre, type Style, type StyleProposal } from '@shared/types'
import { FAMILY_EMOTIONS } from '../analysis/emotion'
import { tendencies } from '../analysis/learner'
import { thumbUrl } from '../analysis/pipeline'
import { emotionLifts, emotionWeights, profileFacts } from '../analysis/style'
import { estimateCost, formatCost } from '../components/AiCost'
import { PageHeader } from '../components/PageHeader'
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
  const { learned, learning, project, createProfile } = useStore()
  const [selected, setSelected] = useState<string | null>(project?.styleIds[0] ?? learned.styles[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [feeling, setFeeling] = useState('')
  const [family, setFamily] = useState<Genre>('event')
  const style = learned.styles.find((x) => x.id === selected) ?? learned.styles[0]

  // If the selected style is deleted, fall back to the first.
  useEffect(() => {
    if (selected && !learned.styles.some((x) => x.id === selected)) setSelected(learned.styles[0]?.id ?? null)
  }, [learned.styles, selected])

  return (
    <div className="split">
      <aside className="split-list" aria-label="Shoot styles">
        <div className="row" style={{ justifyContent: 'space-between', padding: '4px 10px 10px' }}>
          <h3 style={{ margin: 0 }}>Styles</h3>
          <button className="sm" onClick={() => setCreating(true)}>
            New style
          </button>
        </div>
        {learned.styles.map((x) => (
          <button key={x.id} className={`item ${!creating && style?.id === x.id ? 'on' : ''}`} onClick={() => (setSelected(x.id), setCreating(false))} aria-current={!creating && style?.id === x.id}>
            <b>
              {x.name}
              {project?.styleIds.includes(x.id) && <span className="active-dot" title={`Used for “${project.name}”`} />}
            </b>
            <small>
              {x.chapters.length} chapters · {x.chapters.filter((c) => c.must).length} must-have
              {x.sources.length ? ` · learned from ${x.sources.reduce((n, s) => n + s.count, 0)}` : ''}
            </small>
          </button>
        ))}
      </aside>

      <div className="split-detail">
        <div className="page wide" style={{ maxWidth: 900 }}>
          {creating || !style ? (
            <>
              <PageHeader title="New shoot style" lead="A kind of work you do: a wedding, a LARP battle, a boudoir session, a birthday. Give it a name and a sentence; Claude can develop the rest, and it learns from every shoot you cull in it." />
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim()) return
                  void createProfile(name.trim(), family, feeling.trim(), []).then((id) => (setSelected(id), setCreating(false)))
                  setName('')
                  setFeeling('')
                }}
              >
                <label htmlFor="new-name">Name</label>
                <input id="new-name" autoFocus placeholder="e.g. Medieval battle re-enactment" value={name} onChange={(e) => setName(e.target.value)} aria-label="Style name" />
                <label htmlFor="new-family">
                  Closest kind of work<span className="hint">sets sensible starting weights</span>
                </label>
                <select id="new-family" style={{ maxWidth: 320 }} value={family} onChange={(e) => setFamily(e.target.value as Genre)} aria-label="Closest kind of work">
                  {FAMILIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="new-feeling">What are these pictures for?</label>
                <input id="new-feeling" placeholder="In a sentence: what they are for, and what they should feel like" value={feeling} onChange={(e) => setFeeling(e.target.value)} aria-label="What the style is for" />
                <div className="row" style={{ marginTop: 20 }}>
                  <button className="primary" disabled={!name.trim()}>
                    Create style
                  </button>
                  {style && (
                    <button type="button" className="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <StyleEditor key={style.id} style={style} />
          )}
          {learning.running && (
            <div className="card" style={{ marginTop: 16 }}>
              Studying the photographs: {learning.done} of {learning.total}
              <div className="bar" style={{ marginTop: 8 }}>
                <div style={{ width: `${(100 * learning.done) / Math.max(1, learning.total)}%` }} />
              </div>
            </div>
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

type Tab = 'overview' | 'chapters' | 'emotions' | 'markers' | 'learning'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'emotions', label: 'Emotions' },
  { id: 'markers', label: 'Markers' },
  { id: 'learning', label: 'Learning' }
]

function StyleEditor({ style }: { style: Style }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
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

  const developButton = settings.hasApiKey ? (
    <button className="primary" disabled={busy !== null} onClick={() => void develop()}>
      {busy === 'develop' ? 'Thinking…' : evidence() ? 'Refine with Claude' : 'Develop with Claude'}
      <span className="small" style={{ opacity: 0.65 }}>{estimateCost(settings.model, 1500 + (active && picks.length >= 6 ? 16 * 150 : 0), 3500)}</span>
    </button>
  ) : null

  return (
    <>
      <PageHeader title={style.name} lead={style.feeling || 'No description yet.'}>
        {project && (
          <button className={active ? 'on' : ''} onClick={() => chooseStyle(active ? null : style.id)} title={active ? `Stop using this style for “${project.name}”` : `Cull “${project.name}” in this style`}>
            {active ? `Used for “${project.name}”` : 'Use for this project'}
          </button>
        )}
        {developButton}
      </PageHeader>

      {proposal && (
        <div className="note teach">
          <p>
            <b>Claude's proposal.</b> {proposal.notes}
          </p>
          <p className="small">{proposal.feeling}</p>
          <p className="small">
            <b>Chapters:</b> {proposal.chapters.map((c) => `${c.name}${c.must ? ' ★' : ''}`).join(' · ')}
          </p>
          <p className="small">
            <b>Emotions:</b> {proposal.emotions.map((x) => `${x.name} ${x.weight > 0 ? '+' : ''}${x.weight.toFixed(1)}`).join(' · ')}
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
            <button className="ghost" onClick={() => setProposal(null)}>
              Discard
            </button>
            {proposal.usage && <span className="faint small">Cost {formatCost(proposal.usage.costUsd)}</span>}
          </div>
        </div>
      )}
      {!settings.hasApiKey && <p className="faint small">With an API key (Settings), Claude can develop this style with you. Nothing changes until you accept.</p>}

      <div className="tabbar" role="tablist" aria-label="Style">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div role="tabpanel">
          <div className="grid-2">
            <div>
              <label htmlFor={`n-${style.id}`} style={{ marginTop: 0 }}>Name</label>
              <input id={`n-${style.id}`} defaultValue={style.name} onBlur={(ev) => ev.target.value.trim() && edit({ name: ev.target.value.trim() })} />
            </div>
            <div>
              <label htmlFor={`t-${style.id}`} style={{ marginTop: 0 }}>
                Atmosphere<span className="hint">comma separated</span>
              </label>
              <input id={`t-${style.id}`} key={style.tags.join()} defaultValue={style.tags.join(', ')} onBlur={(ev) => edit({ tags: splitTags(ev.target.value) })} />
            </div>
          </div>
          <label htmlFor={`f-${style.id}`}>What these pictures are for</label>
          <textarea id={`f-${style.id}`} key={style.feeling} rows={2} defaultValue={style.feeling} onBlur={(ev) => edit({ feeling: ev.target.value })} />
          <label htmlFor={`b-${style.id}`}>
            Craft or moment<span className="hint">{Math.round(style.balance * 100)}% moment</span>
          </label>
          <div className="row" style={{ maxWidth: 420, flexWrap: 'nowrap' }}>
            <span className="faint small">Craft</span>
            <input id={`b-${style.id}`} type="range" min={0.1} max={0.9} step={0.05} value={style.balance} onChange={(ev) => edit({ balance: Number(ev.target.value) })} />
            <span className="faint small">Moment</span>
          </div>
          <p className="field-help">How much emotion and the moment count against sharpness and exposure when this style suggests keepers.</p>

          <div className="section" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            {confirm ? (
              <div className="row">
                <span className="small">Delete “{style.name}”? Projects that use it keep their chapters.</span>
                <button className="danger" onClick={() => void removeStyle(style.id)}>
                  Delete style
                </button>
                <button className="ghost" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="ghost danger" onClick={() => setConfirm(true)}>
                Delete style…
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'chapters' && (
        <div role="tabpanel">
          <p className="muted small">The chapters a shoot in this style contains, in order. Tick the ones a shoot must not come back without: the cull protects their frames.</p>
          <div className="plan-row with-must faint small" style={{ marginBottom: 4 }}>
            <span title="Must not be missed">Must</span>
            <span>Chapter</span>
            <span>What makes a keeper</span>
            <span />
          </div>
          {style.chapters.map((c, i) => (
            <div className="plan-row with-must" key={i}>
              <span className="must">
                <input type="checkbox" checked={!!c.must} onChange={(ev) => setChapter(i, { must: ev.target.checked })} aria-label={`${c.name} must not be missed`} />
              </span>
              <input value={c.name} aria-label="Chapter name" onChange={(ev) => setChapter(i, { name: ev.target.value })} />
              <textarea value={c.look} rows={2} aria-label="What makes a keeper" onChange={(ev) => setChapter(i, { look: ev.target.value })} />
              <button className="ghost remove" onClick={() => edit({ chapters: style.chapters.filter((_, j) => j !== i) })} aria-label={`Remove ${c.name}`} title="Remove chapter">
                ×
              </button>
            </div>
          ))}
          <button onClick={() => edit({ chapters: [...style.chapters, { name: 'New chapter', look: '' }] })}>Add a chapter</button>
        </div>
      )}

      {tab === 'emotions' && (
        <div role="tabpanel">
          <p className="muted small">
            How much this style values each emotion: right is what the picture is for, left works against it, middle is
            no opinion. An arrow shows where your own decisions in this style have moved it.
          </p>
          <div className="emo-grid">
            {names.map((n) => {
              const declared = style.emotions[n] ?? FAMILY_EMOTIONS[style.family]?.[n] ?? 0.45
              const lift = style.emotionLift?.[n]
              return (
                <div key={n} className="emo-row">
                  <span>{n}</span>
                  <input type="range" min={-1} max={1} step={0.1} value={declared} aria-label={`How much this style values ${n}`} onChange={(ev) => edit({ emotions: { ...style.emotions, [n]: Number(ev.target.value) } })} />
                  <span className="faint small" title={lift ? `Learned from ${lift.n} of your decisions` : 'Nothing learned from your decisions yet'}>
                    {(weights[n] ?? declared).toFixed(1)}
                    {lift && lift.n >= 8 ? (lift.w > 0.05 ? ' ↑' : lift.w < -0.05 ? ' ↓' : '') : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'markers' && (
        <div role="tabpanel" className="grid-2">
          <div>
            <label htmlFor={`l-${style.id}`} style={{ marginTop: 0 }}>
              Look for<span className="hint">one per line</span>
            </label>
            <textarea id={`l-${style.id}`} key={style.lookFor.join()} rows={8} defaultValue={style.lookFor.join('\n')} onBlur={(ev) => edit({ lookFor: lines(ev.target.value) })} />
          </div>
          <div>
            <label htmlFor={`g-${style.id}`} style={{ marginTop: 0 }}>
              Forgive<span className="hint">flaws that do not matter here</span>
            </label>
            <textarea id={`g-${style.id}`} key={style.forgive.join()} rows={8} defaultValue={style.forgive.join('\n')} onBlur={(ev) => edit({ forgive: lines(ev.target.value) })} />
          </div>
          <p className="field-help" style={{ gridColumn: '1 / -1' }}>Claude reads these when it culls in this style.</p>
        </div>
      )}

      {tab === 'learning' && (
        <div role="tabpanel">
          {style.profile ? (
            <>
              <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18, margin: '0 0 8px' }}>
                {profileFacts(style.profile).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <p className="faint small">From: {style.sources.map((x) => `${x.name} (${x.count})`).join(', ')}</p>
              {style.samples.length > 0 && (
                <div className="film" style={{ marginTop: 8 }}>
                  {style.samples.slice(-16).map((id) => (
                    <img key={id} src={thumbUrl(styleCacheId(style.id), id)} alt="" style={{ width: 76, height: 52, objectFit: 'cover', borderRadius: 4 }} loading="lazy" />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>Nothing learned from photographs yet.</p>
              <p className="small">Add a folder of work in this style, yours or someone's you admire, or your picks from a project.</p>
            </div>
          )}
          {style.essence && (
            <div className="note" style={{ marginTop: 12 }}>
              <p className="small">{style.essence.summary}</p>
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
                {style.essence.principles.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
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
                Learn from my {picks.length} picks
              </button>
            )}
            {style.samples.length >= 6 && settings.hasApiKey && (
              <button className="ghost" disabled={busy !== null} onClick={() => void guard('distil', () => distil(style.id))}>
                {busy === 'distil' ? 'Distilling…' : 'Put the photographs into words'}
              </button>
            )}
          </div>
          <p className="field-help">Sift measures the photographs and keeps a few small thumbnails; the files are never changed or shared.</p>
        </div>
      )}
    </>
  )
}
