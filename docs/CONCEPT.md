# Sift: the concept

Sift is a culling tool for professional photographers. It takes the RAW files
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

Eight parts learn, and each feeds the others.

| Part | What it knows | How it learns | Who teaches it |
| --- | --- | --- | --- |
| **Emotion machine** (`analysis/emotion.ts`) | Named emotions as regions in the space of 51 facial-expression measurements. Starts with 14 described by the Facial Action Coding System; grows without limit. | From examples: each one moves an emotion toward what it actually looks like. Strong expressions it cannot name are gathered into *pointers* until someone names them. | The photographer (click a face, name it); Claude (names faces when asked, and during a read of the shoot) |
| **Shoot styles** (`analysis/style.ts`) | For each kind of work: chapters and which must not be missed, how much each emotion is valued, what to look for, what to forgive, the balance of craft against moment. | Emotion weights shift with what the photographer keeps in that style; a measured profile is built from galleries and picks; the whole style can be redeveloped from evidence. | The photographer (edits anything); Claude (develops a style from a sentence, refines it from the photographer's culling) |
| **Taste model** (`analysis/learner.ts`) | Which measurable qualities of a frame this photographer keeps. | Trained on every decision; checked on bursts it never saw; only influences suggestions once it beats the built-in rules. | The photographer's decisions, including past shoots culled elsewhere |
| **Gesture machine** (`analysis/gesture.ts`) | Named gestures as regions in the space of 16 body measurements (arms up, hand to face, leaning, close to someone...). Starts with 15; grows without limit. | From examples, as the emotion machine does. | The photographer (correct or name a gesture under a frame); Claude (names the gesture that carries a frame during a read) |
| **People** (`analysis/people.ts`) | Who is who within one shoot, and which of them are key. Faces are told apart, never identified. | Each correction adds a known face to a person, or, for "this is not them", keeps that and similar faces away from them. Across shoots, every merge and removal is a judgement about two faces; from them it fits how alike faces must be and how much to trust the face against hair and clothes, and uses that only if it beats the defaults on judgements held back from fitting. | The photographer |
| **What is happening** (`analysis/knowledge.ts`) | Words for what goes on in a frame ("first dance", "toast", "sword clash"), each tied to the measurements of the frames it was said of. | Every description Claude gives is stored with the frame's measurements. A word with enough examples is recognised by the app itself. A description counts fully once the photographer's decision agreed with Claude's judgement of that frame, less when it went against it. | Claude's reads; the photographer's own words |
| **Mistakes against assets** (`analysis/knowledge.ts`) | Which mistakes this photographer forgives for which assets ("closed eyes are kept when there is laughter"), and which assets they value at all. | Every decided frame is filed by what was wrong with it, what it brought, and whether it was kept. | The photographer's decisions |
| **Norms** (`analysis/training.ts`) | What this photographer's finished work looks like, so composition and skin are judged against their own standard. | From folders of finished photographs, and from agreeing or disagreeing with findings. | The photographer |

**How they connect.** A face is read by the emotion machine. The active style says
what that emotion is worth here. That, with closeness, rarity and composition,
makes the frame's score, and the taste model adjusts it by what this photographer
has kept before. The decision the photographer then makes goes back into all
three: the taste model retrains, the style's emotion weights shift, and if they
named a face, the emotion machine has a new example. When Claude reads a shoot, the
emotions it names on single faces become examples too, so paid reads make the free
local reading better.

**A frame is read, not only measured.** For every frame the app writes a sentence
(who is in it, how close, what faces and bodies are doing, how it is framed and
lit) and two lists: what the frame *brings* and what is *against it*. The goal of
the learning is stated in those terms: to find out which mistakes are worth less
to this photographer than the assets a frame brought when they chose it. A
mistake that the record shows is forgiven (in general, or when a particular asset
is present) stops being a reason to reject; the frame is put in front of the
photographer with the evidence ("you have kept 9 of 10 frames with closed eyes
that also had laughter").

**Claude remembers through the app.** Claude itself keeps nothing between calls.
The app does: before every assessment it tells Claude what this photographer's
decisions have shown, where they went against Claude's earlier judgement (with
Claude's own description of those frames), what has been kept and rejected in
this shoot so far, and who the key people are. So Claude judges for this
photographer, and its reads improve as the record grows.

**Claude can review what was collected.** Counting is slow with few decisions and
cannot tell taste from coincidence. On request, everything collected is summarised as
numbers and words (no photographs) for Claude, which reasons about it like a picture
editor and a statistician at once, explains the pattern back to the photographer, and
proposes settings. Each proposal is approved or not by the photographer. Approved
starting weights for the taste model count for 10, 25 or 50 decisions by confidence, so
real decisions outweigh them as they accumulate; approved forgiveness rules count for 4,
8 or 16 frames. The weights are tested like everything else, on decisions held back from
learning, and set aside automatically if they make the model worse there. The self-check
still decides when the learned taste gets any say in suggestions: Claude can speed the
learning up, not skip the test.

**The app checks itself on old work.** A culled project can be re-estimated:
scored again with everything known today except what was learned from that
project, and compared with the decisions made in it. The share of calls it gets
right is kept per project over time, and the pass turns up frames worth another
look.

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
