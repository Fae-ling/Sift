import { useState } from 'react'
import type { Genre } from '@shared/types'
import { useStore } from '../store'

const GENRES: { id: Genre; label: string }[] = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'event', label: 'Event' },
  { id: 'other', label: 'Other' }
]

export function Projects(): React.JSX.Element {
  const { summaries, createProject, openProject, deleteProject } = useStore()
  const [name, setName] = useState('')
  const [genre, setGenre] = useState<Genre>('portrait')
  const [confirm, setConfirm] = useState<string | null>(null)

  return (
    <div className="page wide">
      <h1>Projects</h1>
      <p className="lead">
        Each project holds one shoot: its brief, your selects, and the editing plan. Your photos stay where they are on
        disk and are never changed.
      </p>

      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void createProject(name.trim(), genre)
        }}
      >
        <input style={{ flex: 1, minWidth: 220 }} placeholder="New project name, e.g. Lena & Tom — wedding" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        <select style={{ width: 140 }} value={genre} onChange={(e) => setGenre(e.target.value as Genre)} aria-label="Genre">
          {GENRES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!name.trim()}>
          Create project
        </button>
      </form>

      <h2>Recent</h2>
      {summaries.length === 0 && <p className="muted">No projects yet. Name one above to begin.</p>}
      <div className="cards">
        {summaries.map((p) => (
          <div key={p.id} className="card clickable" onClick={() => void openProject(p.id)}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
            <div className="muted small" style={{ margin: '4px 0 10px' }}>
              {p.genre}
              {p.client ? ` · ${p.client}` : ''} · {new Date(p.updatedAt).toLocaleDateString()}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                {p.shotCount} frames · <span style={{ color: 'var(--pick)' }}>{p.pickCount} picks</span>
              </span>
              {confirm === p.id ? (
                <span className="row" onClick={(e) => e.stopPropagation()}>
                  <button className="danger" onClick={() => void deleteProject(p.id)}>
                    Delete project
                  </button>
                  <button onClick={() => setConfirm(null)}>Keep</button>
                </span>
              ) : (
                <button
                  className="link small"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirm(p.id)
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {confirm === p.id && <div className="muted small" style={{ marginTop: 8 }}>Removes the project and its previews. Your photos are not touched.</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
