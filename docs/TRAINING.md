# Training Atelier on your own photographs

Atelier improves by studying your work. This guide says what to give each part,
how much it needs, and how to tell that it has learned. All training happens on
your computer and nothing is uploaded. Open **Training** in the sidebar.

Training is cumulative: every run adds to what is already known, so repeat it
whenever you have new finished work. Each area can be forgotten separately.

## At a glance

| Part of the app | Give it | Minimum before it takes effect | Where you see the result |
| --- | --- | --- | --- |
| Culling suggestions | Past shoots you culled; every decision you make here | about 30 set-aside comparisons, in practice a few hundred decisions in bursts | Culling profiles → Your eye |
| Diagnose a photo | Finished photographs you are happy with | 12 photographs with a person in them | "Judged against your N finished photographs" in Diagnose |
| Edit coach tips | RAW files you edited, with Lightroom's XMP sidecars | 12 edited photographs | "within your usual range" and "Outside your own habits" tips |
| Your look | Unedited frames and their finished versions, same file names | 1 pair; 10 or more gives a stable average | Look extractor → Your house look |
| Culling profiles | A folder of photographs sharing a feeling | any | Culling profiles |

## 1. Culling: what you keep

The culling model learns from decisions: which frame of a moment you kept and
which you passed over. There are three ways to give it decisions.

**From a shoot you already culled in Lightroom** (the fastest way to teach it a lot):

1. Create a project for that shoot and set the kind of shoot.
2. Import the folder that holds *every* frame, not only the keepers.
3. Go to Training. Choose what "kept" means (for example at least 1 star) and press
   **Learn from Lightroom ratings**. Lightroom must have written the ratings to the
   files: Catalog Settings → Metadata → Automatically write changes into XMP, or
   select the photos and press Ctrl+S.

**From a folder of delivered files:** same steps 1 and 2, then **Learn from a folder
of delivered files** and choose the folder of exports. Files are matched by name, so
`IMG_0123.jpg` or `IMG_0123-Edit.jpg` marks `IMG_0123.ARW` as kept; every other frame
counts as not kept.

**By culling here.** Every pick and reject is learned from, every 25 decisions and
when you close the project.

Decisions made before Atelier count double: you made them with no suggestion from
this app in front of you. Decisions you have already made in the project are never
overwritten by an import.

*How to tell it has learned:* Culling profiles → Your eye shows how often the
built-in rules agree with you, how often the trained suggestions do, and how much say
your learned taste has earned. It stays at zero until it demonstrably does better.

*How much:* three or four past weddings is a strong start. More kinds of shoot is
better than more of the same.

## 2. Diagnose a photo: what your finished work looks like

Out of the box the diagnosis uses general limits (how much lost outline is too much,
what range skin hue should fall in, and so on). Those are not your limits. If you
make dark, low-key portraits, a general rule will keep telling you the subject merges
with the background.

1. Collect finished photographs you are happy with: exports, portfolio, delivered
   galleries. JPEG, PNG or WebP. Photographs without a person are skipped.
2. Training → **Train on finished photographs** and choose the folder.

From 12 photographs on, a new photo is flagged when it is worse than 85% of your own
finished work on that measure. The limits stay within bounds of the general ones, so
an odd training set cannot switch a check off.

**Feedback.** Under each finding in Diagnose you can answer **I agree** or **Not a
problem for me**. Each "not a problem" makes that check 8% more lenient for you; each
"agree" makes it 8% stricter.

*How much:* 50 to 200 photographs gives stable norms. Train separately when your
style changes; old samples are dropped once 3,000 are stored.

## 3. Edit coach: how you edit

1. In Lightroom Classic, make sure settings are written beside the RAW files
   (Automatically write changes into XMP, or Ctrl+S on the selection).
2. Training → **Train on an edited shoot** and choose the folder of RAW files.

It records the value of each main slider in each photo. From 12 edited photographs,
the middle 90% of your values for a slider is your usual range. Tips then behave
differently: a value a general rule would flag, but which is normal for you, is
mentioned as your style rather than as a problem; and a value outside your own range
is pointed out even if no general rule objects.

*How much:* a few hundred edited frames from different shoots.

## 4. Look: your own colour

1. Put unedited frames in one folder (RAW or JPEG) and the finished versions in
   another, with the same file names.
2. Training → **Train on before/after pairs**; choose the unedited folder first, then
   the finished one.

Each pair gives one measured look (tone curve, tint of shadows, midtones and
highlights, saturation). They are averaged into your house look, which you can save
as a LUT or a Lightroom preset from the Look extractor. Use pairs from the same kind
of light for a clean result; mixing daylight and tungsten work averages two looks
into one that is neither.

## 5. Culling profiles

Described in the app under Culling profiles: add a gallery folder to a profile, or
your picks from a project, and optionally let Claude put its essence into words.

## What training cannot do

- It adjusts thresholds, weights and ranges. It does not retrain the face, person or
  segmentation models, so it cannot make the app see something it cannot see now
  (a face turned away, a very small face, a silhouette the mask gets wrong).
- It learns from what you provide. Finished photographs teach what your good work
  looks like, not what you would have rejected; only culling decisions teach that.
- It has been tested on synthetic data and a handful of sample images. The first real
  training runs are also the first real test: check "Your eye" and the limits shown
  in Training after each run, and forget an area if it has gone somewhere odd.

## Where it is stored

In the app's data folder: `learning.json` (culling decisions), `training.json`
(norms, habits, house look, feedback, log), `learned.json` (profiles). Copy these
three files to move what Atelier has learned to another computer.
