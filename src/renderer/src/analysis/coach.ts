import type { Brief, Shot } from '@shared/types'
import { describeHarmony, hueName } from './color'

export interface CoachNote {
  topic: string
  /** What was measured. */
  finding: string
  /** What it means and where to act on it. */
  advice: string
  level: 'info' | 'attention'
}

const pct = (v: number): string => `${Math.round(v * 100)}%`
const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const wants = (brief: Brief, words: string[]): boolean => {
  const text = `${brief.moodWords} ${brief.intention} ${brief.clientAsk} ${brief.references}`.toLowerCase()
  return words.some((w) => text.includes(w))
}

/**
 * Turns the measurements of one frame into editing notes. These are rules of
 * thumb applied to numbers, written to explain the reasoning, and they run
 * locally at no cost. `sceneMates` are the other selects from the same scene.
 */
export function coachNotes(shot: Shot, sceneMates: Shot[], brief: Brief): CoachNote[] {
  const a = shot.analysis!
  const c = a.color
  const notes: CoachNote[] = []

  // --- tone ---
  const range = c.p95 - c.p5
  if (range < 0.45) {
    notes.push({
      topic: 'Tonal range',
      finding: `Most of the image sits between ${pct(c.p5)} and ${pct(c.p95)} brightness: a narrow, low-contrast range.`,
      advice: wants(brief, ['soft', 'dream', 'quiet', 'gentle', 'pastel', 'airy', 'matte'])
        ? 'That suits the soft mood in your brief. Protect it: set a clear black and white point only if the image feels foggy rather than gentle, and shape contrast with the Tone Curve rather than the Contrast slider.'
        : 'There is room to stretch. Set the white and black points first (Whites and Blacks, holding Alt to see clipping), then add contrast with a gentle S on the Tone Curve. Contrast is what gives an image depth.',
      level: 'info'
    })
  } else if (range > 0.85) {
    notes.push({
      topic: 'Tonal range',
      finding: `The image already spans ${pct(c.p5)} to ${pct(c.p95)}: nearly the full range.`,
      advice: 'Contrast is already high. Work on local balance instead: bring Highlights down and Shadows up slightly to recover detail, then decide where the brightest point should be. The eye goes to the brightest, most contrasted area first.',
      level: 'info'
    })
  }
  if (c.clipHigh > 0.01) {
    notes.push({
      topic: 'Highlights',
      finding: `${(c.clipHigh * 100).toFixed(1)}% of the preview is pure white.`,
      advice: 'Check the RAW with the highlight clipping warning (J in Lightroom). Recover with Highlights and Whites first. If skin or a dress is clipped in the RAW too, lower the exposure of the whole frame a little so the transition into white is smooth; a hard edge into white looks digital.',
      level: 'attention'
    })
  }
  if (c.meanLuma < 0.2) {
    notes.push({
      topic: 'Exposure',
      finding: `Average brightness is ${pct(c.meanLuma)}: a dark frame.`,
      advice: wants(brief, ['moody', 'dark', 'dramatic', 'cinematic', 'night', 'low key', 'low-key'])
        ? 'A low-key image fits your brief. Keep the shadows dark but not empty: lift Blacks just enough that the darkest areas hold a hint of detail, and make sure the face is the brightest thing in the frame.'
        : 'Raise Exposure before anything else, and judge it on the skin, not the background. Expect noise in the lifted shadows; apply noise reduction after the tonal work, not before.',
      level: 'attention'
    })
  }

  // --- white balance ---
  if (Math.abs(c.castWarm) > 0.035 || Math.abs(c.castTint) > 0.03) {
    const warm = c.castWarm > 0.035 ? 'warm (yellow-orange)' : c.castWarm < -0.035 ? 'cool (blue)' : null
    const tint = c.castTint > 0.03 ? 'magenta' : c.castTint < -0.03 ? 'green' : null
    const lean = [warm, tint].filter(Boolean).join(' and ')
    const briefWarm = wants(brief, ['warm', 'golden', 'nostalg', 'sun', 'cozy', 'cosy'])
    const briefCool = wants(brief, ['cool', 'cold', 'blue', 'clean', 'crisp', 'winter'])
    let advice =
      'Decide whether that is the light you want to keep or a cast to remove. Neutralise first with the White Balance eyedropper on something that should be grey, then add warmth or coolness back on purpose. A deliberate shift reads as mood; an accidental one reads as an error.'
    if (c.castWarm > 0.035 && briefCool) advice = 'Your brief asks for a cooler, cleaner feel, but the neutrals lean warm. Bring Temp down until whites look white, then check skin has not gone grey.'
    if (c.castWarm < -0.035 && briefWarm) advice = 'Your brief asks for warmth, but the neutrals lean cool. Raise Temp until the skin feels alive; if the shadows then look muddy, keep them slightly cooler with Color Grading rather than warming everything.'
    if (tint === 'green') advice += ' A green lean is common under foliage or fluorescent light and is unflattering on skin: correct it with Tint toward magenta.'
    notes.push({ topic: 'White balance', finding: `Areas that should be neutral lean ${lean}.`, advice, level: 'attention' })
  }

  // --- skin ---
  const face = a.faces[0]
  if (face && face.skinHue !== null && face.skinSat !== null) {
    const hue = face.skinHue > 180 ? face.skinHue - 360 : face.skinHue
    let advice = 'Skin hue sits in the natural orange range. Whatever look you build, keep it there: viewers forgive almost any colour choice in the surroundings but notice wrong skin immediately.'
    let level: CoachNote['level'] = 'info'
    if (hue < 8) {
      advice = 'Skin leans red or magenta. Check Tint first (it may be a white balance issue). If it is only the skin, shift the Red and Orange hue slightly toward yellow in HSL, and lower Red saturation a touch.'
      level = 'attention'
    } else if (hue > 38) {
      advice = 'Skin leans yellow or green. Usually this is white balance: move Tint toward magenta, or Temp slightly cooler. If the surroundings are right and only skin is off, nudge Orange hue toward red in HSL.'
      level = 'attention'
    }
    if (face.skinSat > 0.62) {
      advice += ' Saturation on the skin is high; lower Orange saturation a little or use Vibrance rather than Saturation for the overall boost, since Vibrance protects skin tones.'
      level = 'attention'
    } else if (face.skinSat < 0.16) {
      advice += ' The skin is very desaturated and may look lifeless; add a little Orange saturation or warmth in the midtones.'
    }
    notes.push({
      topic: 'Skin tone',
      finding: `Cheek colour measures ${Math.round(face.skinHue)}° (${hueName(face.skinHue)}) at ${pct(face.skinSat)} saturation. Natural skin of every complexion falls roughly between 10° and 35°: complexions differ in brightness and saturation far more than in hue.`,
      advice,
      level
    })
  }

  // --- colour relationships ---
  const harmony = describeHarmony(c.palette)
  notes.push({ topic: 'Colour harmony', finding: harmony.name, advice: harmony.explain, level: 'info' })
  if (c.meanSat > 0.5) {
    notes.push({
      topic: 'Saturation',
      finding: `Average saturation is ${pct(c.meanSat)}, which is high.`,
      advice: 'When everything is saturated nothing stands out. Choose the colour that matters and lower the others in HSL; saturation contrast is as powerful as brightness contrast for directing the eye.',
      level: 'info'
    })
  }

  // --- consistency with the rest of the scene ---
  const mates = sceneMates.filter((s) => s.id !== shot.id && s.analysis)
  if (mates.length >= 2) {
    const luma = median(mates.map((s) => s.analysis!.color.meanLuma))
    const warm = median(mates.map((s) => s.analysis!.color.castWarm))
    const stops = Math.log2(Math.max(c.meanLuma, 0.01) / Math.max(luma, 0.01))
    const parts: string[] = []
    if (Math.abs(stops) > 0.35) parts.push(`about ${Math.abs(stops).toFixed(1)} stop ${stops > 0 ? 'brighter' : 'darker'}`)
    if (Math.abs(c.castWarm - warm) > 0.04) parts.push(c.castWarm > warm ? 'warmer' : 'cooler')
    if (parts.length) {
      notes.push({
        topic: 'Consistency',
        finding: `Compared with your other ${mates.length} selects from this scene, this frame is ${parts.join(' and ')}.`,
        advice: 'Match it before styling. Edit one reference frame per scene, sync the settings to the rest, then correct only exposure and white balance per frame. A set that drifts in brightness and colour from frame to frame looks unfinished even when each frame is good on its own.',
        level: 'attention'
      })
    }
  }
  return notes
}

