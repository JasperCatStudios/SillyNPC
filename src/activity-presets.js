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
        { id: 'alchemy', label: 'Spirit Medicine', kind: 'craft', craft: 'alchemy', tab: 'crafting', icon: 'fa-flask', blurb: 'Choose herbs and water, grind, simmer and seal a remedy.', solo: true },
        { id: 'smithing', label: 'Zanpakutō Forging', kind: 'craft', craft: 'smithing', tab: 'crafting', icon: 'fa-hammer', blurb: 'Choose metal and a hilt, heat the work and strike it on the beat.', solo: true },
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
