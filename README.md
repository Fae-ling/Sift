# Atelier

A local-first project studio for a photographer who also shoots video and designs.
It helps you cull faster, sequence a story, and plan an edit — and it teaches the
reasoning as it goes. It does not edit your photos for you.

**Status: stage 1 of 3.** Culling, story and the edit coach are built. Inspiration
(moodboards, palettes, type, music, poses) and Planning (deadlines, locations, sun
and shadow times, gear, pricing) come next; see [Roadmap](#roadmap).

## What it does today

| Step | What happens | Cost |
| --- | --- | --- |
| **Brief** | The kind of shoot, client ask, your intention, mood words, references, target count, and an editable **story plan**: the chapters this shoot should contain and what makes a frame from each worth keeping. | free |
| **Import** | Reads the JPEG preview your camera embeds in each RAW (Sony `.ARW`, Fujifilm `.RAF`, also CR2/CR3/NEF/DNG/ORF/RW2 and JPEG). Measures focus, closed eyes, smiles, exposure, colour; groups the shoot into scenes and stacks of near-identical frames. | free, on your machine |
| **Cull** | One decision per *moment* instead of per frame. Every frame has a **craft** score and a **moment** score; a slider sets how much each counts. Laughter, closeness and the peak of a burst are recognised, closed eyes in a laugh or embrace are not treated as blinks, and flawed frames that hold a moment are surfaced as **hidden gems** instead of rejected. | free |
| **Cull, working tools** | Keepers-first filters with counts; **Second look** (the best frame of every moment you kept nothing from, to catch a missed shot-list moment); side-by-side compare (C); undo and redo; a chapter filter once frames are read. | free |
| **Editor's read** | Optional. Claude looks at one to three thumbnails per moment with your brief and story plan, and says for each which chapter it belongs to, how much it carries and why. Runs in batches; can be paused and resumed. | optional; shows an estimate first |
| **Learns your eye** | Every pick and reject becomes an example. A small model of your taste is retrained as you cull and tested on bursts it was never shown; it only influences suggestions to the extent it beats the built-in rules there. About one burst in ten is shown without a suggestion, so your unprompted choices can be learned from. See Culling profiles → Your eye. | free |
| **Culling profiles** | A profile is a feeling to cull for: a name, atmosphere words ("intimate", "documentary", "editorial") and a description. The words change what the cull rewards. Each profile keeps learning from **gallery folders** (photographs you admire) and from **your own picks**; Claude can optionally distil a gallery into selection principles. Five starter profiles are included. | learning free; distilling optional |
| **Cull with Claude** | The editor's read, now aware of the chosen profile as well as the brief and story plan. | optional |
| **Story** | Your picks as a sequence: coverage by chapter and shot type, gaps, reordering. **Your eye** compares your decisions with the suggestions and can tune the balance to your taste. Optionally asks Claude for a picture editor's sequence. | optional, cents |
| **Edit coach** | Histogram, vectorscope with skin line, palette, and plain-language notes on tone, white balance, skin, harmony and consistency. Optionally asks Claude for a grading plan aimed at your brief, in Lightroom terms with a Resolve note. | notes free; plan optional, ~2¢ |
| **Edit coach, live** | Reads the develop settings Lightroom writes into the XMP sidecar and comments on the edit in progress (flattened light, orange skin, unmasked sharpening, moves that fight the brief). Refreshes every few seconds. Needs "Automatically write changes into XMP" in Lightroom. | free |
| **Diagnose a photo** | Open any photo, or a pick. Eight panels show what a retoucher looks for: subject and faces; skin, eyes and lips; where the eye goes and what distracts it; the picture as three masses; where the outline merges with the background; skin evenness; sky and vegetation; the silhouette. Findings are written out with the adjustment and its reason. A try-it preview sketches the fix on a small copy, and the masks can be saved as PNG. Optionally Claude writes a description, diagnosis and ordered adjustments. | free; Claude read optional |
| **Look extractor** | Open a finished photo in almost any format; get its tone curve, shadow/midtone/highlight tints and saturation as a `.cube` LUT or a Lightroom preset, with an explanation of what the look is made of. Add one of your unedited frames for a measured match and a before/after preview. | free |
| **Hand off** | Writes star ratings and colour labels to XMP sidecars that Lightroom Classic reads. | free |
| **Learn** | 27 short articles on culling, photo editing, colour, graphic design and video, each with further reading. | free |

Your originals are never modified, moved or uploaded. An existing `.xmp` sidecar is
updated in place, never replaced.

## Running cost

Everything measurable runs locally. The only paid part is the optional advice from
the Claude API, which needs your own key (Settings). A story request sends small
thumbnails of your picks; a grading plan sends one preview. Each button shows an
estimate before and the actual cost after. You can choose a cheaper model in
Settings. With no key, everything else still works.

## Install (Windows)

Every push builds an installer. In GitHub: **Actions → Build → latest run →
Artifacts → Atelier-Windows-Installer**. The installer is unsigned, so Windows
SmartScreen will ask you to confirm the first time.

## Run from source

Needs Node.js 22.

```bash
npm install
```

```bash
npm run dev
```

`npm install` also downloads the on-device face and person models (about 11 MB) from
Google's MediaPipe model storage. Without them the app works but skips eye and
expression checks.

Build an installer yourself:

```bash
npm run dist:win
```

## Tests

```bash
npm test
```

End-to-end (launches the real app against a folder of photos; needs Playwright
installed on the machine, and `xvfb-run -a` in front on a machine with no display):

```bash
ATELIER_SAMPLES=/path/to/photos npm run test:e2e
```

## How the culling works

1. **Preview extraction.** ExifTool pulls the embedded JPEG from each RAW. No RAW
   development, so a thousand frames take minutes.
2. **Focus.** Variance of the Laplacian on the sharpest tenth of the frame (so shallow
   depth of field is not punished), normalised for brightness, and scored *relative to
   the sharpest frames of the same scene*.
3. **Faces.** MediaPipe Face Landmarker: eye openness, smile, sharpness of the eye
   region, cheek colour. The face model cannot see small faces, so in group and wide
   shots a person detector finds the people first and each head is then read up close.
4. **Grouping.** A pause in shooting starts a new scene. Within a scene, consecutive
   frames from the same camera with a near-identical 64-bit difference hash, taken
   within 20 seconds, form a stack. If two cameras' clocks disagree, Import lets you
   correct one of them.
5. **Moment.** From the face landmarks: smiles that reach the eyes, laughter, faces
   turned toward or touching each other, and the frame where a burst's expression
   peaks. Weighted by the kind of shoot, so an unsmiling fashion frame is not marked down.
6. **Suggestion.** Craft and moment are combined by the project's balance. In each
   stack the best frame is suggested and close seconds are marked. Unexplained blinks
   and soft frames are suggested as rejects, unless the moment is strong enough to make
   them a hidden gem. Your own decision always wins.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the suite is put together and
[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for what comes next and why.

### Known limits

- Scores come from the camera's embedded preview, not the developed RAW. Clipping in
  particular looks worse in the preview than it is.
- "Eyes closed" also fires for a deliberate downward glance. It is a flag, not a verdict.
- Group shots: up to 14 people per frame are examined. Very small or turned-away faces
  can still be missed.
- The local moment score sees joy and closeness. It cannot see intensity, tension or
  tenderness in a quiet face; the editor's read and your own eye cover that.
- Diagnose a photo: masks come from a 256-pixel model and have soft edges. The skin
  evenness scale was set on a single test portrait and needs real photos to calibrate.
  There is no depth map and no real scene segmentation (sky and vegetation are guessed
  from colour); see docs/ARCHITECTURE.md for why and how they would be added. It does
  not retouch: the try-it preview is a sketch on a small copy.
- A gallery shows only what a photographer kept, never what they rejected, so a profile
  learns the character of their selections (and Claude infers the taste behind them); it
  cannot learn their actual cull.
- Galleries are added as folders of saved images. Reading a gallery straight from a web
  address is not built.
- The look extractor matches overall tone and colour balance, not individual colours, and
  it is only as good as the pairing: use an unedited frame from light similar to the
  reference. The Lightroom preset has not been tested in Lightroom yet.
- Not yet tested on real `.ARW` files or on Windows hardware; the RAW path was verified
  with a Fujifilm `.RAF` sample. Colour labels rely on Lightroom's default label names.

## Roadmap

- **Inspiration:** moodboard canvas, palette extraction and harmony tools, font
  pairing, layout sketches, music and pose references, story outline.
- **Planning:** deadlines, client brief to shot list, location scouting with sun
  position and shadow direction by time, gear lists, pricing and quotes.
- **Video:** import clips, select takes, shot-matching notes for Resolve.

## Layout

```
src/main       Electron main process: project storage, ExifTool, XMP export, Claude API
src/preload    The narrow bridge the window is allowed to call
src/renderer   The interface, on-device analysis, and the Learn library
src/shared     Types shared by all three
tests          Unit tests and the end-to-end smoke test
```
