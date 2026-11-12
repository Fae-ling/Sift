# Atelier: map of the app

What exists today, where it lives, and how the parts talk to each other. For what
comes next and why, see `DEVELOPMENT_PLAN.md`.

## Principles

1. **Local first, free by default.** Anything that can be measured runs on the user's
   machine. Paid AI is opt-in, per action, with an estimate before and the cost after.
2. **Teach, don't decide.** Every suggestion carries its reason. The app never changes
   a photograph and never makes a final choice.
3. **One project, several phases**, all reading and writing the same project.
4. **Originals are untouchable.** The app reads source files and writes only its own
   data folder, XMP sidecars, and files the user explicitly saves.

## Screens

| Screen | File | What the user does there |
| --- | --- | --- |
| Projects | `views/Projects.tsx` | Create, open, delete projects |
| 1 Brief | `views/Brief.tsx` | Kind of shoot, client ask, intention, mood, story plan |
| 2 Import | `views/Import.tsx` | Point at a folder; analysis; scene gap; camera clocks |
| 3 Cull | `views/Cull.tsx` | Decide per moment: filters, compare, undo, profile, balance, Cull with Claude |
| 4 Story | `views/Story.tsx` | Sequence picks, chapter coverage, "Your eye", picture editor's opinion |
| 5 Edit coach | `views/Coach.tsx` | Scopes, notes, live tips from Lightroom's sidecar, grading plan |
| 6 Hand off | `views/Export.tsx` | Ratings and labels to XMP; copy picks |
| Training | `views/Training.tsx` | Teach each part with your own photographs; training log |
| Culling profiles | `views/Profiles.tsx` | Feelings to cull for; galleries; the learned taste and its self-check |
| Diagnose a photo | `views/Diagnose.tsx` | What is wrong with one picture before retouching; try-it preview; masks |
| Look extractor | `views/Look.tsx` | A reference photo's look as LUT or Lightroom preset |
| Learn | `views/Learn.tsx` | Articles (`knowledge/index.ts`) |
| Settings | `views/Settings.tsx` | API key, model, spend |

## Processes

```
┌──────────────────── renderer (React) ────────────────────┐      ┌──────── main (Node) ────────┐
│ views/        the screens above                          │ IPC  │ store     projects, learned, │
│ store.ts      project state, autosave, undo, learning    │◄────►│           learning, spend,   │
│ analysis/     everything measured (table below)          │      │           settings           │
│ knowledge/    Learn library                              │      │ ingest    ExifTool, previews │
│ components/   Thumb, Scopes, cost helpers                │      │ exporter  XMP, copies, masks │
└───────────────────────────────────────────────────────────┘      │ ai        Claude API         │
                                                                   └──────────────────────────────┘
```

- The renderer never touches the file system or the network. It calls the narrow API
  in `src/preload`, typed in `src/shared/types.ts` (`StudioApi`).
- `media://` serves cached previews and can only read inside the app's data folder.
- The API key lives in the main process, encrypted by the operating system.

## What is measured, and by what

| Module (`src/renderer/src/analysis/`) | Does | Model |
| --- | --- | --- |
| `image.ts` | Decode, orient, resize; focus (Laplacian variance); difference hash | none |
| `color.ts` | Tone and colour statistics, palette, harmony | none |
| `faces.ts` | Faces: eyes, smile, laugh, head turn, eye sharpness, cheek colour; eye and lip outlines; people boxes for small faces | MediaPipe Face Landmarker, EfficientDet-Lite0 |
| `segment.ts` | Person, skin (face / body), hair, clothes masks | MediaPipe selfie multiclass |
| `grouping.ts` | Scenes, stacks, camera clock correction | none |
| `scoring.ts` | Craft and moment scores, suggestions, hidden gems | none |
| `style.ts` | Culling profiles: measured profile, atmosphere words | none |
| `learner.ts` | The photographer's taste: examples, training, held-back self-check | linear model, trained locally |
| `training.ts` | Personal norms, editing habits, house look, feedback; turns them into limits | none |
| `reading.ts` | Runs the whole diagnosis on one preview (shared by Diagnose and Training) | uses the above |
| `coach.ts` | Editing notes from measurements and from Lightroom settings | none |
| `look.ts` | Look extraction: curve, zone tints, saturation; LUT and preset writers | none |
| `diagnose.ts` | Attention, distractions, three masses, outline separation, skin evenness and colour, background clutter and colour families, findings | none |
| `pipeline.ts` | Import of one photo: preview, thumbnail, measurements | uses the above |

Models are downloaded by `scripts/fetch-models.mjs` on `npm install` and shipped with
the app in `out/renderer/mediapipe`.

## Data on disk (`<userData>/`)

