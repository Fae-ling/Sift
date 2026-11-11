# Atelier development plan

Where the program should go next, why, and how each part is to be built.
`ARCHITECTURE.md` describes how the app is put together today; this document is the
plan from here.

## 1. What the research says

Findings from reading reviews, comparisons and workflow guides for culling tools
(Narrative Select, Aftershoot, FilterPixel, Imagen, Lightroom's assisted culling),
and what each means for Atelier. Most published material is written by vendors, so
these are leads, weighted by how often independent photographers repeat them.

| Finding | Consequence for Atelier | Status |
| --- | --- | --- |
| AI cullers lose **shot-list moments**: in one photographer's audit the tool dropped 65 frames they would keep, three of them unrepeatable (a second angle of the rings, a grandmother's portrait, a laugh during a speech). "A culling tool you never double-check is a gamble." | Never finish a cull without a safety pass. **Second look** lists the best frame of every moment nothing was kept from. | built |
| Photographers do not trust a verdict without a reason, and vendors themselves concede human review is needed for emotional moments. | Every suggestion carries its reasons; craft and moment are scored separately; flawed-but-alive frames are surfaced, not rejected. | built |
| **Two cameras with different clocks** scramble capture order; the standard fix is to find a shared moment and shift one body's times. | Per-camera clock correction at import; stacks never mix bodies. | built |
| **Close-ups of every face** are the feature reviewers praise most in Narrative and Aftershoot for group shots; Lightroom now shows per-face eye scores. | Face crops for all faces; small faces must actually be found. Two-stage detection (people, then heads). | built |
| Reviewers found frames with closed eyes that tools kept, and good frames they rejected. | Blink is a flag with context (laugh, embrace), never a hard reject; thresholds must be tuned on real shoots. | built, needs calibration |
| Tools differ on **genre awareness**; most are genre-agnostic. | Kind of shoot, story plan and culling profiles drive the weights. | built |
| "Key people" (best frames of the couple, parents) is asked for and poorly served. | Face clustering and a people panel. | planned, section 3.1 |
| Couples increasingly ask whether AI touched their wedding photos. | Atelier never edits or generates pixels; say so plainly, and keep it true. A one-page statement the photographer can share. | planned, section 3.8 |
| Planning tools are split across apps: moodboards (Milanote), sun position (PhotoPills), CRM (Studio Ninja, Tave). | The Inspiration and Planning phases keep everything in the one project the cull already reads. | planned, section 4 |

Sources are listed at the end.

## 2. Built in this round

- **Second look** filter: one frame per unkept moment.
- **Camera clock correction** per body, and per-body stacking.
- **Two-stage face detection**: a person detector proposes heads; the face model reads
  each one up close. Recovers faces in group and wide shots that the face model alone
  cannot see.
- **Undo / redo** for picks, rejects and ratings (Ctrl+Z, Ctrl+Shift+Z).
- **Side-by-side compare** (C) of the current frame against the moment's suggested frame,
  with face crops for both.
- **Chapter filter** in Cull once frames have been read.
- **Starting star ratings** from scores at hand-off, optional.
- **Spend summary** in Settings, by month and in total.
- **Project backup**: the previous state is kept and used if the project file is damaged.
- Unit tests now also run on Windows in CI.

## 3. Postproduction: next steps

Ordered by value to a wedding and portrait photographer.

### 3.1 Key people

*Why:* a wedding gallery must contain the important people looking like themselves.
Today the app knows there are faces, not whose.

*How:*
- Add a face-embedding model (a small ArcFace/MobileFaceNet-class ONNX model, about
  5 MB) run with `onnxruntime-web` on the GPU. Input: the aligned face crop the
  landmarks already give. Output: a 128 or 512-number vector per face, stored on
  `FaceInfo.embedding` (quantised to 8 bits to keep the project file small).
- Cluster embeddings per project (agglomerative, cosine distance, threshold tuned on
  real shoots). Each cluster is a `Person { id, name?, role?, faceCount, sampleShotId }`.
- **People panel**: clusters largest first; the user names and marks roles (couple,
  parents, wedding party). Unnamed clusters stay "Guest".
