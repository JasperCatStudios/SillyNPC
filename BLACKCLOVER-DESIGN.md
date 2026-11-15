# Black Clover combat world (`bc`): design

The third built-in combat world type, beside Fire Emblem (`fe`) and Bleach (`bleach`). It is data
read by the same engine, plus one new generic hook: an **elemental wheel read from both fighters**,
which replaces the weapon triangle for this world. Fire Emblem and Bleach have no `elements`
block and behave exactly as before.

| File | What it holds |
| --- | --- |
| `src/combat-builtins.js` | The `bc` type: stats, meta, skills, pools, ladders, actions, resolution |
| `src/combat-elements.js` | The generic wheel engine (any world may use it): matchups, two magics, validation, the screen line |
| `src/combat-elements-bc.js` | The wheel's data, Magic Affinity options, Grades and Stages |
| `src/combat-gear-bc.js` | Two gear ladders (metals and grimoires), weapon kinds, tools, the Armoury |
| `src/combat-abilities-bc.js` | The ability library, with grimoire and anti-magic gating |

## The type

- **Stats** (0 to 100; Health 10 to 100): Health, Strength, Dexterity, Magic, Speed, Luck,
  Charisma, Defense, Resistance.
- **Meta**: Grade (E, D, C, B, A, S; default C), Magic Affinity (one of the wheel's options, or two,
  see below; no default, so a blank sheet is neutral rather than quietly Fire), Level (1 to 100).
- **Skills**, each graded E to S on one ladder, `bonusPerRung: 2` (one grade is +2 on the roll):
  Mana Sensory, Mana Control, Reinforcement Magic, Creation Magic, Hand-to-Hand Combat,
  Teamwork/Strategy.
- **Pools**: Health (`stat.hp`), Mana (`20 + MAG x 0.8`), Stamina (`20 + HP x 0.3 + DEF x 0.3`).
  Spells cost Mana; reinforcement, hand-to-hand and anti-magic swordplay cost Stamina.
- **Channels**: physical (Strength against Defense) and magic (Magic against Resistance).
- **Actions**: Strike (hand-to-hand), Reinforced Blow (reinforcement), Spell (mana control),
  Created Weapon (creation).
- **No weapon triangle**: `advantage` is empty. Matchups come from the wheel.

### Resolution (opposed d20, as Bleach)

```
attacker roll = d20 + difficulty + stat modifier + grade bonus (+ weapon hit) (+ elemental edge)
defender roll = d20 + stat modifier + grade bonus                              (+ elemental edge)
margin = attacker roll - defender roll
  < 0 miss | 0 stalemate | 1-4 hit | 5-9 strong hit | 10+ critical | natural 20 critical
damage = max(1, round(band base + power + attack x 0.25 - defense x 0.15)) x tier mult
  band base: hit 6, strong 10, critical 16
```

## The Elemental Interaction Wheel

From the world's lore entry: when spells clash, the side with the advantage gets **+2, "like one
grade higher"**; the disadvantaged side **-2**; neutral nothing. The engine applies it like this:

- It is read from **both** fighters' Magic Affinity (`type.elements.meta = 'affinity'`), not from
  tags on the attack, so it works whether the beating side is attacking or defending.
- **Only spells clash** (`channels: ['magic']`). A punch or a sword cut is never elemental.
- `net = clamp(beats(a, d) - beats(d, a) - wards(d, a), -1, +1)`.
  - `net = +1`: the attacker's roll gets +2.
  - `net = -1`: the defender's roll gets +2 (in an opposed world). In a threshold world, which has
    no defender roll, the attacker's roll gets -2 instead. Either way the margin moves by 2.
  - The block also allows a damage multiplier (`dmgMult`, 1 to 2); Black Clover does not use it,
    because the notes only speak of the roll.
- The hook rolls no dice of its own, so odds previews are exact and seeded fights replay the same.
- The log line names the edge: "Spell: hit, 12 to health (Fire over Plant)".

### Who beats whom

