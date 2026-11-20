# Hands-on crafts: steps and mechanics

A craft in Activities (alchemy, sewing, sealing tags...) is data. Most crafts end with a timing stage (hold a gauge, tap a marker). A craft can instead play **hands-on steps**: little games such as drawing a glyph, seating parts or tuning a drifting target. This page is for anyone who writes a craft, or a world preset with its own crafts.

## How it fits together

1. A craft lists its **stages**. Add `{ "stage": "mech", "weight": 4 }` to play hands-on steps. A craft can have `prep` (one timing tap per material) before it, or the `mech` stage alone.
2. A **recipe** carries its own `steps`: a short list of steps, each naming a mechanic. The same format cooking recipes use.
3. The player picks materials as usual. The materials steer the steps through the craft's `effects` (below).
4. How well all the steps went becomes one performance for the stage. It is mixed with how well the materials fit the recipe, like any other craft, and gives the grade and the item.

```json
{
  "id": "plain-ward-tag", "name": "Plain Ward Tag", "level": 1,
  "slots": [{ "id": "paper", "label": "paper", "tags": ["paper"] }, { "id": "ink", "label": "ink", "tags": ["ink"] }],
  "set": "desk",
  "steps": [
    { "id": "write", "mech": "trace", "weight": 3, "params": { "glyph": "cross", "width": 0.065 }, "art": { "surface": "paper" },
      "words": { "title": "Write the charm", "hint": "Draw each numbered stroke from its dot.", "action": "Draw (hold)" } },
    { "id": "seal", "mech": "stamp", "weight": 1, "params": { "rings": 1 },
      "words": { "title": "Press the seal", "hint": "Tap the mark just as the ring closes on it." } }
  ],
  "outputs": { "good": { "name": "Plain Ward Tag" }, "failed": { "name": "Blank Tag" } }
}
```

A step has an `id`, a `mech`, a `weight` (how much it counts), `params`, `words` (`title`, `hint`, `done`, and `action` for the big button in action-button play), optional `art` (such as `surface`), and `optional: true` to let the player skip it. A step with a `mech` the game does not know is dropped. A script has at most 8 steps.

## The mechanics

Every mechanic works with a finger or mouse, and also with the action button (the action key, Space or the big on-screen button), so a phone or a keyboard player can both finish it. On a touch screen the "assist" help is always on: wider tolerances and slower targets.

| Mechanic | The player | Main parameters |
|---|---|---|
| `trace` | Draws along a guide, stroke by stroke. Ink runs down and can be refilled at a well. A held brush blots, leaving the line is a comic stray, a dry brush draws pale. | `glyph` (a built-in shape: `bar`, `cross`, `peak`, `star`, `box`, `wave`, `spiral`) or `paths` (lists of points, x across and y down, 0 to 1), `width`, `ink` (`false` for no ink), `inkPerUnit`, `wells` |
| `stamp` | Taps when a shrinking ring meets a mark, and the tap must land on the mark. | `rings` (1 to 3 marks in a row), `markR`, `shrinkMs`, `tol`, `aimed` |
| `tune` | Drags to keep a ring on a drifting target (the ring moves by how far you drag, so a finger never hides the target). Surges throw it off now and then. | `durationMs`, `drift` (how fast it wanders), `band` (ring size), `surges` |
| `assemble` | Drags each part, in order, onto its outline. | `count` (parts of a plain figure) or `parts` (your own: `id`, `x`, `y`, `w`, `h`), `tol` |

The cooking mechanics (`slice`, `stir`, `sear`, `sprinkle`, `pour`, `plate`) can also be used in a craft's steps, except that `sear` needs the kitchen screen.

Numbers can be a plain number, `{ "base": 0.3, "perTier": -0.02 }` or a list of five numbers (one per crafter tier). Nothing in a step names a world: the words, colours and shapes are data, so the same mechanic can write a charm, wire a machine or sign a contract.

## Materials steer the steps

Give the craft `effects` on the stage `mech`:

```json
{ "prop": "bleed", "stage": "mech", "param": "ink",   "per": 0.12, "from": 3, "label": "A bleeding paper: the brush runs dry sooner." },
{ "prop": "crispness", "stage": "mech", "param": "ease",  "per": 0.03, "from": 5, "label": "Crisp paper: the lines are easier to draw." },
{ "prop": "instability", "stage": "mech", "param": "drift", "per": 0.1,  "from": 3, "label": "An unstable build: the soul will drift more." }
```

- `ease` widens tolerances for every step (a bigger number is easier).
- `ink` multiplies how fast a `trace` step's brush runs dry.
- `drift` multiplies how fast a `tune` step's target wanders.

The label is shown on the recipe screen when the effect applies.

## Free starting kit

Every craft needs a free starting kit: tier 1 materials marked `"starter": true`, enough to make every level 1 recipe. Better materials come from the pack.

## Sounds

Steps use the activity sounds (`activity_mech_*`, `activity_potion_*` and others) and play nothing when a sound map does not have a tag. The two Bleach examples reuse the existing sounds.

## The Bleach examples

`src/activity-presets.js` holds two hands-on crafts as data: **Sealing Tags** (trace a glyph, then stamp) and the **Gigai Workshop** (assemble, wire, tune, stamp). Copy one under **Customize an activity** and change its words, materials and recipes for your world.
