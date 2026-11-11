import { useEffect, useState } from 'react'
import { facesAvailable } from '../analysis/faces'
import { useStore } from '../store'

export function Import(): React.JSX.Element {
  const { project, ingest, importFolder, cancelIngest, regroup, setView, notify } = useStore()
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

  const elapsed = (Date.now() - ingest.startedAt) / 1000
  const remaining = ingest.done > 3 ? Math.round((elapsed / ingest.done) * (ingest.total - ingest.done)) : null

  const choose = async (): Promise<void> => {
    const folder = await window.studio.pickFolder()
    if (!folder) return
    try {
      await importFolder(folder)
    } catch (err) {
      notify(`Import failed: ${(err as Error).message}`)
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
