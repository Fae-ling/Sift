# Sift roadmap

What is built, what is next, and why. [ARCHITECTURE.md](ARCHITECTURE.md) describes how the
app is put together today.

## Status

Built: the full import → cull → story → hand-off flow; scene and stack grouping with
per-camera clock correction; two-stage face detection; emotion, gesture and people
reading; the taste model with its held-back self-check; the mistakes-against-assets ledger;
reject reasons; Claude reads, descriptions that train the local models, and Review with
Claude; re-estimating old projects; training from past shoots; the Workshop; installer,
updater and backups.

## Design research

Findings from reading reviews, comparisons and workflow guides for culling tools
(Narrative Select, Aftershoot, FilterPixel, Imagen, Lightroom's assisted culling),
and what each means for Sift. Most published material is written by vendors, so
these are leads, weighted by how often independent photographers repeat them.

| Finding | Consequence for Sift | Status |
| --- | --- | --- |
| AI cullers lose **shot-list moments**: in one photographer's audit the tool dropped 65 frames they would keep, three of them unrepeatable (a second angle of the rings, a grandmother's portrait, a laugh during a speech). "A culling tool you never double-check is a gamble." | Never finish a cull without a safety pass. **Second look** lists the best frame of every moment nothing was kept from. | built |
| Photographers do not trust a verdict without a reason, and vendors themselves concede human review is needed for emotional moments. | Every suggestion carries its reasons; craft and moment are scored separately; flawed-but-alive frames are surfaced, not rejected. | built |
| **Two cameras with different clocks** scramble capture order; the standard fix is to find a shared moment and shift one body's times. | Per-camera clock correction at import; stacks never mix bodies. | built |
| **Close-ups of every face** are the feature reviewers praise most in Narrative and Aftershoot for group shots; Lightroom now shows per-face eye scores. | Face crops for all faces; small faces must actually be found. Two-stage detection (people, then heads). | built |
| Reviewers found frames with closed eyes that tools kept, and good frames they rejected. | Blink is a flag with context (laugh, embrace), never a hard reject; thresholds must be tuned on real shoots. | built, needs calibration |
| Tools differ on **genre awareness**; most are genre-agnostic. | Kind of shoot, story plan and culling profiles drive the weights. | built |
| "Key people" (best frames of the couple, parents) is asked for and poorly served. | Face clustering and a people panel. | built (general-purpose model) |
| Couples increasingly ask whether AI touched their wedding photos. | Sift never edits or generates pixels; say so plainly, and keep it true. A one-page statement the photographer can share. | planned |
| Planning tools are split across apps: moodboards (Milanote), sun position (PhotoPills), CRM (Studio Ninja, Tave). | The Inspiration and Planning phases keep everything in the one project the cull already reads. | planned |

Sources are listed at the end.


## Next

### Calibration on real shoots
Every threshold in `scoring.ts` was chosen from first principles and synthetic tests.
An opt-in local export (per frame: measurements, suggestion, decision; no images) and a
script that reports agreement and, above all, how many kept frames were suggested as
rejects (target: under 3%) would let `BLINK_LIMIT`, the focus slope, `GEM_MOMENT` and the
stack distance be fitted from data.

### Cost of Claude at wedding scale
Built: prompt caching of the shared briefing across batches. Still to do: the Batch API
for an overnight half-price read; a two-tier read (cheapest model reads everything, the
strongest re-reads only frames near a decision boundary); text-only scene summaries for
the Story request.

### Speed and scale
Pixel analysis in a Web Worker with `OffscreenCanvas`; a virtualised filmstrip for shoots
above about 3,000 frames; measured import times on real ARW and RAF files, published.

### Better people-matching
People are told apart with a general image model. A face-specific embedding model (a small
ArcFace-class ONNX model run with `onnxruntime-web`) would replace only `identify` in
`body.ts`; clustering, the people screen and the learning from corrections stay.

### Depth and scene understanding
A depth model and scene segmentation for the photo diagnosis; see the table in
[ARCHITECTURE.md](ARCHITECTURE.md#photo-readings-how-they-are-built-and-how-they-grow).

### Edit coach, story and delivery
Watching an export folder to show scopes of the edit against the original; a reference
frame per scene; Capture One hand-off; drag-and-drop sequencing, album spreads, a
numbered export and a contact-sheet PDF.

### Video selects
Keyframes through bundled FFmpeg, the same on-device measurements, take selection and an
EDL of selects for DaVinci Resolve. Smallest useful slice first.

### Trust and distribution
Code signing so SmartScreen stops warning; an in-app statement of exactly what is and is
not sent to Claude; a local error log with a "copy diagnostics" button. No telemetry.

### Planning and inspiration
Light planner (sun position and shadow direction from date, time and place), shot list
checked against picks, deadlines, a moodboard with palette extraction.

## Engineering practice

- Pure logic is unit-tested; the end-to-end test drives the real app with Claude replaced
  by a stand-in. Before a release, one real read, one grading plan and one essence are
  run with a real key and the cost recorded.
- Project files are forward-migrated on open; every new field needs a default and a test.
- Performance budget: import under 0.15 s per frame on a mid-range GPU; moving between
  frames in Cull under 50 ms at 3,000 frames.
- Any number shown says what it measures and what it cannot; any paid action shows an
  estimate first and the real cost after.

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
