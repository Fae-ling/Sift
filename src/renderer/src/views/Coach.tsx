import { useEffect, useMemo, useState } from 'react'
import type { DevelopSettings } from '@shared/types'
import { coachNotes, developText, developTips, measurementText } from '../analysis/coach'
import { previewUrl } from '../analysis/pipeline'
import { estimateCost, formatCost } from '../components/AiCost'
import { Scopes } from '../components/Scopes'
import { Thumb } from '../components/Thumb'
import { useStore } from '../store'

const ORDER: [string, string][] = [
  ['Profile and lens corrections', 'Choose the camera profile first: it changes colour and contrast under everything else. Enable lens corrections.'],
  ['Crop and straighten', 'Composition decides what the tonal work is for. Level horizons and verticals.'],
  ['White balance', 'Neutralise, then choose the warmth on purpose. Judge on skin and on something that should be grey.'],
  ['Exposure, then white and black points', 'Set overall brightness on the subject. Then place the brightest and darkest points.'],
  ['Highlights and shadows', 'Recover detail. Small moves: flattening both ends removes the shape of the light.'],
  ['Tone curve', 'Shape contrast where you want it. This is where most of a "look" comes from.'],
  ['HSL / Color Mixer', 'Refine individual colours: skin first, then quieten whatever competes with the subject.'],
  ['Color grading', 'Tint shadows, midtones and highlights for mood. Usually subtle: 5 to 15 saturation.'],
  ['Masks', 'Guide the eye: lift the subject, darken edges, soften distractions. Dodge and burn.'],
  ['Detail', 'Sharpening and noise reduction last, at 100% view, judged for the output size.']
]

