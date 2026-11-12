import { useState } from 'react'
import { MIN_TESTED_PAIRS, tendencies } from '../analysis/learner'
import { PageHeader } from '../components/PageHeader'
import { limitsFrom, trainingSummary } from '../analysis/training'
import { useStore } from '../store'

const KIND = { finished: 'Finished photographs', look: 'Before/after pairs', decisions: 'Past decisions' }

const plural = (n: number): string => (n === 0 ? 'No new frames' : n === 1 ? '1 frame' : `${n} frames`)

export function TrainingView(): React.JSX.Element {
  const { training, teaching, taste, tasteData, setBlindBursts, forgetLearning, relearn, project, learned, trainFinished, trainLook, teachFromRatings, teachFromDelivered, resetTraining, setView, notify } = useStore()
  const [stars, setStars] = useState(1)
  const [confirmForget, setConfirmForget] = useState(false)
  const summary = trainingSummary(training)
  const limits = limitsFrom(training)
  const pct = (v: number): string => `${Math.round(v * 100)}%`

  const run = async (job: () => Promise<string | void>): Promise<void> => {
    try {
      const message = await job()
      if (message) notify(message)
    } catch (err) {
      notify((err as Error).message)
    }
  }
  const folder = (): Promise<string | null> => window.studio.pickFolder()

  return (
    <div className="page wide">
      <PageHeader
        title="Training"
        lead="Atelier gets better at your work by studying your work. Each section teaches one part of it with your own photographs. Everything is learned on this computer, and each run adds to what it already knows."
      />

      {teaching.running && (
        <div className="card" style={{ marginBottom: 12 }}>
          {teaching.label}: {teaching.done} of {teaching.total}
          <div className="bar" style={{ marginTop: 8 }}>
            <div style={{ width: `${(100 * teaching.done) / Math.max(1, teaching.total)}%` }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>1. Culling: what you keep</h2>
          <p className="small">
            <b>Give it:</b> a past shoot you already culled. Create a project for it, import the folder with every frame,
            then use one of the buttons below. Decisions you made before Atelier count as your unprompted choices, the
            strongest evidence there is. It also learns from every decision you make while culling here.
          </p>
          <div className="your-eye">
          <h3>Your eye</h3>
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

          {project ? (
            <div className="row">
              <button disabled={teaching.running} onClick={() => void run(async () => `${plural(await teachFromRatings(stars))} learned from Lightroom ratings in “${project.name}”.`)}>
                Learn from Lightroom ratings in “{project.name}”
              </button>
              <label className="row" style={{ margin: 0, fontWeight: 400 }}>
                kept means at least
                <select style={{ width: 70 }} value={stars} onChange={(e) => setStars(Number(e.target.value))} aria-label="Minimum stars for a kept frame">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} ★
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={teaching.running}
                onClick={() =>
                  void run(async () => {
                    const f = await folder()
                    return f ? `${plural(await teachFromDelivered(f))} learned from the delivered files.` : undefined
                  })
                }
              >
                Learn from a folder of delivered files…
              </button>
            </div>
          ) : (
            <p className="small muted">Open the project of a past shoot to teach from its ratings or delivered files.</p>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>2. Diagnosis: what your finished work looks like</h2>
          <p className="small">
            <b>Give it:</b> a folder of finished photographs you are happy with (exports, portfolio). It measures each
            one, and from then on a new photo is flagged when it is worse than 85% of your own finished work, instead of
            against a general standard. Your "agree" and "not a problem" answers in Diagnose adjust it further.
          </p>
          <p className="small muted">{summary.diagnosis}</p>
          {limits.basis && (
            <p className="small muted">
              Your limits now: outline lost above {pct(limits.mergedSome)}; attention on the subject below {pct(limits.attentionLow)}; skin hue outside{' '}
              {limits.skinHue[0].toFixed(0)}° to {limits.skinHue[1].toFixed(0)}°; background clutter above {limits.clutter.toFixed(2)}×.
            </p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={teaching.running}
              onClick={() =>
                void run(async () => {
                  const f = await folder()
                  if (f) await trainFinished(f)
                })
              }
            >
              Train on finished photographs…
            </button>
            {Object.keys(training.norms).length > 0 && (
              <button className="link small" onClick={() => resetTraining('norms')}>
                Forget these norms
              </button>
            )}
            {Object.keys(training.feedback).length > 0 && (
              <button className="link small" onClick={() => resetTraining('feedback')}>
                Forget my feedback ({Object.values(training.feedback).reduce((n, f) => n + f.agree + f.dismiss, 0)} answers)
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Look: your own colour</h2>
          <p className="small">
            <b>Give it:</b> two folders: unedited frames (RAW or JPEG), and the finished versions with the same file
            names. It measures the change in each pair and averages them into your house look, which you can save as a
            LUT or Lightroom preset from the Look extractor.
          </p>
          <p className="small muted">{summary.look}</p>
          <div className="row">
            <button
              className="primary"
              disabled={teaching.running}
              onClick={() =>
                void run(async () => {
                  notify('First choose the folder of unedited frames, then the folder of finished photos.')
                  const before = await folder()
                  const after = before ? await folder() : null
                  if (before && after) await trainLook(before, after)
                })
              }
            >
              Train on before/after pairs…
            </button>
            {training.houseLook && (
              <>
                <button onClick={() => setView('look')}>Open the Look extractor</button>
                <button className="link small" onClick={() => resetTraining('houseLook')}>
                  Forget this look
                </button>
              </>
            )}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>4. Shoot styles</h2>
          <p className="small">
            <b>Give it:</b> a folder of photographs that share a feeling (a photographer you admire, or your own best
            work of one kind). Each profile keeps what it learns and steers the cull when you choose it.
          </p>
          <p className="small muted">
            {learned.styles.filter((s) => s.profile).length} of {learned.styles.length} profiles have learned from photographs.
          </p>
          <button onClick={() => setView('profiles')}>Open Culling profiles</button>
        </section>
      </div>

      <h2>Training log</h2>
      {training.log.length === 0 && <p className="muted small">No training runs yet.</p>}
      {[...training.log].reverse().map((e, i) => (
        <div className="row small" key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
          <span className="muted" style={{ width: 150 }}>{new Date(e.at).toLocaleString()}</span>
          <b style={{ width: 180 }}>{KIND[e.kind]}</b>
          <span>
            {e.count} from {e.name}
          </span>
        </div>
      ))}
      <p className="muted small" style={{ marginTop: 16 }}>
        A step-by-step guide to training, with what to give it and how much, is in <code>docs/TRAINING.md</code>.
      </p>
    </div>
  )
}
