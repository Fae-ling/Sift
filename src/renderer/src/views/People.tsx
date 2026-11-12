import { useMemo, useState } from 'react'
import type { Person } from '@shared/types'
import { appearances } from '../analysis/people'
import { PageHeader } from '../components/PageHeader'
import { useStore } from '../store'

/** The people of the open shoot: who they are, who matters most, and how well each is covered. */
export function People(): React.JSX.Element {
  const { project, findPeople, editPerson, mergePerson, setFilter, setView } = useStore()
  const shots = project?.shots ?? []
  const seen = useMemo(() => appearances(shots), [shots])
  const people = useMemo(() => [...(project?.people ?? [])].sort((a, b) => Number(b.key) - Number(a.key) || (seen.get(b.id)?.frames ?? 0) - (seen.get(a.id)?.frames ?? 0)), [project?.people, seen])
  const [showAll, setShowAll] = useState(false)
  if (!project) return <div className="page" />

  const hasIds = shots.some((s) => s.analysis?.faces.some((f) => f.id))
  const withFaces = shots.filter((s) => s.analysis?.faces.length).length
  // Someone seen in a handful of frames is a passer-by until the photographer says otherwise.
  const listed = showAll ? people : people.filter((p) => p.key || p.name || (seen.get(p.id)?.frames ?? 0) >= Math.max(3, withFaces * 0.02))
  const key = people.filter((p) => p.key)

  return (
    <div className="page">
      <PageHeader
        title="People"
        lead="The app tells the people of this shoot apart by their faces, hair and clothes. It cannot know who anyone is: name the ones who matter and mark the key people, and frames of them count for more."
      >
        <button onClick={() => void findPeople()} disabled={!hasIds} title="Gather the faces again, keeping the people you named">
          Find people again
        </button>
      </PageHeader>

      {!hasIds ? (
        <div className="empty-state">
          <h2>Nobody to tell apart yet</h2>
          <p className="muted">
            {shots.length === 0
              ? 'Import the shoot first.'
              : project.fastImport
                ? 'This shoot was imported with the fast option, which skips telling people apart. Import it again without it to use key people.'
                : 'No faces large enough were found, or this shoot was imported before the app could tell people apart.'}
          </p>
        </div>
      ) : (
        <>
          {key.length > 0 && (
            <p className="note">
              <b>{key.length === 1 ? 'Key person' : 'Key people'}:</b>{' '}
              {key.map((p) => `${p.name || 'unnamed'} (${seen.get(p.id)?.kept ?? 0} kept of ${seen.get(p.id)?.frames ?? 0})`).join(', ')}.{' '}
              <button
                className="link"
                onClick={() => {
                  setFilter('key')
                  setView('cull')
                }}
              >
                Show their frames in Cull
              </button>
            </p>
          )}
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {listed.map((p, i) => (
              <PersonCard
                key={p.id}
                person={p}
                label={p.name || `Person ${i + 1}`}
                frames={seen.get(p.id)?.frames ?? 0}
                kept={seen.get(p.id)?.kept ?? 0}
                others={people.filter((x) => x.id !== p.id)}
                onEdit={(patch) => editPerson(p.id, patch)}
                onMerge={(into) => mergePerson(p.id, into)}
              />
            ))}
          </div>
          {people.length > listed.length && (
            <button className="link" style={{ marginTop: 12 }} onClick={() => setShowAll(true)}>
              Show {people.length - listed.length} more who appear only a few times
            </button>
          )}
          <p className="faint small" style={{ marginTop: 16 }}>
            Telling people apart is approximate: the same person in different light or seen from the side can be listed
            twice, and two people who look and dress alike can be taken for one. Giving two entries the same name joins
            them. To correct a single face, open the frame in Cull and choose who it is under the face.
          </p>
        </>
      )}
    </div>
  )
}

function PersonCard(props: { person: Person; label: string; frames: number; kept: number; others: Person[]; onEdit: (patch: Partial<Pick<Person, 'name' | 'key'>>) => void; onMerge: (intoId: string) => void }): React.JSX.Element {
  const { person: p } = props
  const [name, setName] = useState(p.name)
  return (
    <div className={`card person ${p.key ? 'key' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        {p.thumb ? <img src={p.thumb} alt={props.label} className="person-face" /> : <div className="person-face" />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={name}
            placeholder={`${props.label}: who is this?`}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== p.name && props.onEdit({ name })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label={`Name of ${props.label}`}
            style={{ width: '100%' }}
          />
          <p className="small muted" style={{ margin: '6px 0' }}>
            In {props.frames} frame{props.frames === 1 ? '' : 's'}, {props.kept} kept
          </p>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.key} onChange={(e) => props.onEdit({ key: e.target.checked })} />
            Key person
          </label>
        </div>
      </div>
      {props.others.length > 0 && (
        <select className="compact" style={{ marginTop: 8, width: '100%' }} value="" onChange={(e) => e.target.value && props.onMerge(e.target.value)} aria-label={`Join ${props.label} with another person`}>
          <option value="">Same person as…</option>
          {props.others.map((o, k) => (
            <option key={o.id} value={o.id}>
              {o.name || `an unnamed person (${k + 1})`}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
