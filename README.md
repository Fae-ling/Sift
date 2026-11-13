# Sift

A culling tool for professional photographers. It takes the RAW files of a shoot,
small or very large, and helps choose the frames worth keeping: technically sound,
but also the ones that hold the emotion and the moments a shoot of that kind must
not come back without. It learns from every decision, and the photographer, with
Claude's help when wanted, teaches it what they see. See
[docs/CONCEPT.md](docs/CONCEPT.md).

## What it does today

| Step | What happens | Cost |
| --- | --- | --- |
| **Brief** | The kind of shoot, client ask, your intention, mood words, references, target count, and an editable **story plan**: the chapters this shoot should contain and what makes a frame from each worth keeping. | free |
| **Import** | Reads the JPEG preview your camera embeds in each RAW (Sony `.ARW`, Fujifilm `.RAF`, also CR2/CR3/NEF/DNG/ORF/RW2 and JPEG). Measures focus, closed eyes, smiles, exposure, colour; groups the shoot into scenes and stacks of near-identical frames. | free, on your machine |
| **Cull** | One decision per *moment* instead of per frame. Every frame has a **craft** score and a **moment** score; a slider sets how much each counts. Laughter, closeness and the peak of a burst are recognised, closed eyes in a laugh or embrace are not treated as blinks, and flawed frames that hold a moment are surfaced as **hidden gems** instead of rejected. | free |
| **Ultrafast cull** | One step that rejects misfires, frames blurred beyond use, and flawed takes of a moment that has a clean one. Never a hidden gem, a frame you decided, or the only frame of a must-have chapter. One undo restores everything. Fast import mode for very large shoots. | free |
| **Emotions** | Reads the emotion on every face: 14 to start (joy, laughter, tenderness, sadness, crying, anger, fury, surprise, fear, awe, disgust, contempt, concentration, pout), and any you teach it. Click a face in Cull to name what it shows; strong expressions it cannot name are collected for you or Claude to name. Each style says how much it values each emotion, and an emotion that is rare in the shoot counts for more. | free; Claude naming optional |
| **Reads each frame** | Every frame gets a sentence saying what is happening in it (who, how close, what faces and bodies are doing, framing, light), and two lists: what it **brings** and what is **against it**. You can correct the words and the gesture; both teach the app. | free |
| **Gestures** | Reads what bodies are doing (arms raised, embrace, hand to face, in motion, turned away... 15 to start, and any you teach), so a frame can carry a moment even when no face is visible. | free |
| **People** | Tells the people of a shoot apart by face, hair and clothes. Name them, mark the **key people**: their frames count for more, their closed eyes count for more than a bystander's, and you can see how many kept frames each has. Faces are told apart on your machine, never identified. | free |
| **Old projects and people** | A project imported before Sift could tell people apart, or with the fast import, can have its faces read afterwards (People → Read the faces): it works from the previews already kept. Under each person, *Check their faces* shows every face found as them; × on one that is not them removes it, and Sift learns from it. | free |
| **Mistakes against assets** | Learns from your decisions which mistakes you forgive for which assets ("closed eyes kept when there is laughter") and stops rejecting those frames, showing the evidence instead. | free |
| **Learns from Claude** | Everything Claude says about a frame is kept. Its words for what is happening are tied to the frame's measurements, so the app learns to recognise them by itself; they count fully once your decision agreed with Claude about that frame. Claude, in turn, is told before every read what your decisions have shown and where you went against it. | free once paid for |
| **Review with Claude** | In the Workshop, Claude reads a digest of everything collected (numbers and words, never photos), explains your pattern back to you, and proposes settings: starting weights for your taste model, which mistakes to forgive and when, coincidences to stop using, and style changes. You approve each one; the taste-model guidance is then tested on decisions held back from learning and set aside if it makes things worse. | optional, cents |
| **Re-estimate** | Scores a culled project again with what the app knows today (minus what it learned from that project) and reports how many of your calls it would now make, plus frames worth another look. For one shoot in Cull's settings popover; for all projects in Workshop → Overview. | free |
| **Setup guide** | Opens on first start: your kinds of work, past shoots culled in Lightroom (imported and learned from in one step), finished work, your colour, Claude. Every step skippable; runs again from Settings. | free |
| **Loupe and filmstrip** | In Cull the photo fills the middle, the shoot runs along a filmstrip at the bottom grouped by scene, and the menu shrinks to icons. Tab hides the side panel; Shift+Tab leaves only the photo, as in Lightroom. | free |
| **Choosing several frames** | Ctrl-click, Shift-click or Ctrl+A in Cull, then pick, reject, clear or rate them all at once. | free |
| **Why you rejected it** | After a reject, one number key gives the reason. The app learns what frames rejected for each reason look like, and tells Claude. | free |
| **Workshop** | A separate window for everything learned: your eye, styles, emotions, gestures, words, mistakes and reasons, the record with Claude, and teaching with photos. Every learned item can be looked through and removed or switched off. | free |
| **Updates** | Settings → Updates installs a newer version over the old one and restarts; your data stays and is backed up first. Finds new versions on GitHub with a read-only token, or installs a downloaded installer. Backup and restore of everything learned. | free |
| **Shoot styles** | Your kinds of work (wedding, LARP battle, boudoir, birthday, fantasy...). Each holds its chapters and which must not be missed, the emotions it looks for, what to look for and what to forgive, and its balance of craft against moment. Create one from a sentence; Claude can develop it and later refine it from what you kept. Styles also learn from gallery folders and from your decisions. | free; Claude development optional |
| **Cull, working tools** | Keepers-first filters with counts; **Second look** (the best frame of every moment you kept nothing from, to catch a missed shot-list moment); side-by-side compare (C); undo and redo; a chapter filter once frames are read. | free |
| **Editor's read** | Optional. Claude looks at one to three thumbnails per moment with your brief and story plan, and says for each which chapter it belongs to, how much it carries and why. Runs in batches; can be paused and resumed. | optional; shows an estimate first |
| **Learns your eye** | Every pick and reject becomes an example. A small model of your taste is retrained as you cull and tested on bursts it was never shown; it only influences suggestions to the extent it beats the built-in rules there. About one burst in ten is shown without a suggestion, so your unprompted choices can be learned from. See Workshop → Your eye. | free |
| **Training** | One screen to teach with your own photographs: culling from past shoots (Lightroom ratings or a folder of delivered files), diagnosis norms from finished photographs, a house look from before/after pairs. Each run adds to what is known; each area can be forgotten. See [docs/TRAINING.md](docs/TRAINING.md). | free |
| **Cull with Claude** | The editor's read, now aware of the chosen profile as well as the brief and story plan. | optional |
| **Story** | Your picks as a sequence: coverage by chapter and shot type, gaps, reordering. **Your eye** compares your decisions with the suggestions and can tune the balance to your taste. Optionally asks Claude for a picture editor's sequence. | optional, cents |
| **Diagnose a photo** | Open any photo, or a pick. Eight panels show what a retoucher looks for: subject and faces; skin, eyes and lips; where the eye goes and what distracts it; the picture as three masses; where the outline merges with the background; skin evenness; sky and vegetation; the silhouette. Findings are written out with the adjustment and its reason. A try-it preview sketches the fix on a small copy, and the masks can be saved as PNG. Optionally Claude writes a description, diagnosis and ordered adjustments. | free; Claude read optional |
| **Look extractor** | Open a finished photo in almost any format; get its tone curve, shadow/midtone/highlight tints and saturation as a `.cube` LUT or a Lightroom preset. Add one of your unedited frames for a measured match and a preview. Claude can then shape the look so its atmosphere carries the concept of the shoot. | free; shaping optional |
| **Hand off** | Writes star ratings and colour labels to XMP sidecars that Lightroom Classic reads. | free |
| **Learn** | 27 short articles on culling, photo editing, colour, graphic design and video, each with further reading. | free |

