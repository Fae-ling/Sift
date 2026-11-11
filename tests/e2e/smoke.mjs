// End-to-end smoke test: launches the built app, imports a folder of photos
// and checks that analysis, culling and the Lightroom hand-off work.
//
//   ATELIER_SAMPLES=/path/to/photos npm run test:e2e
//
// On a machine without a display, prefix with `xvfb-run -a`.
import { createRequire } from 'node:module'
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs'
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

// Set ATELIER_APP to a packaged executable to test the installed form of the app.
const packaged = process.env.ATELIER_APP
const app = await electron.launch({
  executablePath: packaged ?? require('electron'),
  // Software WebGL, so the face model also runs on machines without a graphics card.
  args: [...(packaged ? [] : [resolve('out/main/index.js')]), '--no-sandbox', '--enable-unsafe-swiftshader'],
  env: { ...process.env, ATELIER_USER_DATA: userData }
})
const errors = []
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
    ipcMain.removeHandler('settings:get')
    ipcMain.handle('settings:get', () => ({ hasApiKey: true, model: 'claude-opus-5-5' }))
    ipcMain.removeHandler('ai:read')
    ipcMain.handle('ai:read', (_event, req) => ({
      reads: Object.fromEntries(
        req.frames.map((f) => [f.shotId, { beat: req.beats[0].name, moment: 9, gem: !!f.flaws, note: 'Stand-in read.' }])
      ),
      usage: { model: 'stand-in', inputTokens: 1000, outputTokens: 100, costUsd: 0.01 }
    }))
  })
  await page.reload()

  await page.getByLabel('Project name').fill('Smoke test')
  await page.getByLabel('Genre').selectOption('wedding')
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
  await page.getByRole('button', { name: "Editor's read" }).click()
  await page.getByRole('button', { name: 'Read the shoot' }).click()
  await page.getByText('Every moment has been read.').waitFor()
  await page.getByText(/Editor's read \(9\/10\)/).first().waitFor()
  assert.ok((await page.locator('.scene-head b').count()) > 0, 'scenes are labelled with their chapter')
  await snap('3-cull-read')
  await page.getByRole('button', { name: "Editor's read" }).click()

  // Enter accepts the suggestion for the current moment and moves to the next one.
  const moments = await page.locator('.strip .stack').count()
  for (let i = 0; i < moments; i++) await page.keyboard.press('Enter')
  // A hidden gem is left for the photographer to decide; decide the first frame by hand.
  await page.locator('.strip .thumb').first().click()
  await page.keyboard.press('p')
  assert.ok((await page.locator('.strip .flag.pick').count()) >= 1, 'accepting a suggestion makes a pick')
  await snap('3-cull-accepted')

  for (const view of ['Story', 'Edit coach', 'Hand off', 'Learn', 'Settings']) {
    await page.getByRole('button', { name: view, exact: false }).first().click()
    await page.waitForTimeout(400)
    await snap(`4-${view.toLowerCase().replace(/\W+/g, '-')}`)
  }

  await page.getByRole('button', { name: 'Hand off' }).click()
  await page.getByRole('button', { name: /Write ratings/ }).click()
  await page.getByText(/sidecars written/).waitFor()
  const raw = readdirSync(samples).find((f) => /\.(raf|arw)$/i.test(f))
  if (raw) {
    const sidecar = join(samples, raw.replace(/\.\w+$/, '.xmp'))
    assert.ok(existsSync(sidecar), 'an XMP sidecar is written next to the RAW')
    assert.match(readFileSync(sidecar, 'utf8'), /xmp:Label="(Green|Red)"/)
  }
  await snap('5-exported')

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
