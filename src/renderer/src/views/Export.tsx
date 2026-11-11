import { useState } from 'react'
import type { ExportResult, XmpItem } from '@shared/types'
import { useStore } from '../store'

/** A starting star rating for a pick you have not rated yourself. */
const starsFor = (overall: number): number => (overall >= 85 ? 5 : overall >= 75 ? 4 : overall >= 62 ? 3 : overall >= 48 ? 2 : 1)

export function Export(): React.JSX.Element {
  const { project, notify } = useStore()
  const [includeRejects, setIncludeRejects] = useState(true)
  const [autoStars, setAutoStars] = useState(false)
  const [result, setResult] = useState<{ kind: string; r: ExportResult } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!project) return <></>

  const picks = project.shots.filter((s) => s.decision === 'pick')
  const rejects = project.shots.filter((s) => s.decision === 'reject')
  const items: XmpItem[] = [
    ...picks.map((s) => ({ path: s.path, rating: s.rating || (autoStars ? starsFor(s.score?.overall ?? 0) : 0), label: 'Green' })),
    ...(includeRejects ? rejects.map((s) => ({ path: s.path, rating: 0, label: 'Red' })) : [])
  ]

  const run = async (kind: string, job: () => Promise<ExportResult | null>): Promise<void> => {
    setBusy(true)
    try {
      const r = await job()
      if (r) setResult({ kind, r })
    } catch (err) {
      notify(`Could not finish: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1>Hand off to Lightroom</h1>
      <p className="lead">
        Your decisions travel as small XMP sidecar files written next to each RAW. Lightroom Classic reads them on
        import. The RAW files themselves are never changed, and a sidecar that already exists is updated, not replaced.
      </p>

      <div className="stats">
        <div className="card">
          <div className="stat" style={{ color: 'var(--pick)' }}>{picks.length}</div>
          <div className="muted small">picks → Green label, with your stars</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: 'var(--reject)' }}>{rejects.length}</div>
          <div className="muted small">rejects → Red label</div>
        </div>
      </div>

      <label style={{ fontWeight: 400 }} className="row">
        <input type="checkbox" style={{ width: 'auto' }} checked={includeRejects} onChange={(e) => setIncludeRejects(e.target.checked)} />
        Also label rejects, so you can filter them out in Lightroom
      </label>

      <label style={{ fontWeight: 400 }} className="row">
        <input type="checkbox" style={{ width: 'auto' }} checked={autoStars} onChange={(e) => setAutoStars(e.target.checked)} />
        Give picks I have not rated a starting star rating from their scores (a first sort for the edit, yours to change)
      </label>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" disabled={busy || items.length === 0} onClick={() => void run('sidecars', () => window.studio.exportXmp(items))}>
          Write ratings for {items.length} photos
        </button>
        <button
          disabled={busy || picks.length === 0}
          onClick={() =>
            void run('copies', async () => {
              const dest = await window.studio.pickFolder()
              return dest ? window.studio.copySelects(picks.map((s) => s.path), dest) : null
            })
          }
        >
          Copy the {picks.length} picks to a folder…
        </button>
      </div>

      {result && (
        <div className={`note ${result.r.failed.length ? 'warn' : 'teach'}`}>
          <p>
            {result.r.written} {result.kind} written{result.r.failed.length ? `, ${result.r.failed.length} skipped` : ''}.
          </p>
          {result.r.failed.slice(0, 5).map((f) => (
            <p className="small muted" key={f.path}>
              {f.path.split(/[\\/]/).pop()}: {f.error}
            </p>
          ))}
        </div>
      )}

      <h2>In Lightroom Classic</h2>
      <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
        <li>
          <b>Not imported yet:</b> import the folder as usual. Ratings and labels arrive with the photos.
        </li>
        <li>
          <b>Already in the catalog:</b> select the photos, then Metadata → Read Metadata from Files.
        </li>
        <li>Filter by the Green label (or by stars) to see only your picks, and start editing.</li>
      </ol>
      <div className="note">
        <p className="small muted">
          Colour labels are matched by name. If a label shows up white in Lightroom, your label set uses different
          names: choose Metadata → Color Label Set → Lightroom Default. Pick and reject flags are private to
          Lightroom's catalog and cannot be set from outside, which is why labels are used here.
        </p>
      </div>
    </div>
  )
}