Your originals are never modified, moved or uploaded. An existing `.xmp` sidecar is
updated in place, never replaced.

## Running cost

Everything measurable runs locally. The only paid part is the optional advice from
the Claude API, which needs your own key (Settings). A story request sends small
thumbnails of your picks. Reading a whole shoot (Cull with Claude) sends one to three
small thumbnails per moment: by the app's own estimate, about 600 frames cost roughly
$2 on the default model (Opus), $1 on Sonnet and 5 cents on Haiku. Each button shows
an estimate before and the actual cost after, and the model is chosen in Settings.
With no key, everything else still works.

## Updating without losing anything

Everything Sift learns and every project live in `%APPDATA%\Sift`, never in the
folder the program is installed in. (Sift was called Atelier until version 0.2.12;
on first start it moves `%APPDATA%\Atelier` to the new name, so nothing is lost.) Installing a newer version over the old one
(or uninstalling) leaves that folder alone.

Every build is published as a GitHub release (`Sift-Setup-0.2.N.exe`). In the app,
Settings → Updates either finds it for you (add a fine-grained GitHub token with
*Contents: read-only* on this repository once) or installs one you downloaded
(*Install from a file*). Before installing, it copies your data into
`%APPDATA%\Sift\backups`. Settings → Your data also backs everything up to a
folder of your choice and restores it.

## Install (Windows)

Every push builds an installer. In GitHub: **Actions → Build → latest run →
Artifacts → Sift-Windows-Installer**. The installer is unsigned, so Windows
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
- Emotion is read from the face only, through 51 expression measurements from a general
  face model. Some of them (nose wrinkle, cheek raise, brow movements) are weak in that
  model, so anger, disgust and similar emotions will be confused until taught with your
  own examples. Body language, context and what a moment means are not read locally;
  Claude's read covers some of that.
- The starting emotions and starter styles are descriptions, not measurements of real
  shoots. Nothing in the emotion or style system has been tried on real photographs yet.
- Composition is read only for the two strongest frames of each moment that contain a face.
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