`[n]` from the notes, `[n*]` in the notes on one side only (the other element's list says it),
`[+]` added to close a gap.

| Element | Beats |
| --- | --- |
| Fire | Plant [n], Ice [n] |
| Water | Fire [n], Earth [n] |
| Plant | Water [n], Earth [n], Lightning [+] (wood grounds a bolt) |
| Lightning | Water [n], Wind [n] |
| Earth | Lightning [n], Ice [n], Fire [n*] (Fire lists Earth as a weakness) |
| Ice | Plant [n], Wind [n] |
| Wind | Plant [n*], Earth [+] (wind erodes stone) |
| Light | Darkness [n] |
| Darkness | Psychic/Illusion [n] (GM discretion in the notes) |
| Psychic/Illusion | Light [n] |

Gaps found in the notes and how they were closed:

1. **Ice and Wind each claim the other.** Two elements that beat each other cancel out, which
   would quietly delete both entries. Settled as **Ice over Wind** (Wind's weakness list names only
   Lightning, Ice's strengths name Wind), and the validator warns if a world ever writes a mutual pair.
2. **Lopsided core elements.** Taken literally, some core elements had more weaknesses than
   strengths. With Earth over Fire (from Fire's own weakness list), Wind over Plant (from Wind's
   strength list) and the two added edges, **every core element has as many strengths as
   weaknesses** (Fire, Water, Lightning, Ice and Wind 2 and 2; Plant and Earth 3 and 3).
3. **Core against special** is neutral, as the notes say ("weak vs none, neutral otherwise").
4. **Unique magics** (Blood, Spatial, Time, Anti-Magic, plus Gravity, Healing, Sealing and an
   "Other (GM-ruled)" catch-all) are neutral until the GM rules otherwise. The one ruling in the
   notes is built in: **Anti-Magic cancels spells regardless of type**, as a ward: a defender with
   Anti-Magic turns aside every spell (-2 to the caster), even one of an unknown element. It gives
   no edge when attacking, because anti-magic swordplay is physical.
5. **Sheets write affinities freely.** Canon magics that are not families of their own are aliases
   (Sand, Glass, Crystal, Steel read as Earth; Flame, Lava, Ash as Fire; Mist, Bubble as Water;
   Thorn, Rose as Plant; Sound, Cloud as Wind; Mirror, Dream as Psychic/Illusion, and so on).
   "Wind", "Wind Magic" and "wind" all find Wind. An unknown magic is neutral, never an error.
6. **Two magics on one sheet** ("Fire & Wind", "Ice Magic and Water Magic"). The affinity text is
   read as up to three elements: the whole text first ("Psychic/Illusion" and "Anti-Magic" stay
   whole), then its parts split on `&`, `and`, `/`, `,`, `+`, dashes and brackets, then single
   words if no part is known ("Crimson Flame Magic" is Fire). A flavour name beside a real one
   ("Lightning-Something") reads as the real one. In a clash the attacker casts whichever of their
   elements does best and the defender meets it with whichever of theirs does best:
   `net = max over a (min over d (net(a, d)))`. With one element each this is the plain matchup; it
   never leaves -1..+1, so a second magic is more coverage, never a bigger bonus.
7. **A spell's own element.** Each signature spell (Fire Ball, Water Bullet...) carries
   `element`, and that stands in for the caster's affinity: a Fire spell clashes as Fire whoever
   casts it. The grimoire's basic spell, Creation Magic and the Advanced Abilities clash as the
   caster's affinity. A spell naming an element the wheel does not know falls back to the
   affinity (and the validator warns).
8. **Setting the affinity.** Magic Affinity is a choice field, but for the wheel's field only,
   `setMeta` also takes what a sheet writes and stores it as the world's own options: "Sand Magic"
   is stored as "Earth Magic", "Fire & Wind" as "Fire Magic & Wind Magic". Text that names no
   element is refused as before. Every other choice field (Grade here, Class in Fire Emblem,
   Faction in Bleach) is still exact.

## Grades and Stages

- **Grade** E to S is the meta field and the skills' ladder; each step is +2 on the roll, the same
  size as an elemental edge.
- **Stage Classification** (9 lowest to 0 apex) follows Level, ten levels a stage
  (`bcStageOf`: 1-10 Stage 9 ... 91-100 Stage 0). Each grade spans the stages it usually stands for
  (E 9-8, D 7-6, C 5-4, B 3-2, A 1, S 0; `BC_GRADE_STAGES`, `bcGradeOfStage`). Arcane Stage and
  Saint Stage sit outside the ladder and are the GM's call. Stages are helpers only; the engine
  does not read them yet.

## Gear

Two ladders (`combat-gear-bc.js`):

- **`default`, the metals**: the generic ladder Fire Emblem uses (Training, Common, Bronze, Iron,
  Steel, Silver, Hero Relic) for swords, daggers, spears, bows, gauntlets and anti-magic blades.
  As in Fire Emblem, the Armoury has **every ordinary kind at every metal from Training to Silver**
  (`BC_ORDINARY_KINDS` x `BC_ORDINARY_TIERS`); a named piece at that kind and tier (Magic Knight's
  Sword, Silver Rapier, Steel Halberd...) takes the place of the plain one. Hero Relic is left to
  named weapons (the anti-magic swords).
- **`grimoire`, the leaves**: a grimoire sits in the focus slot (no hand) and adds its step to the
  basic spell, like a tome in Fire Emblem. Seven steps over three leaf counts, numbers never going
  down:

| Step | Leaves | Power | Hit | Crit | Mult |
| --- | --- | --- | --- | --- | --- |
| Tattered Three-Leaf | 3 | -1 | 0 | 0 | 0.90 |
| Three-Leaf (default) | 3 | 0 | 0 | 0 | 1.00 |
| Tempered Three-Leaf | 3 | +1 | +1 | 2 | 1.05 |
| Four-Leaf | 4 | +2 | +1 | 4 | 1.10 |
| Awakened Four-Leaf | 4 | +2 | +1 | 6 | 1.15 |
| Five-Leaf | 5 | +3 | +2 | 8 | 1.20 |
| Ascended Five-Leaf | 5 | +4 | +2 | 10 | 1.30 |

Tools: healing potion, magic stone shard, smoke orb, flash stone, sealing tag.

### Abilities gated by `needs`

| Ability | Needs |
| --- | --- |
| Mana Zone, Rune Ward | a grimoire at Tempered Three-Leaf or higher |
| Spirit Dive | Four-Leaf or higher |
| Ultimate Magic | Awakened Four-Leaf or higher |
| True Magic, Devil Union | Five-Leaf or higher |
| Full Devil Union | Ascended Five-Leaf |
| Black Meteorite, Anti-Magic Deflection | an anti-magic blade in hand |
| Black Divider | an anti-magic blade at Silver or higher |

`needs: { ladder: 'grimoire', tier }` only counts an item whose kind is on the grimoire ladder, so
a Hero Relic sword never opens Spirit Dive. As in the other worlds, a fighter with no gear on
their sheet is not held back (old saves keep what they had). Each leaf count opens something, and
power and cost never go down a step.

The per-element signature spells are three per element (cheap, mid, big) on one cost curve
(power 4 for 13 Mana, 6 for 22, 8 for 31), so no element is better on paper; only the matchup
differs.

## Screens

The screens read the type generically, as for Fire Emblem and Bleach:

- Character sheet (`ui-combat-section.js`): meta fields from `type.meta` (Grade and Magic
  Affinity as dropdowns; a stored two-magic value is shown as an extra option), skills from the
  grade ladder.
- Equipment and Armoury (`ui-gear.js`, `ui-armoury.js`, `combat-gear-view.js`): tiers come from
  the kind's ladder, so a grimoire offers the leaf steps and a sword the metals; the Armoury lists
  both ladders for editing.
- Fight window (`modules/combat/combat-window.js`): the equipment screen shows one line on how the
  two affinities meet ("Elemental Interaction Wheel: Ana (Fire) against Ben (Plant). Spells of
  their own affinity: Ana +2 (Fire over Plant), Ben -2 (Fire over Plant)."), only for a world with
  a wheel. The log names the edge. Band names cover stalemate and strong hit.

The UI code cannot run in node; tests read the screen files as text to check the wiring. **Not yet
tried in a browser.**

## Balance (seeded simulations)

`tests/combat/bc-balance.test.mjs`, 400 seeded fights per row, sides swapped every other fight,
two middling C-grade mages casting the basic spell (A's win share):

| Matchup | A wins |
| --- | --- |
| Mirror (Fire against Fire) | 0.54 |
| Neutral pair (Fire against Lightning) | 0.54 |
| Elemental edge (Fire against Plant) | 0.80 |
| One grade higher (B against C, neutral elements) | 0.80 |
| Edge against grade (Fire C against Plant B) | 0.54 |
| Edge and grade together (Fire B against Plant C) | 0.96 |
| Mage against Anti-Magic | 0.35 |
| Two magics (Fire & Water against Plant) | 0.80 (same as Fire alone) |
| Fist fighters with clashing affinities | 0.54 (identical fights to no affinity) |

The elemental edge comes out **exactly equal to one grade**, as the notes ask, because both apply
+2 to the same side of the same opposed roll, attacking and defending. The 0.54 mirror is the
seed set's own small lean, not a side bias in the rules (sides are swapped).

## Tests (local, `tests/` is gitignored)

`bc-type`, `bc-elements`, `bc-abilities`, `bc-balance` (with helper `bc-sim.mjs`), `bc-ui`.

## Left to do

- Try the type in the browser: sheet, equipment screen (wheel line), Armoury (grimoire ladder),
  a fight with the log.
- The sheet dropdown cannot pick two magics; two-magic values arrive from typed or generated
  sheets. A small "add a second magic" control would close that.
- The lore import (`combat-lore-parse.js`) reads only Attributes and Proficiencies tables, not
  `Magic_Affinity(...)`; reading it into the affinity field would save typing. Attribute values in
  some sheets look like a 0 to 10 scale; the type has no `loreImport` scale map yet.
- Unique magics beyond Anti-Magic are neutral; GM rulings (Blood, Spatial, Time) could become
  `beats`/`wards` entries or per-character overrides.
- Stages are not read by the engine (pacing, AI difficulty or narration could use them).
- Grade SS (used in other worlds' notes) is not on the ladder.
- From the general combat plan: crowding and allies acting alone, team screens, tools in battle,
  fleeing, state abilities.
