import { useEffect } from 'react'
import { Icon } from './components/Icon'
import { useStore, type View } from './store'
import { Brief } from './views/Brief'
import { Cull } from './views/Cull'
import { Diagnose } from './views/Diagnose'
import { Emotions } from './views/Emotions'
import { Export } from './views/Export'
import { Import } from './views/Import'
import { Learn } from './views/Learn'
import { Look } from './views/Look'
import { Profiles } from './views/Profiles'
import { Projects } from './views/Projects'
import { SettingsView } from './views/Settings'
import { Story } from './views/Story'
import { TrainingView } from './views/Training'

const STEPS: { view: View; label: string; icon: string; hint: string }[] = [
  { view: 'brief', label: 'Brief', icon: 'brief', hint: 'The style of the shoot and what it is for' },
  { view: 'import', label: 'Import', icon: 'import', hint: 'Read and analyse the shoot' },
  { view: 'cull', label: 'Cull', icon: 'cull', hint: 'Choose the keepers' },
  { view: 'story', label: 'Story', icon: 'story', hint: 'Sequence the picks' },
  { view: 'export', label: 'Hand off', icon: 'handoff', hint: 'Send ratings to Lightroom' }
]

const LIBRARY: { view: View; label: string; icon: string; hint: string }[] = [
  { view: 'profiles', label: 'Shoot styles', icon: 'styles', hint: 'Your kinds of work, and what the cull looks for in each' },
  { view: 'emotions', label: 'Emotions', icon: 'emotions', hint: 'What the app reads on a face, and teaching it more' },
  { view: 'training', label: 'Training', icon: 'training', hint: 'Teach the app with your own photographs' }
]

const TOOLS: { view: View; label: string; icon: string; hint: string }[] = [
  { view: 'diagnose', label: 'Diagnose a photo', icon: 'diagnose', hint: 'What holds one picture back, before you retouch it' },
  { view: 'look', label: 'Look extractor', icon: 'look', hint: "Turn a photo's colour into a LUT or preset" }
]

function NavItem(props: { view?: View; label: string; icon: string; hint: string; active: boolean; onClick: () => void; badge?: React.ReactNode; done?: boolean }): React.JSX.Element {
  return (
    <button className={`nav ${props.active ? 'active' : ''}`} onClick={props.onClick} title={props.hint} aria-current={props.active ? 'page' : undefined}>
      <Icon name={props.icon} />
      <span className="nav-label">{props.label}</span>
      {props.badge !== undefined && props.badge !== null && <span className="nav-badge">{props.badge}</span>}
      {props.done && <span className="nav-done" aria-label="done"><Icon name="check" size={13} /></span>}
    </button>
  )
}

export function App(): React.JSX.Element {
  const { view, project, setView, closeProject, refreshProjects, loadSettings, loadLearned, loadLearning, loadTraining, loadEmotions, toast, emotions } = useStore()

  useEffect(() => {
    void refreshProjects()
    void loadSettings()
    void loadLearned()
    void loadLearning()
    void loadTraining()
    void loadEmotions()
  }, [refreshProjects, loadSettings, loadLearned, loadLearning, loadTraining, loadEmotions])

  const shots = project?.shots ?? []
  const picks = shots.filter((s) => s.decision === 'pick').length
  const undecided = shots.filter((s) => s.analysis && s.decision === null).length
  // A step counts as done once there is something to show for it; it is a guide, not a gate.
  const done: Partial<Record<View, boolean>> = {
    brief: !!project && (project.styleIds.length > 0 || !!project.brief.intention),
    import: shots.length > 0 && shots.every((s) => s.analysis || s.error),
    cull: shots.length > 0 && undecided === 0,
    story: (project?.storyOrder.length ?? 0) > 0
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Atelier</div>

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
              <NavItem
                key={n.view}
                {...n}
                active={view === n.view}
                onClick={() => setView(n.view)}
                done={done[n.view]}
                badge={n.view === 'cull' && shots.length ? `${picks}` : undefined}
              />
            ))}
          </>
        ) : (
          <NavItem view="projects" label="Projects" icon="projects" hint="Your shoots" active={view === 'projects'} onClick={() => setView('projects')} />
        )}

        <div className="nav-group">Library</div>
        {LIBRARY.map((n) => (
          <NavItem key={n.view} {...n} active={view === n.view} onClick={() => setView(n.view)} badge={n.view === 'emotions' && emotions.pointers.length ? emotions.pointers.length : undefined} />
        ))}
        <div className="nav-group">Tools</div>
        {TOOLS.map((n) => (
          <NavItem key={n.view} {...n} active={view === n.view} onClick={() => setView(n.view)} />
        ))}

        <div className="spacer" />
        <NavItem view="learn" label="Learn" icon="learn" hint="Articles on culling, colour, design and video" active={view === 'learn'} onClick={() => setView('learn')} />
        <NavItem view="settings" label="Settings" icon="settings" hint="API key, model, spending" active={view === 'settings'} onClick={() => setView('settings')} />
      </nav>
      <main className="main">
        {view === 'projects' && <Projects />}
        {view === 'profiles' && <Profiles />}
        {view === 'emotions' && <Emotions />}
        {view === 'training' && <TrainingView />}
        {view === 'diagnose' && <Diagnose />}
        {view === 'look' && <Look />}
        {view === 'learn' && <Learn />}
        {view === 'settings' && <SettingsView />}
        {project && view === 'brief' && <Brief />}
        {project && view === 'import' && <Import />}
        {project && view === 'cull' && <Cull />}
        {project && view === 'story' && <Story />}
        {project && view === 'export' && <Export />}
      </main>
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  )
}
