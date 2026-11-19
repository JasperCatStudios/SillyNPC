# Make your own activity

You can add a completely new activity to the Activities hub with one script. It appears as a tile in the tab you choose, and it gets the same partner choice, energy cost, streaks and Customize card as the built-in activities. You write only the game; Worldkit does the bookkeeping.

A complete working example is in [`docs/examples/quick-cast-activity.js`](examples/quick-cast-activity.js). Copy it, change the `id` and `label`, and change the game.

> A custom activity runs with the same access as any SillyTavern extension. Only install activity scripts you trust.

## 1. Register it

Any script on the page can do this (a SillyTavern extension, or one file loaded by an extension):

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

- Registering again with the same `id` replaces the activity. `window.WorldkitActivities.unregister(id)` removes it and `.list()` shows what is registered.
- If the active preset already has an activity with that `id`, the preset's wins and yours is not shown. Pick a new `id`.
- A mistake in `run` (an error, or a rejected promise) closes the activity with a message; it never breaks the hub.

## 2. What `run(api)` receives

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
| `loadArt(img, key, vars, onMissing)` | Put a picture in an `<img>` by key, with the world, user and Content Kit folders searched. See [ASSETS-README.md](ASSETS-README.md). |
| `inventory` | `{ active, items(), give(items), take(name, qty) }`. Use the pack only when `active` is true. |
| `leave()`, `restart()` | Back to the hub, or run again. |
| `rng` | A random function (`Math.random`). |

## 3. Looping music

Every activity can have its own loop. Set `music: 'your_tag'` in the registration, or give a built-in activity a music tag in **Activities settings → Customize an activity → Music**. The tag must exist in your sound map (see the sound tags in [ASSETS-README.md](ASSETS-README.md)). The **Activity music** switch and volume in the Activities settings apply to all of them, and a tag with no file is silent.

## 4. Customizing it

A registered activity gets no preset entry of its own, so its name and blurb come from your registration. Players change a world's wording through **Customize an activity**; the same terms are available to you through `api.term`.

## 5. A checklist

- Draw everything inside `win.main`; do not touch the rest of the page.
- Take every world word from `api.term(...)` or from your own settings, so the activity works in any world.
- End with `api.settle(...)` exactly once, then `api.result(...)`.
- Make it playable with the keyboard and at phone width.
- Let a missing picture or sound fail quietly.
