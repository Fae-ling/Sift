// End-to-end smoke test: launches the built app, imports a folder of photos
// and checks that analysis, culling and the Lightroom hand-off work.
//
//   ATELIER_SAMPLES=/path/to/photos npm run test:e2e
//
// On a machine without a display, prefix with `xvfb-run -a`.
import { createRequire } from 'node:module'
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Playwright is expected to be installed on the machine (it is not a project dependency).
const require = createRequire(import.meta.url)
const { _electron: electron } = require('playwright')

const samples = process.env.ATELIER_SAMPLES
if (!samples) throw new Error('Set ATELIER_SAMPLES to a folder of photos')
const shotsDir = process.env.ATELIER_SCREENSHOTS
const userData = mkdtempSync(join(tmpdir(), 'atelier-e2e-'))
// Unprompted bursts are chosen pseudo-randomly per project; they are off unless ATELIER_BLIND=1, so the run is repeatable.
writeFileSync(join(userData, 'learning.json'), JSON.stringify({ version: 1, blindBursts: process.env.ATELIER_BLIND === '1', projects: {} }))

// Set ATELIER_APP to a packaged executable to test the installed form of the app.
const packaged = process.env.ATELIER_APP
const app = await electron.launch({
  executablePath: packaged ?? require('electron'),
  // Software WebGL, so the face model also runs on machines without a graphics card.
  args: [...(packaged ? [] : [resolve('out/main/index.js')]), '--no-sandbox', '--enable-unsafe-swiftshader'],
  env: { ...process.env, ATELIER_USER_DATA: userData, ANTHROPIC_API_KEY: 'stand-in' }
})
const errors = []
/** Waits until a count read from the window satisfies a condition: the window redraws a moment after a key press. */
async function until(read, ok, message) {
  const deadline = Date.now() + 15_000
  for (;;) {
    const value = await read()
    if (ok(value)) return value
    if (Date.now() > deadline) assert.fail(`${message} (last value: ${value})`)
    await new Promise((r) => setTimeout(r, 150))
  }
}
let page
try {
  page = await app.firstWindow()
  // The face library tries to send usage statistics; the app's security policy blocks it, which logs an error.
  const expected = (text) => /odml\.pa\.googleapis\.com|Content Security Policy|^INFO: /.test(text)
  page.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  const snap = async (name) => shotsDir && (await page.screenshot({ path: join(shotsDir, `${name}.png`) }))

  // The folder picker is a native dialog; answer it from the test.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, samples)

  // The paid editor's read is replaced by a stand-in, so the test spends nothing and needs no key.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai:essence')
    ipcMain.handle('ai:essence', () => ({ summary: 'Stand-in essence.', principles: ['Keeps laughter.'], lookFor: ['Hands'], forgive: ['Blur'] }))
    ipcMain.removeHandler('ai:developStyle')
    ipcMain.handle('ai:developStyle', (_event, req) => ({
      feeling: 'Stand-in feeling.', tags: ['stand-in'], chapters: [{ name: 'Only chapter', look: 'Anything.', must: true }],
      emotions: [{ name: 'triumph', weight: 0.9, why: '' }], lookFor: ['A marker'], forgive: ['Blur'], balance: 0.6, notes: `Stand-in notes for ${req.name}.`
    }))
    ipcMain.removeHandler('ai:atmosphere')
    ipcMain.handle('ai:atmosphere', () => ({
      reading: 'Stand-in reading.', moves: [{ what: 'Cool the shadows.', why: 'Stand-in.' }],
      look: { blackLift: 0.05, whiteHold: 0.95, contrast: 0.1, shadowHue: 220, shadowStrength: 12, midHue: 40, midStrength: 4, highlightHue: 45, highlightStrength: 6, saturation: 0.85 }
    }))
    ipcMain.removeHandler('ai:read')
    ipcMain.handle('ai:read', (_event, req) => ({
      reads: Object.fromEntries(
        req.frames.map((f) => [f.shotId, { beat: req.beats[0].name, emotion: 'joy', moment: 9, gem: !!f.flaws, note: 'Stand-in read.', what: 'Someone looks into the camera.', tags: ['portrait sitting'], gesture: 'none' }])
      ),
      usage: { model: 'stand-in', inputTokens: 1000, outputTokens: 100, costUsd: 0.01 }
    }))
  })
  await page.reload()

  // The first-run guide: add a kind of work, learn from a past shoot, then put the guide away.
  await page.getByRole('dialog', { name: 'Setting up Sift' }).waitFor()
  await snap('0-guide')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByLabel('Style name').fill('LARP night')
  await page.getByRole('button', { name: 'Add style' }).click()
  await page.locator('.chip.big', { hasText: 'LARP night' }).waitFor()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: /Choose its folder of originals/ }).click()
  await page.getByRole('button', { name: 'Learn from this shoot' }).click()
  await page.getByText(/Learned from \d+ decisions?|nothing to learn from/).waitFor({ timeout: 300_000 })
  await snap('0-guide-past-shoot')
  await page.getByRole('button', { name: 'Skip the guide' }).click()
  await page.getByRole('dialog', { name: 'Setting up Sift' }).waitFor({ state: 'detached' })
  assert.match(readFileSync(join(userData, 'settings.json'), 'utf8'), /"done":true/, 'the guide stays put away')

  await page.getByLabel('Project name').fill('Smoke test')
  await page.getByLabel('Shoot style').selectOption({ label: 'Wedding' })
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByLabel('Mood words').fill('warm, quiet')
  assert.equal(await page.getByLabel('Chapter 4 name').inputValue(), 'Ceremony', 'a wedding gets the wedding story plan')
  await snap('1-brief')
  await page.getByRole('button', { name: /import the shoot/ }).click()
  await page.getByRole('button', { name: /Choose shoot folder/ }).click()
  await page.getByText('frames read').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => !document.body.innerText.includes('Analysing'), null, { timeout: 120_000 })
  await snap('2-import')
  await page.getByRole('button', { name: 'Start culling' }).click()
  await snap('3-cull')

  const photoCount = readdirSync(samples).filter((f) => /\.(jpe?g|raf|arw)$/i.test(f)).length
  assert.equal(await page.locator('.strip .thumb').count(), photoCount, 'every photo appears in the strip')
  assert.ok((await page.locator('.strip .flag.s-pick').count()) > 0, 'some keepers are suggested')

  // The editor's read sorts frames into chapters and feeds the moment score.
  // Ultrafast cull: misfires go in one step, and one undo brings them back.
  await page.getByRole('button', { name: 'Ultrafast cull' }).click()
  const reject = page.getByRole('button', { name: /^Reject \d+ frames/ })
  if (await reject.isEnabled()) {
    await reject.click()
    await until(() => page.locator('.strip .flag.reject').count(), (n) => n > 0, 'the ultrafast cull rejects frames')
    await page.keyboard.press('Control+z')
    await until(() => page.locator('.strip .flag.reject').count(), (n) => n === 0, 'and one undo restores them')
  } else {
    await page.getByRole('button', { name: 'Ultrafast cull' }).click()
  }

  // Teach the emotion machine from a face: name what it shows.
  const person = page.locator('.strip .stack.multi .thumb').first()
  if (await person.count()) {
    await person.click()
    const label = page.locator('.inspector .closeup button').first()
    if (await label.count()) {
      await label.click()
      await page.getByLabel('Emotion on this face').fill('pride')
      await page.getByRole('button', { name: 'Teach', exact: true }).click()
      await page.locator('.inspector .closeup button', { hasText: 'pride' }).first().waitFor()
    }
    await page.locator('.strip .thumb').first().click()
  }

  await page.getByRole('button', { name: 'Cull with Claude' }).click()
  await page.getByRole('button', { name: 'Read the shoot' }).click()
  await page.getByText('Every moment has been read.').waitFor()
  await page.getByText(/Claude, 9\/10/).first().waitFor()
  assert.notEqual(await page.locator('.scene-chapter').first().inputValue(), '', 'scenes are labelled with their chapter')
  await snap('3-cull-read')
  await page.getByRole('button', { name: 'Cull with Claude' }).click()

  // Enter accepts the suggestion for the current moment and moves to the next one.
  const moments = await page.locator('.strip .stack').count()
  for (let i = 0; i < moments; i++) await page.keyboard.press('Enter')
  // Decisions can be undone and redone.
  const picked = await until(() => page.locator('.strip .flag.pick').count(), (n) => n > 0, 'accepting suggestions makes picks')
  await page.keyboard.press('Control+z')
  await until(() => page.locator('.strip .flag.pick').count(), (n) => n < picked, 'undo takes back the last decision')
  await page.keyboard.press('Control+Shift+z')
  await until(() => page.locator('.strip .flag.pick').count(), (n) => n === picked, 'redo restores it')

  // Side-by-side compare, for a moment with more than one take.
  const multi = page.locator('.strip .stack.multi .thumb').first()
  if (await multi.count()) {
    await multi.click()
    await page.keyboard.press('c')
    await page.locator('.two-up figure').nth(1).waitFor()
    await snap('3-cull-compare')
    await page.keyboard.press('c')
  }

  // The second look lists the best frame of every moment nothing was kept from.
  await page.getByLabel('More filters').selectOption('unkept')
  await snap('3-cull-second-look')
  await page.getByRole('button', { name: /^All \d/ }).click()

  // Several frames chosen with Ctrl-click are rejected in one go, and the reason is asked for.
  await page.locator('.strip .thumb').nth(0).click()
  await page.locator('.strip .thumb').nth(1).click({ modifiers: ['Control'] })
  await page.getByText('2 chosen').waitFor()
  await snap('3-cull-chosen')
  await page.keyboard.press('x')
  await page.getByText('Why (2 frames)?').waitFor()
  await snap('3-cull-why')
  await page.keyboard.press('4')
  await until(() => page.locator('.strip .thumb[title*="rejected: awkward pose"]').count(), (n) => n === 2, 'both frames carry the reason')
  await page.keyboard.press('Escape')
  await page.getByText('2 chosen').waitFor({ state: 'detached' })

  // A hidden gem is left for the photographer to decide; decide the first frame by hand.
  await page.locator('.strip .thumb').first().click()
  await page.keyboard.press('p')
  assert.ok((await page.locator('.strip .flag.pick').count()) >= 1, 'accepting a suggestion makes a pick')
  await snap('3-cull-accepted')

  // The workshop opens in a window of its own; the decisions made above have been learned from.
  const [ws] = await Promise.all([app.waitForEvent('window'), page.locator('.workshop-link').click()])
  ws.on('console', (m) => m.type() === 'error' && !expected(m.text()) && errors.push(`workshop: ${m.text()}`))
  ws.on('pageerror', (e) => errors.push(`workshop: ${e}`))
  const wsnap = async (name) => shotsDir && (await ws.screenshot({ path: join(shotsDir, `${name}.png`) }))
  await ws.getByRole('heading', { name: 'Workshop' }).waitFor()
  await wsnap('w-overview')
  await ws.locator('.sidebar .nav', { hasText: 'Your eye' }).click()
  await ws.getByRole('button', { name: 'Learn now' }).click()
  await ws.getByText(/decisions, \d+ project/).waitFor()
  await wsnap('w-your-eye')
  assert.match(readFileSync(join(userData, 'learning.json'), 'utf8'), /"examples":\[\{/, 'decisions are stored as examples')

  // A shoot style learns from a folder of photographs, has them put into words, and is developed by Claude.
  await ws.locator('.sidebar .nav', { hasText: 'Shoot styles' }).click()
  await ws.locator('.split-list .item', { hasText: 'LARP and battle' }).click()
  await ws.getByRole('tab', { name: 'Learning' }).click()
  await ws.getByRole('button', { name: /Learn from a folder of photographs/ }).click()
  await ws.getByText(/photographs; \d+% show people/).waitFor({ timeout: 400_000 })
  await ws.getByRole('button', { name: /Put the photographs into words/ }).click()
  await ws.getByText('Stand-in essence.').waitFor()
  await ws.getByRole('button', { name: /Develop with Claude|Refine with Claude/ }).click()
  await ws.getByText(/Stand-in notes for LARP and battle/).waitFor()
  await ws.getByRole('button', { name: 'Accept', exact: true }).click()
  await ws.getByRole('tab', { name: 'Emotions' }).click()
  await ws.getByLabel('How much this style values triumph').waitFor()
  await wsnap('w-styles')

  // The emotion taught in Cull is now part of what the app knows.
  await ws.locator('.sidebar .nav', { hasText: 'Emotions' }).click()
  await ws.getByRole('heading', { name: 'What it knows' }).waitFor()
  await wsnap('w-emotions')

  // The look extractor turns a reference photo into a LUT.
  const jpgs = readdirSync(samples).filter((f) => /\.jpe?g$/i.test(f))
  if (jpgs.length >= 2) {
    const lut = join(userData, 'look.cube')
    await app.evaluate(({ dialog }, [files, out]) => {
      let call = 0
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files[call++ % files.length]] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
    }, [[join(samples, jpgs[0]), join(samples, jpgs[jpgs.length - 1])], lut])
    await page.getByRole('button', { name: 'Look extractor' }).click()
    await page.getByRole('button', { name: /Choose reference photo/ }).click()
    await page.getByText('What the look is made of').waitFor()
    await page.getByRole('button', { name: /Add one of my unedited photos/ }).click()
    await page.getByText('Yours, with the look applied').waitFor()
    await page.getByLabel('Concept of the shoot').fill('A doomed last stand: cold, smoky, with fire as the only warmth.')
    await page.getByRole('button', { name: /Ask Claude to shape the look/ }).click()
    await page.getByText('Stand-in reading.').waitFor()
    await snap('4-look')
    await page.getByRole('button', { name: /Save LUT/ }).click()
    await page.getByText(/^Saved /).waitFor()
    assert.match(readFileSync(lut, 'utf8'), /LUT_3D_SIZE 33/)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, samples)
  }

  // Diagnose: the panels are drawn and the findings listed for the first pick.
  await page.getByRole('button', { name: 'Diagnose a photo' }).click()
  await page.getByRole('heading', { name: 'Diagnosis' }).waitFor({ timeout: 60_000 })
  assert.equal(await page.locator('.diag-grid canvas').count(), 9, 'the original and eight analysis panels are shown')
  // Look at a frame with a person in it, if there is one beyond the first pick.
  const others = page.locator('.page .compare .thumb')
  if ((await others.count()) > 1) {
    await others.nth(1).click()
    await page.getByText('Reading the photo…').waitFor({ state: 'detached', timeout: 60_000 })
    await page.getByRole('heading', { name: 'Diagnosis' }).waitFor({ timeout: 60_000 })
  }
  if (shotsDir) {
    await page.locator('.diag-grid').screenshot({ path: join(shotsDir, '4-diagnose-panels.png') })
    await page.getByRole('heading', { name: 'Diagnosis' }).scrollIntoViewIfNeeded()
  }
  await snap('4-diagnose')
  if (await page.getByRole('heading', { name: 'Try it' }).count()) {
    await page.getByLabel('Background saturation').fill('-0.6')
    await page.getByLabel('Separate from background').fill('0.8')
    if (shotsDir) await page.locator('.trial').screenshot({ path: join(shotsDir, '4-diagnose-try.png') })
  }

  for (const view of ['Story', 'Hand off', 'Learn', 'Settings']) {
    await page.getByRole('button', { name: view, exact: false }).first().click()
    await page.waitForTimeout(400)
    await snap(`4-${view.toLowerCase().replace(/\W+/g, '-')}`)
  }

  const rawFile = readdirSync(samples).find((f) => /\.(raf|arw)$/i.test(f))
  await page.getByRole('button', { name: 'Hand off' }).click()
  await page.getByRole('button', { name: /Write ratings/ }).click()
  await page.getByText(/sidecars written/).waitFor()
  const raw = readdirSync(samples).find((f) => /\.(raf|arw)$/i.test(f))
  if (raw) {
    const sidecar = join(samples, raw.replace(/\.\w+$/, '.xmp'))
    assert.ok(existsSync(sidecar), 'an XMP sidecar is written next to the RAW')
    const written = readFileSync(sidecar, 'utf8')
    assert.match(written, /Label[=>"]+(Green|Red)/, 'the label is written')
  }
  await snap('5-exported')

  // Training in the workshop: norms from finished photographs.
  await ws.locator('.sidebar .nav', { hasText: 'Teach with photos' }).click()
  await ws.getByRole('button', { name: /Choose finished photographs/ }).click()
  await ws.getByText(/Learned from \d+ finished photographs|finished photographs so far/).waitFor({ timeout: 400_000 })
  assert.match(readFileSync(join(userData, 'training.json'), 'utf8'), /"norms":\{"/, 'what was learned is stored')
  await wsnap('w-training')

  // People: the shoot's people are told apart; one is named and marked as key.
  await page.locator('.sidebar .nav', { hasText: 'People' }).click()
  await snap('7-people')
  const cards = page.locator('.card.person')
  if (await cards.count()) {
    await cards.first().getByRole('textbox').fill('the sitter')
    await cards.first().getByRole('textbox').blur()
    await cards.first().getByLabel('Key person').check()
    await page.getByText(/Key person:.*the sitter/).waitFor()
    await page.getByRole('button', { name: 'Show their frames in Cull' }).click()
    await page.locator('.chip.pick', { hasText: 'the sitter' }).first().waitFor()
    await snap('7-key-person')
  } else console.log('note: no people were told apart in these samples')

  // The shoot can be re-estimated from the cull settings.
  await page.locator('.sidebar .nav', { hasText: 'Cull' }).click()
  await page.locator('.popover-wrap > button').click()
  await page.getByRole('button', { name: 'Re-estimate this shoot' }).click()
  await page.getByText(/Today the app would make|Decide some frames by hand first/).waitFor()
  await page.keyboard.press('Escape')

  // In the workshop: Claude's words were stored, the reason given is listed and can be forgotten.
  await ws.locator('.sidebar .nav', { hasText: 'What is happening' }).click()
  await ws.locator('.list-title', { hasText: 'portrait sitting' }).waitFor()
  await wsnap('w-words')
  await ws.locator('.sidebar .nav', { hasText: 'Mistakes and reasons' }).click()
  const reasonRow = ws.locator('.list-row', { hasText: 'awkward pose' })
  await reasonRow.waitFor()
  await wsnap('w-reasons')
  await reasonRow.getByRole('button', { name: 'Forget' }).click()
  await reasonRow.waitFor({ state: 'detached' })
  await ws.locator('.sidebar .nav', { hasText: 'Overview' }).click()
  await ws.getByRole('button', { name: 'Re-estimate all projects' }).waitFor()
  const knowledge = JSON.parse(readFileSync(join(userData, 'knowledge.json'), 'utf8'))
  assert.ok(knowledge.concepts.tags.some((t) => t.name === 'portrait sitting'), "Claude's description is stored for learning")
  assert.ok(Object.keys(knowledge.ledger.projects).length >= 1, 'decisions are filed as mistakes against assets')
  assert.ok(!knowledge.reasons.tags.some((t) => t.name === 'awkward pose'), 'a forgotten reason is gone')

  assert.deepEqual(errors, [], 'no console errors')
  console.log('smoke test passed')
} catch (err) {
  // Leave evidence behind: what the window showed when the test failed.
  if (page && shotsDir) await page.screenshot({ path: join(shotsDir, 'failure.png') }).catch(() => {})
  if (page) console.error(await page.locator('main').innerText().catch(() => ''))
  throw err
} finally {
  if (errors.length) console.error(errors.join('\n'))
  await app.close()
}
