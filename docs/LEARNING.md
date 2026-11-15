# How the taste model learns, and how it is kept honest

The aim: every decision the photographer makes should make the next suggestion
better, and the app should be able to prove that it has.

**What is learned from.** Each frame the photographer deals with becomes an example:
26 named measurements (focus, eyes, joy, closeness, laughter, each flaw, shot type,
position within its burst, Claude's read if there is one, tone and colour) and what
they did with it. Examples are kept across projects in `learning.json`.

**The model.** A linear model over those measurements, trained to rank the kept frame
above the others in its burst and to separate keepers from rejects. Linear on purpose:
it trains in milliseconds on the user's machine, needs hundreds of examples rather
than hundreds of thousands, and what it has learned can be read out in words
("you favour closeness between people; you forgive soft eyes").

**When it learns.** It is retrained from all stored examples every 25 decisions while
culling, when a project is opened (tuned to that kind of shoot), and when one is closed.
Retraining from scratch means a change of mind in an old project is learned too, and
nothing can drift into a stale state.

**How it is kept honest.**

1. *Held-back bursts.* One burst in five is never trained on. On those, the app counts
   how often the built-in rules, the learned model, and blends of the two ranked the
   kept frame above the one passed over.
2. *Earned trust.* The learned model's share in suggestions (0, 20, 40, 60 or 80%) is
   whichever does best on the held-back bursts. It stays at zero until there are at
   least 30 held-back comparisons and the gain is larger than chance would explain.
   If it stops helping, its share falls back by itself.
3. *Weighting by how a choice was made.* An accepted suggestion counts 0.3 (the
   suggestion may have caused it); a choice made by hand counts 1; a choice made with
   no suggestion shown counts 2; a frame merely passed over beside a pick counts 0.5.
   Overruling a suggestion is deliberately *not* weighted above agreeing with it by
   hand: a test showed that doing so teaches the model to be contrary and makes the
   rules look worse than they are.
4. *Unprompted bursts.* About one burst in ten is shown without any suggestion, so
   there is a steady supply of choices the app could not have influenced. Can be
   switched off.
5. *Recency.* Each older project counts 7% less than the one after it, and projects
   of a different kind of shoot count half, so the model follows a changing eye.
6. *Safety net.* The learned model can promote a flawed frame to "hidden gem" for
   someone who keeps such frames, but the Second look filter and the rule that a
   photographer's own decision always wins are untouched by it.

**What the photographer sees.** In the Workshop → Your eye: how many decisions
it has learned from, how often the rules alone agree with them, how often the blend
does, how much say the learned taste currently has, and its strongest tendencies in
words. In Cull, each frame shows a "Your taste" meter with the measurements that moved it.

## Possible next steps

- *Learn from the final delivery.* Frames that survive to hand-off and the story
  sequence are stronger evidence than first-pass picks; weight them higher.
- *Learn from the client.* Import the list of images a client favourited or ordered in
  the gallery service, as a separate signal ("what the couple loved").
- *Per-profile taste.* With enough data, fit a small adjustment per culling profile, so
  "documentary" and "editorial" jobs each have their own learned lean.
- *Richer measurements* as they become available (key people, gaze, composition):
  each new measurement is one more named input, and `FEATURE_VERSION` makes sure old
  examples are not mixed with new ones.
- *A non-linear model* (small gradient-boosted trees) only when there are tens of
  thousands of examples and the linear model's held-back agreement has plateaued.
- *Calibration report*: a one-page export of the self-check per project, to see the
  trend over a season.


## Related behaviour added since

- **Why a frame was rejected** is learned as a direction in measurement space and told to Claude.
- **Claude's guidance** (starting weights worth 10, 25 or 50 decisions, forgiveness rules worth 4, 8
  or 16 frames) is tested on the same held-back decisions and set aside automatically if it makes
  the model worse. See [CONCEPT.md](CONCEPT.md).
- **Re-estimating** a culled project scores it again with everything known today, minus what it
  learned from that project, and reports how many of the photographer's calls it would now make.
