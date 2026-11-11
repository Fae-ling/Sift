import { useMemo, useState } from 'react'
import type { Shot, ShotType } from '@shared/types'
import { thumbUrl } from '../analysis/pipeline'
import { estimateCost, formatCost } from '../components/AiCost'
import { Thumb } from '../components/Thumb'
import { useStore } from '../store'

const MAX_FRAMES = 120
const TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'group', 'detail']
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Observations about coverage and rhythm that need no AI. */
function localNotes(shots: Shot[], picks: Shot[], target: number): string[] {
  const notes: string[] = []
  if (target > 0 && picks.length > target) {
    notes.push(`You have ${picks.length} picks for a target of ${target}. Cutting the last ${picks.length - target} is the hardest and most valuable part of the edit: for each frame ask what it adds that no other frame does.`)
  }
  const scenes = new Map<number, { all: number; picks: Shot[] }>()
  for (const s of shots) {
    const e = scenes.get(s.sceneId ?? 0) ?? { all: 0, picks: [] }
    e.all++
    if (s.decision === 'pick') e.picks.push(s)
    scenes.set(s.sceneId ?? 0, e)
  }
  const empty = [...scenes].filter(([, e]) => e.picks.length === 0 && e.all >= 5).map(([id]) => id)
  if (empty.length) notes.push(`Scene${empty.length > 1 ? 's' : ''} ${empty.join(', ')} ${empty.length > 1 ? 'have' : 'has'} no picks. If that part of the day matters to the story, one frame from it keeps the narrative continuous.`)
  for (const [id, e] of scenes) {
    const kinds = new Set(e.picks.map((s) => s.analysis!.shotType))
    if (e.picks.length >= 4 && kinds.size === 1) {
      notes.push(`Scene ${id}: all ${e.picks.length} picks are ${[...kinds][0]} shots. A sequence at one distance feels static; a wider frame for context or a detail for texture gives it rhythm.`)
    }
  }
  if (picks.length >= 8 && !picks.some((s) => s.analysis!.shotType === 'detail')) {
    notes.push('There are no detail frames (hands, objects, textures, places) among your picks. Details are the breathing spaces of a story and they are what make an album spread or a carousel work.')
  }
  if (picks.length >= 6 && picks[0].analysis!.shotType === 'close-up') {
    notes.push('The sequence opens on a close-up. That is a strong, deliberate choice; the conventional opener is a wider frame that tells the viewer where they are.')
  }
  return notes
}

