import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  MODELS,
  styleCacheId,
  type EssenceRequest,
  type StyleEssence,
  type Brief,
  type Genre,
  type GradeAdvice,
  type GradeRequest,
  type NarrativeRead,
  type ReadRequest,
  type ReadResult,
  type StoryAdvice,
  type StoryRequest,
  type Usage
} from '@shared/types'
import { cacheDir, getApiKey, getModel, recordSpend, safeId } from './store'

/**
 * The paid layer. Everything measurable (focus, blinks, duplicates, exposure)
 * is done on the user's machine for free; Claude is only asked the questions
 * that need taste and the brief: which frames tell the story, and how to grade.
 */

const MENTOR = `You are a mentor to a working photographer who also shoots cinematic video and does graphic design. They do their own culling and editing in Lightroom Classic, Photoshop and DaVinci Resolve. Your job is to make them a better artist, not to do the work for them.

How to advise:
- Ground every suggestion in what is visible in the frames and in the brief. Name the principle behind it (colour contrast, tonal hierarchy, pacing, visual rhythm, eye-line, and so on) so the reasoning transfers to the next shoot.
- Give direction and rough magnitude ("pull highlights down a little, about a third of a stop"), never a preset or exact slider recipe to copy. They decide the final values by eye.
- Where the client's ask and the photographer's intention pull in different directions, say so plainly and suggest how to serve both.
- Be honest. If a frame is weak or the set has a hole, say it kindly and specifically.
- Write plainly and briefly. No flattery, no filler.`

const briefText = (genre: Genre, b: Brief): string =>
  [
    `Genre: ${genre}`,
    `Client: ${b.client || 'not given'}`,
    `Client asked for: ${b.clientAsk || 'not given'}`,
    `Photographer's intention: ${b.intention || 'not given'}`,
    `Mood words: ${b.moodWords || 'not given'}`,
    `Colour / visual references: ${b.references || 'not given'}`,
    `Deliverables: ${b.deliverables || 'not given'}`,
    `Target number of final images: ${b.targetCount || 'undecided'}`
  ].join('\n')

async function client(): Promise<Anthropic> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings to use AI advice.')
  return new Anthropic({ apiKey })
}

async function image(projectId: string, file: string): Promise<Anthropic.ImageBlockParam> {
  const data = await fs.readFile(join(cacheDir(projectId), file))
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data.toString('base64') } }
}

function usage(model: string, u: Anthropic.Usage): Usage {
  const price = MODELS.find((m) => m.id === model) ?? MODELS[0]
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  return {
    model,
    inputTokens: input,
    outputTokens: u.output_tokens,
    costUsd: (input * price.inPerM + u.output_tokens * price.outPerM) / 1_000_000
  }
}