export function Coach(): React.JSX.Element {
  const { project, update, settings, setView, notify } = useStore()
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shots = useMemo(() => project?.shots.filter((s) => s.analysis) ?? [], [project?.shots])
  const picks = useMemo(() => shots.filter((s) => s.decision === 'pick'), [shots])
  const [develop, setDevelop] = useState<DevelopSettings | null>(null)
  const current = picks.find((s) => s.id === chosen) ?? picks[0]

  // Follow the edit: Lightroom rewrites the sidecar as you work, so look again every few seconds.
  useEffect(() => {
    if (!current) return
    let live = true
    const check = (): void => {
      void window.studio
        .readDevelop(current.path)
        .then((d) => live && setDevelop((prev) => (prev?.modified === d?.modified ? prev : d)))
        .catch(() => live && setDevelop(null))
    }
    setDevelop(null)
    check()
    const timer = setInterval(check, 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [current?.id, current?.path])
  if (!project) return <></>
  if (picks.length === 0) {
    return (
      <div className="empty">
        <div>
          <p>The edit coach works on your picks. Choose some frames first.</p>
          <button className="primary" onClick={() => setView('cull')}>
            Go to Cull
          </button>
        </div>
      </div>
    )
  }
  const shot = picks.find((s) => s.id === chosen) ?? picks[0]
  const mates = picks.filter((s) => s.sceneId === shot.sceneId)
  const notes = coachNotes(shot, mates, project.brief)
  const advice = project.gradeAdvice[shot.id]
  const src = previewUrl(project.id, shot.id)

  const ask = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.studio.ai.grade({
        projectId: project.id,
        genre: project.genre,
        brief: project.brief,
        shotId: shot.id,
        measurements: measurementText(shot),
        develop: develop && Object.keys(develop.values).length ? developText(develop.values) : ''
      })
      update((p) => ({ ...p, gradeAdvice: { ...p.gradeAdvice, [shot.id]: result } }))
    } catch (err) {
      notify((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="coach">
      <div className="coach-main">
        <div className="view">
          <img src={src} alt={shot.name} />
        </div>
        <div className="compare">
          {picks.map((s) => (
            <Thumb key={s.id} projectId={project.id} shot={s} selected={s.id === shot.id} onSelect={setChosen} />
          ))}
        </div>
      </div>

      <div className="coach-side">
        <h1 style={{ fontSize: 18 }}>Edit coach</h1>
        <p className="muted small">
          {shot.name} · unedited camera preview. Atelier does not edit your photo: it shows you what is there and why
          you might change it. You make the moves in Lightroom.
        </p>

        <h3>Read the image</h3>
        <Scopes src={src} />
        <div className="swatches" style={{ marginTop: 10 }} title="Dominant colours">
          {shot.analysis!.color.palette.map((c) => (
            <div key={c} style={{ background: c }} title={c} />
          ))}
        </div>

        <h3>What the numbers say</h3>
        {notes.map((n, i) => (
          <div className={`note ${n.level === 'attention' ? 'warn' : 'teach'}`} key={i}>
            <p>
              <b>{n.topic}.</b> {n.finding}
            </p>
            <p className="small">{n.advice}</p>
          </div>
        ))}

        <h3>Your edit so far</h3>
        {develop && Object.keys(develop.values).length > 3 ? (
          <>
            <p className="small muted">
              Read from Lightroom's sidecar, saved {new Date(develop.modified).toLocaleTimeString()}. Updates by itself as you edit.
            </p>
            {developTips(develop.values, shot, project.brief).map((n, i) => (
              <div className={`note ${n.level === 'attention' ? 'warn' : 'teach'}`} key={i}>
                <p>
                  <b>{n.topic}.</b> {n.finding}
                </p>
                <p className="small">{n.advice}</p>
              </div>
            ))}
          </>
        ) : (
          <p className="small muted">
            No Lightroom settings found for this photo yet. To get tips while you edit, turn on Catalog Settings →
            Metadata → <b>Automatically write changes into XMP</b> in Lightroom Classic (or press Ctrl+S on a photo).
            Lightroom then saves your sliders next to the RAW and this panel follows along.
          </p>
        )}

        <h3>Grading plan for your brief</h3>
        {!project.brief.moodWords && !project.brief.intention && (
          <p className="small muted">
            Your brief has no mood words or intention yet. <button className="link" onClick={() => setView('brief')}>Fill them in</button> and the plan can aim at something.
          </p>
        )}
        {settings.hasApiKey ? (
          <div className="row">
            <button className="primary" onClick={() => void ask()} disabled={busy}>
              {busy ? 'Studying the frame…' : advice ? 'Ask again' : 'Ask for a grading plan'}
            </button>
            <span className="muted small">{estimateCost(settings.model, 3200, 2500)}</span>
          </div>
        ) : (
          <p className="small muted">
            Optional: with an API key, Claude looks at this frame and your brief and coaches you through a grade.{' '}
            <button className="link" onClick={() => setView('settings')}>Add a key in Settings</button>.
          </p>
        )}
        <p className="small muted">Tip: one plan per scene is usually enough. Grade that frame, then sync it to the rest.</p>

        {advice && (
          <div>
            <div className="note">
              <p>
                <b>What it is now.</b> {advice.read}
              </p>
              <p>
                <b>Where to take it.</b> {advice.direction}
              </p>
            </div>
            {advice.steps.map((s, i) => (
              <div className="step-row" key={i}>
                <b>
                  {i + 1}. {s.panel}
                </b>
                {s.move}
                <div className="muted small">Why: {s.why}</div>
              </div>
            ))}
            {advice.watchOut.length > 0 && (
              <div className="note warn">
                <p>
                  <b>Watch out</b>
                </p>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  {advice.watchOut.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="note">
              <p className="small">
                <b>Matching video in Resolve.</b> {advice.resolveNote}
              </p>
            </div>
            <div className="note teach">
              <p>
                <b>Take with you:</b> {advice.lesson}
              </p>
            </div>
            {advice.usage && <p className="muted small">This plan cost {formatCost(advice.usage.costUsd)}.</p>}
          </div>
        )}

        <h3>Order of work in Lightroom</h3>
        <p className="small muted">Correct first, then shape, then style. Each step changes what the next one needs.</p>
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
          {ORDER.map(([title, why]) => (
            <li key={title} style={{ marginBottom: 6 }}>
              <b>{title}.</b> <span className="muted">{why}</span>
            </li>
          ))}
        </ol>
        <button className="link small" onClick={() => setView('learn')}>
          More in Learn
        </button>
      </div>
    </div>
  )
}
