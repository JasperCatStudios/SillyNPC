# World builder agent

This file is a set of instructions for an AI coding agent (such as Claude Code). Give it to the agent together with a folder of wiki pages you saved as `.html`, and it builds a Worldkit world for you: items, locations, abilities, classes and characters. It fills in what the pages do not say.

## How to use it

1. Make a folder, for example `my-world/`, and put the saved wiki pages in `my-world/source/`. Use your browser's **Save page as, HTML only**. One page per file is fine. Pages about items, places, abilities, classes and characters are the most useful.
2. Open your agent in that folder and say: *"Read WORLD-BUILDER-AGENT.md and build a Worldkit world from `source/`."*
3. Answer the few questions it asks (world name, how strong things are, what to leave out).
4. Import the files it makes with the Worldkit menu, **Content Kit** or the import buttons named below.

## Rules for the agent

- Work only from the pages in `source/`, plus what you are told. Do not invent facts that the pages state. Where the pages are silent, fill the gap and mark it as yours in a `notes.md` file.
- **Write in your own words.** Take names, numbers and relationships. Do not copy long passages of wiki text.
- Strip HTML to plain text first (scripts, menus and tables of contents are noise). Read tables carefully: they usually hold the numbers.
- Never write outside `my-world/out/`. Do not touch the user's SillyTavern folder.
- Use neutral ids: lower case with underscores. Names keep their original spelling.
- Ask before guessing a big choice (how many stats, what the damage scale is). For everything else pick a sensible default and note it.
- Finish with a short report: what was built, what was guessed, what is missing.

## Step 1: Survey

Read every page and write `out/notes.md` with:

- the world's name and a one-paragraph summary in your own words;
- the list of **classes or roles**, **abilities or spells**, **item categories**, **locations**, **factions** and **named characters** that the pages cover;
- the **stats** the world uses (for example Strength, Magic, Speed), and any ranks or levels (for example E to S, or Novice to Master);
- gaps you will have to fill.

Show the user this survey and the questions in one message, then continue.

## Step 2: Build the files

Make each file below in `out/`. Use the sample world in the Worldkit-Content repository (`worlds/lantern-coast.world.json`, `items/`, `characters/`, `lorebooks/`) as the exact shape. Copy its structure and replace the content.

### `out/<world>.world.json` (a combat world type)

A JSON file with `"format": "worldkit-combat-type"` and `"version": 2`. It holds the rules of fights and what the world calls things. Fill these parts from the pages:

| Field | What goes in it |
| --- | --- |
| `id`, `name`, `description` | the world's id (lower case, underscores), its name, one sentence |
| `stats` | each stat: `id`, `label`, `abbr`, and a `scale` with `min`, `max` and a `default` |
| `channels` | the kinds of damage or power (for example physical, magic) |
| `roles` | formulas that turn stats into `attack`, `defense`, `initiative`, `speed`, `accuracy`, `evasion`, `luck`, `endurance`, `awareness`. Formulas look like `stat.might*0.7 + stat.finesse*0.3`. Keep them simple |
| `pools` | health and any other bar (mana, stamina), each with a `max` formula and a colour |
| `ladders` | ranks, such as `Novice` up to `Master`, with a `zeroAt` rung and a `bonusPerRung` |
| `proficiencies` | skills (swords, bows, a magic school), each on a ladder, with a `channel` |
| `actions` | what a fighter can do on a turn, each tied to a proficiency |
| `abilities` | the abilities and spells from the pages: `id`, `label`, `category`, `kind` (`active` or passive), `prof` and `power` |
| `gear` | weapon kinds, tiers of quality, tools, and the rules for carrying them |
| `resolution` | how a hit is rolled. Keep the sample's values unless the pages describe something different |
| `stakes` | whether a fight can injure or kill (default: no) |

Classes, if the world has them, go in the same file as roles or as a category of abilities, following the sample.

Scale the numbers so that a middling fighter is about 50 on a 10 to 100 scale and the strongest named character is near 100. Say in `notes.md` how you scaled them.

### `out/<world>.items.json` (the Item Database)

```json
{
  "format": "worldkit-items",
  "version": 1,
  "name": "<World> items",
  "items": [
    { "id": "iron_sword", "name": "Iron Sword", "category": "Weapon", "stats": "Mt 5, Wt 6", "desc": "One sentence in your own words." }
  ],
  "presets": [
    { "id": "starter_pack", "name": "Starter pack", "desc": "A first outing.", "gold": 300, "items": [ { "ref": "Iron Sword", "qty": 1 } ] }
  ]
}
```

One entry for every item the pages list. Keep `stats` short and in the world's own terms. Add two to five presets (bundles of items and money), such as a starter pack, a healer's kit, a traveller's pack.

### `out/<world>.characters.json` (a character pack)

A `"format": "worldkit-characters"` file with one entry per named character: `name`, `color` (a hex colour you choose, one per faction family), `category` (the faction or place), `aliases`. Add combat stats only if the sample pack does, using the world's stats on its scale. **Do not** write portraits or long profiles here.

### `out/<world>.lorebook.json` (the lorebook)

A SillyTavern lorebook (copy the shape of `lorebooks/Lantern_Coast.lorebook.json`). One entry per **character**, **location**, **faction** and **important concept**, written as a short paragraph in your own words, with keywords that are the name and its aliases. Locations get their own entries so Scene and the story can use them.

### `out/<world>.places.md` (locations for the Scene map)

A list of places, each with: name, a one-line description, the other names people call it, and which places it connects to. The user will enter these on the **Scene** tab (the map of places, with a background for each). If the Scene map import format in the sample content is available, produce that file instead.

## Step 3: Check your work

- Every ability named in a character or class exists in `abilities`.
- Every item in a preset exists in `items`.
- Every stat used in a formula exists in `stats`.
- All JSON parses. Run a JSON parser on each file and fix errors.
- Ids are unique inside each file.
- Open the finished `.world.json` and compare its keys with the sample's. No key from the sample should be missing.

## Step 4: Hand over

Write `out/README.md` for the user:

1. What each file is and where to import it:
   - the world type: Worldkit menu, **Modules, Combat**, import a world type;
   - the item list: **Trackers, Inventory, Item Database**, import;
   - the character pack: **Characters** tab, import;
   - the lorebook: SillyTavern's **World Info**, import;
   - the places: **Modules, Scene**.
2. What you guessed (copied from `notes.md`).
3. How to change the numbers if fights feel too easy or too hard: edit the `roles` formulas and the `scale` values.

## A note on source material

Wiki pages belong to their authors. Keep the pages and the generated files for your own use unless the wiki's licence lets you share them. If you share a world, share it without the wiki text.