async function ask<T>(
  schema: z.ZodType<T>,
  content: Anthropic.ContentBlockParam[]
): Promise<{ value: T; usage: Usage }> {
  const model = await getModel()
  const anthropic = await client()
  let response
  try {
    response = await anthropic.messages.parse({
      model,
      max_tokens: 16000,
      system: MENTOR,
      output_config: { effort: 'medium', format: zodOutputFormat(schema) },
      messages: [{ role: 'user', content }]
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The API key was rejected. Check it in Settings.')
    if (err instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API. Wait a minute and try again.')
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the API. Check your connection.')
    if (err instanceof Anthropic.APIError) throw new Error(`The API returned an error: ${err.message}`)
    throw err
  }
  if (response.stop_reason === 'refusal') throw new Error('The model declined to comment on these images.')
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new Error('The advice came back incomplete. Try again with fewer frames.')
  }
  const cost = usage(model, response.usage)
  await recordSpend(cost.costUsd).catch(() => {})
  return { value: response.parsed_output, usage: cost }
}

const StorySchema = z.object({
  summary: z.string().describe('Two or three sentences: what story these frames can tell and how well they serve the brief.'),
  sequence: z
    .array(
      z.object({
        frame: z.number().describe('Frame number as labelled.'),
        role: z.string().describe('Its job in the sequence, e.g. "opener: sets the place", "emotional peak", "breather", "closer".'),
        why: z.string().describe('One sentence on why this frame, here.')
      })
    )
    .describe('The recommended delivery sequence, in viewing order.'),
  cut: z
    .array(z.object({ frame: z.number(), why: z.string() }))
    .describe('Frames to leave out, and the specific reason for each (repeats another frame, weak expression, breaks the mood...).'),
  gaps: z.array(z.string()).describe('What the story is missing that could still be found among unpicked frames or shot next time.'),
  lesson: z.string().describe('One transferable sequencing principle this set illustrates, in two or three sentences.')
})

/** Sends small thumbnails of the candidate frames and asks for a sequence. */
export async function storyAdvice(req: StoryRequest): Promise<StoryAdvice> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `${briefText(req.genre, req.brief)}\n\nBelow are ${req.frames.length} candidate frames in capture order. Each is labelled with a frame number, its scene, capture time and shot type. "picked" means the photographer has already chosen it.`
    }
  ]
  for (const [i, f] of req.frames.entries()) {
    content.push({
      type: 'text',
      text: `Frame ${i + 1} | scene ${f.scene} | ${f.time} | ${f.shotType}${f.faces ? `, ${f.faces} face(s)` : ''}${f.picked ? ' | picked' : ''}`
    })
    content.push(await image(req.projectId, `${safeId(f.shotId)}_t.jpg`))
  }
  content.push({
    type: 'text',
    text: `Build the strongest delivery sequence${req.brief.targetCount ? ` of about ${req.brief.targetCount} frames` : ''} from these candidates. Think like a picture editor: an opener that sets the scene, variety of scale (wide, medium, close, detail), a rhythm of energy and rest, and a closer that lands. Refer to frames by number.`
  })

  const { value, usage } = await ask(StorySchema, content)
  const id = (n: number): string | undefined => req.frames[n - 1]?.shotId
  return {
    summary: value.summary,
    sequence: value.sequence.flatMap((s) => (id(s.frame) ? [{ shotId: id(s.frame)!, role: s.role, why: s.why }] : [])),
    cut: value.cut.flatMap((c) => (id(c.frame) ? [{ shotId: id(c.frame)!, why: c.why }] : [])),
    gaps: value.gaps,
    lesson: value.lesson,
    usage
  }
}

const GradeSchema = z.object({
  read: z.string().describe('What the image is doing now: where the light comes from, the tonal structure, the existing colour relationships, where the eye goes.'),
  direction: z.string().describe('The grade to aim for and how it serves the brief and mood words, including the colour harmony to build.'),
  steps: z
    .array(
      z.object({
        panel: z.string().describe('Lightroom Classic panel or tool, in the order to work: Profile, White Balance, Tone, Tone Curve, HSL / Color Mixer, Color Grading, Masking, Detail, Crop...'),
        move: z.string().describe('The direction and rough size of the adjustment.'),
        why: z.string().describe('The principle behind it.')
      })
    )
    .describe('Ordered editing plan: correct first, then shape, then style.'),
  watchOut: z.array(z.string()).describe('Specific risks in this image, e.g. skin going orange, banding in the sky, a distracting bright edge.'),
  resolveNote: z.string().describe('How the same look would be approached for matching video in DaVinci Resolve (nodes, scopes), in two or three sentences.'),
  lesson: z.string().describe('One transferable principle about colour or light that this image teaches.')
})

/** Sends one preview plus its measured statistics and asks for a grading plan. */
export async function gradeAdvice(req: GradeRequest): Promise<GradeAdvice> {
  const { value, usage } = await ask(GradeSchema, [
    { type: 'text', text: briefText(req.genre, req.brief) },
    await image(req.projectId, `${safeId(req.shotId)}.jpg`),
    {
      type: 'text',
      text: `This is the camera's unedited embedded preview of one selected frame. Measurements taken from it:\n${req.measurements}\n\n${req.develop ? `The photographer has already started editing it in Lightroom. Current settings:\n${req.develop}\nComment on these moves specifically: which help, which fight the brief, what to try next.\n\n` : ''}Coach me through grading it for this brief. The measurements are from the preview, so treat them as a guide to what the RAW holds, not as exact values.`
    }
  ])
  return { ...value, usage }
}

