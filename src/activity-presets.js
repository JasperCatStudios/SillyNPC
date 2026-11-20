/**
 * The built-in world presets for Activities (fork). A preset tells the module how to behave in a world: which activities
 * exist, what they and their roles are called (terms), the Study subjects, the brewing recipe, and the tea music.
 * Written in plain fantasy words: no character names, nothing copyrighted beyond the common names of the setting's own items
 * and classes. The module picks the preset whose `world` is the active combat type (see presetFor in
 * activity-config-core.js), unless the user picked one. The Generic preset is the default when none matches.
 *
 * Pure data: no DOM, no SillyTavern imports.
 */

/** The Fire Emblem world preset. The world is the built-in combat type 'fe'. */
export const FIRE_EMBLEM_PRESET = Object.freeze({
    format: 'worldkit-activities',
    version: 1,
    id: 'fire-emblem',
    name: 'Fire Emblem',
    world: 'fe',
    // No sound map is bundled. Point this (or the Activities pane) at your own map; a missing file is silent. See docs/examples/sound-map-example.json.
    soundMap: '',
    activities: [
        { id: 'study', label: 'Study', kind: 'memory', tab: 'study', icon: 'fa-book-open', blurb: 'Match the runes in the library. What you learn counts toward a class change.', solo: true },
        { id: 'potion', label: 'Brewing', kind: 'mastermind', off: true, tab: 'study', icon: 'fa-flask', blurb: 'Work out the recipe from the clues and brew a tonic.', solo: true },
        { id: 'tea', label: 'Tea Time', kind: 'tea', tab: 'leisure', icon: 'fa-mug-hot', blurb: 'Share a cup in the garden and see how the talk goes.' },
        { id: 'alchemy', label: 'Alchemy', kind: 'craft', craft: 'alchemy', tab: 'crafting', icon: 'fa-flask', blurb: 'Choose herbs and water, grind, simmer and seal a tonic.', solo: true },
        { id: 'smithing', label: 'Smithing', kind: 'craft', craft: 'smithing', tab: 'crafting', icon: 'fa-hammer', blurb: 'Choose metal and a handle, heat the work and strike it on the beat.', solo: true },
        { id: 'cook', label: 'Cooking', kind: 'harvest', tab: 'crafting', icon: 'fa-utensils', blurb: 'Time three steps and cook a dish in the kitchen.', solo: true },
        { id: 'fish', label: 'Fishing', kind: 'harvest', tab: 'leisure', icon: 'fa-fish', blurb: 'Wait for a bite at the pond, hook it and reel it in.', solo: true },
        { id: 'target', label: 'Target Practice', kind: 'drill', drill: 'target', tab: 'training', icon: 'fa-bullseye', blurb: 'A steady mark crosses the lane. Tap when it is inside the ring.', solo: true },
        { id: 'moving', label: 'Moving Targets', kind: 'drill', drill: 'moving', tab: 'training', icon: 'fa-crosshairs', blurb: 'The mark speeds up and slows down. Tap when it is inside the ring.', solo: true },
        { id: 'exam', label: 'Certification exam', kind: 'exam', tab: 'training', icon: 'fa-certificate', blurb: 'A graded set of drills. Pass to raise a skill one rank and earn a seal. A professor examines you.' },
        { id: 'garden', label: 'Gardening', kind: 'harvest', tab: 'leisure', icon: 'fa-seedling', blurb: 'Tend the greenhouse beds. Plants grow as you tend them on different days.', solo: true },
    ],
    // Study trains the magic-like skills. Without runes of its own the generic glyphs are used.
    study: { runes: [], profs: ['reason', 'faith', 'authority'] },
    potion: {
        recipe: 'Vulnerary',
        failed: 'Murky Brew',
        names: { red: 'Redroot', blue: 'Bluebell', green: 'Mint Leaf', yellow: 'Sunpetal', purple: 'Nightshade', orange: 'Ember Pepper', teal: 'Seagrass', pink: 'Rosehip' },
        profs: ['faith'],
    },
    // The teas come from the item database (the item pack in the Content Kit) and from the cast's tastes.
    tea: { category: 'Tea', music: 'activity_tea_music' },
    // The seals the exam hands out, by where the next rank sits on the skill's ladder (the Dark Seal is for one class, not a rank).
    exam: { tiers: ['Beginner', 'Intermediate', 'Advanced', 'Master'] },
    classChange: { mode: 'both', studyKnowledge: 100, rankGate: null },
    terms: {
        examiner: 'Professor', examinerPlural: 'Professors', examinerRule: 'partner',
        exam: 'Certification exam', examVerb: 'Sit the exam', passed: 'Certified',
        credential: 'Seal', credentialPlural: 'Seals',
        credentialTiers: ['Beginner', 'Intermediate', 'Advanced', 'Master', 'Dark'],
        classWord: 'Class', changeClass: 'Change class', knowledge: 'Knowledge', studyPlace: 'the library',
        tile: 'rune', cursedTile: 'cursed rune', gardenPlace: 'the greenhouse', fishingPlace: 'the pond',
        tea: 'tea', guest: 'guest',
    },
});

