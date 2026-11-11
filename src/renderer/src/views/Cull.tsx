import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FaceInfo, Shot } from '@shared/types'
import { previewUrl } from '../analysis/pipeline'
import { BLINK_LIMIT } from '../analysis/scoring'
import { Thumb } from '../components/Thumb'
import { useStore, visibleShots, type Filter } from '../store'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'suggested', label: 'Suggested' },
  { id: 'undecided', label: 'Undecided' },
  { id: 'picks', label: 'Picks' },
  { id: 'rejects', label: 'Rejects' },
  { id: 'warnings', label: 'Flagged' }
]

const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function Cull(): React.JSX.Element {
  const { project, selectedId, select, filter, setFilter, decide, updateShot, acceptSuggestions, setView } = useStore()
  const [zoom, setZoom] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const shots = useMemo(() => project?.shots.filter((s) => s.analysis) ?? [], [project?.shots])
  const list = useMemo(() => visibleShots(shots, filter), [shots, filter])
  const current = list.find((s) => s.id === selectedId) ?? list[0]
  const stack = useMemo(() => (current ? shots.filter((s) => s.stackId === current.stackId) : []), [shots, current])

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
      if (!current || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      if (key === 'arrowright') move(1)
      else if (key === 'arrowleft') move(-1)
      else if (key === 'arrowdown') moveStack(1)
      else if (key === 'arrowup') moveStack(-1)
      else if (key === 'p') (decide([current.id], 'pick'), move(1))
      else if (key === 'x') (decide([current.id], 'reject'), move(1))
      else if (key === 'u') decide([current.id], null)
      else if (key === 'enter') (acceptSuggestions(stack.map((s) => s.id)), moveStack(1))
      else if (key === 'z' || key === ' ') setZoom((z) => !z)
      else if (/^[0-5]$/.test(key)) updateShot(current.id, { rating: Number(key) })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, stack, move, moveStack, decide, acceptSuggestions, updateShot])

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
    <div className="cull">
      <div className="cull-bar">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="small">
          <span style={{ color: 'var(--pick)' }}>{picks} picks</span>
          {target > 0 && <span className="muted"> / {target} target</span>} · <span style={{ color: 'var(--reject)' }}>{rejects} rejected</span> ·{' '}
          <span className="muted">{undecided} to decide</span>
        </span>
        <div className="spacer" />
        <button onClick={() => acceptSuggestions()} disabled={undecided === 0} title="Applies every suggestion to frames you have not decided yourself">
          Accept all remaining suggestions
        </button>
        <button className="primary" onClick={() => setView('story')} disabled={picks === 0}>
          Build the story
        </button>
      </div>

      <div className="strip" ref={stripRef}>
        {list.length === 0 && <p className="muted small" style={{ padding: 8 }}>Nothing matches this filter.</p>}
        {scenes.map((scene) => (
          <div className="scene" key={scene.id}>
            <div className="scene-head">
              <span>
                Scene {scene.id} · {time(scene.stacks[0][0].time)}
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

function Meter({ label, value }: { label: string; value: number }): React.JSX.Element {
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
  alternate: 'Close second: nearly as strong as the suggested keeper. Compare expression and gesture.',
  reject: 'Suggested reject: a stronger frame of the same moment exists, or it has a flaw.'
}

function Inspector({ shot, projectId }: { shot: Shot; projectId: string }): React.JSX.Element {
  const { decide, updateShot } = useStore()
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
          <button key={n} className="link" style={{ fontSize: 18, textDecoration: 'none', color: n <= shot.rating ? '#fff' : '#555' }} onClick={() => updateShot(shot.id, { rating: shot.rating === n ? 0 : n })} aria-label={`${n} stars`}>
            ★
          </button>
        ))}
      </div>

      {score && (
        <>
          <h3>Why</h3>
          {shot.suggestion && <p className="small">{SUGGESTION_TEXT[shot.suggestion]}</p>}
          <Meter label="Overall" value={score.overall} />
          <Meter label="Focus" value={score.focus} />
          {score.faces !== null && <Meter label="Faces" value={score.faces} />}
          <Meter label="Exposure" value={score.exposure} />
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
            {score.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="muted small">
            Focus is measured against the sharpest frames of the same scene. These numbers describe craft, not meaning:
            a technically weaker frame with the right gesture is still the right frame.
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
        <kbd>P</kbd> pick · <kbd>X</kbd> reject · <kbd>U</kbd> undo
        <br />
        <kbd>Enter</kbd> accept suggestion for this moment
        <br />
        <kbd>1</kbd>–<kbd>5</kbd> stars · <kbd>Z</kbd> zoom
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
