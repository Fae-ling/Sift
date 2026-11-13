import { useMemo, useState } from 'react'
import type { Person, Shot } from '@shared/types'
import { thumbUrl } from '../analysis/pipeline'
import { appearances } from '../analysis/people'
import { PageHeader } from '../components/PageHeader'
import { useStore } from '../store'

/** The people of the open shoot: who they are, who matters most, and how well each is covered. */
export function People(): React.JSX.Element {
  const { project, readIdentities, editPerson, mergePerson, removePerson, setFacePerson, setFilter, setView, identifying, peopleLearning } = useStore()
  const shots = project?.shots ?? []
  const seen = useMemo(() => appearances(shots), [shots])
  const people = useMemo(() => [...(project?.people ?? [])].sort((a, b) => Number(b.key) - Number(a.key) || (seen.get(b.id)?.frames ?? 0) - (seen.get(a.id)?.frames ?? 0)), [project?.people, seen])
  const [showAll, setShowAll] = useState(false)
  // The card being dragged, and the card or the bin it is over.
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  if (!project) return <div className="page" />

  const hasIds = shots.some((s) => s.analysis?.faces.some((f) => f.id))
  // Frames whose faces were found at import but never given what tells them apart: an older project, or a quick import.
  const unread = shots.filter((s) => s.analysis?.faces.some((f) => f.h >= 0.06 && !f.id)).length
  const hasFaces = shots.some((s) => s.analysis?.faces.some((f) => f.h >= 0.06))
  const withFaces = shots.filter((s) => s.analysis?.faces.length).length
  const learning = peopleLearning()
  // Someone seen in a handful of frames is a passer-by until the photographer says otherwise.
  const listed = showAll ? people : people.filter((p) => p.key || p.name || (seen.get(p.id)?.frames ?? 0) >= Math.max(3, withFaces * 0.02))
  const key = people.filter((p) => p.key)

  return (
    <div className="page">
      <PageHeader
        title="People"
        lead="The app tells the people of this shoot apart by their faces, hair and clothes. It cannot know who anyone is: name the ones who matter and mark the key people, and frames of them count for more."
      >
        <button onClick={() => void readIdentities()} disabled={!hasFaces || identifying.running} title="Gather the faces again, keeping the people you named">
          {identifying.running ? `Reading faces ${identifying.done} of ${identifying.total}…` : unread ? 'Read the faces' : 'Find people again'}
        </button>
      </PageHeader>

      {unread > 0 && (
        <div className="note teach read-faces">
          <p>
            <b>{unread} frame{unread === 1 ? '' : 's'} with faces {unread === 1 ? 'has' : 'have'} not been read for people yet.</b>{' '}
            {project.fastImport ? 'This shoot was imported with the quick option, which skips it. ' : 'This shoot was imported before Sift could tell people apart. '}
            Reading them again does not need the photos: it works from the previews Sift already keeps, and nothing else about the project changes.
          </p>
          {identifying.running ? (
            <div>
              <div className="bar">
                <div style={{ width: `${(100 * identifying.done) / Math.max(1, identifying.total)}%` }} />
              </div>
              <p className="faint small" style={{ marginTop: 6 }}>
                {identifying.done} of {identifying.total} frames
              </p>
            </div>
          ) : (
            <button className="primary" onClick={() => void readIdentities()}>
              Read the faces now
            </button>
          )}
        </div>
      )}
      {!hasIds && unread === 0 ? (
        <div className="empty-state">
          <h2>Nobody to tell apart yet</h2>
          <p className="muted">{shots.length === 0 ? 'Import the shoot first.' : 'No faces large enough to tell apart were found in this shoot.'}</p>
        </div>
      ) : !hasIds ? null : (
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
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {listed.map((p, i) => (
              <PersonCard
                key={p.id}
                person={p}
                label={p.name || `Person ${i + 1}`}
                frames={seen.get(p.id)?.frames ?? 0}
                kept={seen.get(p.id)?.kept ?? 0}
                others={people.filter((x) => x.id !== p.id)}
                shots={shots}
                onNotThem={(shotId, face) => setFacePerson(shotId, face, null)}
                onEdit={(patch) => editPerson(p.id, patch)}
                onMerge={(into) => mergePerson(p.id, into)}
                onRemove={() => removePerson(p.id)}
                dragging={drag === p.id}
                target={!!drag && drag !== p.id && over === p.id}
                onDragStart={() => setDrag(p.id)}
                onDragEnd={() => {
                  setDrag(null)
                  setOver(null)
                }}
                onDragOver={() => drag && drag !== p.id && setOver(p.id)}
                onDragLeave={() => setOver((o) => (o === p.id ? null : o))}
                onDropHere={() => {
                  if (drag && drag !== p.id) mergePerson(drag, p.id)
                  setDrag(null)
                  setOver(null)
                }}
              />
            ))}
          </div>
          {drag && (
            <div
              className={`person-bin ${over === 'bin' ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOver('bin')
              }}
              onDragLeave={() => setOver((o) => (o === 'bin' ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                removePerson(drag)
                setDrag(null)
                setOver(null)
              }}
            >
              Drop here to remove this person
            </div>
          )}
          {people.length > listed.length && (
            <button className="link" style={{ marginTop: 12 }} onClick={() => setShowAll(true)}>
              Show {people.length - listed.length} more who appear only a few times
            </button>
          )}
          <section className="card people-learning">
            <h3>It learns from your corrections</h3>
            {learning.judgements === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                Every time you join two people, or say a face is not them, Sift learns how alike two faces must be to count as one person, and how much to trust the face against hair and clothes.
              </p>
            ) : (
              <>
                <p className="small" style={{ margin: '0 0 4px' }}>
                  {learning.judgements} judgements from your corrections. {learning.tested >= 4 ? <>Tested on {learning.tested} held back: the standard settings get {Math.round(learning.defaults * 100)}% right, settings fitted to you {Math.round(learning.fitted * 100)}%. </> : 'Too few yet to test on. '}
                  <b>{learning.used ? 'Your fitted settings are in use.' : 'The standard settings are in use.'}</b>
                </p>
                {learning.used && <p className="faint small" style={{ margin: 0 }}>Faces must be {Math.round(learning.tuning.threshold * 100)}% alike to count as one person; the face counts for {Math.round(learning.tuning.faceWeight * 100)}% of that, hair and clothes the rest.</p>}
              </>
            )}
          </section>
          <p className="faint small" style={{ marginTop: 16 }}>
            Telling people apart is approximate: the same person in different light or seen from the side can be listed
            twice, and two people who look and dress alike can be taken for one. Drag one person onto another to join them, or onto the bin
            that appears to remove them. Giving two entries the same name joins them too. To correct a single face, open the frame in Cull and choose who it is under the face.
          </p>
        </>
      )}
    </div>
  )
}

/** A square view of one face, cut out of the frame's thumbnail with the background's size and position alone. */
function faceCrop(shot: Shot, face: number): React.CSSProperties {
  const f = shot.analysis!.faces[face]
  const aspect = shot.width && shot.height ? shot.width / shot.height : 1.5
  const side = Math.min(1, Math.max(f.w, f.h / aspect) * 1.5)
  const W = 1 / side
  const H = W / aspect
  const cx = f.x + f.w / 2
  const cy = (f.y + f.h / 2) / aspect
  const pos = (c: number, len: number): string => {
    const off = Math.max(0, Math.min(len - 1, (c - side / 2) * W))
    return len - 1 <= 0 ? '50%' : `${(100 * off) / (len - 1)}%`
  }
  return { backgroundSize: `${W * 100}% auto`, backgroundPosition: `${pos(cx, W)} ${pos(cy, H)}` }
}

function PersonCard(props: { person: Person; label: string; frames: number; kept: number; others: Person[]; shots: Shot[]; onNotThem: (shotId: string, face: number) => void; onEdit: (patch: Partial<Pick<Person, 'name' | 'key'>>) => void; onMerge: (intoId: string) => void; onRemove: () => void; dragging: boolean; target: boolean; onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDragLeave: () => void; onDropHere: () => void }): React.JSX.Element {
  const { person: p } = props
  const [name, setName] = useState(p.name)
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const faces = useMemo(
    () => (open ? props.shots.flatMap((s) => (s.people ?? []).flatMap((id, face) => (id === p.id && s.analysis?.faces[face]?.id ? [{ shot: s, face }] : []))) : []),
    [open, props.shots, p.id]
  )
  const projectId = useStore((x) => x.project?.id ?? '')
  return (
    <div
      className={`card person ${p.key ? 'key' : ''} ${props.dragging ? 'dragging' : ''} ${props.target ? 'merge-target' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', p.id)
        props.onDragStart()
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        props.onDragOver()
      }}
      onDragLeave={props.onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        props.onDropHere()
      }}
    >
      {props.target && <div className="merge-hint">Let go to join as the same person</div>}
      <button className="person-x" onClick={props.onRemove} aria-label={`Remove ${props.label}`} title="Remove this person">
        ×
      </button>
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
      <button className="link small" style={{ marginTop: 8 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide their faces' : 'Check their faces'}
      </button>
      {open && (
        <>
          <p className="faint small" style={{ margin: '6px 0' }}>Is every one of these them? Click × on one that is not: Sift removes it and learns from it.</p>
          <div className="face-grid">
            {faces.slice(0, more ? 200 : 18).map(({ shot, face }) => (
              <div className="face-tile" key={`${shot.id}:${face}`} title={shot.name}>
                <div className="face-crop" style={{ backgroundImage: `url(${thumbUrl(projectId, shot.id)})`, ...faceCrop(shot, face) }} />
                <button className="face-x" onClick={() => props.onNotThem(shot.id, face)} aria-label={`Not ${props.label}: ${shot.name}`} title="Not them">
                  ×
                </button>
              </div>
            ))}
          </div>
          {faces.length > 18 && !more && (
            <button className="link small" onClick={() => setMore(true)}>
              Show all {faces.length}
            </button>
          )}
        </>
      )}
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
