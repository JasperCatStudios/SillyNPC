# Customize activity art and sounds

> Generated from `src/activity-assets-manifest.js` by `node tools/build-assets-readme.mjs`. Do not edit by hand; change the manifest.

You change what an activity looks like by dropping a picture with the right file name into the right folder. There is nothing to edit and nothing to restart but a page refresh. If a picture is missing, the screen shows a plain icon instead.

## Where to put the files

Pictures go in your SillyTavern user folder, under `user/images/worldkit-art/`:

| For | Folder |
|---|---|
| One world only (use the preset's id, for example `fire-emblem`) | `user/images/worldkit-art/<world>/activities/<file>` |
| Every world | `user/images/worldkit-art/activities/<file>` |

A picture is looked for in your world folder first, then in the all-worlds folder, then in the art of the installed Content Kit. `.webp` is tried first, then `.png`. The "older names" listed below still work, so art you already have keeps working.

File names are lower case with dashes. "Roast Fish" becomes `roast-fish`.

Pieces marked **reserved** are not used by the program yet. Their names are fixed now so art you make today will be picked up when the activity that uses it arrives.

## Tea Time

### `tea.table`

The Tea Time table scene, seen from slightly above. Fills the Tea Time screen.

- Size: 1024x768, opaque.
- File: `tea/table.webp`

### `tea.tabletop`

A plain tabletop, top-down, used behind the tea and snack pickers.

- Size: 1024x768, opaque.
- File: `tea/tabletop.webp`

### `tea.cup`

A cup of tea, cut out on a transparent background. One per kind of drink.

- Size: 256x256, transparent background.
- File: `tea/cups/apple.webp`, `tea/cups/berry.webp`, `tea/cups/black.webp`, `tea/cups/citrus.webp`, `tea/cups/flower.webp`, `tea/cups/herb.webp`, `tea/cups/leaf.webp`, `tea/cups/spice.webp`
- Older names that also work: `tea/teas/apple.webp`, `tea/teas/berry.webp`, `tea/teas/black.webp`, `tea/teas/citrus.webp`, `tea/teas/flower.webp`, `tea/teas/herb.webp`, `tea/teas/leaf.webp`, `tea/teas/spice.webp`

### `tea.food`

A snack or small dish, cut out on a transparent background.

- Size: 256x256, transparent background.
- File: `tea/food/cheese.webp`, `tea/food/cookies.webp`, `tea/food/honeycake.webp`, `tea/food/macarons.webp`, `tea/food/pastry.webp`, `tea/food/sandwiches.webp`, `tea/food/scone.webp`, `tea/food/shortcake.webp`, `tea/food/skewer.webp`, `tea/food/tart.webp`
- Older names that also work: `tea/snacks/cheese.webp`, `tea/snacks/cookies.webp`, `tea/snacks/honeycake.webp`, `tea/snacks/macarons.webp`, `tea/snacks/pastry.webp`, `tea/snacks/sandwiches.webp`, `tea/snacks/scone.webp`, `tea/snacks/shortcake.webp`, `tea/snacks/skewer.webp`, `tea/snacks/tart.webp`

## Hub

### `hub.bg` (reserved)

The background behind the Activities hub.

- Size: 1024x1536, opaque.
- File: `hub/bg.webp`
- Older names that also work: `hub-bg.webp`

### `hub.tile` (reserved)

The picture on an activity tile. The name is the activity id (study, potion, tea, cook, fish, garden, training).

- Size: 512x512, opaque.
- File: `tiles/study.webp`, `tiles/potion.webp`, `tiles/tea.webp`, `tiles/cook.webp`, `tiles/fish.webp`, `tiles/garden.webp`, `tiles/training.webp`
- Older names that also work: `tile-study.webp`, `tile-potion.webp`, `tile-tea.webp`, `tile-cook.webp`, `tile-fish.webp`, `tile-garden.webp`, `tile-training.webp`

## Study

### `study.back` (reserved)

The back of a face-down Study tile.

- Size: 256x256, opaque.
- File: `study/back.webp`
- Older names that also work: `runes/back.webp`

### `study.tile` (reserved)

The face of a Study tile. Twelve of them, numbered 01 to 12.

- Size: 256x256, transparent background.
- File: `study/tile-01.webp`, `study/tile-02.webp`, `study/tile-03.webp`, `study/tile-04.webp`, `study/tile-05.webp`, `study/tile-06.webp`, `study/tile-07.webp`, `study/tile-08.webp`, `study/tile-09.webp`, `study/tile-10.webp`, `study/tile-11.webp`, `study/tile-12.webp`
- Older names that also work: `runes/rune-01.webp`, `runes/rune-02.webp`, `runes/rune-03.webp`, `runes/rune-04.webp`, `runes/rune-05.webp`, `runes/rune-06.webp`, `runes/rune-07.webp`, `runes/rune-08.webp`, `runes/rune-09.webp`, `runes/rune-10.webp`, `runes/rune-11.webp`, `runes/rune-12.webp`

## Brewing

### `brewing.material` (reserved)

One ingredient of the Brewing puzzle. Eight of them, numbered 01 to 08.

- Size: 256x256, transparent background.
- File: `craft/brewing/material-01.webp`, `craft/brewing/material-02.webp`, `craft/brewing/material-03.webp`, `craft/brewing/material-04.webp`, `craft/brewing/material-05.webp`, `craft/brewing/material-06.webp`, `craft/brewing/material-07.webp`, `craft/brewing/material-08.webp`
- Older names that also work: `potions/p-01.webp`, `potions/p-02.webp`, `potions/p-03.webp`, `potions/p-04.webp`, `potions/p-05.webp`, `potions/p-06.webp`, `potions/p-07.webp`, `potions/p-08.webp`

## Items

### `items.item` (reserved)

An item or dish. The name is the item name in lower case with dashes (Roast Fish is roast-fish).

- Size: 128x128, transparent background.
- File: `items/bread.webp`, `items/cabbage.webp`, `items/cake.webp`, `items/carp.webp`, `items/carrot.webp`, `items/cheese.webp`, `items/dumplings.webp`, `items/herbs.webp`, `items/lavender.webp`, `items/lily.webp`, `items/pastry.webp`, `items/pie.webp`, `items/pumpkin.webp`, `items/roast-fish.webp`, `items/rose.webp`, `items/salad.webp`, `items/sandwich.webp`, `items/soup.webp`, `items/stew.webp`, `items/sunflower.webp`, `items/tea.webp`, `items/tomato.webp`, `items/trout.webp`, `items/turnip.webp`

## Drills

### `drill.bg` (reserved)

The background of a skill drill.

- Size: 1536x864, opaque.
- File: `drills/archery/bg.webp`, `drills/infirmary/bg.webp`, `drills/march/bg.webp`, `drills/sky/bg.webp`, `drills/trail/bg.webp`
- Older names that also work: `drill-bg-archery.webp`, `drill-bg-infirmary.webp`, `drill-bg-march.webp`, `drill-bg-sky.webp`, `drill-bg-trail.webp`

### `drill.archery` (reserved)

Parts of the archery drill.

- Size: 256x256, transparent background.
- File: `drills/archery/apple-stand.webp`, `drills/archery/arrow.webp`, `drills/archery/bow.webp`, `drills/archery/dummy.webp`, `drills/archery/quiver.webp`, `drills/archery/rail-target.webp`, `drills/archery/target.webp`, `drills/archery/windsock.webp`
- Older names that also work: `archery/apple-stand.webp`, `archery/arrow.webp`, `archery/bow.webp`, `archery/dummy.webp`, `archery/quiver.webp`, `archery/rail-target.webp`, `archery/target.webp`, `archery/windsock.webp`

### `drill.sky` (reserved)

Parts of the flying drill.

- Size: 256x256, transparent background.
- File: `drills/sky/balloon.webp`, `drills/sky/bird.webp`, `drills/sky/cloud-storm.webp`, `drills/sky/cloud-white.webp`, `drills/sky/feather.webp`, `drills/sky/flyer-dragon.webp`, `drills/sky/flyer-pegasus.webp`, `drills/sky/lightning.webp`, `drills/sky/ring-gold.webp`, `drills/sky/ring-silver.webp`, `drills/sky/sparkle.webp`, `drills/sky/wind-swirl.webp`
- Older names that also work: `sky/balloon.webp`, `sky/bird.webp`, `sky/cloud-storm.webp`, `sky/cloud-white.webp`, `sky/feather.webp`, `sky/flyer-dragon.webp`, `sky/flyer-pegasus.webp`, `sky/lightning.webp`, `sky/ring-gold.webp`, `sky/ring-silver.webp`, `sky/sparkle.webp`, `sky/wind-swirl.webp`

### `drill.trail` (reserved)

Parts of the riding drill.

- Size: 256x256, transparent background.
- File: `drills/trail/apple.webp`, `drills/trail/fence.webp`, `drills/trail/gate.webp`, `drills/trail/hay-bale.webp`, `drills/trail/horse.webp`, `drills/trail/log.webp`, `drills/trail/mud.webp`, `drills/trail/rock.webp`
- Older names that also work: `trail/apple.webp`, `trail/fence.webp`, `trail/gate.webp`, `trail/hay-bale.webp`, `trail/horse.webp`, `trail/log.webp`, `trail/mud.webp`, `trail/rock.webp`

### `drill.element` (reserved)

An element symbol for the spell-chain drill.

- Size: 256x256, transparent background.
- File: `drills/elements/dark.webp`, `drills/elements/earth.webp`, `drills/elements/fire.webp`, `drills/elements/light.webp`, `drills/elements/water.webp`, `drills/elements/wind.webp`
- Older names that also work: `elements/dark.webp`, `elements/earth.webp`, `elements/fire.webp`, `elements/light.webp`, `elements/water.webp`, `elements/wind.webp`

### `drill.status` (reserved)

A condition or supply for the triage drill.

- Size: 256x256, transparent background.
- File: `drills/status/bandage.webp`, `drills/status/blanket.webp`, `drills/status/heart.webp`, `drills/status/herb.webp`, `drills/status/mana.webp`, `drills/status/poison.webp`, `drills/status/prayer.webp`, `drills/status/stun.webp`
- Older names that also work: `status/bandage.webp`, `status/blanket.webp`, `status/heart.webp`, `status/herb.webp`, `status/mana.webp`, `status/poison.webp`, `status/prayer.webp`, `status/stun.webp`

## Sounds

Sounds come from your sound map today: set its address under Activities settings. Each sound has a tag, and the tag is also its file name (`activity_tea_pour` is `activity-tea-pour.mp3`). A tag with no file is silent.

| Tag | File |
|---|---|
| `activity_study_flip` | `activity-study-flip.mp3` |
| `activity_study_match` | `activity-study-match.mp3` |
| `activity_study_miss` | `activity-study-miss.mp3` |
| `activity_study_curse` | `activity-study-curse.mp3` |
| `activity_study_clear` | `activity-study-clear.mp3` |
| `activity_potion_pour` | `activity-potion-pour.mp3` |
| `activity_potion_hint` | `activity-potion-hint.mp3` |
| `activity_potion_success` | `activity-potion-success.mp3` |
| `activity_potion_fail` | `activity-potion-fail.mp3` |
| `activity_tea_pour` | `activity-tea-pour.mp3` |
| `activity_tea_cup` | `activity-tea-cup.mp3` |
| `activity_tea_good` | `activity-tea-good.mp3` |
| `activity_tea_bad` | `activity-tea-bad.mp3` |
| `activity_tea_music` | `activity-tea-music.mp3` |
| `activity_cook_chop` | `activity-cook-chop.mp3` |
| `activity_cook_sizzle` | `activity-cook-sizzle.mp3` |
| `activity_cook_bubble` | `activity-cook-bubble.mp3` |
| `activity_cook_done` | `activity-cook-done.mp3` |
| `activity_fish_cast` | `activity-fish-cast.mp3` |
| `activity_fish_bite` | `activity-fish-bite.mp3` |
| `activity_fish_catch` | `activity-fish-catch.mp3` |
| `activity_fish_lost` | `activity-fish-lost.mp3` |
| `activity_garden_dig` | `activity-garden-dig.mp3` |
| `activity_garden_water` | `activity-garden-water.mp3` |
| `activity_garden_harvest` | `activity-garden-harvest.mp3` |
