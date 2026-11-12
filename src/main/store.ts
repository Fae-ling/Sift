import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { DEFAULT_MODEL, MODELS, styleCacheId, type Learned, type Project, type ProjectSummary, type Settings } from '@shared/types'

export const projectsRoot = (): string => join(app.getPath('userData'), 'projects')
const projectDir = (id: string): string => join(projectsRoot(), safeId(id))
export const cacheDir = (id: string): string => join(projectDir(id), 'cache')
export const tmpDir = (id: string): string => join(projectDir(id), 'tmp')

/** Ids become folder and file names, so they must not be able to escape the root. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid id: ${id}`)
  return id
}

/** Resolves a media:// path and guarantees it stays inside the projects folder. */
export function resolveMediaPath(relative: string): string {
  const root = resolve(projectsRoot())
  const full = resolve(root, relative)
  if (!full.startsWith(root + sep)) throw new Error('Path outside the projects folder')
  return full
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await fs.mkdir(projectsRoot(), { recursive: true })
  const out: ProjectSummary[] = []
  for (const id of await fs.readdir(projectsRoot())) {
    try {
      const p = await loadProject(id)
      out.push({
        id: p.id,
        name: p.name,
        genre: p.genre,
        client: p.brief.client,
        updatedAt: p.updatedAt,
        shotCount: p.shots.length,
        pickCount: p.shots.filter((s) => s.decision === 'pick').length
      })
    } catch {
      // Not a project folder, or unreadable: leave it alone.
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * A project is stored in two files. `project.json` holds the decisions and is
 * rewritten often; `analysis.json` holds the measurements of every frame,
 * which are large and change only during import. Scores are not stored at all:
 * they are worked out again when the project opens.
 */
async function readProject(dir: string, file: string): Promise<Project> {
  const project = JSON.parse(await fs.readFile(join(dir, file), 'utf8')) as Project
  try {
    const analysis = JSON.parse(await fs.readFile(join(dir, 'analysis.json'), 'utf8')) as Record<string, Project['shots'][0]['analysis']>
    for (const shot of project.shots) if (!shot.analysis && analysis[shot.id]) shot.analysis = analysis[shot.id]
  } catch {
    // An older project keeps its measurements inside project.json.
  }
  return project
}

export async function loadProject(id: string): Promise<Project> {
  const dir = projectDir(id)
  try {
    return await readProject(dir, 'project.json')
  } catch (err) {
    // A damaged project file: fall back to the last backup rather than lose the cull.
    try {
      return await readProject(dir, 'project.bak.json')
    } catch {
      throw err
    }
  }
}

const BACKUP_EVERY_MS = 10 * 60 * 1000

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.writeFile(file + '.tmp', text)
  await fs.rename(file + '.tmp', file)
}

export async function saveProject(project: Project, analysisChanged = true): Promise<void> {
  const dir = projectDir(project.id)
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, 'project.json')
  const backup = join(dir, 'project.bak.json')
  // Keep a copy of the previous state, refreshed at most every ten minutes.
  const age = await fs.stat(backup).then(
    (st) => Date.now() - st.mtimeMs,
    () => Infinity
  )
  if (age > BACKUP_EVERY_MS) await fs.copyFile(file, backup).catch(() => {})
  const analysisFile = join(dir, 'analysis.json')
  const haveAnalysis = await fs.access(analysisFile).then(
    () => true,
    () => false
  )
  if (analysisChanged || !haveAnalysis) {
    await writeAtomic(analysisFile, JSON.stringify(Object.fromEntries(project.shots.flatMap((s) => (s.analysis ? [[s.id, s.analysis]] : [])))))
  }
  const light = { ...project, shots: project.shots.map(({ analysis: _a, score: _s, ...rest }) => rest) }
  await writeAtomic(file, JSON.stringify(light))
}

/** Removes the project record and its preview cache. Original photos are never touched. */
export async function removeProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true })
}

// --- what the app has learned (shared by all projects) ---

const learnedFile = (): string => join(app.getPath('userData'), 'learned.json')

export async function getLearned(): Promise<Learned> {
  try {
    return JSON.parse(await fs.readFile(learnedFile(), 'utf8'))
  } catch {
    return { styles: [], balance: {} }
  }
}

export async function saveLearned(learned: Learned): Promise<void> {
  const tmp = learnedFile() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(learned))
  await fs.rename(tmp, learnedFile())
}

export const removeStyleSamples = (styleId: string): Promise<void> => removeProject(styleCacheId(styleId))

// --- named stores of what the app has learned ---

const DATA_NAMES = ['emotions']

export async function getData(name: string): Promise<unknown> {
  if (!DATA_NAMES.includes(name)) throw new Error(`Unknown store: ${name}`)
  try {
    return JSON.parse(await fs.readFile(join(app.getPath('userData'), `${name}.json`), 'utf8'))
  } catch {
    return null
  }
}

export async function saveData(name: string, value: unknown): Promise<void> {
  if (!DATA_NAMES.includes(name)) throw new Error(`Unknown store: ${name}`)
  await writeAtomic(join(app.getPath('userData'), `${name}.json`), JSON.stringify(value))
}

// --- examples the taste model learns from ---

const learningFile = (): string => join(app.getPath('userData'), 'learning.json')

export async function getLearning(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(learningFile(), 'utf8'))
  } catch {
    return null
  }
}

export async function saveLearning(data: unknown): Promise<void> {
  const tmp = learningFile() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, learningFile())
}

// --- what was learned from photographs provided for training ---

const trainingFile = (): string => join(app.getPath('userData'), 'training.json')

export async function getTraining(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(trainingFile(), 'utf8'))
  } catch {
    return null
  }
}

export async function saveTraining(data: unknown): Promise<void> {
  const tmp = trainingFile() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, trainingFile())
}

// --- what the optional AI advice has cost ---

const spendFile = (): string => join(app.getPath('userData'), 'spend.json')

export async function getSpend(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await fs.readFile(spendFile(), 'utf8'))
  } catch {
    return {}
  }
}

export async function recordSpend(usd: number): Promise<void> {
  const spend = await getSpend()
  const month = new Date().toISOString().slice(0, 7)
  spend[month] = (spend[month] ?? 0) + usd
  await fs.writeFile(spendFile(), JSON.stringify(spend))
}

// --- settings ---------------------------------------------------------------

interface StoredSettings {
  model?: string
  apiKeyEnc?: string
}
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')
/** Used when the OS offers no encrypted storage: the key then lives for this session only. */
let sessionKey: string | null = null

async function readStored(): Promise<StoredSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

export async function getApiKey(): Promise<string | null> {
  if (sessionKey) return sessionKey
  const s = await readStored()
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'))
    } catch {
      return null
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null
}

export async function getModel(): Promise<string> {
  const { model } = await readStored()
  return MODELS.some((m) => m.id === model) ? model! : DEFAULT_MODEL
}

export async function getSettings(): Promise<Settings> {
  return { hasApiKey: !!(await getApiKey()), model: await getModel() }
}

export async function setSettings(patch: { apiKey?: string; model?: string }): Promise<Settings> {
  const s = await readStored()
  if (patch.model && MODELS.some((m) => m.id === patch.model)) s.model = patch.model
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey.trim()
    sessionKey = null
    delete s.apiKeyEnc
    if (key) {
      if (safeStorage.isEncryptionAvailable()) s.apiKeyEnc = safeStorage.encryptString(key).toString('base64')
      else sessionKey = key
    }
  }
  await fs.writeFile(settingsFile(), JSON.stringify(s))
  return getSettings()
}
