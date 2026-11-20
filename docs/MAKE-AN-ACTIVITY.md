# Make your own activity

You can add a completely new activity to the Activities hub with one `.js` file. It shows up as a tile in the tab you choose, and it gets the same partner choice, energy cost, streaks and Customize card as the built-in activities. You write only the game; Worldkit does the bookkeeping (XP, bonds, items, the story report).

> An activity file runs like a SillyTavern extension and can do anything one can. Only add files you trust.

## The 60-second version (see it working first)

1. Open the Worldkit menu, then **Modules → Activities**.
2. Scroll to **Your own activities** and press **Try the example**. It adds a small game called Quick Cast and runs it. The line under the buttons says "added", and the list shows `Quick Cast (example)  ✓ loaded`.
3. Open the **Activities** hub (the green floating button), go to the **Leisure** tab, and press the **Quick Cast** tile.
4. Remove it again with the **Remove** button next to it in the list, then refresh the page.

That is the whole mechanism: **a `.js` file in, a tile out.** To use your own file, press **Add an activity file** instead and choose it. Worldkit saves a copy, runs it right away, and runs it again every time the page starts. You do not run any code yourself and you do not copy files into folders.

## Writing your own file

1. Copy [`docs/examples/quick-cast-activity.js`](examples/quick-cast-activity.js) to a new file on your computer, for example `river-fishing.js`. (It is in the extension folder, `WorldKit/docs/examples/`.)
2. Open it in any text editor. Change three things at the top:
   - `id`: a unique short name (letters, numbers and dashes), e.g. `'river-fishing'`.
   - `label`: the name on the tile, e.g. `'River Fishing'`.
   - `tab`: `'leisure'`, `'study'` or `'training'`.
3. Change the game inside `run(api)`. Everything the game needs comes from `api` (see the table below). The example draws a bar, listens for a click, and ends with `api.settle(...)` and `api.result(...)`; keep that ending.
4. Save the file. In **Modules → Activities → Your own activities**, press **Add an activity file** and pick it. If it has a mistake, the list shows `✗` and the reason, and the browser console (F12) has details.
5. To change it later, edit the file and add it again: the same file name replaces the old copy.

## The registration

The top of every activity file is one call:

```js
window.WorldkitActivities.register({
    id: 'river-fishing',        // unique: letters, numbers, dashes
    label: 'River Fishing',
    tab: 'leisure',             // 'leisure', 'study' or 'training'
    icon: 'fa-fish',            // a Font Awesome name
    blurb: 'My own fishing game.',
    solo: true,                 // can be played with nobody (optional)
    music: 'river_loop',        // a looping tag from your sound map (optional)
    energy: 10,                 // its own energy cost (optional)
    minutes: 30,                // story minutes it takes (optional)
    run(api) { /* your game */ },
});
```

- Registering the same `id` again replaces the activity. `window.WorldkitActivities.unregister(id)` removes it and `.list()` shows what is registered.
- If the active preset already has an activity with that `id`, the preset's wins and yours is not shown. Pick a new `id`.
- A mistake in `run` (an error or a rejected promise) closes the activity with a message; it never breaks the hub.

## What `run(api)` receives

| `api.…` | What it is |
|---|---|
| `win` | The activity window. Draw into `win.main` (`win.main.replaceChildren(yourElement)`). `win.setHelp([{ title, text }])` fills the How to play tab. |
| `partner`, `alone`, `userName` | The partner's name (`''` when played alone), whether the player is alone, and the player's name. |
| `activity` | Your hub entry (`id`, `label`, ...). |
| `preset`, `term(key)` | The active world preset and its wording, for example `api.term('knowledge')`. |
| `settings` | The Activities settings (`difficulty`, `assist`, `actionKey`, ...). |
| `talk(beat, { state, player, outcome, event })` | The partner says something short. `beat` is `'start'`, `'moment'`, `'end'` or `'chat'`; the details say in plain words what is happening. Never blocks and never throws. |
| `settle({ grade, summary, levelXp, profXp, subject, bonds, items, consume, winners })` | Ends the activity: records it, pays XP and bonds, hands out items, writes the story report. Call it once. Returns the lines to show. `grade` is `perfect`, `good`, `fair`, `poor` or `failed`. |
| `result({ title, grade, extra, lines, again })` | Shows the result card with **Play again** and **Back to the hub** buttons. |
| `sfx(tag)`, `music(tag)` | Play a sound tag, or start (`music(tag)`) or stop (`music('')`) a loop. They follow the player's music and volume settings. |
| `loadArt(img, key, vars, onMissing)` | Put a picture by manifest key in an `<img>`, searching the world, user and Content Kit folders. See [ASSETS-README.md](ASSETS-README.md). |
| `inventory` | `{ active, items(), give(items), take(name, qty) }`. Use the pack only when `active` is true. |
| `leave()`, `restart()` | Back to the hub, or run again. |
| `rng` | A random function (`Math.random`). |

## Looping music

Every activity can have its own loop. In your file set `music: 'your_tag'`. For a built-in activity give it a tag under **Modules → Activities → Customize an activity → Music loop**. The tag must exist in your sound map. The **Activity music** switch and volume in the Activities settings apply to all of them, and a tag with no file is silent.

## A checklist

- Draw everything inside `win.main`; do not touch the rest of the page.
- Take every world word from `api.term(...)` or your own settings, so the activity works in any world.
- End with `api.settle(...)` exactly once, then `api.result(...)`.
- Make it playable with the keyboard and at phone width.
- Let a missing picture or sound fail quietly.

## If something does not work

- **The list says `✗` with a reason:** the file has a mistake or could not be read. Open the browser console (F12) and look for `[Worldkit]` lines.
- **It says loaded but there is no tile:** open the hub and check the tab named in `tab`. A different `id` clash with a preset activity hides it (pick another `id`). A refresh after adding fixes most stale screens.
- **Removed it but the tile is still there:** refresh the page; removing takes effect on the next start.
- **Where is the saved copy?** In your SillyTavern user files folder as `worldkit-activity-<name>.js.txt` (SillyTavern does not store `.js` files, so it is kept as text and run from there). Advanced: you can instead put any script file in that folder yourself and it is served at `/user/files/<name>`.
