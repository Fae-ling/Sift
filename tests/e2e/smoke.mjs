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
    ipcMain.removeHandler('ai:essence')
    ipcMain.handle('ai:essence', () => ({ summary: 'Stand-in essence.', principles: ['Keeps laughter.'], lookFor: ['Hands'], forgive: ['Blur'] }))
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
  await page.getByLabel('Culling profile').selectOption({ label: 'Joyful and candid' })
  await page.getByRole('button', { name: 'Cull with Claude' }).click()
  await page.getByRole('button', { name: 'Read the shoot' }).click()
  await page.getByText('Every moment has been read.').waitFor()
  await page.getByText(/Editor's read \(9\/10\)/).first().waitFor()
  assert.ok((await page.locator('.scene-head b').count()) > 0, 'scenes are labelled with their chapter')
  await snap('3-cull-read')
  await page.getByRole('button', { name: 'Cull with Claude' }).click()

  // Enter accepts the suggestion for the current moment and moves to the next one.
  const moments = await page.locator('.strip .stack').count()
  for (let i = 0; i < moments; i++) await page.keyboard.press('Enter')
  // Decisions can be undone and redone.
  const picked = await page.locator('.strip .flag.pick').count()
  await page.keyboard.press('Control+z')
  assert.ok((await page.locator('.strip .flag.pick').count()) < picked, 'undo takes back the last decision')
  await page.keyboard.press('Control+Shift+z')
  assert.equal(await page.locator('.strip .flag.pick').count(), picked, 'redo restores it')

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
  await page.getByRole('button', { name: /^Second look/ }).click()
  await snap('3-cull-second-look')
  await page.getByRole('button', { name: /^All \d/ }).click()

  // A hidden gem is left for the photographer to decide; decide the first frame by hand.
  await page.locator('.strip .thumb').first().click()
  await page.keyboard.press('p')
  assert.ok((await page.locator('.strip .flag.pick').count()) >= 1, 'accepting a suggestion makes a pick')
  await snap('3-cull-accepted')

  // A culling profile learns from a folder of photographs, then has its essence distilled.
  await page.getByRole('button', { name: 'Culling profiles' }).click()
  const card = page.locator('.card', { has: page.locator('input[value="Joyful and candid"]') })
  await card.getByRole('button', { name: /Learn from a gallery folder/ }).click()
  await card.getByText(/photographs; \d+% show people/).waitFor({ timeout: 60_000 })
  await card.getByRole('button', { name: /Distil the essence/ }).click()
  await card.getByText('Stand-in essence.').waitFor()
  await snap('4-profiles')

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
    await snap('4-look')
    await page.getByRole('button', { name: /Save LUT/ }).click()
    await page.getByText(/^Saved /).waitFor()
    assert.match(readFileSync(lut, 'utf8'), /LUT_3D_SIZE 33/)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, samples)
  }

  for (const view of ['Story', 'Edit coach', 'Hand off', 'Learn', 'Settings']) {
    await page.getByRole('button', { name: view, exact: false }).first().click()
    await page.waitForTimeout(400)
    await snap(`4-${view.toLowerCase().replace(/\W+/g, '-')}`)
  }

  // The edit coach follows Lightroom's sidecar: write one, as Lightroom would, and expect a tip about it.
  const rawFile = readdirSync(samples).find((f) => /\.(raf|arw)$/i.test(f))
  if (rawFile) {
    writeFileSync(
      join(samples, rawFile.replace(/\.\w+$/, '.xmp')),
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="+0.30" crs:Saturation="+50" crs:Highlights2012="-90" crs:Shadows2012="+90" crs:Sharpness="40"/></rdf:RDF></x:xmpmeta>`
    )
    await page.getByRole('button', { name: 'Edit coach' }).click()
    await page.locator(`.coach .thumb[title="${rawFile}"]`).click()
    await page.getByText('Saturation is +50.').waitFor({ timeout: 15_000 })
    await page.getByText('Highlights -90, Shadows +90.').waitFor()
    await snap('4-edit-coach-live')
  }

  await page.getByRole('button', { name: 'Hand off' }).click()
  await page.getByRole('button', { name: /Write ratings/ }).click()
  await page.getByText(/sidecars written/).waitFor()
  const raw = readdirSync(samples).find((f) => /\.(raf|arw)$/i.test(f))
  if (raw) {
    const sidecar = join(samples, raw.replace(/\.\w+$/, '.xmp'))
    assert.ok(existsSync(sidecar), 'an XMP sidecar is written next to the RAW')
    const written = readFileSync(sidecar, 'utf8')
    assert.match(written, /Label[=>"]+(Green|Red)/, 'the label is written')
    assert.match(written, /Saturation/, 'develop settings already in the sidecar are kept')
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
