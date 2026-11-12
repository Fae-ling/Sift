import { useEffect, useState } from 'react'
import { facesAvailable } from '../analysis/faces'
import { bodyOf } from '../analysis/grouping'
import { useStore } from '../store'

export function Import(): React.JSX.Element {
  const { project, ingest, importFolder, cancelIngest, regroup, setView, notify, setClockOffset, setFastImport, deep } = useStore()
  const [faces, setFaces] = useState<boolean | null>(null)
  useEffect(() => void facesAvailable().then(setFaces), [])
  if (!project) return <></>

  const analysed = project.shots.filter((s) => s.analysis)
  const failed = project.shots.filter((s) => s.error)
  const pending = project.shots.length - analysed.length - failed.length
  const scenes = new Set(analysed.map((s) => s.sceneId)).size
  const stacks = new Set(analysed.map((s) => s.stackId)).size
  const suggested = analysed.filter((s) => s.suggestion === 'pick').length
  const warnings = analysed.filter((s) => s.score?.warnings.some((w) => w === 'blink' || w === 'soft' || w === 'soft-face')).length

  const bodies = new Map<string, number>()
  for (const s of analysed) bodies.set(bodyOf(s), (bodies.get(bodyOf(s)) ?? 0) + 1)

  const elapsed = (Date.now() - ingest.startedAt) / 1000
  const remaining = ingest.done > 3 ? Math.round((elapsed / ingest.done) * (ingest.total - ingest.done)) : null

  const choose = async (): Promise<void> => {
    const folder = await window.studio.pickFolder()
    if (!folder) return
    try {
      await importFolder(folder)
    } catch (err) {
      notify((err as Error).message)
    }
  }

  return (
    <div className="page">
      <h1>Import</h1>
      <p className="lead">
        Point Atelier at the folder from your card. It reads the preview your camera already stored inside each RAW
        file, so a thousand frames take minutes, and it measures focus, eyes, exposure and repeats on this computer.
        Nothing is uploaded and no file is changed.
      </p>

      <div className="row">
        <button className="primary" onClick={() => void choose()} disabled={ingest.running}>
          {project.shots.length ? 'Add another folder…' : 'Choose shoot folder…'}
        </button>
        {!ingest.running && pending > 0 && project.folder && (
          <button onClick={() => void importFolder(project.folder!)}>Resume analysis ({pending} left)</button>
        )}
        {project.folder && <span className="muted small">{project.folder}</span>}
      </div>

      <label style={{ fontWeight: 400, marginTop: 12 }} className="row">
        <input type="checkbox" style={{ width: 'auto' }} checked={!!project.fastImport} onChange={(e) => setFastImport(e.target.checked)} disabled={ingest.running} />
        Fast import for very large shoots
        <span className="hint">about twice as quick; focus is judged on a smaller image and small faces in wide shots are not searched for</span>
      </label>

      {project.shots.length === 0 && !ingest.running && (
        <p className="muted small" style={{ marginTop: 10, maxWidth: 680 }}>
          The window that opens lists folders only, so the folder with your RAW files will look empty. That is normal:
          open the folder that holds the photos and choose it. Subfolders are included.
        </p>
      )}

      {faces === false && (
        <div className="note warn">
          <p>
            Face analysis is not available on this computer, so eye and expression checks are off. Focus, exposure and
            duplicate grouping still work. It needs the face model (downloaded by <code>npm install</code>) and
            graphics acceleration.
          </p>
        </div>
      )}

      {ingest.running && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span>
              Analysing {ingest.done} of {ingest.total}
              {remaining !== null && <span className="muted"> · about {remaining > 90 ? `${Math.round(remaining / 60)} min` : `${remaining} s`} left</span>}
            </span>
            <button onClick={cancelIngest}>Pause</button>
          </div>
          <div className="bar">
            <div style={{ width: `${(100 * ingest.done) / Math.max(1, ingest.total)}%` }} />
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>You can start culling now; results fill in as they arrive.</p>
        </div>
      )}

      {failed.length > 0 && (
        <div className="note warn">
          <p>
            {failed.length} file{failed.length > 1 ? 's' : ''} could not be read (for example {failed[0].name}: {failed[0].error}).
          </p>
        </div>
      )}
      {analysed.length > 0 && (
        <>
          <div className="stats">
            <div className="card">
              <div className="stat">{analysed.length}</div>
              <div className="muted small">frames read</div>
            </div>
            <div className="card">
              <div className="stat">{scenes}</div>
              <div className="muted small">scenes</div>
            </div>
            <div className="card">
              <div className="stat">{stacks}</div>
              <div className="muted small">distinct moments</div>
            </div>
            <div className="card">
              <div className="stat" style={{ color: 'var(--pick)' }}>{suggested}</div>
              <div className="muted small">suggested keepers</div>
            </div>
            <div className="card">
              <div className="stat" style={{ color: 'var(--warn)' }}>{warnings}</div>
              <div className="muted small">closed eyes or soft</div>
            </div>
          </div>

          {deep.running && (
            <p className="muted small">
              Now reading the composition of the strongest frames ({deep.done} of {deep.total}): whether the subject stands
              clear of the background and holds the eye. You can cull meanwhile.
            </p>
          )}
          <div className="note teach">
            <p>
              <b>{analysed.length} frames are really {stacks} moments.</b> Bursts and repeated takes are stacked
              together, so you choose once per moment instead of once per frame. That is where most culling time goes.
            </p>
          </div>

          <label htmlFor="gap">
            A new scene starts after a pause of<span className="hint">{Math.round(project.sceneGapSec / 60)} min {project.sceneGapSec % 60 ? `${project.sceneGapSec % 60} s` : ''}</span>
          </label>
          <input id="gap" type="range" min={30} max={900} step={30} value={project.sceneGapSec} onChange={(e) => regroup(Number(e.target.value))} />
          <p className="muted small">Shorter pauses split the day into more scenes. Pick what matches how you shot.</p>

          {bodies.size > 1 && (
            <>
              <h2>Camera clocks</h2>
              <p className="muted small" style={{ maxWidth: 680 }}>
                This shoot comes from {bodies.size} cameras. If their clocks disagree, frames interleave in the wrong
                order and scenes split oddly. Find one moment both cameras caught, note the time each shows for it in
                Cull, and enter the difference in seconds for one of them (negative if that camera runs ahead).
              </p>
              {[...bodies].map(([body, count]) => (
                <div className="row" key={body} style={{ marginBottom: 6 }}>
                  <span style={{ width: 280 }}>
                    {body} <span className="muted small">· {count} frames</span>
                  </span>
                  <input
                    type="number"
                    style={{ width: 110 }}
                    aria-label={`Clock correction for ${body} in seconds`}
                    defaultValue={project.clockOffsets[body] ?? 0}
                    onBlur={(e) => setClockOffset(body, Math.round(Number(e.target.value) || 0))}
                  />
                  <span className="muted small">seconds</span>
                </div>
              ))}
            </>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={() => setView('cull')}>
              Start culling
            </button>
          </div>
        </>
      )}
    </div>
  )
}
