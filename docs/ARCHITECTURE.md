# Atelier architecture

How the suite fits together, and the design of the parts not built yet.

## Principles

1. **Local first, free by default.** Anything that can be measured or computed runs
   on the user's machine. Paid AI is opt-in, per action, with an estimate before and
   the cost after.
2. **Teach, don't do.** Every suggestion carries its reason. The app never edits a
   photo, never applies a look, never makes a final choice.
3. **One project, three phases.** Inspiration → Planning → Postproduction all read
   and write the same project, so the moodboard informs the brief, the brief informs
   the cull, and the cull informs the grade.
4. **Originals are untouchable.** The app reads source files and writes only its own
   project folder and XMP sidecars.

## Processes

```
┌──────────────── renderer (React) ────────────────┐      ┌────── main (Node) ──────┐
│ views/        one screen per step                │ IPC  │ store      project JSON │
│ analysis/     pixels, faces, grouping, scoring   │◄────►│ ingest     ExifTool     │
│ knowledge/    Learn library                      │      │ exporter   XMP, copies  │
│ store.ts      project state, autosave            │      │ ai         Claude API   │
└──────────────────────────────────────────────────┘      └─────────────────────────┘
```

- The renderer never touches the file system or the network directly. It calls the
  narrow API in `src/preload`, typed in `src/shared/types.ts`.
- Cached previews are served by the `media://` scheme, which can only read inside the
  app's projects folder.
- The API key lives in the main process, encrypted by the OS.

## Data model

A project is one JSON file plus a cache folder:

```
<userData>/projects/<id>/project.json
<userData>/projects/<id>/cache/<shotId>.jpg, <shotId>_t.jpg     previews
<userData>/projects/<id>/assets/<assetId>.<ext>                  moodboard files (planned)
```

`Project` today holds `brief`, `storyPlan`, `shots`, `storyOrder` and advice. The
planned phases add sibling fields; nothing existing changes shape:

```ts
interface Project {
  // existing
  brief; storyPlan; shots; storyOrder; ...
  // planned
  inspiration?: Inspiration
  plan?: Plan
  clips?: Clip[]
}
```

## Phase 1: Inspiration (planned)

Goal: get the feel of a project right before anything is shot.

```ts
interface Inspiration {
  boards: Board[]
  palette: PaletteColor[]        // the project palette, max ~6
  type: { heading: string; body: string; note: string }
  story: { logline: string; beats: StoryBeat[] }   // feeds project.storyPlan
  references: Reference[]        // music, films, photographers: title + link + why
}
interface Board { id; name; items: BoardItem[] }
type BoardItem =
  | { kind: 'image'; assetId; x; y; w; h; rotation; note? }
  | { kind: 'color'; hex; x; y }
  | { kind: 'text'; text; font; x; y; size }
  | { kind: 'pose'; assetId; x; y; w; h; note }       // a reference tagged as a pose
  | { kind: 'link'; url; title; x; y }                // music, video
```

| Feature | How | Cost |
| --- | --- | --- |
| Moodboard canvas | Free-form pan/zoom canvas; drag in images or paste from clipboard; files copied to `assets/`. Plain DOM + CSS transforms, no canvas library needed at this scale. | free |
| Palette from the board | Reuses `analysis/color.ts` (`colorStats`, `describeHarmony`) on the board's images; shows the harmony and what it will feel like. | free |
| Palette play | Wheel with harmony guides (complementary, analogous, triadic), contrast checker for type on colour. | free |
| Fonts | Lists fonts installed on the system (`queryLocalFonts`) plus a bundled shortlist of open-licence pairings; live preview with the project's own words. | free |
| Layout sketches | Grid templates (album spread, carousel, poster) the user fills with board images; teaches hierarchy and white space from Learn. | free |
| Music and references | Stored as links with a note; opened in the browser. No streaming or downloading. | free |
| Poses | Board items tagged as poses become a printable shot-reference sheet in Planning. | free |
| Mood critique | Optional: sends the board thumbnails and mood words to Claude; returns what the board says, where it contradicts itself, and what to look for on the day. | cents |

Hand-offs: the palette and mood words flow into the **Brief**; story beats flow into
the **story plan** that the narrative cull uses; pose references flow into the
**shot list**.

## Phase 2: Planning (planned)

Goal: everything needed to walk onto the shoot prepared.