| Path | Holds |
| --- | --- |
| `projects/<id>/project.json` (+ `.bak.json`) | Brief, story plan, shots with measurements and decisions, advice |
| `projects/<id>/cache/` | Preview (1600 px) and thumbnail per shot |
| `projects/style-<id>/cache/` | Sample thumbnails of a culling profile |
| `projects/look/`, `projects/diagnose/` | Scratch previews for the two single-photo tools |
| `learned.json` | Culling profiles; learned balance per kind of shoot |
| `learning.json` | Examples of the photographer's decisions, per project |
| `training.json` | Norms of finished photographs, editing habits, house look, feedback, log |
| `spend.json` | What Claude has cost, by month |
| `settings.json` | Model choice; encrypted API key |

## Calls to Claude (`src/main/ai.ts`)

| Call | Sends | Returns |
| --- | --- | --- |
| `read` (Cull with Claude) | Thumbnails of 1 to 3 frames per moment, brief, story plan, profile | Chapter, moment score, gem flag, note per frame |
| `story` | Thumbnails of picks, brief | Sequence, cuts, gaps, a lesson |
| `grade` | One preview, measurements, current Lightroom settings, brief | Read, direction, steps, risks |
| `essence` | Up to 36 thumbnails of a gallery, measured facts | How that photographer chooses |
| `diagnose` | One preview, the diagnosis findings, brief | Description, diagnosis, ordered adjustments, what stays the photographer's |

All use structured output, report their cost, and add it to the spend ledger.

## Diagnose a photo: how it is built, and how it grows

The feature answers, for one photograph, the questions a retoucher asks before
touching it. Each has a measurable part.

| Question | Built | How |
| --- | --- | --- |
| Where does the eye go? | yes | Centre-surround contrast in brightness and colour plus edge density (`attentionMap`), then faces added (`withFaces`). A flat bright area scores nothing. |
| What pulls the eye that should not? | yes | Compact high-attention regions outside the subject and a margin around it (`distractions`), judged without the face prior. |
| Does the subject separate from the background? | yes | Along the mask's outline, brightness and colour just inside against just outside (`separation`); merging stretches are located and named. |
| Does the picture read as masses? | yes | Three tonal masses (`notan`); which one the subject and its surroundings fall in. |
| Is the skin even? Is its colour right? | yes | Blotch-scale variation in brightness and redness (`skinEvenness`); CIELAB hue against the usual band, spread, face against body, lips against skin (`skinColour`). Eyes and lips are excluded. |
| Is the background fighting the subject? | yes | Edge density around the outline against the picture's average; colour families and hue spread (`readBackground`); saturation and local contrast of background against subject. |
| Where does the gaze lead? | partly | Head turn and the room in that direction. Iris-level gaze is not read yet. |
| What would the fix look like? | yes, as a sketch | Six sliders applied to a small copy through the masks; each names the Lightroom or Photoshop tool that does it for real. |
| Masks to work with | yes, soft | Subject, background, skin as PNG at preview size, from a 256 px model. |
| Depth (what is near, what is far) | **no** | Needs a depth model (Depth Anything V2 small, about 25 MB, run with `onnxruntime-web`). Its download host is not reachable from the build environment used so far, so it could not be integrated and tested. Would add: a depth panel, "atmospheric perspective" advice by distance, and a foreground/background split where there is no person. |
| Scene concepts (sky, vegetation, water, building, ground) | rough | Sky and vegetation are guessed from colour and position. A proper answer needs a scene-segmentation model (SegFormer-B0 on ADE20K, about 15 MB, same runtime as depth). |
| Doing the retouch (cleaning skin, removing objects, applying the masks) | **no, by design** | Atelier does not change photographs. The sketch shows direction and amount; the work is done in Lightroom and Photoshop, where it stays editable. |

**To add depth and scene concepts:** add `onnxruntime-web` and its WASM files to the
renderer's public folder; a `depth.ts` and `scene.ts` beside `segment.ts`, each
returning a map at the working size; two more entries in `PANELS`; and in `findings`:
subject-to-background distance for the separation advice, and named regions
("the sky", "the foliage") in place of positions for distractions. The `Analysis`
object in `Diagnose.tsx` is where new maps are attached.

**To sharpen the masks:** run the segmenter per person on a crop (the people boxes
from `faces.ts` already exist), or replace it with a matting model; the export path
does not change.

## Tests

- `tests/*.test.ts`: unit tests of the pure logic (grouping, scoring, profiles, look,
  learner, diagnosis, EXIF orientation).
- `tests/e2e/smoke.mjs`: drives the real app through every screen, with Claude
  replaced by a stand-in.
- CI (`.github/workflows/build.yml`): type-check, unit tests on Linux and Windows,
  build, Windows installer.
