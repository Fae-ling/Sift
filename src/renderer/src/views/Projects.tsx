import { useState } from 'react'
import { useStore } from '../store'

export function Projects(): React.JSX.Element {
  const { summaries, createProject, openProject, deleteProject, learned, setView } = useStore()
  const [name, setName] = useState('')
  const [styleId, setStyleId] = useState('')
  const chosen = styleId || learned.styles[0]?.id || ''
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
          if (name.trim()) void createProject(name.trim(), chosen)
        }}
      >
        <input style={{ flex: 1, minWidth: 220 }} placeholder="New project name, e.g. Lena & Tom — wedding" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        <select style={{ width: 240 }} value={chosen} onChange={(e) => setStyleId(e.target.value)} aria-label="Shoot style">
          {learned.styles.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!name.trim()}>
          Create project
        </button>
      </form>

      <p className="muted small" style={{ marginTop: 8 }}>
        The style tells the cull what to look for. Not in the list?{' '}
        <button className="link" onClick={() => setView('profiles')}>
          Create a style
        </button>{' '}
        for the kind of work you do.
      </p>

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
