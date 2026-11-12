import { useState } from 'react'
import { MIN_TESTED_PAIRS } from '../analysis/learner'
import { habitsFrom, limitsFrom, trainingSummary } from '../analysis/training'
import { useStore } from '../store'

const KIND = { finished: 'Finished photographs', edits: 'Lightroom edits', look: 'Before/after pairs', decisions: 'Past decisions' }

const plural = (n: number): string => (n === 0 ? 'No new frames' : n === 1 ? '1 frame' : `${n} frames`)

export function TrainingView(): React.JSX.Element {
  const { training, teaching, taste, project, learned, trainFinished, trainEdits, trainLook, teachFromRatings, teachFromDelivered, resetTraining, setView, notify } = useStore()
  const [stars, setStars] = useState(1)
  const summary = trainingSummary(training)
  const habits = habitsFrom(training)
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
      <h1>Training</h1>
      <p className="lead">
        Atelier gets better at your work by studying your work. Give it photographs and it adjusts each of its
        functions to you. Everything is learned on this computer; nothing is uploaded. Train as often as you like:
        each run adds to what it knows.
      </p>

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
          <p className="small muted">
            {taste
              ? `So far: ${taste.report.decisions} decisions from ${taste.report.projects} project${taste.report.projects === 1 ? '' : 's'}. ${
                  taste.report.testedPairs >= MIN_TESTED_PAIRS
                    ? `On bursts it was never shown, the built-in rules agree with you ${pct(taste.report.rulesAgree)} of the time and the trained suggestions ${pct(taste.report.blendedAgree)}; your learned taste has ${pct(taste.trust)} of the say.`
                    : `It needs ${MIN_TESTED_PAIRS - taste.report.testedPairs} more comparisons in set-aside bursts before the training may change suggestions.`
                }`
              : 'Nothing learned yet.'}
          </p>
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
          <button className="link small" style={{ marginTop: 8 }} onClick={() => setView('profiles')}>
            See what it has learned about your eye
          </button>
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
          <h2 style={{ marginTop: 0 }}>3. Edit coach: how you edit</h2>
          <p className="small">
            <b>Give it:</b> a folder of RAW files you edited in Lightroom, with their XMP sidecars (Catalog Settings →
            Metadata → Automatically write changes into XMP, or select the photos and press Ctrl+S). It learns the range
            you normally use for each slider. Tips then point out when you leave your own range, and stop flagging
            values that are simply your style.
          </p>
          <p className="small muted">{summary.habits}</p>
          {Object.keys(habits).length > 0 && (
            <p className="small muted">
              Your usual ranges:{' '}
              {['Exposure2012', 'Contrast2012', 'Clarity2012', 'Vibrance', 'Saturation', 'Sharpness']
                .filter((k) => habits[k])
                .map((k) => `${k.replace('2012', '')} ${habits[k].lo.toFixed(k === 'Exposure2012' ? 2 : 0)} to ${habits[k].hi.toFixed(k === 'Exposure2012' ? 2 : 0)}`)
                .join(' · ')}
            </p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={teaching.running}
              onClick={() =>
                void run(async () => {
                  const f = await folder()
                  if (f) await trainEdits(f)
                })
              }
            >
              Train on an edited shoot…
            </button>
            {Object.keys(training.habits).length > 0 && (
              <button className="link small" onClick={() => resetTraining('habits')}>
                Forget these habits
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>4. Look: your own colour</h2>
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
          <h2 style={{ marginTop: 0 }}>5. Culling profiles: a feeling to cull for</h2>
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
