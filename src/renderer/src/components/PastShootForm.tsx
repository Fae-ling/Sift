import { useState } from 'react'
import { useStore } from '../store'

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/**
 * Teaches the cull from a shoot culled before Atelier: imports its folder as a
 * project, takes the decisions from Lightroom ratings or from the files that
 * were delivered, and learns from them as unprompted choices.
 */
export function PastShootForm({ onDone, compact }: { onDone?: (count: number) => void; compact?: boolean }): React.JSX.Element {
  const { learned, ingest, learnFromPastShoot, notify } = useStore()
  const [folder, setFolder] = useState<string | null>(null)
  const [styleId, setStyleId] = useState(learned.styles[0]?.id ?? '')
  const [how, setHow] = useState<'ratings' | 'delivered'>('ratings')
  const [stars, setStars] = useState(1)
  const [delivered, setDelivered] = useState<string | null>(null)
  const [fast, setFast] = useState(true)
  const [busy, setBusy] = useState(false)

  const start = async (): Promise<void> => {
    if (!folder) return
    setBusy(true)
    try {
      const count = await learnFromPastShoot({
        folder,
        name: `Past shoot: ${baseName(folder)}`,
        styleId,
        from: how === 'ratings' ? { stars } : { delivered: delivered! },
        fast
      })
      notify(count ? `Learned from ${count} decisions in “${baseName(folder)}”.` : 'No ratings or matching delivered files were found, so there was nothing to learn from.')
      setFolder(null)
      setDelivered(null)
      onDone?.(count)
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (busy) {
    const left = ingest.total - ingest.done
    const perFrame = ingest.done ? (Date.now() - ingest.startedAt) / ingest.done : 0
    return (
      <div className="past-progress">
        <p className="small">
          {ingest.running ? `Reading ${ingest.done} of ${ingest.total} frames${perFrame ? `, about ${Math.max(1, Math.round((left * perFrame) / 60000))} min left` : ''}…` : 'Learning from your decisions…'}
        </p>
        <div className="bar">
          <div style={{ width: `${(100 * ingest.done) / Math.max(1, ingest.total)}%` }} />
        </div>
        <p className="faint small" style={{ marginTop: 8 }}>You can keep this window open and do something else meanwhile.</p>
      </div>
    )
  }

  return (
    <div className={`past-form ${compact ? 'compact' : ''}`}>
      <div className="field-row">
        <span className="field-label">The shoot</span>
        <button onClick={() => void window.studio.pickFolder().then((f) => f && setFolder(f))}>{folder ? baseName(folder) : 'Choose its folder of originals…'}</button>
      </div>
      <div className="field-row">
        <span className="field-label">Kind of shoot</span>
        <select value={styleId} onChange={(e) => setStyleId(e.target.value)} aria-label="Kind of shoot" style={{ maxWidth: 260 }}>
          {learned.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <span className="field-label">What you kept</span>
        <div className="segmented" role="group" aria-label="Where your choices are">
          <button className={how === 'ratings' ? 'on' : ''} onClick={() => setHow('ratings')}>
            Lightroom stars
          </button>
          <button className={how === 'delivered' ? 'on' : ''} onClick={() => setHow('delivered')}>
            Delivered files
          </button>
        </div>
      </div>
      {how === 'ratings' ? (
        <div className="field-row">
          <span className="field-label" />
          <label className="row small" style={{ margin: 0, fontWeight: 400 }}>
            kept means at least
            <select style={{ width: 76 }} value={stars} onChange={(e) => setStars(Number(e.target.value))} aria-label="Minimum stars for a kept frame">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} ★
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="field-row">
          <span className="field-label" />
          <button onClick={() => void window.studio.pickFolder().then((f) => f && setDelivered(f))}>{delivered ? baseName(delivered) : 'Choose the folder of delivered files…'}</button>
        </div>
      )}
      <div className="field-row">
        <span className="field-label" />
        <label className="row small" style={{ margin: 0, fontWeight: 400 }}>
          <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
          Quick read (about twice as fast; does not tell people apart)
        </label>
      </div>
      <p className="faint small">
        {how === 'ratings'
          ? 'Stars must be in the files: in Lightroom Classic, select all, then Metadata → Save Metadata to Files (Ctrl+S).'
          : 'Exported files are matched to originals by name, so IMG_0123-Edit.jpg counts for IMG_0123.ARW.'}
      </p>
      <button className="primary" disabled={!folder || !styleId || (how === 'delivered' && !delivered)} onClick={() => void start()}>
        Learn from this shoot
      </button>
    </div>
  )
}
