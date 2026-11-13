import { useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { Mark } from './components/Mark'
import { useStore, type View } from './store'
import { Brief } from './views/Brief'
import { Cull } from './views/Cull'
import { Diagnose } from './views/Diagnose'
import { Emotions } from './views/Emotions'
import { Export } from './views/Export'
import { Guide } from './views/Guide'
import { Import } from './views/Import'
import { Learn } from './views/Learn'
import { Look } from './views/Look'
import { People } from './views/People'
import { Profiles } from './views/Profiles'
import { Projects } from './views/Projects'
import { SettingsView } from './views/Settings'
import { Story } from './views/Story'
import { TrainingView } from './views/Training'
import { ClaudeRecord, Gestures, Overview, Reasons, Taste, Words } from './views/Workshop'
import { ReviewView } from './views/Review'

type Item = { view: View; label: string; icon: string; hint: string }

const STEPS: Item[] = [
  { view: 'brief', label: 'Brief', icon: 'brief', hint: 'The style of the shoot and what it is for' },
  { view: 'import', label: 'Import', icon: 'import', hint: 'Read and analyse the shoot' },
  { view: 'people', label: 'People', icon: 'people', hint: 'Who is in the shoot, and who matters most' },
  { view: 'cull', label: 'Cull', icon: 'cull', hint: 'Choose the keepers' },
  { view: 'story', label: 'Story', icon: 'story', hint: 'Sequence the picks' },
  { view: 'export', label: 'Hand off', icon: 'handoff', hint: 'Send ratings to Lightroom' }
]

const TOOLS: Item[] = [
  { view: 'diagnose', label: 'Diagnose a photo', icon: 'diagnose', hint: 'What holds one picture back, before you retouch it' },
  { view: 'look', label: 'Look extractor', icon: 'look', hint: "Turn a photo's colour into a LUT or preset" }
]

/** The workshop window's sections: what the app has learned, and teaching it. */
const WORKSHOP: { group: string; items: Item[] }[] = [
  { group: '', items: [{ view: 'overview', label: 'Overview', icon: 'knowledge', hint: 'Everything learned, at a glance, and how well it predicts you' }] },
  {
    group: 'What it has learned',
    items: [
      { view: 'taste', label: 'Your eye', icon: 'training', hint: 'Which frames you keep, learned from your decisions' },
      { view: 'profiles', label: 'Shoot styles', icon: 'styles', hint: 'Your kinds of work, and what the cull looks for in each' },
      { view: 'emotions', label: 'Emotions', icon: 'emotions', hint: 'What it reads on a face' },
      { view: 'gestures', label: 'Gestures', icon: 'people', hint: 'What it reads in a body' },
      { view: 'words', label: 'What is happening', icon: 'story', hint: 'Words for what goes on in a frame' },
      { view: 'reasons', label: 'Mistakes and reasons', icon: 'cull', hint: 'Which flaws you forgive, and why you reject' },
      { view: 'claude', label: 'Claude', icon: 'sparkle', hint: 'Where you and Claude agreed and differed' }
    ]
  },
  {
    group: 'Teach',
    items: [
      { view: 'training', label: 'Teach with photos', icon: 'import', hint: 'Past shoots, finished work, your colour' },
      { view: 'review', label: 'Review with Claude', icon: 'sparkle', hint: 'Claude reads what has been collected and proposes how it should shape the cull' }
    ]
  }
]

const IS_WORKSHOP = location.hash.startsWith('#workshop')

function NavItem(props: Item & { active: boolean; onClick: () => void; badge?: React.ReactNode; done?: boolean }): React.JSX.Element {
  return (
    <button className={`nav ${props.active ? 'active' : ''}`} onClick={props.onClick} title={`${props.label}: ${props.hint}`} aria-label={props.label} aria-current={props.active ? 'page' : undefined}>
      <Icon name={props.icon} />
      <span className="nav-label">{props.label}</span>
      {props.badge !== undefined && props.badge !== null && <span className="nav-badge">{props.badge}</span>}
      {props.done && (
        <span className="nav-done" aria-label="done">
          <Icon name="check" size={13} />
        </span>
      )}
    </button>
  )
}

/** Loads what both windows need, and keeps this window in step with what the other one saves. */
function useLoad(): void {
  const { refreshProjects, loadSettings, loadLearned, loadLearning, loadTraining, loadEmotions, loadKnowledge, reloadChanged } = useStore()
  useEffect(() => {
    void refreshProjects()
    void loadSettings()
    void loadLearned()
    // What was learned from Claude and from past trade-offs is needed before the first scoring.
    void loadKnowledge().then(loadLearning)
    void loadTraining()
    void loadEmotions()
    return window.studio.onChanged((name) => void reloadChanged(name))
  }, [refreshProjects, loadSettings, loadLearned, loadLearning, loadTraining, loadEmotions, loadKnowledge, reloadChanged])
}

export function App(): React.JSX.Element {
  return IS_WORKSHOP ? <WorkshopApp /> : <StudioApp />
}

function Toast(): React.JSX.Element {
  const toast = useStore((s) => s.toast)
  const undo = useStore((s) => s.toastUndo)
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast">
          <span>{toast}</span>
          {undo && (
            <button className="link" onClick={undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StudioApp(): React.JSX.Element {
  useLoad()
  const { view, project, setView, closeProject, emotions, settings, chrome } = useStore()
  // While culling, the menu shrinks to icons so that the photo has the room; it can be opened again.
  const [wide, setWide] = useState(false)
  const rail = view === 'cull' && !wide
  const shots = project?.shots ?? []
  const picks = shots.filter((s) => s.decision === 'pick').length
  const undecided = shots.filter((s) => s.analysis && s.decision === null).length
  // A step counts as done once there is something to show for it; it is a guide, not a gate.
  const done: Partial<Record<View, boolean>> = {
    brief: !!project && (project.styleIds.length > 0 || !!project.brief.intention),
    import: shots.length > 0 && shots.every((s) => s.analysis || s.error),
    people: (project?.people ?? []).some((p) => p.key),
    cull: shots.length > 0 && undecided === 0,
    story: (project?.storyOrder.length ?? 0) > 0
  }

  return (
    <div className={`app ${view === 'cull' && chrome.focus ? 'focus' : ''}`}>
      <nav className={`sidebar ${rail ? 'rail' : ''}`} aria-label="Main">
        <div className="brand">
          <Mark />
          <span className="brand-name">Sift</span>
          {view === 'cull' && (
            <button className="ghost rail-toggle" onClick={() => setWide(!wide)} title={rail ? 'Show the menu' : 'Shrink the menu to icons'} aria-label={rail ? 'Show the menu' : 'Shrink the menu'}>
              <Icon name="menu" size={16} />
            </button>
          )}
        </div>

        {project ? (
          <>
            <button className="nav nav-back" onClick={closeProject} title="Close this project and see all projects">
              <Icon name="back" />
              <span className="nav-label">All projects</span>
            </button>
            <div className="nav-project" title={project.name}>
              {project.name}
            </div>
            {STEPS.map((n) => (
              <NavItem key={n.view} {...n} active={view === n.view} onClick={() => setView(n.view)} done={done[n.view]} badge={n.view === 'cull' && shots.length ? `${picks}` : undefined} />
            ))}
          </>
        ) : (
          <NavItem view="projects" label="Projects" icon="projects" hint="Your shoots" active={view === 'projects'} onClick={() => setView('projects')} />
        )}

        <div className="nav-group">Tools</div>
        <div className="nav-group-rule" />
        {TOOLS.map((n) => (
          <NavItem key={n.view} {...n} active={view === n.view} onClick={() => setView(n.view)} />
        ))}

        <div className="spacer" />
        <button className="workshop-link" onClick={() => void window.studio.openWorkshop()} title="Workshop: what the app has learned, and teaching it more. Opens in its own window." aria-label="Workshop">
          <Icon name="knowledge" />
          <span>
            <b>Workshop</b>
            <small>what it has learned</small>
          </span>
          {emotions.pointers.length > 0 && <span className="nav-badge" title={`${emotions.pointers.length} expressions waiting for a name`}>{emotions.pointers.length}</span>}
        </button>
        <NavItem view="learn" label="Learn" icon="learn" hint="Articles on culling, colour, design and video" active={view === 'learn'} onClick={() => setView('learn')} />
        <NavItem view="settings" label="Settings" icon="settings" hint="Claude, updates, backups" active={view === 'settings'} onClick={() => setView('settings')} />
      </nav>
      <main className="main">
        {view === 'projects' && <Projects />}
        {view === 'diagnose' && <Diagnose />}
        {view === 'look' && <Look />}
        {view === 'learn' && <Learn />}
        {view === 'settings' && <SettingsView />}
        {project && view === 'brief' && <Brief />}
        {project && view === 'import' && <Import />}
        {project && view === 'people' && <People />}
        {project && view === 'cull' && <Cull />}
        {project && view === 'story' && <Story />}
        {project && view === 'export' && <Export />}
      </main>
      {!settings.guide.done && <Guide />}
      <Toast />
    </div>
  )
}

function WorkshopApp(): React.JSX.Element {
  useLoad()
  const { view, setView, emotions } = useStore()
  // Open at the section asked for, and follow later requests from the studio window.
  useEffect(() => {
    const first = location.hash.split('/')[1] as View | undefined
    setView(first || 'overview')
    return window.studio.onWorkshopGo((section) => setView(section as View))
  }, [setView])
  return (
    <div className="app workshop">
      <nav className="sidebar" aria-label="Workshop">
        <div className="brand">
          <Mark />
          <span className="brand-name">Workshop</span>
        </div>
        {WORKSHOP.map((g) => (
          <div key={g.group || 'top'}>
            {g.group && <div className="nav-group">{g.group}</div>}
            {g.items.map((n) => (
              <NavItem key={n.view} {...n} active={view === n.view} onClick={() => setView(n.view)} badge={n.view === 'emotions' && emotions.pointers.length ? emotions.pointers.length : undefined} />
            ))}
          </div>
        ))}
        <div className="spacer" />
        <button className="nav" onClick={() => void window.studio.focusStudio()} title="Back to the main window">
          <Icon name="back" />
          <span className="nav-label">Back to the studio</span>
        </button>
      </nav>
      <main className="main">
        {view === 'overview' && <Overview />}
        {view === 'taste' && <Taste />}
        {view === 'profiles' && <Profiles />}
        {view === 'emotions' && <Emotions />}
        {view === 'gestures' && <Gestures />}
        {view === 'words' && <Words />}
        {view === 'reasons' && <Reasons />}
        {view === 'claude' && <ClaudeRecord />}
        {view === 'training' && <TrainingView />}
        {view === 'review' && <ReviewView />}
      </main>
      <Toast />
    </div>
  )
}
