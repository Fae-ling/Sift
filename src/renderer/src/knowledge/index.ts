// The Learn library. Each article is a short, practical distillation of widely
// taught practice, with places to go deeper. Body text uses a tiny subset of
// Markdown: "## heading", "- bullet", "1. numbered", **bold**.

export interface Source {
  label: string
  url?: string
}

export interface Article {
  id: string
  category: Category
  title: string
  summary: string
  body: string
  sources: Source[]
}

export const CATEGORIES = ['Culling', 'Photo editing', 'Colour', 'Graphic design', 'Video'] as const
export type Category = (typeof CATEGORIES)[number]

export const ARTICLES: Article[] = [
  // ------------------------------------------------------------------ Culling
  {
    id: 'cull-passes',
    category: 'Culling',
    title: 'Cull in passes, not frame by frame',
    summary: 'Why three quick passes beat one careful one.',
    body: `
The slowest way to cull is to make a final decision about every frame the first time you see it. You have no context yet: you do not know that a better version of this moment is four frames later.

## The three passes
1. **Reject pass (fast).** Remove only what can never be used: closed eyes, missed focus, misfires, test shots. No comparing. One or two seconds a frame. Atelier's flags do most of this pass for you; your job is to overrule it where a "flaw" is actually the picture.
2. **Moment pass.** Go stack by stack. For each moment keep the single strongest frame. Compare within the stack only. This is where most of the volume disappears: a thousand frames are usually two or three hundred moments.
3. **Story pass.** Now look at the survivors as a set. Cut for sequence, variety and the brief, not for quality: every frame left is already good.

## Rules that keep you fast
- Decide in **picks, not rejects**, once the obvious failures are gone. Choosing the few you love is quicker than justifying the removal of the many you do not.
- **Never edit while culling.** Tweaking a frame you have not yet chosen is the most common way an evening disappears.
- **Cull rested and in order.** Capture order keeps the day's logic in your head; fatigue makes everything look equally fine.
- When two frames are truly equal, **take either and move on**. Nobody but you will ever see the other one.
`,
    sources: [
      { label: 'Narrative: Photo culling, the complete FAQ', url: 'https://narrative.so/blog/photo-culling-complete-faq' },
      { label: 'Imagen: Photo culling workflow', url: 'https://imagen-ai.com/post/photo-culling-workflow/' },
      { label: 'Pixel Peeper: A faster culling workflow', url: 'https://pixelpeeper.com/resources/photo-culling' }
    ]
  },
  {
    id: 'cull-keeper',
    category: 'Culling',
    title: 'What makes a keeper',
    summary: 'Technical checks are a floor. Meaning decides.',
    body: `
A frame earns its place in this order. Stop at the first "no".

1. **Is there a moment?** Gesture, expression, connection, light doing something. A sharp picture of nothing is still nothing.
2. **Does it serve the brief?** A beautiful frame that contradicts what the work is for belongs in your portfolio folder, not the delivery.
3. **Is it clean enough?** Focus where it matters (the nearer eye, in a portrait), no blink unless the lowered eyes are the point, exposure recoverable.
4. **Is it the best version of this moment?** Compare inside the stack only.
5. **Does the set need it?** If you already have this beat covered, a second one dilutes both.

## Reading faces in a stack
- Look at **eyes first**, then mouth, then hands. Tension in hands gives away a stiff pose even when the face is fine.
- In groups, pick the frame where the **most important person** looks best, then check nobody is mid-blink. Perfect on everyone rarely exists.
- The frame **just after** the posed one is often the real one: people relax when they think it is over.

## When to keep a technically weak frame
Motion blur in a dance, grain in a dark church, a missed-focus frame of the one real laugh. If the moment is unrepeatable and the flaw reads as atmosphere at delivery size, keep it. Check it at the size it will be seen, not at 100%.
`,
    sources: [
      { label: 'Narrative: Photo culling checklist', url: 'https://narrative.so/blog/photo-culling-checklist-beginners' },
      { label: 'Henri Cartier-Bresson, "The Decisive Moment" (1952)' }
    ]
  },
  {
    id: 'cull-sequence',
    category: 'Culling',
    title: 'Sequencing: turning selects into a story',
    summary: 'Openers, rhythm, scale and endings.',
    body: `
A gallery, album or carousel is read in order. The order is part of the work.

## Building blocks
- **Establishing frame**: where are we? Wide, with air.
- **Characters**: who is this about? Medium and close.
- **Details**: hands, objects, textures, light on a wall. They slow the pace and add specificity.
- **Peak**: the emotional high point. Give it room: do not bury it between two similar frames.
- **Closer**: a frame that feels like an exhale. Walking away, a quiet look, an empty room.

## Rhythm
- **Vary distance.** Wide, medium, close, detail. Three frames in a row at the same distance read as one frame shown three times.
- **Alternate energy.** After a loud, busy frame place a quiet one. Contrast makes both stronger.
- **Pair deliberately.** Two frames side by side should rhyme (shape, colour, gesture) or answer each other (looking left / looking right; cause / effect).
- **Watch direction.** A subject looking out of the right edge leads the eye to the next image. Use it.

## Weddings and events
Chronology is the spine, but you do not need equal weight for every part of the day. A common proportion: preparation and details as a short prelude, ceremony and portraits as the core, celebration as the release. One strong frame per beat is better than five adequate ones.

## Portrait and fashion sets
There is no chronology, so build an arc of intensity: open inviting, move closer, vary crop and expression, end on the strongest or the quietest. Keep the light and colour consistent enough that it reads as one body of work.
`,
    sources: [
      { label: 'Davina + Daniel Kudish, "The Wedding Story" (CreativeLive): sequencing', url: 'https://www.creativelive.com/class/the-wedding-story-capture-creative-and-authentic-photos-davina-kudish-daniel-kudish' },
      { label: 'W. Eugene Smith\'s photo essays for LIFE ("Country Doctor", 1948) as models of sequence' },
      { label: 'Jörg Colberg, "Understanding Photobooks" (2016)' }
    ]
  },

  // ------------------------------------------------------------ Photo editing
  {
    id: 'edit-order',
    category: 'Photo editing',
    title: 'Order of operations in Lightroom',
    summary: 'Correct, then shape, then style.',
    body: `
Every adjustment changes what the next one needs, so the order matters. Three stages:

## 1. Correct: make it true
- **Profile** (Adobe Color, Camera Matching, or your own). It sets base colour and contrast, so choose it before touching sliders.
- **Lens corrections**, crop, straighten.
- **White balance.** Neutral first, taste later.
- **Exposure**, judged on the subject.

## 2. Shape: make it read
- **Whites and Blacks** to place the ends of the range (hold Alt/Option while dragging to see clipping).
- **Highlights and Shadows** to recover detail, sparingly.
- **Tone Curve** for contrast with intent.
- **Masks** to guide the eye: lift the subject, quieten the edges.

## 3. Style: make it yours
- **HSL / Color Mixer** to refine individual colours.
- **Color Grading** to tint shadows, midtones and highlights.
- **Grain, vignette, calibration** if they are part of your look.

Finish with **Detail** (sharpening, noise reduction) at 100%.

## Why style comes last
A look built on an uncorrected image only works on that image. A look built on a corrected image can be synced across the whole scene and saved as your own preset. That is how a consistent personal style is made.
`,
    sources: [
      { label: 'Adobe: Lightroom Classic user guide', url: 'https://helpx.adobe.com/lightroom-classic/user-guide.html' },
      { label: 'Photoworkout: How to edit photos in Lightroom', url: 'https://www.photoworkout.com/how-to-edit-photos-in-lightroom/' },
      { label: 'Martin Evening, "The Adobe Photoshop Lightroom Classic Book"' }
    ]
  },
  {
    id: 'edit-histogram',
    category: 'Photo editing',
    title: 'Reading the histogram',
    summary: 'A map of tones, not a target to hit.',
    body: `
The histogram counts pixels at each brightness: shadows on the left, highlights on the right. There is no correct shape. A snow scene lives on the right, a candle-lit portrait on the left.

## What to look for
- **A wall at either end** means clipping: detail lost to pure black or pure white. Small specular highlights can clip; skin, dresses and skies should not.
- **Empty space at both ends** means low contrast. Deliberate if you want softness, otherwise there is range you are not using.
- **Separate red, green and blue peaks** in an area that should be neutral show a colour cast.
- **A single channel clipping** (often red, on skin) loses colour detail before the brightness looks clipped. Skin turns flat and waxy.

## In practice
- Turn on the clipping indicators (J in Lightroom's Develop module).
- Set exposure for the subject first, then let the histogram tell you what that cost at the ends.
- Expose in camera so highlights you care about sit just below clipping. Shadows lift with noise; clipped highlights never come back.
`,
    sources: [
      { label: 'Adobe: Work with image tone and color in Lightroom Classic', url: 'https://helpx.adobe.com/lightroom-classic/help/image-tone-color.html' },
      { label: 'Michael Freeman, "Perfect Exposure"' }
    ]
  },
  {
    id: 'edit-wb-skin',
    category: 'Photo editing',
    title: 'White balance and skin tones',
    summary: 'Get skin right and viewers forgive everything else.',
    body: `
White balance has two axes: **Temperature** (blue to yellow) and **Tint** (green to magenta). People are far more sensitive to errors in Tint, because green or magenta skin looks unwell.

## A reliable method
1. Click the eyedropper on something that should be neutral: white of the eye, a grey card, a white shirt in the same light as the face.
2. Look at the skin. Adjust by eye from there; neutral is a starting point, not the answer.
3. Set white balance **per lighting situation**, then sync within the scene.

## What healthy skin looks like in numbers
Skin of every complexion shares nearly the same hue: orange, slightly toward red. Complexions differ in brightness and saturation, not hue. On a vectorscope all skin falls along one line, which is why colourists call it the skin tone line.

## Fixing skin without wrecking the image
- If **everything** is off, it is white balance.
- If **only skin** is off, use HSL: Orange is most of skin, Red is lips and flush, Yellow is highlights on skin.
- Lowering Orange saturation calms sunburn; raising Orange luminance brightens skin without touching exposure.
- Prefer **Vibrance** to Saturation for overall colour: it protects already-saturated colours and skin.

## Mixed light
Window light on one side, tungsten on the other: no single white balance is right. Choose for the key light on the face and correct the other side with a mask, or lean into the contrast as a look.
`,
    sources: [
      { label: 'Fstoppers: Perfecting skin color, a five-step Lightroom workflow', url: 'https://fstoppers.com/lightroom/perfecting-skin-color-five-step-lightroom-workflow-714570' },
      { label: 'Fstoppers: How to edit portrait skin tones in Lightroom', url: 'https://fstoppers.com/education/how-edit-portrait-skin-tones-lightroom-902830' },
      { label: 'Alexis Van Hurkman, "Color Correction Handbook" (chapter on skin and memory colours)' }
    ]
  },
  {
    id: 'edit-curve',
    category: 'Photo editing',
    title: 'Contrast and the tone curve',
    summary: 'Where most of a "look" actually comes from.',
    body: `
The tone curve maps input brightness (horizontal) to output brightness (vertical). A steeper section means more contrast in those tones; a flatter section means less.

## Shapes to know
- **Gentle S**: darker shadows, brighter highlights, more contrast in the midtones where faces live. The default improvement for most images.
- **Lifted blacks** (raise the bottom-left point): shadows become dark grey. The "matte" or film look. It trades depth for softness.
- **Rolled-off highlights** (lower the top-right point slightly, flatten the top): highlights become gentle, like film or print. Flattering on skin.
- **Midtone lift** (raise the centre): brightens faces without clipping anything.

## Contrast is also separation
An image has depth when the subject differs from the background in **brightness, colour or sharpness**. Before adding global contrast, ask which of the three you are short of. Often a mask that lifts the face a third of a stop does more than any curve.

## Per-channel curves
Curves on red, green or blue alone tint specific tonal ranges: lifting blue in the shadows cools them, lowering blue in the highlights warms them. It is the same idea as Color Grading, with finer control.
`,
    sources: [
      { label: 'Adobe: Tone Curve in Lightroom Classic', url: 'https://helpx.adobe.com/lightroom-classic/help/image-tone-color.html' },
      { label: 'Dan Margulis, "Professional Photoshop" (curves as the core tool)' }
    ]
  },
  {
    id: 'edit-hsl-grading',
    category: 'Photo editing',
    title: 'HSL versus Color Grading',
    summary: 'One changes colours; the other tints tones.',
    body: `
They sound alike and do different jobs.

## HSL / Color Mixer: change a colour wherever it appears
Selects by **hue**. Three controls per colour:
- **Hue**: shift it toward its neighbours (greens toward yellow for warm foliage, toward teal for a cooler, cinematic green).
- **Saturation**: how vivid.
- **Luminance**: how bright. Darkening blue deepens a sky; brightening orange lifts skin.

Use it to simplify the palette. Fewer distinct hues usually look more intentional: pull distracting colours toward the ones you are keeping, or desaturate them.

## Color Grading: tint by brightness
Selects by **tone**: shadows, midtones, highlights. Adds a colour to each.
- Cool shadows with warm highlights is the classic combination: it mirrors daylight (warm sun, sky-blue shade) and keeps skin warm.
- **Balance** moves the boundary between shadows and highlights; **Blending** controls how much they overlap.
- Keep saturation low. Between 5 and 15 is usually enough; if you can name the colour at a glance, it is probably too much.

## Order
HSL first to get individual colours right, then Color Grading to unify everything under one mood.
`,
    sources: [
      { label: 'Adobe: Color grading in Lightroom Classic', url: 'https://helpx.adobe.com/lightroom-classic/help/color-grading.html' },
      { label: 'Cursa: Vibrance, HSL, Color Grading and natural skin', url: 'https://cursa.app/en/page/color-tools-in-lightroom-classic-vibrance-hsl-color-grading-and-keeping-skin-tones-natural' }
    ]
  },
  {
    id: 'edit-consistency',
    category: 'Photo editing',
    title: 'Consistency across a set',
    summary: 'A set is judged as a whole.',
    body: `
Clients rarely notice that one frame is 200 K too warm. They do notice when a gallery jumps between warm and cool, bright and dark. Consistency is what makes a set look professional.

## Method
1. Group by **lighting situation**, not by time: same light, same settings.
2. In each group choose a **reference frame** and edit it fully.
3. **Sync** to the group (in Lightroom: select all, Sync Settings). Leave out crop and local masks.
4. Walk the group correcting only **exposure and white balance** per frame.
5. View the whole set as thumbnails. Outliers are obvious when small.

## Tools that help
- **Reference View** in Lightroom's Develop module shows your reference beside the frame you are matching.
- **Match Total Exposures** evens brightness across a selection shot at different settings.
- Compare **skin** between frames, not backgrounds. Skin is what viewers compare.

## Consistent does not mean identical
A reception at night should not match the ceremony at noon. Aim for the same contrast character, the same treatment of skin, the same palette decisions. The light changes; the hand stays the same.
`,
    sources: [
      { label: 'Adobe: Reference View and syncing settings', url: 'https://helpx.adobe.com/lightroom-classic/user-guide.html' },
      { label: 'Exposure Software: Wedding workflow', url: 'https://exposure.software/tutorial/wedding-workflow/' }
    ]
  },
  {
    id: 'edit-retouch',
    category: 'Photo editing',
    title: 'Retouching with restraint',
    summary: 'What to fix in Photoshop, and when to stop.',
    body: `
Do global work in Lightroom, then take only your final selects into Photoshop.

## A sensible order
1. **Clean up**: temporary things only. Blemishes, stray hairs, lint, sensor dust. Leave permanent features unless asked.
2. **Even out**: dodge and burn at low flow on a 50% grey layer set to Soft Light, to reduce blotchiness while keeping texture.
3. **Shape the light**: larger, softer dodge and burn to enhance the form that is already there.
4. **Colour**: fix local colour problems (red hands, uneven skin) with a hue/saturation layer and a mask.

## Keeping it believable
- **Texture is what makes skin look like skin.** Blur-based smoothing removes it; dodge and burn preserves it. Frequency separation is a tool for specific problems, not a default.
- **Zoom out often.** Decisions made at 200% are invisible or wrong at viewing size.
- **Work non-destructively**: layers and masks, so you can lower opacity later. You will usually want to.
- **Stop earlier than you think.** Come back the next day; over-retouching is far easier to see with fresh eyes.

## Ethics and the brief
Agree with the client how far retouching goes before you start. Changing body shape or skin colour without being asked is a decision about a person, not about a picture.
`,
    sources: [
      { label: 'Adobe: Photoshop user guide, retouching and repairing', url: 'https://helpx.adobe.com/photoshop/user-guide.html' },
      { label: 'Fstoppers: Editing portraits with Lightroom, Photoshop and Nik', url: 'https://fstoppers.com/portraits/how-edit-portraits-using-lightroom-photoshop-and-nik-collection-698122' },
      { label: 'Natalia Taffarel\'s teaching on dodge and burn retouching' }
    ]
  },
  {
    id: 'edit-output',
    category: 'Photo editing',
    title: 'Sharpening, noise and export',
    summary: 'Finish for where the image will be seen.',
    body: `
## Noise reduction
Reduce noise just enough that it stops distracting. Some luminance grain looks natural; colour noise (random red and green speckles) never does, so remove that first. AI Denoise works on the RAW and is best applied before heavy tonal changes.

## Sharpening has three jobs
1. **Capture sharpening** (Detail panel): restores the slight softness every sensor produces. Use the Masking slider (hold Alt/Option) so only edges are sharpened, not skin or sky.
2. **Creative sharpening**: local, to draw attention. Eyes, jewellery, texture.
3. **Output sharpening** (Export dialog): compensates for resizing and for the medium. Screen and print need different amounts.

## Export
- **Web and social**: sRGB, JPEG quality 75 to 85, sized to the platform (around 2000 to 2500 px on the long edge for galleries). Anything other than sRGB will look wrong in many browsers and apps.
- **Print**: ask the lab. Usually sRGB or Adobe RGB JPEG or TIFF at full resolution; soft-proof with the lab's profile if they provide one.
- **Archive**: keep the RAW plus the catalog or XMP. The edit is a recipe, not a file.

## Screen
A calibrated monitor at a moderate brightness (about 100 to 120 cd/m² for print work) is the cheapest improvement to colour judgement there is. Edit in dim, neutral surroundings; a bright or coloured room shifts what you see.
`,
    sources: [
      { label: 'Adobe: Sharpening and noise reduction in Lightroom Classic', url: 'https://helpx.adobe.com/lightroom-classic/help/sharpening-noise-reduction.html' },
      { label: 'Bruce Fraser & Jeff Schewe, "Real World Image Sharpening"' }
    ]
  },

  // ------------------------------------------------------------------- Colour
  {
    id: 'colour-three',
    category: 'Colour',
    title: 'Hue, saturation, luminance',
    summary: 'The three dials behind every colour decision.',
    body: `
Every colour can be described by three independent qualities.

- **Hue**: which colour. Its position around the wheel.
- **Saturation**: how pure. From grey to vivid.
- **Luminance** (value): how bright.

## Why this matters
Most colour problems are diagnosed by asking which of the three is wrong.
- Skin looks sunburnt: **hue** too red, or **saturation** too high.
- A sky looks weak: often **luminance** too high, not saturation too low. Darken blue before saturating it.
- Colours look garish: saturation is high in **bright** areas. Real-world bright colours are rarely very saturated; film and print naturally desaturate highlights.

## Value does the work, colour gets the credit
Convert an image to black and white: if it still reads clearly, the structure is sound. If it turns to mush, no colour grade will save it. Painters check value first for the same reason.

## Saturation and brightness interact
A colour is at its most saturated at a particular brightness (yellow when light, blue when dark). Pushing a colour away from that brightness makes it look less colourful even if the saturation number is unchanged. This is why darkening blue skies makes them richer.
`,
    sources: [
      { label: 'Johannes Itten, "The Art of Color" (1961)' },
      { label: 'James Gurney, "Color and Light: A Guide for the Realist Painter" (2010)' },
      { label: 'Albert Munsell\'s colour system (hue, value, chroma)' }
    ]
  },
  {
    id: 'colour-harmony',
    category: 'Colour',
    title: 'Colour harmonies',
    summary: 'Relationships on the wheel, and what each feels like.',
    body: `
Harmony describes how the hues in an image relate. It is a way to see what you already have and decide what to remove.

- **Monochromatic**: one hue in many tones. Unified, calm, graphic. Risk: flat. Fix with strong value contrast.
- **Analogous**: neighbours on the wheel (yellow, orange, red). Natural and comfortable; most golden-hour and forest scenes. Risk: no focal point. A small opposite accent helps.
- **Complementary**: opposites (orange and teal, red and green, yellow and violet). Maximum colour contrast; each makes the other look more vivid. Let one dominate.
- **Split-complementary**: one hue plus the two beside its opposite. Contrast with less tension.
- **Triadic**: three evenly spaced hues. Lively, playful. Needs one clear leader.

## Using harmony in photographs
You rarely add colours in a photograph; you **reduce** them. Grading toward a harmony means:
1. Identify the two or three hues that matter.
2. Pull stray hues toward them with HSL hue shifts, or desaturate them.
3. Check that the subject holds the colour that differs most from its surroundings.

## Proportion
The 60-30-10 guideline from interior and graphic design applies: a dominant colour, a secondary, and a small accent. The accent has power because it is rare.

## Planning it
The cheapest colour grade is done before the shutter: wardrobe, location and time of day set the palette. A moodboard with a five-colour palette, shared with the client and stylist, does more than any slider.
`,
    sources: [
      { label: 'Johannes Itten, "The Art of Color"' },
      { label: 'Adobe Color wheel (interactive harmonies)', url: 'https://color.adobe.com/create/color-wheel' },
      { label: 'Patti Bellantoni, "If It\'s Purple, Someone\'s Gonna Die" (colour in film)' }
    ]
  },
  {
    id: 'colour-contrast',
    category: 'Colour',
    title: 'Seven kinds of colour contrast',
    summary: "Itten's list: seven ways colours set each other off.",
    body: `
Johannes Itten, teaching at the Bauhaus, described seven distinct ways colours contrast. Knowing them gives you seven separate tools for making a subject stand out.

1. **Hue**: different pure colours side by side. Bold, simple, folk-art energy.
2. **Light and dark**: the strongest contrast and the one that survives in black and white.
3. **Cold and warm**: warm colours advance, cool colours recede. The basis of depth in most cinematic grading.
4. **Complementary**: opposites intensify each other.
5. **Simultaneous**: the eye generates the complement of a colour next to it. Grey beside orange looks bluish. This is why a neutral background takes on a tint from the subject, and why your editing room should be neutral.
6. **Saturation**: vivid against muted. A small saturated element in a desaturated frame is impossible to ignore.
7. **Extension (proportion)**: how much of each colour. A little bright yellow balances a lot of dark violet.

## Applying it
When a subject does not separate from the background, ask which contrast is available. You may not be able to change brightness without flattening the light, but you can cool the background (cold-warm), mute it (saturation), or crop to change proportions (extension).

Josef Albers showed the companion lesson: a colour has no fixed appearance. The same swatch looks different on every background. Judge colours in context, never in isolation.
`,
    sources: [
      { label: 'Johannes Itten, "The Art of Color" / "The Elements of Color"' },
      { label: 'Josef Albers, "Interaction of Color" (1963)' }
    ]
  },
  {
    id: 'colour-mood',
    category: 'Colour',
    title: 'Colour, light and mood',
    summary: 'Why warm reads as intimate and teal-orange is everywhere.',
    body: `
## Temperature
- **Warm** (amber, gold): intimacy, nostalgia, comfort, late day.
- **Cool** (blue, cyan): distance, calm, melancholy, night, modernity.
- **Mixed**: warm subject in a cool world is the most used scheme in cinema, because skin is orange and orange's complement is blue-cyan. It separates people from everything else using colour alone. That is all "teal and orange" is.

## Saturation and contrast set the register
- **Low saturation, low contrast**: quiet, memory, softness.
- **Low saturation, high contrast**: grit, drama, documentary.
- **High saturation, high contrast**: energy, commercial, pop.
- **High saturation, low contrast**: dreamlike, pastel.

Choose the register from the brief's mood words before touching a slider, and write it down. It keeps you from drifting halfway through a set.

## Associations are cultural, light is physical
Colour symbolism (white for weddings or for mourning, red for luck or danger) varies by culture and context: ask who the audience is. The feelings we attach to light are steadier, because everyone has lived through golden evenings and blue dusk. Grades that echo real light feel believable; grades that fight it feel like filters.

## Keep an anchor
However far you push a look, keep one thing true: usually skin, sometimes a known neutral. The viewer needs a reference to read the rest as intentional.
`,
    sources: [
      { label: 'Patti Bellantoni, "If It\'s Purple, Someone\'s Gonna Die"' },
      { label: 'Vittorio Storaro on colour and light in cinematography ("Writing with Light")' },
      { label: 'James Gurney, "Color and Light"' }
    ]
  },

  // ----------------------------------------------------------- Graphic design
  {
    id: 'design-hierarchy',
    category: 'Graphic design',
    title: 'Hierarchy, grids and white space',
    summary: 'Deciding what is seen first, second and third.',
    body: `
Layout is the ordering of attention. A viewer should know within a second where to look first.

## Hierarchy
Make one element clearly dominant, a second supporting, and the rest quiet. The tools, strongest first:
- **Size** and **weight**
- **Contrast** (value and colour)
- **Position** (top and left are read first in left-to-right cultures; centre and isolation also dominate)
- **Space around it**

Squint at the layout: what you still see is your hierarchy. If everything is emphasised, nothing is.

## Grids
A grid is a set of invisible columns and margins that elements align to. It makes decisions for you and gives a layout its calm. Start with generous margins and a 12-column grid (it divides into halves, thirds and quarters). Break the grid once, on purpose, for emphasis.

## White space
Empty space is an active element: it groups, separates and gives weight. More space around an object makes it feel more important and more expensive. When a layout feels wrong, removing something or adding space fixes it more often than adding something.

## Alignment and proximity
- Align every element with at least one other. Near-alignment looks like a mistake.
- Things that belong together sit close; things that do not are clearly apart. Use two or three spacing sizes consistently, not a new gap each time.

## For photographers
An album spread, a pricing PDF and an Instagram carousel are all layouts. One hero image per spread, consistent margins, and space around small images lift the work more than any decoration.
`,
    sources: [
      { label: 'Josef Müller-Brockmann, "Grid Systems in Graphic Design" (1981)' },
      { label: 'Robin Williams, "The Non-Designer\'s Design Book" (contrast, repetition, alignment, proximity)' },
      { label: 'Ellen Lupton & Jennifer Cole Phillips, "Graphic Design: The New Basics"' }
    ]
  },
  {
    id: 'design-type',
    category: 'Graphic design',
    title: 'Typography that works',
    summary: 'Choosing, pairing and setting type.',
    body: `
## Choosing
A typeface carries a voice before a word is read. Serif faces tend to read as traditional, literary, warm; sans-serifs as modern, neutral, direct. Match the voice to the brief's mood words, exactly as you would with colour.

## Pairing
- **One family is often enough**: use its weights and sizes for contrast.
- If you pair, pair for **clear contrast**: a serif with a sans, a display face with a quiet text face. Two similar faces look like an error.
- Two typefaces is a sensible limit; three needs a reason.

## Setting text
- **Line length**: about 45 to 75 characters. Longer lines tire the eye.
- **Line spacing**: roughly 1.4 to 1.6 times the type size for body text; tighter for large headings.
- **Size scale**: pick a ratio (1.25 or 1.333) and derive every size from it, so sizes relate.
- **Letter-spacing**: add a little to text in capitals and to very small text; tighten large headlines slightly. Leave lowercase body text alone.
- **Alignment**: left-aligned, ragged right is the most readable. Centre only short blocks. Avoid justified text without hyphenation.

## Type on photographs
- Place type on a calm area of the image, or create one (a gradient, a blur, a block).
- Check contrast: light type needs a consistently dark background, and the reverse.
- Let the type respect the image's composition: align it with a strong line or the subject's eyeline.

## Details that signal care
Real quotation marks (“ ”) and apostrophes (’), en dashes for ranges (10–12), consistent capitalisation, no widows (a single word alone on the last line).
`,
    sources: [
      { label: 'Robert Bringhurst, "The Elements of Typographic Style"' },
      { label: 'Ellen Lupton, "Thinking with Type"', url: 'https://thinkingwithtype.com/' },
      { label: 'Matthew Butterick, "Practical Typography"', url: 'https://practicaltypography.com/' }
    ]
  },
  {
    id: 'design-gestalt',
    category: 'Graphic design',
    title: 'Gestalt: how the eye groups things',
    summary: 'The perception rules behind composition and layout.',
    body: `
Early twentieth-century psychologists described how we organise what we see into wholes. The same rules explain why a composition or a layout works.

- **Figure and ground**: we split a scene into a subject and a background. If the split is unclear, the image is hard to read. Separate them by brightness, colour or focus.
- **Proximity**: things near each other are seen as a group. Spacing is meaning.
- **Similarity**: things that look alike (colour, shape, size) are seen as related. One different element becomes the focus.
- **Continuity**: the eye follows lines and curves. A road, an arm, a gaze all lead somewhere; make sure it is somewhere you want.
- **Closure**: we complete incomplete shapes. A cropped circle is still a circle; a frame within a frame holds the eye.
- **Common fate**: things moving or pointing the same way belong together. Essential in video and in group poses.
- **Symmetry and order**: we prefer the simplest, most stable reading. Symmetry feels formal and calm; asymmetry balanced by weight feels dynamic.

## In practice
When a photograph feels cluttered, check **figure and ground** first: is the subject distinct? When a layout feels disorganised, check **proximity and alignment**. When an image feels static, look for a **line** that could lead the eye and recrop to use it.
`,
    sources: [
      { label: 'Rudolf Arnheim, "Art and Visual Perception"' },
      { label: 'Interaction Design Foundation: Gestalt principles', url: 'https://www.interaction-design.org/literature/topics/gestalt-principles' },
      { label: 'Michael Freeman, "The Photographer\'s Eye"' }
    ]
  },
  {
    id: 'design-colour',
    category: 'Graphic design',
    title: 'Colour in layouts and brands',
    summary: 'Palettes, proportion and legibility.',
    body: `
## Build a palette, not a rainbow
A working palette is small: one or two **neutrals** (a near-black, an off-white), one **primary** colour, and at most one **accent**. Derive lighter and darker steps of each rather than adding new hues.

## Proportion
Use the 60-30-10 guideline: mostly neutral, a clear secondary, and an accent used sparingly for the things that must be noticed (a button, a price, a date).

## Take colours from the photographs
For a gallery cover, album or client PDF, sample colours from the images themselves (Atelier's palette on each frame is a start). Type and graphics that echo the photographs' colours make the whole piece feel designed as one.

## Legibility
Text must contrast with its background in **brightness**, not just hue: red on green of equal brightness vibrates and is unreadable. The accessibility standard (WCAG) asks for a contrast ratio of at least 4.5:1 for body text and 3:1 for large text. About one in twelve men has some form of colour-vision deficiency, so never rely on colour alone to carry meaning.

## Screen and print
Screens emit light (RGB) and can show more saturated colours than ink on paper (CMYK). Vivid blues, greens and oranges will dull in print. Design for print in a CMYK-aware workflow, soft-proof, and ask the printer for a proof when colour matters.

## Neutral surroundings
Pure white and pure black are harsh. Slightly warm or cool off-whites and near-blacks feel more refined and are kinder to photographs placed on them.
`,
    sources: [
      { label: 'W3C: WCAG contrast requirements', url: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html' },
      { label: 'Josef Albers, "Interaction of Color"' },
      { label: 'Adobe Color', url: 'https://color.adobe.com/' }
    ]
  },

  // -------------------------------------------------------------------- Video
  {
    id: 'video-cut',
    category: 'Video',
    title: 'Why and when to cut',
    summary: "Walter Murch's six priorities.",
    body: `
Editor Walter Murch ranked what makes a good cut. When they conflict, the higher one wins.

1. **Emotion** (51%): does the cut feel right for the moment?
2. **Story** (23%): does it advance what we need to understand?
3. **Rhythm** (10%): does it happen at the right beat?
4. **Eye-trace** (7%): is the viewer's eye already where the next shot's interest is?
5. **Two-dimensional plane** (5%): screen direction, the 180-degree line.
6. **Three-dimensional space** (4%): physical continuity.

The lesson: a cut that is emotionally right but breaks continuity is better than a cut that is continuous and dead. Viewers forgive a glass that moved; they do not forgive a moment that did not land.

## Practical habits
- **Cut on motion or on a blink.** Movement hides the join; Murch noticed that people blink when a thought completes, which is where a cut feels natural.
- **Enter late, leave early.** Start a shot after the action has begun and cut before it resolves.
- **Every shot should give new information** or a new feeling. If removing it changes nothing, remove it.
- **Watch without sound, then listen without picture.** Each pass reveals different problems.

## Cut types worth knowing
- **J-cut**: the next shot's sound starts before its picture. Pulls the viewer forward.
- **L-cut**: the previous shot's sound continues over the new picture. Lets a line land on a reaction.
- **Match cut**: join two shots on a shared shape, motion or colour.
- **Cutaway / B-roll**: covers a join and adds context. Shoot more than you think you need.
`,
    sources: [
      { label: 'Walter Murch, "In the Blink of an Eye"' },
      { label: 'Karen Pearlman, "Cutting Rhythms"' }
    ]
  },
  {
    id: 'video-pacing',
    category: 'Video',
    title: 'Pacing, rhythm and music',
    summary: 'Shaping time so a short film breathes.',
    body: `
Pacing is not speed. A film feels well paced when the rate of new information matches the viewer's appetite for it.

## Structure first
Even a 60-second piece benefits from three movements: **set up** (place, people, tone), **develop** (the thing happens, builds), **resolve** (a feeling to leave with). Write it as three sentences before you open the timeline.

## Rhythm
- **Shot length carries energy.** Short shots raise tension; long shots let the viewer look and feel. Vary them: constant fast cutting is as monotonous as constant slow.
- **Complex or wide shots need longer** on screen than simple close-ups, because there is more to read.
- **Leave room after a peak.** A beat of stillness after the emotional high lets it register.

## Working with music
- Choose music early; it sets tempo and structure.
- **Do not cut on every beat.** Cut on the beat for emphasis, slightly before it for flow, and against it to avoid a music-video feel.
- Mark the music's phrases and build sequences to them: a new section of music wants a new idea in picture.
- Let natural sound (voices, wind, footsteps) sit under the music. It is what makes footage feel present.

## Speed changes
Slow motion says "this matters". Used on everything, it says nothing. Shoot at a higher frame rate only for shots you intend to slow, and keep some real-time footage for contrast.

## Getting distance
Export a draft, watch it on your phone the next morning. Wherever your attention wanders, cut.
`,
    sources: [
      { label: 'Karen Pearlman, "Cutting Rhythms"' },
      { label: 'Walter Murch, "In the Blink of an Eye"' },
      { label: 'Blackmagic Design: DaVinci Resolve training (editing)', url: 'https://www.blackmagicdesign.com/products/davinciresolve/training' }
    ]
  },
  {
    id: 'video-resolve',
    category: 'Video',
    title: 'Colour in DaVinci Resolve: nodes and order',
    summary: 'The same correct-shape-style logic, built as a node tree.',
    body: `
A node is one step of colour work. Nodes are processed left to right, each working on the output of the one before, so order matters exactly as it does in Lightroom.

## A dependable node tree
1. **Input transform**: convert your camera's log footage into a working space (Color Space Transform, or Resolve Color Management). Do this properly and half of grading becomes easy.
2. **Exposure and balance** (primaries): set black and white levels on the waveform, neutralise casts.
3. **Contrast**: curves or the contrast/pivot controls.
4. **Saturation**.
5. **Secondaries** (often as parallel nodes): skin via the qualifier, sky, a power window to lift a face.
6. **Look**: the creative grade. Split-toning, film emulation, a LUT if you use one.
7. **Output transform**: to Rec.709 for normal delivery.

Label every node. Keep the same tree on every clip so you always know where a change lives. Use **groups** to apply the look once to a whole scene.

## Reading the scopes
- **Waveform**: brightness from bottom (black, 0) to top (white, 100 in Rec.709 terms). Exposure decisions live here.
- **RGB parade**: three waveforms side by side. If the three are level at the bottom and top, blacks and whites are neutral.
- **Vectorscope**: hue as angle, saturation as distance from centre. Skin of every complexion falls along one line toward upper left, between red and yellow.

Scopes measure; a calibrated display judges. Use both.

## Matching shots
Balance each shot first, then match to a hero shot using the scopes and a split-screen still. Match skin before anything else. Only then apply the look across the group.

## LUTs
A LUT is a fixed transform designed for a specific input. Put a creative LUT late in the tree, after correction, and lower its strength with the node's key output gain. A LUT on uncorrected footage is why "cinematic LUTs" disappoint.
`,
    sources: [
      { label: 'Blackmagic Design: DaVinci Resolve training and the official "Colorist Guide"', url: 'https://www.blackmagicdesign.com/products/davinciresolve/training' },
      { label: 'Mixing Light: A fixed node tree', url: 'https://mixinglight.com/color-grading-tutorials/color-grading-101-part-4-pats-davinci-node-tree-2024-edition' },
      { label: 'Noam Kroll: Order of operations for color grading', url: 'https://noamkroll.com/the-best-order-of-operations-for-color-grading-why-it-makes-all-the-difference/' },
      { label: 'Alexis Van Hurkman, "Color Correction Handbook"' }
    ]
  },
  {
    id: 'video-shoot',
    category: 'Video',
    title: 'Shooting for the edit and the grade',
    summary: 'Camera settings that keep your options open.',
    body: `
## Frame rate and shutter
- **24 or 25 fps** for a cinematic feel (25 in PAL regions and under 50 Hz lighting), 30 for a more immediate look.
- **Shutter around double the frame rate** (1/50 at 24 or 25 fps): the 180-degree rule. It gives natural motion blur. Faster shutters look crisp and stuttery; that is a choice, not a default.
- For slow motion, shoot 50/60 or 100/120 fps and slow it on a 24/25 timeline. Only for shots you plan to slow.
- Outdoors, hold the shutter with **ND filters**, not by stopping down or raising shutter speed.

## Exposure and picture profile
- **Log profiles** (S-Log3, F-Log2) record more dynamic range but look flat and need a proper transform in the grade. Expose them as the manufacturer recommends, often a little brighter than the meter suggests, and protect highlights.
- If you will not grade, a standard or mild "cine" profile gives a better result with less work.
- **10-bit** recording matters far more for log than resolution does: 8-bit log breaks into banding when graded.
- Set **white balance manually**. Auto white balance drifts mid-shot and cannot be cleanly fixed.

## Coverage
For every scene get a **wide** (where), a **medium** (who), **close-ups** (feeling) and **details** (texture, cutaways). Hold each shot for at least ten seconds, with a clean start and end. Move the camera with a reason: toward something, to reveal something, to follow someone.

## Sound
Viewers tolerate imperfect pictures and reject bad sound. Record clean dialogue close to the mouth, and capture a minute of room tone at each location for the edit.

## Stills and motion together
If the same project delivers both, agree the look once. Shoot stills and video under the same white balance, and build the photo grade and the video grade from the same decisions: same contrast character, same skin, same palette.
`,
    sources: [
      { label: 'Blackmagic Design: DaVinci Resolve training', url: 'https://www.blackmagicdesign.com/products/davinciresolve/training' },
      { label: 'Sony: S-Log shooting guide', url: 'https://www.sony.com/electronics/support/articles/00145908' },
      { label: 'Blain Brown, "Cinematography: Theory and Practice"' }
    ]
  }
]
