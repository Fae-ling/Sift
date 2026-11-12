import { Happening } from '../components/Happening'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FaceInfo, Shot } from '@shared/types'
import { previewUrl } from '../analysis/pipeline'
import { BLINK_LIMIT } from '../analysis/scoring'
import { Thumb } from '../components/Thumb'
import { estimateCost, formatCost } from '../components/AiCost'
import { Icon } from '../components/Icon'
import { isHidden, READ_TOKENS, readCandidates, triage, useStore, visibleShots, type Filter, type TriageKind } from '../store'

/** The filters used all the time, shown as a segmented control. */
const MAIN_FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'suggested', label: 'Keepers', hint: 'The frames the cull would keep, plus your own picks' },
  { id: 'undecided', label: 'To decide', hint: 'Frames you have not picked or rejected' },
  { id: 'picks', label: 'Picks', hint: 'Frames you picked' },
  { id: 'all', label: 'All', hint: 'Every frame of the shoot' }
]
/** The filters for a particular check, kept in a menu. */
const MORE_FILTERS: { id: Filter; label: string; hint: string }[] = [
  { id: 'gems', label: 'Hidden gems', hint: 'Flawed frames that may hold a moment' },
  { id: 'key', label: 'Key people', hint: 'Frames with someone you marked as a key person' },
  { id: 'relook', label: 'Another look', hint: 'What a re-estimate of this project turned up: moments you kept nothing from that the app would now put forward, and picks it would now question' },
  { id: 'must', label: 'Must-have chapters', hint: 'Frames from chapters your style says must not be missed' },
  { id: 'unkept', label: 'Second look', hint: 'The strongest frame of every moment you kept nothing from' },
  { id: 'rejects', label: 'Rejects', hint: 'Frames you rejected' },
  { id: 'warnings', label: 'Flagged', hint: 'Closed eyes, soft, or badly exposed' }
]

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function Cull(): React.JSX.Element {
  const { project, selectedId, select, filter, setFilter, decide, acceptSuggestions, setView, chapter, setChapter, setRating, undo, redo, tasteData, setSceneChapter, deep, cancelDeepRead, relook } = useStore()
  const [showTriage, setShowTriage] = useState(false)
  const [compare, setCompare] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [showRead, setShowRead] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const shots = useMemo(() => project?.shots.filter((s) => s.analysis) ?? [], [project?.shots])
  const chapters = useMemo(() => [...new Set(shots.flatMap((s) => (s.chapter ?? s.read?.beat ? [(s.chapter ?? s.read?.beat)!] : [])))], [shots])
  // Bursts shown without a suggestion, so the choice made in them is the photographer's alone.
  const hidden = useMemo(() => {
    const ids = new Set<string>()
    if (project && tasteData.blindBursts) for (const s of shots) if (isHidden(project.id, s, shots)) ids.add(s.id)
    return ids
  }, [project?.id, shots, tasteData.blindBursts])
  const list = useMemo(() => {
    const shown = new Set(visibleShots(shots, filter, relook).map((s) => s.id))
    // A hidden burst must not give its suggestion away through the filters:
    // Keepers shows all of its frames, and the flaw filters show none.
    if (filter === 'suggested' || filter === 'unkept') for (const id of hidden) shown.add(id)
    if (filter === 'gems' || filter === 'warnings') for (const id of hidden) shown.delete(id)
    return shots.filter((s) => shown.has(s.id) && (!chapter || (s.chapter ?? s.read?.beat) === chapter))
  }, [shots, filter, chapter, hidden, relook])
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
      // What the photographer said about a scene outranks any number of guesses.
      if (s.chapter) {
        votes.set(s.sceneId ?? 0, new Map([[s.chapter, 1e6]]))
        continue
      }
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

  const planNames = useMemo(() => project?.storyPlan.map((c) => c.name) ?? [], [project?.storyPlan])

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
      // In a burst shown without a suggestion there is nothing to accept: the choice is the photographer's.
      else if (key === 'enter') hidden.has(current.id) || (acceptSuggestions(stack.map((s) => s.id)), moveStack(1))
      else if (key === 'z' || key === ' ') setZoom((z) => !z)
      else if (key === 'c') setCompare((c) => !c)
      else if (/^[0-5]$/.test(key)) setRating(current.id, Number(key))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, stack, hidden, move, moveStack, decide, acceptSuggestions, setRating, undo, redo])

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
    <div className={`cull ${showRead || showTriage ? 'with-read' : ''}`}>
      <div className="cull-bar">
        <div className="segmented" role="group" aria-label="Show">
          {MAIN_FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)} title={f.hint} aria-pressed={filter === f.id}>
              {f.label} <span className="n">{visibleShots(shots, f.id).length}</span>
            </button>
          ))}
        </div>
        <select
          className={`compact ${MORE_FILTERS.some((f) => f.id === filter) ? 'active' : ''}`}
          value={MORE_FILTERS.some((f) => f.id === filter) ? filter : ''}
          onChange={(e) => setFilter((e.target.value || 'suggested') as Filter)}
          aria-label="More filters"
          title="Filters for a particular check"
        >
          <option value="">More filters…</option>
          {MORE_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} ({visibleShots(shots, f.id).length})
            </option>
          ))}
        </select>
        {chapters.length > 0 && (
          <select className={`compact ${chapter ? 'active' : ''}`} value={chapter ?? ''} onChange={(e) => setChapter(e.target.value || null)} aria-label="Chapter" title="Show only frames from one chapter of the story">
            <option value="">All chapters</option>
            {chapters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <div className="progress" title={`${picks} picked, ${rejects} rejected, ${undecided} to decide`}>
          <span>
            <b style={{ color: 'var(--pick)' }}>{picks}</b>
            {target > 0 ? <span className="faint"> / {target}</span> : ''} picks
          </span>
          <div className="bar" aria-hidden="true">
            <div style={{ width: `${(100 * (picks + rejects)) / Math.max(1, shots.length)}%` }} />
          </div>
        </div>
        {deep.running && (
          <span className="faint small" title="Reading how the strongest frames of each moment are composed: separation from the background, what holds the eye">
            Reading composition {deep.done}/{deep.total}{' '}
            <button className="link small" onClick={cancelDeepRead}>
              stop
            </button>
          </span>
        )}

        <div className="spacer" />
        <CullSettings />
        <button className={`ghost ${showTriage ? 'on' : ''}`} onClick={() => (setShowTriage((v) => !v), setShowRead(false))} title="Reject misfires and unusable frames in one step" aria-label="Ultrafast cull" aria-expanded={showTriage}>
          <Icon name="bolt" /> <span className="label">Ultrafast cull</span>
        </button>
        <button className={`ghost ${showRead ? 'on' : ''}`} onClick={() => (setShowRead((v) => !v), setShowTriage(false))} title="Claude reads each moment: chapter, emotion, hidden gems" aria-label="Cull with Claude" aria-expanded={showRead}>
          <Icon name="sparkle" /> <span className="label">Cull with Claude</span>
        </button>
        <button className="primary" onClick={() => acceptSuggestions()} disabled={undecided === 0} title="Applies every suggestion to frames you have not decided yourself">
          Accept suggestions
        </button>
      </div>

      {showRead && <ReadPanel />}
      {showTriage && <TriagePanel onDone={() => setShowTriage(false)} />}

      <div className="strip" ref={stripRef}>
        {list.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nothing matches this filter.</p>}
        {scenes.map((scene) => (
          <SceneBlock
            key={scene.id}
            projectId={project.id}
            scene={scene}
            chapter={sceneBeat.get(scene.id) ?? ''}
            plan={planNames}
            // Only the scene holding the selection is given it, so moving through a large shoot redraws one scene, not all.
            selectedId={current && scene.stacks.some((st) => st.some((x) => x.id === current.id)) ? current.id : null}
            hidden={hidden}
            onSelect={select}
            onChapter={setSceneChapter}
          />
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
                      {s.name}
                      {!hidden.has(s.id) && <> · moment {s.score?.moment === null || !s.score ? '–' : Math.round(s.score.moment)} · craft {Math.round(s.score?.craft ?? 0)}</>}
                      {s.suggestion === 'pick' && !hidden.has(s.id) ? ' · suggested' : ''}
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
                  <Thumb projectId={project.id} shot={s} selected={s.id === current.id} onSelect={select} hide={hidden.has(s.id)} />
                  <div className="cap">
                    {hidden.has(s.id) ? '·' : Math.round(s.score?.overall ?? 0)}
                    {hidden.has(s.id) ? '' : s.suggestion === 'pick' ? ' · best' : s.suggestion === 'alternate' ? ' · close' : ''}
                  </div>
                </div>
              ))}
              {stack.length > 1 && (
                <div className="muted small" style={{ alignSelf: 'center', marginLeft: 8, maxWidth: 220 }}>
                  {hidden.has(current.id) ? (
                    <>Your call: no suggestion is shown for this moment. Pick the take you would keep.</>
                  ) : (
                    <>
                      {stack.length} takes of one moment. <kbd>Enter</kbd> keeps the best and moves on.
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <Inspector shot={current} projectId={project.id} hide={hidden.has(current.id)} />
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

const SUGGESTION_TEXT = {
  pick: 'Suggested keeper: the strongest frame of this moment.',
  alternate: 'Worth a look: close to the best, or flawed but holding a moment.',
  reject: 'Suggested reject: a stronger frame of this moment exists, or it has a flaw.'
}

const TAG_TEXT = { laugh: 'laughter', joy: 'joy', connection: 'connection', embrace: 'embrace', peak: 'peak of the burst', rare: 'rare in this shoot' }


function Inspector({ shot, projectId, hide }: { shot: Shot; projectId: string; hide: boolean }): React.JSX.Element {
  const { decide, setRating, taste, setFacePerson } = useStore()
  const score = shot.score
  const a = shot.analysis!
  const chapterName = shot.chapter ?? shot.read?.beat
  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b className="ellipsis" title={shot.name}>{shot.name}</b>
          <span className="faint small">{new Date(shot.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <div className="decide">
          <button className={shot.decision === 'pick' ? 'on pick' : ''} onClick={() => decide([shot.id], shot.decision === 'pick' ? null : 'pick')} aria-pressed={shot.decision === 'pick'}>
            Pick <kbd>P</kbd>
          </button>
          <button className={shot.decision === 'reject' ? 'on reject' : ''} onClick={() => decide([shot.id], shot.decision === 'reject' ? null : 'reject')} aria-pressed={shot.decision === 'reject'}>
            Reject <kbd>X</kbd>
          </button>
        </div>
        <div className="stars" role="group" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={n <= shot.rating ? 'on' : ''} onClick={() => setRating(shot.id, shot.rating === n ? 0 : n)} aria-label={`${n} stars`} aria-pressed={n <= shot.rating}>
              ★
            </button>
          ))}
        </div>
      </div>

      {score && hide && (
        <div className="note teach">
          <p className="small">
            <b>Your call.</b> No suggestion is shown for about one moment in ten, so your unprompted choice can be
            learned from. The app's view appears once you decide.
          </p>
        </div>
      )}
      {score && !hide && (
        <section className="insp-section">
          {shot.suggestion && <p className={`verdict ${shot.suggestion}`}>{SUGGESTION_TEXT[shot.suggestion]}</p>}
          <Meter label="Moment" value={score.moment} />
          <Meter label="Craft" value={score.craft} />
          {score.learned !== undefined && taste && <Meter label="Your taste" value={score.learned} />}
          {(score.gem || score.must || score.emotion || score.tags.length > 0 || chapterName) && (
            <div className="chips">
              {score.gem && <span className="chip gem">hidden gem</span>}
              {score.must && <span className="chip pick">must-have chapter</span>}
              {score.emotion && (
                <span className="chip">
                  {score.emotion.name} {Math.round(score.emotion.intensity * 100)}%
                </span>
              )}
              {score.tags.map((t) => (
                <span className="chip" key={t}>
                  {TAG_TEXT[t]}
                </span>
              ))}
              {chapterName && <span className="chip">{chapterName}</span>}
            </div>
          )}
          {shot.read && (
            <p className="small read-note">
              <b>Claude, {shot.read.moment}/10:</b> {shot.read.note}
            </p>
          )}
          <ul className="notes">
            {score.momentNotes.slice(0, 3).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <Happening shot={shot} hide={hide} />

      {a.faces.length > 0 && (
        <section className="insp-section">
          <h3>Faces{!hide && score?.faceEmotions ? <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · click an emotion to teach it</span> : ''}</h3>
          <FaceCrops src={previewUrl(projectId, shot.id)} faces={a.faces} emotions={hide ? undefined : score?.faceEmotions} teachable who={shot.people} onWho={(i, id) => setFacePerson(shot.id, i, id)} />
        </section>
      )}

      {score && !hide && (
        <details className="insp-section">
          <summary>
            <h3 style={{ margin: 0 }}>Craft in detail</h3>
          </summary>
          <Meter label="Focus" value={score.focus} />
          {score.faces !== null && <Meter label="Eyes" value={score.faces} />}
          <Meter label="Exposure" value={score.exposure} />
          <ul className="notes">
            {score.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {score.momentNotes.slice(3).map((n, i) => (
              <li key={`m${i}`}>{n}</li>
            ))}
          </ul>
          {score.learned !== undefined && taste && (
            <p className="faint small">
              Your taste: {taste.trust > 0 ? `counts for ${Math.round(taste.trust * 100)}% of this suggestion` : 'shown for interest; it has not yet earned a say in suggestions'}
              {score.learnedWhy?.length ? `. ${score.learnedWhy.join('; ')}.` : '.'}
            </p>
          )}
        </details>
      )}

      <details className="insp-section">
        <summary>
          <h3 style={{ margin: 0 }}>Capture</h3>
        </summary>
        <div className="small muted" style={{ lineHeight: 1.7 }}>
          {[shot.camera, shot.lens].filter(Boolean).join(' · ') || 'No camera data'}
          <br />
          {[shot.focal && `${Math.round(shot.focal)} mm`, shot.aperture && `f/${shot.aperture}`, shot.shutter && `${shot.shutter} s`, shot.iso && `ISO ${shot.iso}`].filter(Boolean).join(' · ')}
          <br />
          {new Date(shot.time).toLocaleString()} · {a.shotType}
        </div>
        <button className="link small" style={{ marginTop: 6 }} onClick={() => void window.studio.reveal(shot.path)}>
          Show file in folder
        </button>
      </details>

      <details className="insp-section">
        <summary>
          <h3 style={{ margin: 0 }}>Keyboard</h3>
        </summary>
        <dl className="keys">
          <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>previous / next frame</dd>
          <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>previous / next moment</dd>
          <dt><kbd>P</kbd> <kbd>X</kbd> <kbd>U</kbd></dt><dd>pick, reject, clear</dd>
          <dt><kbd>Enter</kbd></dt><dd>accept this moment's suggestion</dd>
          <dt><kbd>1</kbd>–<kbd>5</kbd></dt><dd>stars</dd>
          <dt><kbd>Z</kbd> <kbd>C</kbd></dt><dd>zoom, compare</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd></dt><dd>undo (with Shift: redo)</dd>
        </dl>
      </details>
    </div>
  )
}

/** Style and balance for this shoot: set once, so kept out of the way. */
function CullSettings(): React.JSX.Element {
  const { project, learned, chooseStyle, setBalance, setView } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])
  if (!project) return <></>
  const style = learned.styles.find((x) => project.styleIds.includes(x.id))
  return (
    <div className="popover-wrap" ref={ref}>
      <button className={`ghost ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} title="The style this shoot is culled in, and how much the moment counts">
        <Icon name="sliders" /> <span className="label ellipsis" style={{ maxWidth: 140 }}>{style?.name ?? 'No style'}</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Cull settings">
          <label htmlFor="cull-style">Shoot style</label>
          <select id="cull-style" value={project.styleIds[0] ?? ''} onChange={(e) => chooseStyle(e.target.value || null)} aria-label="Shoot style">
            <option value="">No style</option>
            {learned.styles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <p className="field-help">Sets the chapters, the emotions looked for, and the balance below.</p>
          <label htmlFor="cull-balance">Craft or moment</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="faint small">Craft</span>
            <input id="cull-balance" type="range" min={0} max={1} step={0.05} value={project.balance} onChange={(e) => setBalance(Number(e.target.value))} aria-label="Balance between craft and moment" />
            <span className="faint small">Moment</span>
          </div>
          <p className="field-help">How much the emotion and the moment count against sharpness and exposure.</p>
          <button className="link small" onClick={() => setView('profiles')}>
            Edit shoot styles
          </button>
        </div>
      )}
    </div>
  )
}

/** Enlarged crops of each face, so expression and focus can be judged without zooming. */
function FaceCrops({ src, faces, emotions, teachable, who, onWho }: { src: string; faces: FaceInfo[]; emotions?: (string | null)[]; teachable?: boolean; who?: (string | null)[]; onWho?: (face: number, personId: string | 'new' | null) => void }): React.JSX.Element {
  const { teachEmotion, emotions: store } = useStore()
  const people = useStore((x) => x.project?.people)
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const [teaching, setTeaching] = useState<number | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    let live = true
    setTeaching(null)
    // Fetched rather than loaded through an <img>, so a crop can be kept as a teaching example.
    void (async () => {
      const img = await createImageBitmap(await (await fetch(src)).blob())
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
      img.close()
    })()
    return () => {
      live = false
    }
  }, [src, faces])

  /** Teaches the emotion machine what this face shows, with a small picture of it as the example. */
  const teachFace = (i: number, emotion: string): void => {
    const f = faces[i]
    const canvas = refs.current[i]
    if (!f.shapes || !emotion.trim()) return
    const small = document.createElement('canvas')
    small.width = small.height = 88
    if (canvas) small.getContext('2d')!.drawImage(canvas, 0, 0, 88, 88)
    teachEmotion(emotion, f.shapes, canvas ? small.toDataURL('image/jpeg', 0.72) : undefined)
    setTeaching(null)
    setName('')
  }

  return (
    <>
      <div className="closeups">
        {faces.map((f, i) => {
          const emotion = emotions?.[i]
          return (
            <div key={i} className={`closeup ${f.blink > BLINK_LIMIT ? 'bad' : ''}`}>
              <canvas ref={(el) => void (refs.current[i] = el)} />
              {emotions && f.shapes ? (
                teachable ? (
                  <button className="link" style={{ fontSize: 10, display: 'block', width: '100%' }} title="Click to confirm or correct: this teaches the app" onClick={() => (setTeaching(teaching === i ? null : i), setName(emotion && emotion !== 'unnamed' ? emotion : ''))}>
                    {emotion ?? 'calm'}
                  </button>
                ) : (
                  <div>{emotion ?? 'calm'}</div>
                )
              ) : (
                <div>{f.blink > BLINK_LIMIT ? 'eyes closed' : f.smile > 0.5 ? 'smiling' : 'eyes open'}</div>
              )}
              {onWho && f.id && (
                <select className="who" value={who?.[i] ?? ''} onChange={(e) => onWho(i, (e.target.value || null) as string | 'new' | null)} aria-label="Who is this" title="Who this is. Correcting it teaches the app to tell this person apart.">
                  <option value="">someone</option>
                  {(people ?? []).map((p, k) => (
                    <option key={p.id} value={p.id}>
                      {p.name || `person ${k + 1}`}
                    </option>
                  ))}
                  <option value="new">a new person</option>
                </select>
              )}
            </div>
          )
        })}
      </div>
      {teaching !== null && (
        <form
          className="row"
          style={{ marginTop: 6 }}
          onSubmit={(e) => {
            e.preventDefault()
            teachFace(teaching, name)
          }}
        >
          <input list="cull-emotions" style={{ flex: 1 }} autoFocus placeholder="What does this face show?" value={name} onChange={(e) => setName(e.target.value)} aria-label="Emotion on this face" />
          <datalist id="cull-emotions">
            {store.concepts.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
          <button className="primary" disabled={!name.trim()}>
            Teach
          </button>
        </form>
      )}
    </>
  )
}

interface SceneData {
  id: number
  stacks: Shot[][]
}

/** One scene of the strip. Memoised so that a shoot of many thousand frames stays quick to move through. */
const SceneBlock = memo(function SceneBlock(props: {
  projectId: string
  scene: SceneData
  chapter: string
  plan: string[]
  selectedId: string | null
  hidden: Set<string>
  onSelect: (id: string) => void
  onChapter: (sceneId: number, chapter: string | null) => void
}): React.JSX.Element {
  const { scene, chapter, plan } = props
  return (
    <div className="scene">
      <div className="scene-head">
        <span>
          Scene {scene.id} · {time(scene.stacks[0][0].time)}
        </span>
        <select
          className="scene-chapter"
          value={plan.includes(chapter) ? chapter : ''}
          onChange={(e) => props.onChapter(scene.id, e.target.value || null)}
          aria-label={`Chapter of scene ${scene.id}`}
          title="Which chapter of the story this scene belongs to. Saying so lets the cull protect must-have chapters."
        >
          <option value="">{chapter && !plan.includes(chapter) ? chapter : 'chapter…'}</option>
          {plan.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {scene.stacks.map((st) => (
        <div className={`stack ${st.length > 1 ? 'multi' : ''}`} key={st[0].id}>
          {st.map((x) => (
            <Thumb key={x.id} projectId={props.projectId} shot={x} selected={x.id === props.selectedId} onSelect={props.onSelect} hide={props.hidden.has(x.id)} />
          ))}
        </div>
      ))}
    </div>
  )
})

const TRIAGE: { kind: TriageKind; label: string; hint: string; on: boolean }[] = [
  { kind: 'misfire', label: 'Misfires', hint: 'Black, white or blank frames', on: true },
  { kind: 'blurred', label: 'Blurred beyond use', hint: 'Far softer than everything around them, with no moment to excuse it', on: true },
  { kind: 'flawedTwin', label: 'Closed eyes or soft, with a better take', hint: 'A flawed frame of a moment that has a clean one', on: true },
  { kind: 'spare', label: 'Spare takes', hint: 'Clean frames of a moment whose best frame is already suggested. Leave off to choose between takes yourself.', on: false }
]

/** Rejects the frames that are certainly not keepers in one step, so attention goes to the rest. */
function TriagePanel({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { project, applyTriage, notify } = useStore()
  const [chosen, setChosen] = useState<Record<TriageKind, boolean>>(() => Object.fromEntries(TRIAGE.map((t) => [t.kind, t.on])) as Record<TriageKind, boolean>)
  const found = useMemo(() => triage(project?.shots ?? []), [project?.shots])
  const total = TRIAGE.reduce((n, t) => n + (chosen[t.kind] ? found[t.kind].length : 0), 0)
  return (
    <div className="triage">
      <b>Ultrafast cull.</b>
      {TRIAGE.map((t) => (
        <label key={t.kind} title={t.hint}>
          <input type="checkbox" checked={chosen[t.kind]} onChange={(e) => setChosen({ ...chosen, [t.kind]: e.target.checked })} />
          {t.label} <span className="muted">{found[t.kind].length}</span>
        </label>
      ))}
      <div className="spacer" />
      <span className="muted small">Never a hidden gem, a frame you decided, or the only frame of a must-have chapter. One Ctrl+Z undoes it.</span>
      <button
        className="primary"
        disabled={total === 0}
        onClick={() => {
          const n = applyTriage(TRIAGE.filter((t) => chosen[t.kind]).map((t) => t.kind))
          notify(`${n} frame${n === 1 ? '' : 's'} rejected. Ctrl+Z brings ${n === 1 ? 'it' : 'them'} back.`)
          onDone()
        }}
      >
        Reject {total} frames
      </button>
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
          {profile ? <> and the style “{profile.name}”</> : ', and your shoot style if you choose one'}. For every
          frame it says which chapter it belongs to, how much it carries, what emotion it shows and why, and it
          points out hidden gems. What it sees on faces also teaches the app's own emotion reading. Its read is folded into the Keepers; you still make every decision.
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
