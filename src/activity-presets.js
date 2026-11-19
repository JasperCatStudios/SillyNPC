/**
 * The built-in world presets for Activities (fork). A preset tells the module how to behave in a world: which activities
 * exist, what they and their roles are called (terms), the Study subjects, the brewing recipe, and the tea music.
 * Written in plain fantasy words: no character names, nothing copyrighted beyond the common names of the setting's own items
 * and classes. The module picks the preset whose `world` is the active combat type (see presetFor in
 * activity-config-core.js), unless the user picked one. The Generic preset is the default when none matches.
 *
 * Pure data: no DOM, no SillyTavern imports.
 */

/** Fire Emblem: Three Houses style. The world is the built-in combat type 'fe'. */
export const FIRE_EMBLEM_PRESET = Object.freeze({
    format: 'worldkit-activities',
    version: 1,
    id: 'fire-emblem',
    name: 'Fire Emblem',
    world: 'fe',
    // The owner's private sound folder in the Fire Emblem profile (music and the activity effects). A missing file is silent.
    soundMap: '/user/files/fe-sounds/map.json',
    activities: [
        { id: 'study', label: 'Study', kind: 'memory', tab: 'study', icon: 'fa-book-open', blurb: 'Match the runes in the library. What you learn counts toward a class change.', solo: true },
        { id: 'potion', label: 'Brewing', kind: 'mastermind', off: true, tab: 'study', icon: 'fa-flask', blurb: 'Work out the recipe from the clues and brew a tonic.', solo: true },
        { id: 'tea', label: 'Tea Time', kind: 'tea', tab: 'leisure', icon: 'fa-mug-hot', blurb: 'Share a cup in the garden and see how the talk goes.' },
        { id: 'alchemy', label: 'Alchemy', kind: 'craft', craft: 'alchemy', tab: 'crafting', icon: 'fa-flask', blurb: 'Choose herbs and water, grind, simmer and seal a tonic.', solo: true },
        { id: 'cook', label: 'Cooking', kind: 'harvest', tab: 'crafting', icon: 'fa-utensils', blurb: 'Time three steps and cook a dish in the kitchen.', solo: true },
        { id: 'fish', label: 'Fishing', kind: 'harvest', tab: 'leisure', icon: 'fa-fish', blurb: 'Wait for a bite at the pond, hook it and reel it in.', solo: true },
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
    // The teas come from the item database (the Fire Emblem item pack) and from the cast's tastes.
    tea: { category: 'Tea', music: 'activity_tea_music' },
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

/** Every built-in preset by id. presetFor() repairs each one, so nothing here needs to be perfect. */
export const BUILT_IN_PRESETS = Object.freeze({
    [FIRE_EMBLEM_PRESET.id]: FIRE_EMBLEM_PRESET,
});