- Uses: a person filter in Cull; per-person coverage in Story ("the groom's mother
  appears in 2 picks, both with eyes down"); weight the couple's faces more heavily in
  craft and moment; tell the editor's read who is who.
- *Privacy:* embeddings never leave the machine and are not included in anything sent
  to Claude. Deleting a project deletes them.
- *Risk:* clustering splits one person across lighting conditions. Mitigate with a
  merge action in the panel; do not automate what the user can fix in one click.

### 3.2 Calibration on real shoots

*Why:* every threshold in `scoring.ts` was chosen from first principles and synthetic
tests. They need real data.

*How:*
- A **calibration export** (opt-in, local file): per frame the measurements, the
  suggestion and the user's decision, no images.
- A script (`scripts/calibrate.mjs`) that reads one or more exports and reports, per
  threshold: agreement rate, how many keepers were suggested as rejects (the costly
  error), how many rejects were suggested as keepers.
- Target: of the frames the photographer keeps, fewer than 3% suggested as rejects
  (they are still reachable through Second look, but the goal is not to need it).
- Fit `BLINK_LIMIT`, the focus slope, `GEM_MOMENT` and the stack distance from that data.
- Longer term: replace the hand-written weights with a small per-user model (logistic
  regression over the existing measurements) trained on their own decisions. It stays
  explainable because the inputs are the same named measurements.

### 3.3 Cost of Claude at wedding scale

- **Batch API** for the editor's read: half price, results within the hour. Offer
  "read overnight" beside "read now". Needs a job record on the project
  (`readJob { batchId, submittedAt, frames }`) and a poll on next launch.
- **Prompt caching**: the mentor prompt, brief, story plan and profile are identical
  across chunks; mark that prefix as cacheable so chunks 2..n pay a tenth for it.
- **Two-tier read**: the cheapest model reads everything for chapter and a coarse
  score; the strongest model re-reads only frames near a decision boundary and
  candidate gems. Expected saving: most of the bill, with the judgement where it matters.
- **Scene summaries** instead of frames for the Story request once reads exist: text
  only, a fraction of a cent.

### 3.4 Speed and scale

- Move pixel analysis into a **Web Worker** with `OffscreenCanvas` so the window stays
  responsive during import; two workers on machines with 8+ cores.
- **Virtualise** the thumbnail strip (render only visible scenes) for shoots above
  about 3,000 frames.
- Split the project file: decisions in `project.json`, measurements in
  `analysis.json` written once. Saves become kilobytes instead of megabytes.
- Use the **full-size embedded JPEG** only for focus measurement and keep the preview
  path light; measure import time on real ARW and RAF files and publish it in the README.

### 3.5 Edit coach

- **See the result, not only the sliders**: watch a folder where the photographer
  exports a JPEG of the frame being edited, and show its scopes against the original
  preview. Tips can then refer to what the edit did to the picture, not only to slider values.
- **Reference frame per scene**: mark one pick as the scene's reference; the coach
  compares every other pick's settings against it and lists what to sync.
- **Look extractor**: HSL estimation (per-hue shifts) when a starting frame is given;
  verify the preset in Lightroom Classic and Camera Raw and fix whatever import shows.
- **Capture One** hand-off (its own sidecar format for ratings and colour tags).

### 3.6 Story and delivery

- Drag-and-drop sequencing; album-spread view (pairs) with the pairing principles from
  Learn applied as hints.
- **Numbered export** of picks in story order, and a contact-sheet PDF for the client.
- Shot list from Planning shown against picks ("ring exchange, second angle: nothing kept").

### 3.7 Video selects

As in `ARCHITECTURE.md`: keyframes through bundled FFmpeg, the same on-device
measurements, take selection, an EDL of selects for Resolve, and shot-matching notes.
Start with the smallest useful slice: import clips, show keyframes, pick takes, export EDL.

### 3.8 Trust and distribution

- **Code signing** for Windows (an OV certificate or Azure Trusted Signing) so
  SmartScreen stops warning; then **auto-update** through `electron-updater` and
  GitHub Releases.
- An in-app page, exportable as PDF, stating exactly what the software does with a
  client's photos: nothing is uploaded unless the photographer presses a Claude button;
  what is sent then (small previews, the brief); nothing is ever edited or generated.
- Crash and error log written locally, with a "copy diagnostics" button. No telemetry.

## 4. Planning and Inspiration

Designed in `ARCHITECTURE.md`. Build order and the first slice of each:

1. **Light planner** (Planning): date, time and place in; sun azimuth and elevation,
   golden and blue hour, and a compass diagram of shadow direction and length out.
   Pure maths, no service. This is the single most-used planning tool for location work.
2. **Shot list** from the story plan, checked off on the day, compared with picks after.
3. **Deadlines** on the Projects screen, worked back from the delivery date.
4. **Moodboard** canvas with palette extraction (reuses `colorStats` and
   `describeHarmony`) feeding the brief's mood words and references.
5. **Type and layout** play, then gear lists and pricing.

Each slice ships usable by itself and writes into the same project file.

## 5. Engineering practice

- **Tests.** Pure logic (grouping, scoring, style, look) is unit-tested; the end-to-end
  test drives the real app, with Claude replaced by a stand-in. Add a fixture set of
  real, permission-cleared RAW files (ARW, RAF) to a private location and run the
  end-to-end test against it before each release.
- **Never fake the paid path in release checks.** Before a release, run one real
  editor's read, one grading plan and one essence with a real key and record the cost.
- **Compatibility.** Project files are forward-migrated on open (`openProject`); every
  new field needs a default there and a test.
- **Performance budget.** Import: under 0.15 s per frame on a mid-range GPU. Moving
  between frames in Cull: under 50 ms at 3,000 frames.
- **Honesty in the interface.** Any number shown must say what it measures and what it
  cannot. Any paid action shows an estimate first and the real cost after.

## 6. Open questions for the photographer

1. Do the Keepers match your eye on a real wedding? Which gems does it miss or invent?
2. Is the Lightroom preset from the look extractor importing correctly?
3. Would you use an overnight, half-price read, or is waiting a deal-breaker?
4. Which planning tool would you open most: light, shot list, or deadlines?

## Sources

- [Narrative: Aftershoot vs Narrative](https://narrative.so/blog/aftershoot-vs-narrative-which-is-better-culling-software)
- [Narrative: How AI photo culling software works](https://narrative.so/blog/how-ai-photo-culling-software-works)
- [Honest review of Aftershoot AI culling](https://mariess.squarespace.com/blog/honest-review-of-aftershoot-ai-culling)
- [Photographer AI workflow stage (audit of missed frames)](https://sagnikbhattacharya.com/blog/photographer-ai-photo-editor-workflow-stage)
- [Fstoppers: The AI debate splitting wedding photographers](https://fstoppers.com/wedding/ai-debate-splitting-wedding-photographers-right-now-903674)
- [Fstoppers: Review of Narrative Select](https://fstoppers.com/originals/tired-culling-taking-your-precious-time-fstoppers-review-narrative-select-ai-489934)
- [Adobe: Assisted culling in Lightroom Classic](https://helpx.adobe.com/ae_en/lightroom-classic/help/assisted-culling.html)
- [Digital Camera World: Lightroom Classic's assisted culling](https://www.digitalcameraworld.com/tech/software/lightroom-classics-assisted-photo-culling-is-a-great-idea-but-is-really-annoying-but-i-have-found-a-solution)
- [Digital Camera World: Zenfolio PhotoRefine.ai review](https://www.digitalcameraworld.com/reviews/zenfolio-photorefineai-review)
- [Photography Life: Synchronize your cameras](https://photographylife.com/wedding-photography-tips-synchronize-your-cameras)
- [Fstoppers: How to time sync your files in Lightroom](https://fstoppers.com/how-to-easily-time-sync-your-files-in-lightroom)
- [Lightroom Killer Tips: Edit capture time](https://lightroomkillertips.com/edit-capture-time/)
- [SLR Lounge: Photography studio management software guide](https://www.slrlounge.com/photography-studio-management-software-guide/)