/**
 * The Bleach crafts: sewing (cloth, thread and buttons made into clothes and small goods) and gadgetry (shop inventions built from
 * reishi dust, wire and casings). Healing is done by kidō and special abilities and swords are not made, so neither is crafted.
 * Both use the shared craft engine: choose materials, prepare, tend (hold the gauge) and finish. Pure data.
 */
const BL_SEWING = {
    id: 'sewing',
    label: 'Sewing',
    icon: 'fa-scissors',
    prof: 'sewing',
    music: 'activity_craft_sewing_music',
    materialWeight: 0.3,
    properties: [
        { id: 'warmth', label: 'Warmth', mix: 'sum', max: 20, icon: 'fa-temperature-half' },
        { id: 'sturdiness', label: 'Sturdiness', mix: 'avg', max: 10, icon: 'fa-shield' },
        { id: 'fraying', label: 'Fraying', mix: 'max', max: 10, icon: 'fa-burst' },
    ],
    materials: [
        { id: 'cotton-cloth', name: 'Cotton Cloth', match: ['cotton cloth', 'cotton'], category: 'Cloth', props: { warmth: 3, sturdiness: 5, fraying: 2 }, tags: ['cloth'], tier: 1, starter: true, shape: '■', letter: 'C', color: '#e8e1d0' },
        { id: 'hemp-cloth', name: 'Hemp Cloth', match: ['hemp cloth', 'hemp'], category: 'Cloth', props: { warmth: 2, sturdiness: 6, fraying: 3 }, tags: ['cloth'], tier: 1, starter: true, shape: '▲', letter: 'H', color: '#b7a97a' },
        { id: 'plain-thread', name: 'Plain Thread', match: ['plain thread'], category: 'Thread', props: { warmth: 0, sturdiness: 5, fraying: 1 }, tags: ['thread'], tier: 1, starter: true, shape: '●', letter: 'T', color: '#d9d2c3' },
        { id: 'wooden-buttons', name: 'Wooden Buttons', match: ['wooden buttons', 'wooden button'], category: 'Trim', props: { warmth: 0, sturdiness: 4, fraying: 0 }, tags: ['trim'], tier: 1, starter: true, shape: '♣', letter: 'B', color: '#8b5a2b' },
        { id: 'wool-cloth', name: 'Wool Cloth', match: ['wool cloth', 'wool'], category: 'Cloth', props: { warmth: 7, sturdiness: 6, fraying: 1 }, tags: ['cloth', 'warm'], tier: 2, shape: '◆', letter: 'W', color: '#c9a98a' },
        { id: 'silver-buttons', name: 'Silver Buttons', match: ['silver buttons', 'silver button'], category: 'Trim', props: { warmth: 0, sturdiness: 7, fraying: 0 }, tags: ['trim', 'fine'], tier: 2, shape: '★', letter: 'V', color: '#d9e1ea' },
        { id: 'silk-cloth', name: 'Silk Cloth', match: ['silk cloth', 'silk'], category: 'Cloth', props: { warmth: 2, sturdiness: 4, fraying: 4 }, tags: ['cloth', 'fine'], tier: 3, shape: '♥', letter: 'S', color: '#e6b8d4' },
        { id: 'reishi-thread', name: 'Reishi Thread', match: ['reishi thread'], category: 'Thread', props: { warmth: 1, sturdiness: 9, fraying: 0 }, tags: ['thread', 'fine'], tier: 3, shape: '⬟', letter: 'R', color: '#9fc5e8' },
    ],
    effects: [
        { prop: 'fraying', stage: 'tend', param: 'drift', per: 0.1, from: 3, label: 'Frayed cloth: the stitching will wander.' },
        { prop: 'sturdiness', stage: 'finish', param: 'zone', per: 0.05, from: 5, label: 'Sturdy cloth: the last knot is easier.' },
        { prop: 'warmth', stage: 'tend', param: 'progress', per: 0.04, from: 8, label: 'A thick piece: it takes longer to stitch.' },
    ],
    stages: [{ stage: 'prep', weight: 1 }, { stage: 'tend', weight: 3 }, { stage: 'finish', weight: 1 }],
    terms: { tended: 'the stitching', craftVerb: 'Sew', workplace: 'the sewing room', prep: 'Cut', finish: 'Knot off' },
    recipes: [
        {
            id: 'cloth-pouch', name: 'Cloth Pouch', level: 1, desc: 'A small drawstring pouch. Any cloth and plain thread.',
            slots: [{ id: 'cloth', label: 'a cloth', tags: ['cloth'] }, { id: 'thread', label: 'thread', tags: ['thread'] }],
            targets: { sturdiness: { min: 3, ideal: [4, 8], max: 10 }, fraying: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Cloth Pouch', note: 'neatly stitched', qty: 2 }, good: { name: 'Cloth Pouch', note: 'well made' }, fair: { name: 'Cloth Pouch', note: 'a little crooked' }, poor: { name: 'Cloth Pouch', note: 'loose seams' }, failed: { name: 'Tangled Mess', note: 'a knot of thread' } },
        },
        {
            id: 'handkerchief', name: 'Handkerchief', level: 1, desc: 'A hemmed square of cloth. Any cloth will do.',
            slots: [{ id: 'cloth', label: 'a cloth', tags: ['cloth'] }, { id: 'thread', label: 'thread', tags: ['thread'] }],
            targets: { fraying: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Handkerchief', note: 'neatly hemmed', qty: 2 }, good: { name: 'Handkerchief', note: 'well made' }, fair: { name: 'Handkerchief', note: 'uneven hem' }, failed: { name: 'Tangled Mess', note: 'a knot of thread' } },
        },
        {
            id: 'scarf', name: 'Scarf', level: 2, desc: 'Long and warm. Two lengths of cloth and thread.',
            slots: [{ id: 'cloth', label: 'a cloth', tags: ['cloth'] }, { id: 'cloth2', label: 'more cloth', tags: ['cloth'] }, { id: 'thread', label: 'thread', tags: ['thread'] }],
            targets: { warmth: { min: 6, ideal: [7, 12], max: 16 }, fraying: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Scarf', note: 'soft and warm', qty: 1 }, good: { name: 'Scarf', note: 'well made' }, fair: { name: 'Scarf', note: 'a bit thin' }, poor: { name: 'Scarf', note: 'itchy' }, failed: { name: 'Tangled Mess', note: 'a knot of thread' } },
        },
        {
            id: 'stuffed-toy', name: 'Stuffed Toy', level: 2, desc: 'A small soft toy. Cloth, thread and buttons for the eyes.',
            slots: [{ id: 'cloth', label: 'a cloth', tags: ['cloth'] }, { id: 'thread', label: 'thread', tags: ['thread'] }, { id: 'trim', label: 'buttons', tags: ['trim'] }],
            targets: { sturdiness: { min: 4, ideal: [5, 9], max: 10 }, warmth: { ideal: [2, 8], max: 12 }, fraying: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Stuffed Toy', note: 'wonderfully cute', qty: 1 }, good: { name: 'Stuffed Toy', note: 'charming' }, fair: { name: 'Stuffed Toy', note: 'lopsided' }, failed: { name: 'Tangled Mess', note: 'a knot of thread' } },
        },
        {
            id: 'warm-coat', name: 'Warm Coat', level: 3, desc: 'A proper coat. Thick cloth, strong thread and buttons.',
            slots: [{ id: 'cloth', label: 'a thick cloth', tags: ['warm'] }, { id: 'cloth2', label: 'more cloth', tags: ['cloth'] }, { id: 'thread', label: 'strong thread', tags: ['thread'] }, { id: 'trim', label: 'buttons', tags: ['trim'] }],
            targets: { warmth: { min: 9, ideal: [11, 16], max: 20 }, sturdiness: { min: 5, ideal: [6, 10], max: 10 }, fraying: { ideal: [0, 3], max: 5 } },
            outputs: { perfect: { name: 'Warm Coat', note: 'finely tailored', qty: 1 }, good: { name: 'Warm Coat', note: 'well tailored' }, fair: { name: 'Warm Coat', note: 'ill-fitting' }, failed: { name: 'Tangled Mess', note: 'a knot of thread' } },
        },
    ],
};

const BL_GADGETRY = {
    id: 'gadgetry',
    label: 'Gadgetry',
    icon: 'fa-gears',
    prof: 'gadgetry',
    music: 'activity_craft_gadgetry_music',
    materialWeight: 0.3,
    properties: [
        { id: 'charge', label: 'Charge', mix: 'sum', max: 20, icon: 'fa-bolt' },
        { id: 'precision', label: 'Precision', mix: 'avg', max: 10, icon: 'fa-crosshairs' },
        { id: 'instability', label: 'Instability', mix: 'max', max: 10, icon: 'fa-burst' },
    ],
    materials: [
        { id: 'reishi-dust', name: 'Reishi Dust', match: ['reishi dust', 'dust'], category: 'Reishi', props: { charge: 4, precision: 5, instability: 2 }, tags: ['reishi'], tier: 1, starter: true, shape: '●', letter: 'D', color: '#9fc5e8' },
        { id: 'copper-wire', name: 'Copper Wire', match: ['copper wire', 'wire'], category: 'Part', props: { charge: 2, precision: 6, instability: 1 }, tags: ['part', 'wire'], tier: 1, starter: true, shape: '▲', letter: 'W', color: '#cc7a3a' },
        { id: 'rice-paste', name: 'Rice Paste', match: ['rice paste', 'paste'], category: 'Binder', props: { charge: 1, precision: 7, instability: 0 }, tags: ['binder'], tier: 1, starter: true, shape: '♣', letter: 'P', color: '#f3efe0' },
        { id: 'tin-casing', name: 'Tin Casing', match: ['tin casing', 'casing'], category: 'Part', props: { charge: 0, precision: 4, instability: 0 }, tags: ['part', 'casing'], tier: 1, starter: true, shape: '■', letter: 'T', color: '#b0b8c0' },
        { id: 'reishi-crystal', name: 'Reishi Crystal', match: ['reishi crystal'], category: 'Reishi', props: { charge: 8, precision: 6, instability: 4 }, tags: ['reishi'], tier: 2, shape: '◆', letter: 'C', color: '#6fa8dc' },
        { id: 'spring-coil', name: 'Spring Coil', match: ['spring coil', 'coil'], category: 'Part', props: { charge: 3, precision: 8, instability: 2 }, tags: ['part'], tier: 2, shape: '⬟', letter: 'S', color: '#a0a8b0' },
        { id: 'clear-shard', name: 'Clear Shard', match: ['clear shard', 'shard'], category: 'Reishi', props: { charge: 6, precision: 9, instability: 1 }, tags: ['reishi', 'fine'], tier: 3, shape: '★', letter: 'H', color: '#e8f4ff' },
        { id: 'hollow-residue', name: 'Hollow Residue', match: ['hollow residue', 'residue'], category: 'Reishi', props: { charge: 10, precision: 2, instability: 8 }, tags: ['reishi', 'volatile'], tier: 3, shape: '♥', letter: 'R', color: '#7b4a8c' },
    ],
    effects: [
        { prop: 'instability', stage: 'tend', param: 'drift', per: 0.1, from: 3, label: 'An unstable build: the tuning will drift.' },
        { prop: 'precision', stage: 'finish', param: 'zone', per: 0.05, from: 6, label: 'A precise build: the final seal is easier.' },
        { prop: 'charge', stage: 'tend', param: 'progress', per: 0.04, from: 8, label: 'A heavy charge: it takes longer to tune.' },
    ],
    stages: [{ stage: 'prep', weight: 1 }, { stage: 'tend', weight: 3 }, { stage: 'finish', weight: 1 }],
    terms: { tended: 'the tuning', craftVerb: 'Build', workplace: 'the back room of the shop', prep: 'Assemble', finish: 'Seal' },
    recipes: [
        {
            id: 'soul-candy', name: 'Soul Candy', level: 1, desc: 'A small pill packed with spirit energy. Reishi and a binder.',
            slots: [{ id: 'reishi', label: 'reishi', tags: ['reishi'] }, { id: 'binder', label: 'a binder', tags: ['binder'] }],
            targets: { charge: { min: 3, ideal: [4, 9], max: 12 }, instability: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Soul Candy', note: 'potent and sweet', qty: 2 }, good: { name: 'Soul Candy', note: 'good quality' }, fair: { name: 'Soul Candy', note: 'a little weak' }, poor: { name: 'Soul Candy', note: 'crumbly' }, failed: { name: 'Fizzled Gadget', note: 'a failed build' } },
        },
        {
            id: 'reiatsu-sensor', name: 'Reiatsu Sensor', level: 1, desc: 'Ticks faster near spirit energy. A part and some reishi.',
            slots: [{ id: 'part', label: 'a part', tags: ['part'] }, { id: 'reishi', label: 'reishi', tags: ['reishi'] }],
            targets: { precision: { min: 4, ideal: [5, 9], max: 10 }, instability: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Reiatsu Sensor', note: 'finely tuned', qty: 1 }, good: { name: 'Reiatsu Sensor', note: 'works well' }, fair: { name: 'Reiatsu Sensor', note: 'twitchy' }, failed: { name: 'Fizzled Gadget', note: 'a failed build' } },
        },
        {
            id: 'barrier-charm', name: 'Barrier Charm', level: 2, desc: 'A charm that throws up a small barrier. Strong reishi in a sound casing.',
            slots: [{ id: 'reishi', label: 'reishi', tags: ['reishi'] }, { id: 'reishi2', label: 'more reishi', tags: ['reishi'] }, { id: 'casing', label: 'a casing', tags: ['casing'] }],
            targets: { charge: { min: 8, ideal: [10, 15], max: 19 }, precision: { min: 5, ideal: [6, 10], max: 10 }, instability: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Barrier Charm', note: 'rock steady', qty: 1 }, good: { name: 'Barrier Charm', note: 'holds well' }, fair: { name: 'Barrier Charm', note: 'flickers' }, failed: { name: 'Fizzled Gadget', note: 'a failed build' } },
        },
        {
            id: 'spirit-lantern', name: 'Spirit Lantern', level: 3, desc: 'A lantern that glows with spirit energy. Needs a fine, steady build.',
            slots: [{ id: 'reishi', label: 'reishi', tags: ['reishi'] }, { id: 'reishi2', label: 'more reishi', tags: ['reishi'] }, { id: 'part', label: 'a part', tags: ['part'] }, { id: 'casing', label: 'a casing', tags: ['casing'] }],
            targets: { charge: { min: 10, ideal: [12, 17], max: 20 }, precision: { min: 6, ideal: [7, 10], max: 10 }, instability: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Spirit Lantern', note: 'glows beautifully', qty: 1 }, good: { name: 'Spirit Lantern', note: 'glows steadily' }, fair: { name: 'Spirit Lantern', note: 'dim' }, failed: { name: 'Fizzled Gadget', note: 'a failed build' } },
        },
    ],
};

/**
 * The Bleach world preset. The world is the built-in combat type 'bleach'. Everything world-specific lives here as data: the wording,
 * the kanji tiles, the drills (each trains one of the Bleach type's skills), the dishes, fish and seeds, and the promotion trial.
 * Names are the common ones of the setting; no character names.
 */
const BL_FISH = ['fish', 'trout', 'carp', 'loach', 'eel', 'ayu', 'koi', 'unagi', 'mackerel'];
const BL_VEG = ['daikon', 'radish', 'onion', 'potato', 'eggplant', 'edamame', 'spinach', 'cabbage', 'pumpkin', 'vegetable'];
const BL_FRUIT = ['persimmon', 'plum', 'peach', 'berry', 'fruit', 'apple'];

export const BLEACH_PRESET = Object.freeze({
    format: 'worldkit-activities',
    version: 1,
    id: 'bleach',
    name: 'Bleach',
    world: 'bleach',
    soundMap: '',
    activities: [
        { id: 'study', label: 'Study', kind: 'memory', tab: 'study', icon: 'fa-book-open', blurb: 'Match the kanji in the academy library. What you learn deepens your spiritual insight.', solo: true },
        { id: 'tea', label: 'Tea Time', kind: 'tea', tab: 'leisure', icon: 'fa-mug-hot', blurb: 'Share a cup of tea and a sweet, and see how the talk goes.' },
        { id: 'sewing', label: 'Sewing', kind: 'craft', craft: 'sewing', tab: 'crafting', icon: 'fa-scissors', blurb: 'Choose cloth, thread and buttons, cut, stitch and knot off a small good.', solo: true },
        { id: 'gadgetry', label: 'Gadgetry', kind: 'craft', craft: 'gadgetry', tab: 'crafting', icon: 'fa-gears', blurb: 'Assemble reishi, wire and casings into a shop invention, then tune and seal it.', solo: true },
        { id: 'cook', label: 'Cooking', kind: 'harvest', tab: 'crafting', icon: 'fa-utensils', blurb: 'Cook a dish in the kitchen, hands on.', solo: true },
        { id: 'fish', label: 'Fishing', kind: 'harvest', tab: 'leisure', icon: 'fa-fish', blurb: 'Wait for a bite at the river, hook it and reel it in.', solo: true },
        { id: 'garden', label: 'Gardening', kind: 'harvest', tab: 'leisure', icon: 'fa-seedling', blurb: 'Tend the garden beds. Plants grow as you tend them on different days.', solo: true },
        { id: 'zanjutsu', label: 'Sword Practice', kind: 'drill', drill: 'zanjutsu', tab: 'training', icon: 'fa-khanda', blurb: 'Strike the swinging post inside the ring.', solo: true },
        { id: 'kido', label: 'Kidō Practice', kind: 'drill', drill: 'kido', tab: 'training', icon: 'fa-wand-sparkles', blurb: 'Release the spell when the mark is in the ring.', solo: true },
        { id: 'hoho', label: 'Flash Step Drill', kind: 'drill', drill: 'hoho', tab: 'training', icon: 'fa-wind', blurb: 'Step on the beat as the marker darts across.', solo: true },
        { id: 'exam', label: 'Promotion trial', kind: 'exam', tab: 'training', icon: 'fa-certificate', blurb: 'A graded set of drills. Pass to raise a skill one grade and earn a writ. A captain sets it.' },
    ],
    // Kanji for the matching game (demon/spirit art, way, slash, fist, step, bind, spirit, blade).
    study: { runes: ['鬼', '道', '斬', '拳', '歩', '縛', '霊', '刀'], profs: ['kido', 'bakudo', 'healing_kido'] },
    // The drills: each trains one of the Bleach skills (ids of the Bleach combat type).
    drills: {
        zanjutsu: { id: 'zanjutsu', label: 'Sword Practice', prof: 'zanjutsu', rounds: 6, wobble: 0.25, speed: 1.05, ring: 0.95, blurb: 'Strike the swinging post when it is inside the ring.', sound: 'sword_slash', terms: { mark: 'practice post', action: 'Strike', place: 'the dojo' } },
        kido: { id: 'kido', label: 'Kidō Practice', prof: 'kido', rounds: 6, wobble: 0, speed: 1, ring: 1, blurb: 'Hold the incantation, then release when the mark is inside the ring.', sound: 'magic_cast', terms: { mark: 'target', action: 'Release', place: 'the training grounds' } },
        hoho: { id: 'hoho', label: 'Flash Step Drill', prof: 'hoho', rounds: 8, wobble: 0.6, speed: 1.2, ring: 0.85, blurb: 'The marker darts and slows. Step when it is inside the ring.', sound: 'flash_step', terms: { mark: 'marker', action: 'Step', place: 'the training grounds' } },
    },
    crafts: { sewing: BL_SEWING, gadgetry: BL_GADGETRY },
    potion: { recipe: 'Soul Remedy', failed: 'Bitter Draught', names: {}, profs: [] },
    harvest: {
        recipes: [
            { id: 'misosoup', name: 'Miso Soup', needs: [], desc: 'Warm, salty and always possible.', restore: 16 },
            { id: 'onigiri', name: 'Onigiri', needs: [], desc: 'Pressed rice with a pickled plum.', restore: 14 },
            { id: 'tamagoyaki', name: 'Tamagoyaki', needs: [], desc: 'A rolled sweet omelette.', restore: 12 },
            { id: 'shioyaki', name: 'Grilled Fish', needs: [{ label: 'a fish', any: BL_FISH, qty: 1 }], desc: 'Salted and grilled over coals.', restore: 28 },
            { id: 'nabe', name: 'Fish Hotpot', needs: [{ label: 'a fish', any: BL_FISH, qty: 1 }, { label: 'a vegetable', any: BL_VEG, qty: 1 }], desc: 'A bubbling pot for sharing.', restore: 38 },
            { id: 'tempura', name: 'Vegetable Tempura', needs: [{ label: '2 vegetables', any: BL_VEG, qty: 2 }], desc: 'Light and crisp.', restore: 22 },
            { id: 'nimono', name: 'Simmered Vegetables', needs: [{ label: '2 vegetables', any: BL_VEG, qty: 2 }], desc: 'Slowly simmered in dashi.', restore: 20 },
            { id: 'fruitdango', name: 'Fruit Dango', needs: [{ label: '2 fruits', any: BL_FRUIT, qty: 2 }], desc: 'Sweet rice dumplings on a stick.', restore: 14 },
        ],
        fish: [
            { name: 'Dojo Loach', weight: 34, difficulty: 1, size: 1 },
            { name: 'Crucian Carp', weight: 28, difficulty: 1, size: 2 },
            { name: 'Ayu', weight: 20, difficulty: 2, size: 2 },
            { name: 'Rainbow Trout', weight: 10, difficulty: 2, size: 3 },
            { name: 'Koi', weight: 6, difficulty: 3, size: 5 },
            { name: 'Unagi', weight: 2, difficulty: 3, size: 6 },
        ],
        seeds: [
            { name: 'Wild Herb Seeds', produce: 'Wild Herbs', needs: 1, yield: 2, kind: 'plant', free: true },
            { name: 'Daikon Seeds', produce: 'Daikon', needs: 2, yield: 2, kind: 'food' },
            { name: 'Green Onion Seeds', produce: 'Green Onion', needs: 2, yield: 2, kind: 'food' },
            { name: 'Eggplant Seeds', produce: 'Eggplant', needs: 3, yield: 2, kind: 'food' },
            { name: 'Edamame Seeds', produce: 'Edamame', needs: 2, yield: 3, kind: 'food' },
            { name: 'Sweet Potato Seeds', produce: 'Sweet Potato', needs: 3, yield: 2, kind: 'food' },
            { name: 'Persimmon Seeds', produce: 'Persimmon', needs: 3, yield: 2, kind: 'food' },
            { name: 'Chrysanthemum Seeds', produce: 'Chrysanthemum', needs: 2, yield: 1, kind: 'plant' },
            { name: 'Cherry Blossom Seeds', produce: 'Cherry Blossom', needs: 3, yield: 1, kind: 'plant' },
        ],
    },
    tea: {
        category: 'Tea', music: 'activity_tea_music',
        snacks: ['Dango', 'Mochi', 'Taiyaki', 'Senbei', 'Daifuku', 'Anmitsu', 'Castella', 'Sweet Bean Bun', 'Onigiri', 'Matcha Cake'],
        fallback: ['Sencha', 'Genmaicha', 'Hojicha', 'Mugicha', 'Sobacha', 'Matcha'],
    },
    classChange: { mode: 'both', studyKnowledge: 100, rankGate: null },
    // The credentials the promotion trial hands out, by where the next grade sits on the E to SS ladder.
    exam: { tiers: ['Academy', 'Officer', 'Lieutenant', 'Captain'] },
    terms: {
        examiner: 'Captain', examinerPlural: 'Captains', examinerRule: 'partner',
        exam: 'Promotion trial', examVerb: 'Begin the trial', passed: 'Promoted',
        credential: 'Writ', credentialPlural: 'Writs',
        credentialTiers: ['Academy', 'Officer', 'Lieutenant', 'Captain'],
        classWord: 'Rank', changeClass: 'Change rank', knowledge: 'Spiritual insight', studyPlace: 'the academy library',
        tile: 'kanji', cursedTile: 'hollow mark', gardenPlace: 'the garden', fishingPlace: 'the river',
        tea: 'tea', guest: 'guest',
    },
});

/** Every built-in preset by id. presetFor() repairs each one, so nothing here needs to be perfect. */
export const BUILT_IN_PRESETS = Object.freeze({
    [FIRE_EMBLEM_PRESET.id]: FIRE_EMBLEM_PRESET,
    [BLEACH_PRESET.id]: BLEACH_PRESET,
});