export function Story(): React.JSX.Element {
  const { project, update, settings, setView, notify, select } = useStore()
  const [busy, setBusy] = useState(false)

  const shots = useMemo(() => project?.shots.filter((s) => s.analysis) ?? [], [project?.shots])
  const picks = useMemo(() => shots.filter((s) => s.decision === 'pick'), [shots])
  const byId = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots])
  if (!project) return <></>

  // The stored order, minus anything unpicked since, plus new picks at the end.
  const ordered = [
    ...project.storyOrder.flatMap((id) => (byId.get(id)?.decision === 'pick' ? [byId.get(id)!] : [])),
    ...picks.filter((s) => !project.storyOrder.includes(s.id))
  ]
  const candidates = picks.slice(0, MAX_FRAMES)
  const advice = project.storyAdvice
  const notes = localNotes(shots, picks, project.brief.targetCount)
  const counts = TYPES.map((t) => [t, picks.filter((s) => s.analysis!.shotType === t).length] as const)

  const ask = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.studio.ai.story({
        projectId: project.id,
        genre: project.genre,
        brief: project.brief,
        frames: candidates.map((s) => ({
          shotId: s.id,
          scene: s.sceneId ?? 0,
          time: clock(s.time),
          shotType: s.analysis!.shotType,
          faces: s.analysis!.faces.length,
          picked: true
        }))
      })
      update((p) => ({ ...p, storyAdvice: result }))
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const move = (id: string, delta: number): void => {
    const ids = ordered.map((s) => s.id)
    const i = ids.indexOf(id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    update((p) => ({ ...p, storyOrder: ids }))
  }

  if (picks.length === 0) {
    return (
      <div className="empty">
        <div>
          <p>Pick some frames first; the story is built from your picks.</p>
          <button className="primary" onClick={() => setView('cull')}>
            Go to Cull
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page wide">
      <h1>Story</h1>
      <p className="lead">
        A cull chooses good frames; an edit chooses frames that work together. Look at your picks as one sequence: does
        it have a beginning, variety of distance, moments of rest, and an ending?
      </p>

      <div className="row">
        {counts.map(([t, n]) => (
          <span key={t} className="chip">
            {n} {t}
          </span>
        ))}
        <span className="chip pick">
          {picks.length} picks{project.brief.targetCount ? ` / ${project.brief.targetCount} target` : ''}
        </span>
      </div>

      {notes.map((n, i) => (
        <div className="note teach" key={i}>
          <p>{n}</p>
        </div>
      ))}

      <h2>Your sequence</h2>
      <p className="muted small">Capture order by default. Use the arrows to reorder; click a frame to open it in Cull.</p>
      <div className="film">
        {ordered.map((s, i) => (
          <div key={s.id}>
            <Thumb projectId={project.id} shot={s} onSelect={(id) => (select(id), setView('cull'))} />
            <div className="row small muted" style={{ justifyContent: 'space-between', gap: 2 }}>
              <button className="link" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="Move earlier">
                ◀
              </button>
              <span>
                {i + 1} · {s.analysis!.shotType}
              </span>
              <button className="link" onClick={() => move(s.id, 1)} disabled={i === ordered.length - 1} aria-label="Move later">
                ▶
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2>Picture editor's opinion</h2>
      <p className="muted small" style={{ maxWidth: 680 }}>
        Sends small thumbnails of {candidates.length === picks.length ? `your ${picks.length} picks` : `your first ${candidates.length} picks`} and
        your brief to Claude, and asks for a sequence, what to cut, and what is missing.{' '}
        {settings.hasApiKey
          ? `Estimated cost: ${estimateCost(settings.model, 800 + candidates.length * 190, 2500 + candidates.length * 70)}.`
          : 'This is the only paid step and it is optional.'}
      </p>
      <div className="row">
        {settings.hasApiKey ? (
          <button className="primary" onClick={() => void ask()} disabled={busy || picks.length < 3}>
            {busy ? 'Reading the sequence…' : advice ? 'Ask again' : 'Ask for a sequence'}
          </button>
        ) : (
          <button onClick={() => setView('settings')}>Add an API key in Settings</button>
        )}
        {picks.length < 3 && <span className="muted small">Needs at least three picks.</span>}
      </div>

      {advice && (
        <div style={{ marginTop: 16 }}>
          <div className="note">
            <p>{advice.summary}</p>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Suggested sequence</h3>
            <button onClick={() => update((p) => ({ ...p, storyOrder: advice.sequence.map((s) => s.shotId) }))}>Use this order</button>
          </div>
          {advice.sequence.map((s, i) =>
            byId.has(s.shotId) ? (
              <div className="seq" key={i}>
                <img src={thumbUrl(project.id, s.shotId)} alt="" />
                <div>
                  <b>
                    {i + 1}. {s.role}
                  </b>
                  <p className="small" style={{ marginTop: 4 }}>{s.why}</p>
                </div>
              </div>
            ) : null
          )}
          {advice.cut.length > 0 && (
            <>
              <h3>Consider cutting</h3>
              {advice.cut.map((c, i) =>
                byId.has(c.shotId) ? (
                  <div className="seq" key={i}>
                    <img src={thumbUrl(project.id, c.shotId)} alt="" />
                    <p className="small">{c.why}</p>
                  </div>
                ) : null
              )}
            </>
          )}
          {advice.gaps.length > 0 && (
            <>
              <h3>What is missing</h3>
              <ul>
                {advice.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}
          <div className="note teach">
            <p>
              <b>Take with you:</b> {advice.lesson}
            </p>
          </div>
          {advice.usage && (
            <p className="muted small">
              This advice cost {formatCost(advice.usage.costUsd)} ({advice.usage.inputTokens.toLocaleString()} tokens in, {advice.usage.outputTokens.toLocaleString()} out).
            </p>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 24 }}>
        <button className="primary" onClick={() => setView('coach')}>
          Next: plan the edit
        </button>
      </div>
    </div>
  )
}
