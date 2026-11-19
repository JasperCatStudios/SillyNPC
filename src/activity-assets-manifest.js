/**
 * Every picture and sound an activity can show, by file name (fork). One list, used by the resolver (activity-assets.js), the
 * generated README (docs/ASSETS-README.md) and the tests, so what the README promises is what the code looks for.
 *
 * An entry:
 *   key       what the code asks for (e.g. 'tea.cup')
 *   group     the folder it lives in, and the README heading
 *   file      the canonical name, a pattern relative to art/activities/ ({placeholders} are filled from `values`)
 *   legacy    older names of the same picture that still work (files already in a folder, the current Content Kit)
 *   values    the names each placeholder takes (so the README can list every file)
 *   size / transparent / desc   what to make
 *   used      true when the program looks for it now, false while it is only reserved for a coming step
 *
 * Add the entries for a new activity here in the same change that adds the activity. Pure data; no imports.
 */

const SPRITES_TEA = ['apple', 'berry', 'black', 'citrus', 'flower', 'herb', 'leaf', 'spice'];
const SPRITES_FOOD = ['cheese', 'cookies', 'honeycake', 'macarons', 'pastry', 'sandwiches', 'scone', 'shortcake', 'skewer', 'tart'];
const ITEMS = ['bread', 'cabbage', 'cake', 'carp', 'carrot', 'cheese', 'dumplings', 'herbs', 'lavender', 'lily', 'pastry', 'pie', 'pumpkin', 'roast-fish', 'rose', 'salad', 'sandwich', 'soup', 'stew', 'sunflower', 'tea', 'tomato', 'trout', 'turnip'];
const NN = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

const img = (key, group, file, desc, size, transparent, extra = {}) => ({ kind: 'image', key, group, file, desc, size, transparent, used: false, legacy: [], ...extra });

