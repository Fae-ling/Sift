import { useState } from 'react'
import { styleCacheId, type Style } from '@shared/types'
import { thumbUrl } from '../analysis/pipeline'
import { MIN_TESTED_PAIRS, tendencies } from '../analysis/learner'
import { impliedBalance, profileFacts } from '../analysis/style'
import { estimateCost, formatCost } from '../components/AiCost'
import { useStore } from '../store'

const splitTags = (text: string): string[] =>
  text
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

export function Profiles(): React.JSX.Element {
  const { learned, learning, project, createProfile, taste, tasteData, setBlindBursts, forgetLearning, relearn } = useStore()
  const [confirmForget, setConfirmForget] = useState(false)
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')

  return (
    <div className="page wide">
      <h1>Culling profiles</h1>
      <p className="lead">
        A profile is a feeling to cull for. Its atmosphere words steer what the cull rewards, and it keeps learning from
        the galleries and picks you add to it. Choose one per project and the suggestions lean that way.
      </p>

      <h2 style={{ marginTop: 8 }}>Your eye</h2>
      <div className="card">
        {taste ? (
          <>
            <div className="stats" style={{ marginTop: 0 }}>
              <div>
                <div className="stat">{taste.report.decisions}</div>
                <div className="muted small">decisions learned from, across {taste.report.projects} project{taste.report.projects === 1 ? '' : 's'}</div>
              </div>
              <div>
                <div className="stat">{taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.rulesAgree) : '–'}</div>
                <div className="muted small">built-in rules agree with you</div>
              </div>
              <div>
                <div className="stat" style={{ color: taste.trust > 0 ? 'var(--pick)' : undefined }}>
                  {taste.report.testedPairs >= MIN_TESTED_PAIRS ? pct(taste.report.blendedAgree) : '–'}
                </div>
                <div className="muted small">with what it has learned from you</div>
              </div>
              <div>
                <div className="stat">{pct(taste.trust)}</div>
                <div className="muted small">say your learned taste has in each suggestion</div>
              </div>
            </div>
            <p className="small muted">
              {taste.report.testedPairs < MIN_TESTED_PAIRS
                ? `Still gathering evidence. Agreement is measured on bursts set aside and never learned from: ${taste.report.testedPairs} comparisons so far, ${MIN_TESTED_PAIRS} needed before what it has learned may influence suggestions. Until then the built-in rules decide.`
                : taste.trust > 0
                  ? `Measured on ${taste.report.testedPairs} choices from bursts that were set aside and never learned from: how often the frame you kept was ranked above the one you passed over. The learned share is whatever gives the best agreement there, so it only grows when it earns it.`
                  : `Measured on ${taste.report.testedPairs} choices from bursts that were set aside. What it has learned does not yet beat the built-in rules there, so it is not used. It keeps learning with every decision.`}{' '}
              {taste.report.blindDecisions} of your decisions were made with no suggestion shown.
            </p>
            {tendencies(taste.model).length > 0 && (
              <>
                <h3>What it has noticed about your choices</h3>
                <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
                  {tendencies(taste.model).map((t) => (
                    <li key={t}>{t.startsWith('you') ? t[0].toUpperCase() + t.slice(1) : `You favour ${t}`}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing learned yet. Every pick and reject you make teaches Atelier your taste; choices you make by hand
            teach more than suggestions you accept. It retrains as you cull and whenever you close a project.
          </p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 400, margin: 0 }} className="row">
            <input type="checkbox" style={{ width: 'auto' }} checked={tasteData.blindBursts} onChange={(e) => setBlindBursts(e.target.checked)} />
            Show about one moment in ten without a suggestion, so my unprompted choice can be learned from
          </label>
          <div className="spacer" />
          <button onClick={relearn}>Learn now</button>
          {confirmForget ? (
            <>
              <button className="danger" onClick={() => void forgetLearning().then(() => setConfirmForget(false))}>
                Forget everything learned
              </button>
              <button onClick={() => setConfirmForget(false)}>Keep</button>
            </>
          ) : (
            taste && (
              <button className="link small" onClick={() => setConfirmForget(true)}>
                Forget
              </button>
            )
          )}
        </div>
      </div>

      <h2>Profiles</h2>
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void createProfile(name.trim(), splitTags(tags), '')
          setName('')
          setTags('')
        }}
      >
        <input style={{ flex: 1, minWidth: 200 }} placeholder="New profile name, e.g. Golden-hour elopements" value={name} onChange={(e) => setName(e.target.value)} aria-label="Profile name" />
        <input style={{ flex: 1, minWidth: 200 }} placeholder="Atmosphere words, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Atmosphere words" />
        <button className="primary" disabled={!name.trim()}>
          Create profile
        </button>
      </form>

      {learning.running && (
        <div className="card" style={{ marginTop: 12 }}>
          Studying the gallery: {learning.done} of {learning.total}
          <div className="bar" style={{ marginTop: 8 }}>
            <div style={{ width: `${(100 * learning.done) / Math.max(1, learning.total)}%` }} />
          </div>
        </div>
      )}

      {Object.keys(learned.balance).length > 0 && (
        <div className="note teach">
          <p>
            <b>Learned from your own decisions.</b>{' '}
            {Object.entries(learned.balance)
              .map(([genre, b]) => `${genre}: you weigh the moment at about ${Math.round(b!.value * 100)}% (from ${b!.projects} project${b!.projects > 1 ? 's' : ''})`)
              .join('; ')}
            . New projects of that kind start there.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {learned.styles.map((s) => (
          <ProfileCard key={s.id} style={s} />
        ))}
      </div>
      {!project && <p className="muted small" style={{ marginTop: 16 }}>Open a project to choose which profile it is culled with.</p>}
    </div>
  )
}

function ProfileCard({ style }: { style: Style }): React.JSX.Element {
  const { project, settings, learning, editProfile, addGallery, rememberPicks, distil, removeStyle, chooseStyle, notify } = useStore()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = project?.styleIds.includes(style.id) ?? false
  const picks = project?.shots.filter((x) => x.decision === 'pick').length ?? 0
  const stale = style.essence && style.profile && style.essenceCount !== style.profile.count

  const guard = async (job: () => Promise<void>): Promise<void> => {
    try {
      await job()
    } catch (err) {
      notify((err as Error).message)
    }
  }
  const gallery = (): Promise<void> =>
    guard(async () => {
      const folder = await window.studio.pickFolder()
      if (folder) await addGallery(style.id, folder.split(/[\\/]/).pop() ?? 'Gallery', folder)
    })

  return (
    <div className="card" style={active ? { borderColor: 'var(--gem)' } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <input
          style={{ fontWeight: 600, fontSize: 15, maxWidth: 360 }}
          value={style.name}
          aria-label="Profile name"
          onChange={(e) => void editProfile(style.id, { name: e.target.value })}
        />
        {project && (
          <button className={active ? 'primary' : ''} onClick={() => chooseStyle(active ? null : style.id)}>
            {active ? `Culling “${project.name}” with this` : 'Cull this project with it'}
          </button>
        )}
      </div>

      <label htmlFor={`tags-${style.id}`}>
        Atmosphere<span className="hint">comma separated; these steer the cull</span>
      </label>
      <input id={`tags-${style.id}`} defaultValue={style.tags.join(', ')} onBlur={(e) => void editProfile(style.id, { tags: splitTags(e.target.value) })} />
      <label htmlFor={`feel-${style.id}`}>
        The feeling<span className="hint">in your words; Claude reads this when it helps you cull</span>
      </label>
      <textarea id={`feel-${style.id}`} rows={2} defaultValue={style.feeling} onBlur={(e) => void editProfile(style.id, { feeling: e.target.value })} />

      <h3>What it has learned</h3>
      {style.profile ? (
        <>
          <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18, margin: '0 0 8px' }}>
            {profileFacts(style.profile).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
            <li>Suggests weighing the moment at about {Math.round(impliedBalance(style.profile) * 100)}%.</li>
          </ul>
          <div className="muted small">
            From: {style.sources.map((x) => `${x.name} (${x.count})`).join(', ')}
          </div>
          {style.samples.length > 0 && (
            <div className="film" style={{ marginTop: 8 }}>
              {style.samples.slice(-14).map((id) => (
                <img key={id} src={thumbUrl(styleCacheId(style.id), id)} alt="" style={{ width: 70, height: 48, objectFit: 'cover', borderRadius: 3 }} loading="lazy" />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted small">Nothing yet: so far it steers the cull by its atmosphere words alone. Add a gallery or your picks and it starts to learn.</p>
      )}

      {style.essence && (
        <div className="note teach" style={{ marginTop: 12 }}>
          <p>{style.essence.summary}</p>
          <p className="small">
            <b>How this photographer chooses</b>
          </p>
          <ul className="small" style={{ paddingLeft: 18, margin: '0 0 8px' }}>
            {style.essence.principles.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p className="small">
            <b>Look for:</b> {style.essence.lookFor.join(' · ')}
          </p>
          <p className="small">
            <b>Forgives:</b> {style.essence.forgive.join(' · ')}
          </p>
          {style.essence.usage && <p className="muted small">Distilling this cost {formatCost(style.essence.usage.costUsd)}.</p>}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => void gallery()} disabled={learning.running}>
          Learn from a gallery folder…
        </button>
        {project && (
          <button onClick={() => void guard(() => rememberPicks(style.id))} disabled={picks < 10} title={picks < 10 ? 'Needs at least ten picks in the open project' : ''}>
            Learn from my {picks} picks in “{project.name}”
          </button>
        )}
        {style.samples.length >= 6 &&
          (settings.hasApiKey ? (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void distil(style.id).finally(() => setBusy(false))
              }}
            >
              {busy ? 'Distilling…' : style.essence ? (stale ? 'Distil again (it has learned more)' : 'Distil again') : 'Distil the essence with Claude'}{' '}
              <span className="muted small">{estimateCost(settings.model, 600 + Math.min(36, style.samples.length) * 150, 2500)}</span>
            </button>
          ) : (
            <span className="muted small">Add an API key in Settings to have Claude put the essence into words.</span>
          ))}
        <div className="spacer" />
        {confirm ? (
          <>
            <button className="danger" onClick={() => void removeStyle(style.id)}>
              Delete profile
            </button>
            <button onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <button className="link small" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        A gallery is a folder of images you saved from a photographer's site or your own portfolio. Atelier measures
        them and keeps a few small thumbnails; the files are never changed or shared.
      </p>
    </div>
  )
}
