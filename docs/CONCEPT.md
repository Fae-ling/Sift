# Atelier: the concept

Atelier is a culling tool for professional photographers. It takes the RAW files
of a shoot, small or very large, and helps choose the frames worth keeping: not
only the technically sound ones, but the ones that hold the emotion, the special
moment, and the pictures a shoot of that kind must not come back without.

It is built around one idea: **the photographer makes it their own.** The app
starts with general knowledge and becomes specific to one person's work, because
that person, with Claude's help when they want it, teaches it what they see.

Where this document conflicts with earlier descriptions of the project, this
document wins.

## What it is for

1. **Cull any shoot quickly.** From a 200-frame portrait session to a wedding or
   event of many thousand frames. An ultrafast first step removes misfires and
   unusable frames so attention goes to the rest.
2. **Judge every frame through several lenses at once:**
   - *Craft*: focus, eyes, exposure, and composition (does the subject stand clear
     of the background, does it hold the eye, is something pulling attention away).
   - *Emotion*: what each face is showing, how strongly, and whether this kind of
     shoot is looking for it.
   - *The moment*: closeness between people, the peak of a burst, an emotion that
     is rare in the shoot.
   - *The style*: the chapters this kind of shoot must contain, and the flaws it
     forgives.
3. **Learn constantly.** Every decision, every emotion named, every style refined
   makes the next cull better.

## The machine inside

Four parts learn, and each feeds the others.

| Part | What it knows | How it learns | Who teaches it |
| --- | --- | --- | --- |
| **Emotion machine** (`analysis/emotion.ts`) | Named emotions as regions in the space of 51 facial-expression measurements. Starts with 14 described by the Facial Action Coding System; grows without limit. | From examples: each one moves an emotion toward what it actually looks like. Strong expressions it cannot name are gathered into *pointers* until someone names them. | The photographer (click a face, name it); Claude (names faces when asked, and during a read of the shoot) |
| **Shoot styles** (`analysis/style.ts`) | For each kind of work: chapters and which must not be missed, how much each emotion is valued, what to look for, what to forgive, the balance of craft against moment. | Emotion weights shift with what the photographer keeps in that style; a measured profile is built from galleries and picks; the whole style can be redeveloped from evidence. | The photographer (edits anything); Claude (develops a style from a sentence, refines it from the photographer's culling) |
| **Taste model** (`analysis/learner.ts`) | Which measurable qualities of a frame this photographer keeps. | Trained on every decision; checked on bursts it never saw; only influences suggestions once it beats the built-in rules. | The photographer's decisions, including past shoots culled elsewhere |
| **Norms** (`analysis/training.ts`) | What this photographer's finished work looks like, so composition and skin are judged against their own standard. | From folders of finished photographs, and from agreeing or disagreeing with findings. | The photographer |

**How they connect.** A face is read by the emotion machine. The active style says
what that emotion is worth here. That, with closeness, rarity and composition,
makes the frame's score, and the taste model adjusts it by what this photographer
has kept before. The decision the photographer then makes goes back into all
three: the taste model retrains, the style's emotion weights shift, and if they
named a face, the emotion machine has a new example. When Claude reads a shoot, the
emotions it names on single faces become examples too, so paid reads make the free
local reading better.

## Styles are open-ended

A photographer who shoots weddings, LARP battles, boudoir, birthdays and fantasy
portraits needs each judged differently. A style is created with a name and a
sentence; Claude can develop it into chapters, emotion weights and markers; the
photographer accepts, edits or discards. After real shoots in the style, Claude
can refine it from the evidence of what was kept. Starter styles (Wedding,
Celebration or party, Portrait, Intimate portrait and boudoir, Fashion and
editorial, LARP and battle, Fantasy and conceptual) are examples, not limits.

## Looks

The look extractor measures a reference photo's colour and writes it as a LUT or
Lightroom preset. On top of that, Claude can propose how to shape the look so its
atmosphere carries the concept of the shoot; the result is previewed and saved the
same way.

## What Claude is for

Claude is a teacher and a second pair of eyes, never a requirement:

- names emotions on faces the app cannot name;
- reads a shoot moment by moment (chapter, emotion, how much it carries, hidden gems);
- develops and refines styles;
- suggests a sequence for the picks;
- diagnoses a single photo;
- shapes a look for a concept.

Each call shows an estimate first and its cost after. Everything else runs on the
photographer's computer at no cost, and everything Claude teaches stays in the
app afterwards.

## What it does not do

- It does not change photographs. Decisions travel to Lightroom as ratings and labels.
- It does not decide. Suggestions are proposals; the photographer's choice always wins,
  and frames of must-have chapters and hidden gems are never rejected on the app's say-so.
- It does not upload anything unless a Claude button is pressed.

## Directions it can grow in

Kept from earlier plans, not built: reading emotion from the body as well as the
face; recognising who is who (key people); depth and scene understanding for the
photo diagnosis; video selects; planning (light and shadow, shot lists, deadlines)
and inspiration (moodboards). See `DEVELOPMENT_PLAN.md`.