export const ASSET_MANIFEST = Object.freeze([
    // ---- Tea Time (used now)
    img('tea.table', 'Tea Time', 'tea/table.webp', 'The Tea Time table scene, seen from slightly above. Fills the Tea Time screen.', '1024x768', false, { used: true }),
    img('tea.tabletop', 'Tea Time', 'tea/tabletop.webp', 'A plain tabletop, top-down, used behind the tea and snack pickers.', '1024x768', false, { used: true }),
    img('tea.cup', 'Tea Time', 'tea/cups/{sprite}.webp', 'A cup of tea, cut out on a transparent background. One per kind of drink.', '256x256', true, {
        used: true, legacy: ['tea/teas/{sprite}.webp'], values: { sprite: SPRITES_TEA },
    }),
    img('tea.food', 'Tea Time', 'tea/food/{sprite}.webp', 'A snack or small dish, cut out on a transparent background.', '256x256', true, {
        used: true, legacy: ['tea/snacks/{sprite}.webp'], values: { sprite: SPRITES_FOOD },
    }),

    // ---- The hands-on kitchen (used now). Every piece has a plain-shape fallback, so the game plays with no art.
    img('mech.bench', 'Kitchen', 'bench/kitchen.webp', 'The kitchen counter behind the cooking steps. Leave the middle empty: the props are drawn on it.', '1376x768', false, { used: true }),
    img('mech.prop', 'Kitchen', 'props/{set}/{part}.webp', 'A prop of the cooking steps, cut out on a transparent background, seen from slightly above. The set is the prop family (kitchen).', '320x290', true, {
        used: true, values: { set: ['kitchen'], part: ['board', 'knife', 'saucepan', 'spoon', 'pan', 'stove', 'shaker', 'plate', 'bowl', 'jug'] },
    }),
    img('mech.food', 'Kitchen', 'food/{item}.webp', 'A food shown in the cooking steps, cut out on a transparent background: raw and golden-cooked fillet, whole and chopped herbs.', '320x290', true, {
        used: true, values: { item: ['fish-fillet', 'fish-fillet-cooked', 'herbs', 'herbs-cooked', 'vegetables', 'vegetables-cooked', 'fruit', 'fruit-cooked', 'bread', 'bread-cooked', 'grain-cooked', 'soup-cooked', 'pie-cooked'] },
    }),
    img('mech.item', 'Kitchen', 'items/{item}.webp', 'A picture of any ingredient or dish, named by its Item Database id (so a fish called "trout" is items/trout.webp). Looked for after the kitchen food folder, so it also works for crafting and for items of your own. Same cut-out style as the kitchen food.', '320x290', true, {
        used: true, values: { item: ['trout', 'carrot', 'iron-ore'] },
    }),

    // ---- Reserved for the coming steps (the Content Kit already holds art under the older names)
    img('hub.bg', 'Hub', 'hub/bg.webp', 'The background behind the Activities hub.', '1024x1536', false, { legacy: ['hub-bg.webp'] }),
    img('hub.tile', 'Hub', 'tiles/{activity}.webp', 'The picture on an activity tile. The name is the activity id (study, potion, tea, cook, fish, garden, training).', '512x512', false, {
        legacy: ['tile-{activity}.webp'], values: { activity: ['study', 'potion', 'tea', 'cook', 'fish', 'garden', 'training'] },
    }),
    img('study.back', 'Study', 'study/back.webp', 'The back of a face-down Study tile.', '256x256', false, { legacy: ['runes/back.webp'] }),
    img('study.tile', 'Study', 'study/tile-{nn}.webp', 'The face of a Study tile. Twelve of them, numbered 01 to 12.', '256x256', true, { legacy: ['runes/rune-{nn}.webp'], values: { nn: NN } }),
    img('brewing.material', 'Brewing', 'craft/brewing/material-{nn}.webp', 'One ingredient of the Brewing puzzle. Eight of them, numbered 01 to 08.', '256x256', true, {
        legacy: ['potions/p-{nn}.webp'], values: { nn: NN.slice(0, 8) },
    }),
    img('items.item', 'Items', 'items/{item}.webp', 'An item or dish. The name is the item name in lower case with dashes (Roast Fish is roast-fish).', '128x128', true, { values: { item: ITEMS } }),
    img('drill.bg', 'Drills', 'drills/{drill}/bg.webp', 'The background of a skill drill.', '1536x864', false, {
        legacy: ['drill-bg-{drill}.webp'], values: { drill: ['archery', 'infirmary', 'march', 'sky', 'trail'] },
    }),
    img('drill.archery', 'Drills', 'drills/archery/{part}.webp', 'Parts of the archery drill.', '256x256', true, {
        legacy: ['archery/{part}.webp'], values: { part: ['apple-stand', 'arrow', 'bow', 'dummy', 'quiver', 'rail-target', 'target', 'windsock'] },
    }),
    img('drill.sky', 'Drills', 'drills/sky/{part}.webp', 'Parts of the flying drill.', '256x256', true, {
        legacy: ['sky/{part}.webp'], values: { part: ['balloon', 'bird', 'cloud-storm', 'cloud-white', 'feather', 'flyer-dragon', 'flyer-pegasus', 'lightning', 'ring-gold', 'ring-silver', 'sparkle', 'wind-swirl'] },
    }),
    img('drill.trail', 'Drills', 'drills/trail/{part}.webp', 'Parts of the riding drill.', '256x256', true, {
        legacy: ['trail/{part}.webp'], values: { part: ['apple', 'fence', 'gate', 'hay-bale', 'horse', 'log', 'mud', 'rock'] },
    }),
    img('drill.element', 'Drills', 'drills/elements/{part}.webp', 'An element symbol for the spell-chain drill.', '256x256', true, {
        legacy: ['elements/{part}.webp'], values: { part: ['dark', 'earth', 'fire', 'light', 'water', 'wind'] },
    }),
    img('drill.status', 'Drills', 'drills/status/{part}.webp', 'A condition or supply for the triage drill.', '256x256', true, {
        legacy: ['status/{part}.webp'], values: { part: ['bandage', 'blanket', 'heart', 'herb', 'mana', 'poison', 'prayer', 'stun'] },
    }),
]);

/** The sound tags the activities play now. A tag is also the file name: activity_tea_pour is activity-tea-pour.mp3. */
export const SOUND_TAGS = Object.freeze([
    'activity_study_flip', 'activity_study_match', 'activity_study_miss', 'activity_study_curse', 'activity_study_clear',
    'activity_potion_pour', 'activity_potion_hint', 'activity_potion_success', 'activity_potion_fail',
    'activity_tea_pour', 'activity_tea_cup', 'activity_tea_good', 'activity_tea_bad', 'activity_tea_music',
    'activity_cook_chop', 'activity_cook_sizzle', 'activity_cook_bubble', 'activity_cook_done',
    'activity_fish_cast', 'activity_fish_bite', 'activity_fish_catch', 'activity_fish_lost',
    'activity_garden_dig', 'activity_garden_water', 'activity_garden_harvest',
    'activity_mech_perfect', 'activity_mech_good', 'activity_mech_miss', 'activity_mech_streak', 'activity_mech_flow_up', 'activity_mech_step_done', 'activity_mech_serve', 'activity_mech_ruin_comic',
    'activity_mech_slice_cut', 'activity_mech_slice_guard', 'activity_mech_stir_loop', 'activity_mech_stir_splash', 'activity_mech_sear_sizzle', 'activity_mech_sear_flip', 'activity_mech_sear_land', 'activity_mech_sear_warn', 'activity_mech_sprinkle_shake',
    'activity_mech_pour_loop', 'activity_mech_pour_spill', 'activity_mech_plate_pick', 'activity_mech_plate_place', 'activity_mech_plate_present',
]);

/** The file name a sound tag is stored under. */
export const soundFileOf = (tag) => `${String(tag).replace(/_/g, '-')}.mp3`;
