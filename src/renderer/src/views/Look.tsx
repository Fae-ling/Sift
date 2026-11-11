import { useEffect, useRef, useState } from 'react'
import { loadOriented, resized, rgba } from '../analysis/image'
import { applyLookToImage, deriveLook, describeLook, lookStats, mismatch, scaleLook, shiftToHueSat, toCube, toLightroomPreset, type Look as LookType } from '../analysis/look'
import { useStore } from '../store'

interface Loaded {
  path: string
  name: string
  canvas: HTMLCanvasElement
}

/** Reads any photo the app can open into a small upright canvas. */
async function load(slot: string): Promise<Loaded | null> {
  const path = await window.studio.pickImage()
  if (!path) return null
  const extracted = await window.studio.extract('look', slot, path)
  const blob = await (await fetch(`${extracted.url}?t=${Date.now()}`)).blob()
  const canvas = resized(await loadOriented(blob, extracted.applyOrientation, 1600), 640)
  return { path, name: path.split(/[\\/]/).pop()!, canvas }
}

export function Look(): React.JSX.Element {
  const { notify } = useStore()
  const [reference, setReference] = useState<Loaded | null>(null)
  const [source, setSource] = useState<Loaded | null>(null)
  const [full, setFull] = useState<LookType | null>(null)
  const [strength, setStrength] = useState(1)
  const [unlike, setUnlike] = useState(0)
  const look = full ? scaleLook(full, strength) : null
  const refCanvas = useRef<HTMLCanvasElement>(null)
  const beforeCanvas = useRef<HTMLCanvasElement>(null)
  const afterCanvas = useRef<HTMLCanvasElement>(null)
  const curveCanvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!reference) return setFull(null)
    const ref = lookStats(rgba(reference.canvas).data)
    const src = source ? lookStats(rgba(source.canvas).data) : undefined
    setUnlike(src ? mismatch(ref, src) : 0)
    setFull(deriveLook(ref, src))
  }, [reference, source])

  useEffect(() => {
    const draw = (target: HTMLCanvasElement | null, from: HTMLCanvasElement | undefined, apply?: LookType): void => {
      if (!target || !from) return
      target.width = from.width
      target.height = from.height
      const ctx = target.getContext('2d')!
      ctx.drawImage(from, 0, 0)
      if (apply) {
        const img = ctx.getImageData(0, 0, from.width, from.height)
        applyLookToImage(apply, img.data)
        ctx.putImageData(img, 0, 0)
      }
    }
    draw(refCanvas.current, reference?.canvas)
    draw(beforeCanvas.current, source?.canvas)
    if (look) draw(afterCanvas.current, source?.canvas, look)
    const c = curveCanvas.current
    if (c && look) {
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.strokeStyle = '#444'
      ctx.beginPath()
      ctx.moveTo(0, c.height)
      ctx.lineTo(c.width, 0)
      ctx.stroke()
      ctx.strokeStyle = '#e4e4e4'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * c.width, c.height - look.curve[i] * c.height)
      ctx.stroke()
    }
  }, [reference, source, full, strength])

  const pick = async (slot: string, set: (l: Loaded) => void): Promise<void> => {
    try {
      const loaded = await load(slot)
      if (loaded) set(loaded)
    } catch (err) {
      notify(`Could not open that file: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    }
  }

  const base = reference ? reference.name.replace(/\.\w+$/, '') : 'look'
  const save = async (file: string, content: string): Promise<void> => {
    const path = await window.studio.saveText(file, content)
    if (path) notify(`Saved ${path}`)
  }

  return (
    <div className="page wide">
      <h1>Look extractor</h1>
      <p className="lead">
        Give it a finished photograph whose colour you admire. It works out the tone curve, the tint in shadows,
        midtones and highlights, and the saturation, and writes them as a LUT or a Lightroom preset. It also tells you
        what was done, so you can rebuild the look by hand and make it your own.
      </p>

      <div className="row">
        <button className="primary" onClick={() => void pick('ref', setReference)}>
          {reference ? 'Change reference photo…' : 'Choose reference photo…'}
        </button>
        <button onClick={() => void pick('src', setSource)} disabled={!reference}>
          {source ? 'Change my unedited photo…' : 'Add one of my unedited photos (recommended)…'}
        </button>
        {source && (
          <button className="link small" onClick={() => setSource(null)}>
            Remove it
          </button>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 8, maxWidth: 720 }}>
        Opens JPEG, PNG, WebP, AVIF, BMP and GIF directly, and RAW, TIFF, HEIC and PSD files through the preview stored
        inside them. Nothing is uploaded.
      </p>

      {!reference && (
        <div className="note teach">
          <p>
            <b>Why add your own photo?</b> A look is the difference between a starting image and a finished one. From
            the finished photo alone only the unmistakable parts can be read: faded blacks, held-back whites, a tint on
            the greys. With one of your unedited frames from similar light as the starting point, the full curve and
            colour shift can be measured, and you see the result on your own picture before saving anything.
          </p>
        </div>
      )}

      {reference && look && (
        <>
          <div className="look-grid">
            <figure>
              <canvas ref={refCanvas} />
              <figcaption>Reference: {reference.name}</figcaption>
            </figure>
            {source && (
              <>
                <figure>
                  <canvas ref={beforeCanvas} />
                  <figcaption>Yours, before: {source.name}</figcaption>
                </figure>
                <figure>
                  <canvas ref={afterCanvas} />
                  <figcaption>Yours, with the look applied</figcaption>
                </figure>
              </>
            )}
          </div>

          <div className={`note ${look.estimated ? 'warn' : 'teach'}`}>
            <p>
              {look.estimated
                ? 'Estimated from the reference alone. Treat it as a starting point; add one of your unedited photos for a measured match and a preview.'
                : 'Measured as the change from your photo to the reference. It matches overall tone and colour balance, not individual colours: if the reference has a red dress and yours has a green field, expect to adjust.'}
            </p>
          </div>

          {unlike > 0.16 && (
            <div className="note warn">
              <p>
                These two photos are very different in brightness and content, so much of what was measured is the
                difference between the scenes, not the edit. For a trustworthy match, use an unedited frame shot in
                similar light and with a similar subject to the reference, or lower the strength below.
              </p>
            </div>
          )}
          <label htmlFor="strength">
            Strength<span className="hint">{Math.round(strength * 100)}%</span>
          </label>
          <input id="strength" type="range" min={0.1} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} style={{ maxWidth: 320, padding: 0, border: 0, background: 'none' }} />

          <h2>What the look is made of</h2>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div>
              <canvas ref={curveCanvas} width={180} height={180} style={{ background: '#0e0e0e', borderRadius: 4 }} aria-label="Tone curve" />
              <div className="muted small">Tone curve</div>
            </div>
            <div>
              <div className="row" style={{ gap: 6 }}>
                {['Shadows', 'Midtones', 'Highlights'].map((name, z) => {
                  const { hue, sat } = shiftToHueSat(look.shift[z])
                  return (
                    <div key={name} style={{ textAlign: 'center' }}>
                      <div style={{ width: 56, height: 56, borderRadius: 4, background: `hsl(${hue} ${Math.min(90, sat * 2.2)}% ${[26, 50, 76][z]}%)` }} />
                      <div className="muted small">{name}</div>
                    </div>
                  )
                })}
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>Tints, exaggerated to be visible</div>
            </div>
            <ul style={{ flex: 1, minWidth: 280, lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
              {describeLook(look).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          <h2>Save it</h2>
          <div className="row">
            <button className="primary" onClick={() => void save(`${base}.cube`, toCube(look, base))}>
              Save LUT (.cube)
            </button>
            <button onClick={() => void save(`${base}.xmp`, toLightroomPreset(look, base))}>Save Lightroom preset (.xmp)</button>
          </div>
          <ul className="small muted" style={{ lineHeight: 1.7, marginTop: 12, paddingLeft: 20 }}>
            <li>
              <b>LUT:</b> for DaVinci Resolve (drop on a node, after converting log footage to Rec.709), Premiere, and
              Photoshop (Color Lookup adjustment layer). Lower the node or layer opacity to taste.
            </li>
            <li>
              <b>Preset:</b> in Lightroom Classic, Develop → Presets → + → Import Presets. It uses only the tone curve,
              colour grading and saturation, so every part stays editable. It is an approximation of the LUT, built
              with Lightroom's own tools.
            </li>
            <li>Correct white balance and exposure on each photo first, then apply the look. A look on an uncorrected image is why presets disappoint.</li>
          </ul>
        </>
      )}
    </div>
  )
}