/** The measurements as plain text, for the AI grading request. */
export function measurementText(shot: Shot): string {
  const a = shot.analysis!
  const c = a.color
  const face = a.faces[0]
  return [
    `Shot type: ${a.shotType}; faces: ${a.faces.length}`,
    `Mean brightness ${pct(c.meanLuma)}; 5th-95th percentile ${pct(c.p5)}-${pct(c.p95)}`,
    `Clipped to white ${(c.clipHigh * 100).toFixed(1)}%; crushed to black ${(c.clipLow * 100).toFixed(1)}%`,
    `Mean saturation ${pct(c.meanSat)}`,
    `Neutral cast: warm/cool ${c.castWarm.toFixed(3)} (+warm), tint ${c.castTint.toFixed(3)} (+magenta)`,
    `Dominant colours: ${c.palette.join(', ')}`,
    face && face.skinHue !== null ? `Main face cheek colour: hue ${Math.round(face.skinHue)} deg, saturation ${pct(face.skinSat ?? 0)}` : 'No face measured',
    [shot.focal && `${Math.round(shot.focal)}mm`, shot.aperture && `f/${shot.aperture}`, shot.shutter && `${shot.shutter}s`, shot.iso && `ISO ${shot.iso}`].filter(Boolean).join(', ')
  ]
    .filter(Boolean)
    .join('\n')
}