```ts
interface Plan {
  schedule: Milestone[]          // deadlines: shoot day, first selects, delivery
  shootDay: { date: string; timeline: TimelineItem[] }
  locations: Location[]
  shotList: PlannedShot[]        // beat, description, pose reference, lens, done
  gear: GearItem[]               // from a personal gear library, with packed state
  quote: Quote
}
interface Location { id; name; lat; lng; notes; photos: string[]; facing?: number }
interface Quote { lines: { label; qty; unit; rate }[]; currency; taxRate; expenses; notes }
```

| Feature | How | Cost |
| --- | --- | --- |
| Deadlines | Milestones with dates, worked back from delivery; overdue and upcoming shown on the Projects screen. Optional `.ics` export. | free |
| Location scouting | Locations with coordinates (typed or picked on a map), notes and scouting photos. Map tiles from OpenStreetMap; needs an allowed tile host and attribution. | free |
| Light conditions | Sun azimuth and elevation computed locally from date, time and coordinates (standard solar position maths, no service). Shows sunrise, golden hour, blue hour, and a compass diagram of **where shadows fall and how long they are** for any time of day; a timeline scrubber animates it. | free |
| Weather | Optional forecast for the shoot date from a free forecast API (cloud cover matters more than temperature for light). | free |
| Shot list | Generated from the story plan's beats; each line can carry a pose reference from Inspiration and a lens. On the day it is a checklist; after import, the cull shows which planned shots have picks. | free |
| Gear | Personal gear library; per-project packing list; suggestions by genre and location light (a rule table, not AI). | free |
| Pricing | Line items, hours, expenses, tax, licence terms; exports a PDF quote. A cost-of-doing-business calculator explains the day rate. | free |
| Brief check | Optional: Claude reads the brief, shot list and timeline and points out gaps and risks. | cents |

## Phase 3: Postproduction

Built: import, narrative cull, story, edit coach, hand-off (see README).

Planned for **video**:

```ts
interface Clip { id; path; duration; fps; codec; frames: KeyFrame[]; take?: string; decision; note }
```

- Keyframes extracted with FFmpeg (bundled) and analysed by the same on-device
  pipeline as stills: focus, faces, exposure, colour.
- Take selection per shot-list line; an EDL or Resolve-importable timeline of selects.
- Shot-matching notes: which clips drift from the scene's reference in exposure and
  white balance, in Resolve's terms.

## The narrative cull (built)

Two scores per frame, kept separate on purpose:

- **Craft**: focus relative to the scene, eyes, exposure. Local.
- **Moment**: expression intensity, genuine smiles, laughter, faces turned toward or
  touching each other, the peak frame of a burst. Local, from face landmarks.

The project's **balance** (craft ↔ moment) and its **story plan** (the beats a shoot
of this kind should contain, each with its own tolerance for technical flaws) decide
how the two combine into a suggestion. Closed eyes inside a laugh or an embrace are
read as the moment, not as a blink.

The optional **editor's read** sends one or two small thumbnails per moment to Claude
with the brief and the story plan. For each frame it returns the beat it belongs to,
how much the frame carries emotionally, a one-line reason, and whether it is a
*hidden gem*: a technically imperfect frame worth keeping. Requests are chunked by
scene so a large shoot can be read incrementally, paused and resumed.

**Your eye** compares what the user actually kept against the suggestions and can
move the balance to match, so the suggestions drift toward the photographer's own
taste rather than toward an average.

## Build order

1. Postproduction for stills — done.
2. Planning: light and shadow tool, shot list, deadlines (highest daily value).
3. Inspiration: moodboard, palette, type.
4. Planning: gear, pricing, quote PDF.
5. Video selects.

## Culling profiles and learning (built)

`<userData>/learned.json` holds what the app has learned, shared by every project:

- **Profiles** (`Style` in code): a name, atmosphere words, a description, and a
  measured `StyleProfile` merged from every gallery folder and set of picks added to
  it. Atmosphere words are mapped to scoring adjustments (`feelOf`); the measured
  profile tilts close calls (`styleBonus`); both are passed to Claude in the read.
  A few thumbnails per profile live in `projects/style-<id>/cache`.
- **Balance per kind of shoot**: when a project closes, the craft/moment balance that
  best matched the user's own decisions is averaged in, and new projects start there.

## Look extractor (built)

`analysis/look.ts` measures a look as a tone curve, a colour shift for shadows,
midtones and highlights, and a saturation factor, either between two images or
estimated from one. The same `Look` is written as a 33-point `.cube` LUT or as a
Lightroom preset using the point curve, colour grading and saturation.

## Live edit tips (built)

The edit coach polls the XMP sidecar of the selected RAW and runs `developTips` over
the Camera Raw settings in it. Read-only: the app never writes develop settings.
