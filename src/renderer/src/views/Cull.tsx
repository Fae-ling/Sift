import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FaceInfo, Shot } from '@shared/types'
import { previewUrl } from '../analysis/pipeline'
import { BLINK_LIMIT } from '../analysis/scoring'
import { Thumb } from '../components/Thumb'
import { estimateCost, formatCost } from '../components/AiCost'
import { READ_TOKENS, readCandidates, useStore, visibleShots, type Filter } from '../store'

const FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'suggested', label: 'Keepers', hint: 'The frames the cull would keep, plus your own picks' },
  { id: 'gems', label: 'Hidden gems', hint: 'Flawed frames that may hold a moment' },
  { id: 'unkept', label: 'Second look', hint: 'The strongest frame of every moment you kept nothing from: check here for a missed shot-list moment before you finish' },
  { id: 'undecided', label: 'Undecided', hint: 'Frames you have not picked or rejected' },
  { id: 'picks', label: 'Picks', hint: 'Frames you picked' },
  { id: 'rejects', label: 'Rejects', hint: 'Frames you rejected' },
  { id: 'warnings', label: 'Flagged', hint: 'Closed eyes, soft, or badly exposed' },
  { id: 'all', label: 'All', hint: 'Every frame of the shoot' }
]

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function Cull(): React.JSX.Element {
  const { project, selectedId, select, filter, setFilter, decide, acceptSuggestions, setView, setBalance, learned, chooseStyle, chapter, setChapter, setRating, undo, redo } = useStore()
  const [compare, setCompare] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [showRead, setShowRead] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const shots = useMemo(() => project?.shots.filter((s) => s.analysis) ?? [], [project?.shots])
  const chapters = useMemo(() => [...new Set(shots.flatMap((s) => (s.read ? [s.read.beat] : [])))], [shots])
  const list = useMemo(
    () => visibleShots(shots, filter).filter((s) => !chapter || s.read?.beat === chapter),
    [shots, filter, chapter]
  )
  const current = list.find((s) => s.id === selectedId) ?? list[0]
  const stack = useMemo(() => (current ? shots.filter((s) => s.stackId === current.stackId) : []), [shots, current])
  // What to compare against: the suggested frame of this moment, or the runner-up if this is it.
  const rival = useMemo(() => {
    if (!current) return undefined
    const ranked = stack.filter((s) => s.id !== current.id).sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0))
    return ranked.find((s) => s.suggestion === 'pick') ?? ranked[0]
  }, [stack, current])

  // The chapter each scene belongs to: whichever beat the editor's read named most often.
  const sceneBeat = useMemo(() => {
    const votes = new Map<number, Map<string, number>>()
    for (const s of shots) {
      if (!s.read || s.read.beat === 'Other') continue
      const m = votes.get(s.sceneId ?? 0) ?? new Map<string, number>()
      m.set(s.read.beat, (m.get(s.read.beat) ?? 0) + 1)
      votes.set(s.sceneId ?? 0, m)
    }
    return new Map([...votes].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1])[0][0]]))
  }, [shots])

  // Scenes -> stacks, for the visible shots.
  const scenes = useMemo(() => {
    const out: { id: number; stacks: Shot[][] }[] = []
    for (const s of list) {
      let scene = out[out.length - 1]
      if (!scene || scene.id !== s.sceneId) out.push((scene = { id: s.sceneId ?? 0, stacks: [] }))
      const last = scene.stacks[scene.stacks.length - 1]
      if (last && last[0].stackId === s.stackId) last.push(s)
      else scene.stacks.push([s])
    }
    return out
  }, [list])

  useEffect(() => {
    if (current) stripRef.current?.querySelector(`[data-shot="${current.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current?.id])

  const move = useCallback(
    (delta: number) => {
      if (!current) return
      const i = list.findIndex((s) => s.id === current.id)
      const next = list[Math.min(list.length - 1, Math.max(0, i + delta))]
      if (next) select(next.id)
    },
    [list, current, select]
  )

  const moveStack = useCallback(
    (dir: 1 | -1) => {
      if (!current) return
      let i = list.findIndex((s) => s.id === current.id)
      const here = current.stackId
      while (list[i] && list[i].stackId === here) i += dir
      if (!list[i]) return
      // Land on the first frame of that stack.
      const target = list[i].stackId
      while (dir === -1 && list[i - 1]?.stackId === target) i--
      select(list[i].id)
    },
    [list, current, select]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault()
        return redo()
      }
      if (!current || e.ctrlKey || e.metaKey || e.altKey) return
      if (key === 'arrowright') move(1)
      else if (key === 'arrowleft') move(-1)
      else if (key === 'arrowdown') moveStack(1)
      else if (key === 'arrowup') moveStack(-1)
      else if (key === 'p') (decide([current.id], 'pick'), move(1))
      else if (key === 'x') (decide([current.id], 'reject'), move(1))
      else if (key === 'u') decide([current.id], null)
      else if (key === 'enter') (acceptSuggestions(stack.map((s) => s.id)), moveStack(1))
      else if (key === 'z' || key === ' ') setZoom((z) => !z)
      else if (key === 'c') setCompare((c) => !c)
      else if (/^[0-5]$/.test(key)) setRating(current.id, Number(key))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, stack, move, moveStack, decide, acceptSuggestions, setRating, undo, redo])

  if (!project) return <></>
  if (shots.length === 0) {
    return (
      <div className="empty">
        <div>
          <p>No frames yet.</p>
          <button className="primary" onClick={() => setView('import')}>
            Import a shoot
          </button>
        </div>
      </div>
    )
  }

  const picks = shots.filter((s) => s.decision === 'pick').length
  const rejects = shots.filter((s) => s.decision === 'reject').length
  const undecided = shots.length - picks - rejects
  const target = project.brief.targetCount

  return (
    <div className={`cull ${showRead ? 'with-read' : ''}`}>
      <div className="cull-bar">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)} title={f.hint}>
              {f.label}
              <span className="muted"> {visibleShots(shots, f.id).length}</span>
            </button>
          ))}
        </div>
        {chapters.length > 0 && (
          <select value={chapter ?? ''} onChange={(e) => setChapter(e.target.value || null)} aria-label="Chapter" title="Show only frames from one chapter of the story">
            <option value="">All chapters</option>
            {chapters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <span className="small">
          <span style={{ color: 'var(--pick)' }}>{picks} picks</span>
          {target > 0 && <span className="muted"> / {target} target</span>} · <span style={{ color: 'var(--reject)' }}>{rejects} rejected</span> ·{' '}
          <span className="muted">{undecided} to decide</span>
        </span>
        <div className="spacer" />
        <select
          value={project.styleIds[0] ?? ''}
          onChange={(e) => chooseStyle(e.target.value || null)}
          aria-label="Culling profile"
          title="The feeling this shoot is culled for. Manage profiles under Culling profiles."
        >
          <option value="">No profile</option>
          {learned.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="balance" title="How much the moment counts against technical quality when suggesting keepers">
          <span className="muted small">Craft</span>
          <input type="range" min={0} max={1} step={0.05} value={project.balance} onChange={(e) => setBalance(Number(e.target.value))} aria-label="Balance between craft and moment" />
          <span className="muted small">Moment</span>
        </label>
        <button className={showRead ? 'on' : ''} onClick={() => setShowRead((v) => !v)}>
          Cull with Claude
        </button>
        <button onClick={() => acceptSuggestions()} disabled={undecided === 0} title="Applies every suggestion to frames you have not decided yourself">
          Accept all remaining suggestions
        </button>
        <button className="primary" onClick={() => setView('story')} disabled={picks === 0}>
          Build the story
        </button>
      </div>

      {showRead && <ReadPanel />}

      <div className="strip" ref={stripRef}>
        {list.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nothing matches this filter.</p>}
        {scenes.map((scene) => (
          <div className="scene" key={scene.id}>
            <div className="scene-head">
              <span>
                Scene {scene.id} · {time(scene.stacks[0][0].time)}
                {sceneBeat.has(scene.id) && <b style={{ color: 'var(--text)' }}> · {sceneBeat.get(scene.id)}</b>}
              </span>
              <span>
                {scene.stacks.length} moment{scene.stacks.length === 1 ? '' : 's'}
              </span>
            </div>
            {scene.stacks.map((st) => (
              <div className={`stack ${st.length > 1 ? 'multi' : ''}`} key={st[0].id}>
                {st.map((s) => (
                  <Thumb key={s.id} projectId={project.id} shot={s} selected={s.id === current?.id} onSelect={select} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {current ? (
        <>
          <div className="loupe">
            {compare && rival ? (
              <div className="two-up" title="Press C to leave compare">
                {[current, rival].map((s) => (
                  <figure key={s.id} className={s.id === current.id ? 'here' : ''} onClick={() => select(s.id)}>
                    <img src={previewUrl(project.id, s.id)} alt={s.name} draggable={false} />
                    <figcaption>
                      {s.name} · moment {s.score?.moment === null || !s.score ? '–' : Math.round(s.score.moment)} · craft {Math.round(s.score?.craft ?? 0)}
                      {s.suggestion === 'pick' ? ' · suggested' : ''}
                      {s.decision ? ` · ${s.decision}` : ''}
                    </figcaption>
                    <FaceCrops src={previewUrl(project.id, s.id)} faces={s.analysis!.faces.slice(0, 6)} />
                  </figure>
                ))}
              </div>
            ) : (
              <div className={`loupe-img ${zoom ? 'zoom' : ''}`} onClick={() => setZoom((z) => !z)} title="Click or press Z to zoom">
              <div className="frame">
                <img src={previewUrl(project.id, current.id)} alt={current.name} draggable={false} />
                {!zoom &&
                  current.analysis!.faces.map((f, i) => (
                    <div
                      key={i}
                      className={`facebox ${f.blink > BLINK_LIMIT ? 'bad' : ''}`}
                      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                    />
                  ))}
              </div>
            </div>
            )}
            <div className="compare">
              {stack.map((s) => (
                <div key={s.id}>
                  <Thumb projectId={project.id} shot={s} selected={s.id === current.id} onSelect={select} />
                  <div className="cap">
                    {Math.round(s.score?.overall ?? 0)}
                    {s.suggestion === 'pick' ? ' · best' : s.suggestion === 'alternate' ? ' · close' : ''}
                  </div>
                </div>
              ))}
              {stack.length > 1 && (
                <div className="muted small" style={{ alignSelf: 'center', marginLeft: 8, maxWidth: 220 }}>
                  {stack.length} takes of one moment. <kbd>Enter</kbd> keeps the best and moves on.
                </div>
              )}
            </div>
          </div>
          <Inspector shot={current} projectId={project.id} />
        </>
      ) : (
        <div className="empty" style={{ gridColumn: '2 / -1' }}>Nothing matches this filter.</div>
      )}
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number | null }): React.JSX.Element {
  if (value === null) {
    return (
      <div className="meter">
        <span className="muted">{label}</span>
        <span className="muted small">not measurable here</span>
        <span />
      </div>
    )
  }
  const v = Math.round(value)
  return (
    <div className="meter">
      <span className="muted">{label}</span>
      <div className="bar">
        <div className={v < 45 ? 'low' : v < 70 ? 'mid' : 'high'} style={{ width: `${v}%` }} />
      </div>
      <span>{v}</span>
    </div>
  )
}

const TAG_TEXT = { laugh: 'laughter', joy: 'joy', connection: 'connection', embrace: 'embrace', peak: 'peak of the burst' }

const SUGGESTION_TEXT = {
  pick: 'Suggested keeper: the strongest frame of this moment.',
  alternate: 'Worth a look: nearly as strong as the suggested keeper, or flawed but holding a moment. Compare expression and gesture.',
  reject: 'Suggested reject: a stronger frame of the same moment exists, or it has a flaw.'
}

function Inspector({ shot, projectId }: { shot: Shot; projectId: string }): React.JSX.Element {
  const { decide, setRating } = useStore()
  const score = shot.score
  const a = shot.analysis!
  return (
    <div className="inspector">
      <div style={{ fontWeight: 600 }}>{shot.name}</div>
      <div className="muted small">
        {new Date(shot.time).toLocaleString()} · {a.shotType}
      </div>

      <div className="decide">
        <button className={shot.decision === 'pick' ? 'on pick' : ''} onClick={() => decide([shot.id], shot.decision === 'pick' ? null : 'pick')}>
          Pick <kbd>P</kbd>
        </button>
        <button className={shot.decision === 'reject' ? 'on reject' : ''} onClick={() => decide([shot.id], shot.decision === 'reject' ? null : 'reject')}>
          Reject <kbd>X</kbd>
        </button>
      </div>
      <div className="row" style={{ gap: 2 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="link" style={{ fontSize: 18, textDecoration: 'none', color: n <= shot.rating ? '#fff' : '#555' }} onClick={() => setRating(shot.id, shot.rating === n ? 0 : n)} aria-label={`${n} stars`}>
            ★
          </button>
        ))}
      </div>

      {score && (
        <>
          <h3>Why</h3>
          {shot.suggestion && <p className="small">{SUGGESTION_TEXT[shot.suggestion]}</p>}
          <Meter label="Moment" value={score.moment} />
          <Meter label="Craft" value={score.craft} />
          <div style={{ margin: '8px 0' }}>
            {score.gem && <span className="chip gem">hidden gem</span>}
            {score.tags.map((t) => (
              <span className="chip" key={t}>
                {TAG_TEXT[t]}
              </span>
            ))}
            {shot.read && <span className="chip">{shot.read.beat}</span>}
          </div>
          {shot.read && (
            <div className="note teach">
              <p className="small">
                <b>Editor's read ({shot.read.moment}/10).</b> {shot.read.note}
              </p>
            </div>
          )}
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
            {score.momentNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <h3>Craft in detail</h3>
          <Meter label="Focus" value={score.focus} />
          {score.faces !== null && <Meter label="Eyes" value={score.faces} />}
          <Meter label="Exposure" value={score.exposure} />
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
            {score.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="muted small">
            Craft is measured; the moment is only partly measurable. A frame can score low on both and still be the one.
            The numbers are there to save you time on the obvious, not to make the choice.
          </p>
        </>
      )}

      {a.faces.length > 0 && (
        <>
          <h3>Faces</h3>
          <FaceCrops src={previewUrl(projectId, shot.id)} faces={a.faces} />
        </>
      )}

      <h3>Capture</h3>
      <div className="small muted" style={{ lineHeight: 1.6 }}>
        {[shot.camera, shot.lens].filter(Boolean).join(' · ')}
        <br />
        {[shot.focal && `${Math.round(shot.focal)} mm`, shot.aperture && `f/${shot.aperture}`, shot.shutter && `${shot.shutter} s`, shot.iso && `ISO ${shot.iso}`].filter(Boolean).join(' · ')}
      </div>
      <button className="link small" style={{ marginTop: 6 }} onClick={() => void window.studio.reveal(shot.path)}>
        Show file in folder
      </button>

      <h3>Keys</h3>
      <div className="small muted" style={{ lineHeight: 2 }}>
        <kbd>←</kbd> <kbd>→</kbd> frame · <kbd>↑</kbd> <kbd>↓</kbd> moment
        <br />
        <kbd>P</kbd> pick · <kbd>X</kbd> reject · <kbd>U</kbd> clear
        <br />
        <kbd>Enter</kbd> accept suggestion for this moment
        <br />
        <kbd>1</kbd>–<kbd>5</kbd> stars · <kbd>Z</kbd> zoom · <kbd>C</kbd> compare
        <br />
        <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo
      </div>
    </div>
  )
}

/** Enlarged crops of each face, so expression and focus can be judged without zooming. */
function FaceCrops({ src, faces }: { src: string; faces: FaceInfo[] }): React.JSX.Element {
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => {
      if (!live) return
      faces.forEach((f, i) => {
        const c = refs.current[i]
        if (!c) return
        const size = Math.max(f.w * img.width, f.h * img.height) * 1.25
        const cx = (f.x + f.w / 2) * img.width
        const cy = (f.y + f.h / 2) * img.height
        c.width = c.height = 168
        c.getContext('2d')!.drawImage(img, cx - size / 2, cy - size / 2, size, size, 0, 0, 168, 168)
      })
    }
    img.src = src
    return () => {
      live = false
    }
  }, [src, faces])
  return (
    <div className="closeups">
      {faces.map((f, i) => (
        <div key={i} className={`closeup ${f.blink > BLINK_LIMIT ? 'bad' : ''}`}>
          <canvas ref={(el) => void (refs.current[i] = el)} />
          <div>{f.blink > BLINK_LIMIT ? 'eyes closed' : f.smile > 0.5 ? 'smiling' : 'eyes open'}</div>
        </div>
      ))}
    </div>
  )
}

/** Explains the paid editor's read, shows its cost before and after, and runs it. */
function ReadPanel(): React.JSX.Element {
  const { project, settings, reading, readShoot, cancelRead, setView, learned } = useStore()
  if (!project) return <></>
  const profile = learned.styles.find((s) => project.styleIds.includes(s.id))
  const todo = readCandidates(project.shots)
  const read = project.shots.filter((s) => s.read).length
  const chunks = Math.ceil(todo.length / READ_TOKENS.chunk)
  const estimate = estimateCost(
    settings.model,
    todo.length * READ_TOKENS.inPerFrame + chunks * READ_TOKENS.inPerChunk,
    todo.length * READ_TOKENS.outPerFrame + chunks * READ_TOKENS.outPerChunk
  )
  return (
    <div className="read-panel">
      <div style={{ flex: 1, minWidth: 280 }}>
        <b>Cull with Claude.</b>{' '}
        <span className="muted">
          Claude looks at one to three small thumbnails of each moment, knowing your brief, your story plan
          {profile ? <> and the profile “{profile.name}”</> : ', and your culling profile if you choose one'}. For every
          frame it says which chapter it belongs to, how much it carries for this feeling, and why, and it points out
          hidden gems. Its read is folded into the Keepers; you still make every decision.
        </span>
        {read > 0 && (
          <span className="muted">
            {' '}
            {read} frames read so far, {formatCost(project.readCostUsd)} spent on this project.
          </span>
        )}
      </div>
      {reading.running ? (
        <div className="row">
          <span>
            Reading {reading.done} of {reading.total}…
          </span>
          <button onClick={cancelRead}>Pause after this batch</button>
        </div>
      ) : !settings.hasApiKey ? (
        <button onClick={() => setView('settings')}>Add an API key in Settings</button>
      ) : todo.length === 0 ? (
        <span className="muted">Every moment has been read.</span>
      ) : (
        <div className="row">
          <span className="muted small">
            {todo.length} frames · {estimate}
          </span>
          <button className="primary" onClick={() => void readShoot()}>
            {read ? 'Read the rest' : 'Read the shoot'}
          </button>
        </div>
      )}
    </div>
  )
}