const ReadSchema = z.object({
  frames: z.array(
    z.object({
      frame: z.number().describe('Frame number as labelled.'),
      beat: z.string().describe('The chapter of the story plan this frame belongs to, by its exact name, or "Other".'),
      moment: z.number().describe('0 to 10: how much this frame carries emotionally and for the story. 5 is a competent, unremarkable frame.'),
      gem: z.boolean().describe('True only if the frame has a listed technical flaw and is still worth keeping for what it holds.'),
      note: z.string().describe('One short sentence: what is happening between or within the people, and why it matters or does not.')
    })
  )
})

/**
 * The editor's read: looks at one or two thumbnails per moment and says what
 * each frame carries, beyond whether it is sharp. Called once per chunk of frames.
 */
export async function narrativeRead(req: ReadRequest): Promise<ReadResult> {
  const plan = req.beats.map((b) => `- ${b.name}: ${b.look}`).join('\n')
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `${briefText(req.genre, req.brief)}\n\nStory plan for this shoot:\n${plan}${req.styleNotes ? `\n\nThe photographer is culling for a particular feeling. Let it shape what you value, without overriding the brief:\n${req.styleNotes}` : ''}\n\nBelow are ${req.frames.length} frames in capture order, each labelled with a number, scene, time, shot type and any technical flaws already measured.`
    }
  ]
  for (const [i, f] of req.frames.entries()) {
    content.push({ type: 'text', text: `Frame ${i + 1} | scene ${f.scene} | ${f.time} | ${f.shotType}${f.flaws ? ` | flaws: ${f.flaws}` : ''}` })
    content.push(await image(req.projectId, `${safeId(f.shotId)}_t.jpg`))
  }
  content.push({
    type: 'text',
    text: `Read every frame the way an experienced picture editor would on a first pass through a contact sheet. Technical quality has already been measured, so do not grade sharpness or exposure. Look for what cannot be measured: gesture, expression, connection between people, anticipation, the in-between moment, an unrepeatable instant, a frame that says something about who these people are. A blurred or badly exposed frame of a real moment can be worth more than a clean frame of nothing; mark those as gems. Be discriminating: most frames in any shoot are a 4 to 6, and a set where everything scores 8 is useless to the photographer. Return one entry per frame.`
  })

  const { value, usage } = await ask(ReadSchema, content)
  const reads: Record<string, NarrativeRead> = {}
  for (const f of value.frames) {
    const shot = req.frames[f.frame - 1]
    if (!shot) continue
    reads[shot.shotId] = { beat: f.beat, moment: Math.min(10, Math.max(0, f.moment)), gem: f.gem && !!shot.flaws, note: f.note }
  }
  return { reads, usage }
}

const EssenceSchema = z.object({
  summary: z.string().describe('Three or four sentences: what these photographs have in common and what the photographer seems to care about.'),
  principles: z.array(z.string()).describe('Four to seven selection principles, each one sentence, phrased so they could guide a cull: what kind of frame this photographer keeps.'),
  lookFor: z.array(z.string()).describe('Concrete things to look for in a contact sheet when choosing in this spirit: gestures, distances, light, timing.'),
  forgive: z.array(z.string()).describe('Technical imperfections this photographer evidently accepts when the picture is right, as seen in the samples.')
})

/**
 * Looks at a sample of a reference gallery and puts into words how its
 * photographer appears to choose. A gallery shows only what was kept, so this
 * is an inference about taste, not a record of anyone's actual cull.
 */
export async function styleEssence(req: EssenceRequest): Promise<StyleEssence> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `These are ${req.samples.length} photographs from a gallery the photographer admires and wants to learn from: "${req.name}". They are final, published selections. Measured facts about the whole gallery:\n${req.facts}`
    }
  ]
  for (const sample of req.samples) content.push(await image(styleCacheId(safeId(req.styleId)), `${safeId(sample)}_t.jpg`))
  content.push({
    type: 'text',
    text: 'Work out what makes these the chosen frames. Do not describe the photographs one by one and do not dwell on colour grading or gear. Infer the taste behind the selection: what moments, gestures, relationships, distances and kinds of light keep recurring, what is conspicuously absent, and which imperfections were clearly judged not to matter. Write it so it can be used as guidance when culling a different shoot.'
  })
  const { value, usage } = await ask(EssenceSchema, content)
  return { ...value, usage }
}
