import { useEffect } from 'react'
import { useStore, type View } from './store'
import { Brief } from './views/Brief'
import { Diagnose } from './views/Diagnose'
import { Emotions } from './views/Emotions'
import { Cull } from './views/Cull'
import { Export } from './views/Export'
import { Import } from './views/Import'
import { Learn } from './views/Learn'
import { Projects } from './views/Projects'
import { Look } from './views/Look'
import { Profiles } from './views/Profiles'
import { SettingsView } from './views/Settings'
import { Story } from './views/Story'
import { TrainingView } from './views/Training'

const PROJECT_NAV: { view: View; label: string; hint: string }[] = [
  { view: 'brief', label: 'Brief', hint: 'What the work is for' },
  { view: 'import', label: 'Import', hint: 'Read and analyse the shoot' },
  { view: 'cull', label: 'Cull', hint: 'Choose the keepers' },
  { view: 'story', label: 'Story', hint: 'Sequence the selects' },
  { view: 'export', label: 'Hand off', hint: 'Send to Lightroom' }
]

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

  const picks = project?.shots.filter((s) => s.decision === 'pick').length ?? 0

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Atelier</div>
        <button className={`nav ${view === 'projects' ? 'active' : ''}`} onClick={() => (project ? closeProject() : setView('projects'))}>
          {project ? '← All projects' : 'Projects'}
        </button>
        {project && (
          <>
            <div className="nav-title" title={project.name}>
              {project.name}
            </div>
            {PROJECT_NAV.map((n, i) => (
              <button key={n.view} className={`nav ${view === n.view ? 'active' : ''}`} onClick={() => setView(n.view)} title={n.hint}>
                <span className="step">{i + 1}</span>
                {n.label}
                {n.view === 'cull' && project.shots.length > 0 && <span className="count">{picks}</span>}
              </button>
            ))}
          </>
        )}
        <div className="spacer" />
        <button className={`nav ${view === 'profiles' ? 'active' : ''}`} onClick={() => setView('profiles')} title="The kinds of work you do, and what the cull looks for in each">
          Shoot styles
        </button>
        <button className={`nav ${view === 'emotions' ? 'active' : ''}`} onClick={() => setView('emotions')} title="What the app can read on a face, and teaching it more">
          Emotions
          {emotions.pointers.length > 0 && <span className="count" style={{ color: 'var(--gem)' }}>{emotions.pointers.length}</span>}
        </button>
        <button className={`nav ${view === 'training' ? 'active' : ''}`} onClick={() => setView('training')} title="Teach Atelier with your own photographs">
          Training
        </button>
        <button className={`nav ${view === 'diagnose' ? 'active' : ''}`} onClick={() => setView('diagnose')} title="What is wrong with this picture, before you retouch it">
          Diagnose a photo
        </button>
        <button className={`nav ${view === 'look' ? 'active' : ''}`} onClick={() => setView('look')} title="Turn a photo's look into a preset or LUT">
          Look extractor
        </button>
        <button className={`nav ${view === 'learn' ? 'active' : ''}`} onClick={() => setView('learn')}>
          Learn
        </button>
        <button className={`nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
          Settings
        </button>
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
