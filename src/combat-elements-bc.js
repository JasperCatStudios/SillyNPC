/**
 * Black Clover: the Elemental Interaction Wheel, Grades and Stages (fork). Pure data, no imports.
 *
 * Read by the generic elemental hook (combat-elements.js) through type.elements. The wheel is the
 * world's own notes with their gaps closed; the notes say which relation came from
 * the notes and which was added, and why. In short:
 *
 *   - an advantage is +2 on the roll, "like one grade higher" (a grade is +2 on this world's ladder)
 *   - the side holding the beating element gets it, attacking or defending
 *   - only spells clash (the magic channel); a punch or a sword cut is not elemental
 *   - unique magics are neutral until the GM declares a relation; the one declared here is the
 *     notes' own example, Anti-Magic, which wards off every spell whatever its element
 *
 * Canon magic names that are not families of their own are aliases ("Sand Magic" reads as Earth),
 * so a sheet's Magic_Affinity can be written the way the sheet writes it.
 */

const e = (id, label, group, aliases, option) => ({ id, label, group, option: option || `${label} Magic`, aliases });

export const BC_ELEMENT_LIST = Object.freeze([
    // Core elements (the notes).
    e('fire', 'Fire', 'core', ['flame', 'lava', 'magma', 'ash', 'explosion', 'blaze', 'heat']),
    e('water', 'Water', 'core', ['mist', 'bubble', 'sea', 'rain', 'mercury', 'slime', 'liquid']),
    e('plant', 'Plant', 'core', ['wood', 'thorn', 'briar', 'rose', 'flower', 'tree', 'vine', 'fungus', 'spore', 'leaf']),
    e('lightning', 'Lightning', 'core', ['thunder', 'electric', 'electricity', 'magnetism', 'magnet']),
    e('earth', 'Earth', 'core', ['stone', 'rock', 'sand', 'mud', 'clay', 'glass', 'crystal', 'steel', 'iron', 'metal']),
    e('ice', 'Ice', 'core', ['snow', 'frost', 'cold']),
    e('wind', 'Wind', 'core', ['air', 'gale', 'cloud', 'storm', 'feather', 'sound']),
    // Special elements (the notes).
    e('light', 'Light', 'special', ['star', 'sun', 'holy', 'radiance']),
    e('dark', 'Darkness', 'special', ['dark', 'shadow', 'curse', 'night'], 'Dark Magic'),
    e('illusion', 'Psychic/Illusion', 'special', ['psychic', 'illusion', 'mirror', 'dream', 'mind', 'mirage', 'phantom'], 'Illusion Magic'),
    // Unique magics, GM-ruled (Blood, Spatial, Time and Anti-Magic are the notes'; the rest are added).
    e('blood', 'Blood', 'unique', []),
    e('spatial', 'Spatial', 'unique', ['space', 'portal', 'dimension']),
    e('time', 'Time', 'unique', ['chrono']),
    e('anti_magic', 'Anti-Magic', 'unique', ['antimagic', 'anti'], 'Anti-Magic'),
    e('gravity', 'Gravity', 'unique', []),
    e('healing', 'Healing', 'unique', ['recovery', 'restoration']),
    e('sealing', 'Sealing', 'unique', ['seal']),
    e('other', 'Other (GM-ruled)', 'unique', ['ink', 'paper', 'thread', 'string', 'copy', 'poison', 'soul', 'spirit', 'beast', 'compound', 'trap', 'word', 'bone', 'creation', 'unique', 'gm'], 'Other (GM-ruled)'),
]);

/**
 * Who beats whom. Every core element ends with as many strengths as weaknesses.
 * Marked: [n] from the notes, [n*] in the notes on one side only, [+] added to close a gap.
 */
const BEATS = {
    fire: ['plant', 'ice'], //                       [n] [n]
    water: ['fire', 'earth'], //                     [n] [n]
    plant: ['water', 'earth', 'lightning'], //       [n] [n] [+]  wood grounds a bolt
    lightning: ['water', 'wind'], //                 [n] [n]
    earth: ['lightning', 'ice', 'fire'], //          [n] [n] [n*] Fire lists Earth as a weakness
    ice: ['plant', 'wind'], //                       [n] [n]      the notes also had Wind over Ice; Ice wins (see design)
    wind: ['plant', 'earth'], //                     [n*] [+]     wind erodes stone
    light: ['dark'], //                              [n]
    dark: ['illusion'], //                           [n] (GM discretion in the notes)
    illusion: ['light'], //                          [n] (the notes' Light line says "weak vs none")
};

export const BC_ELEMENTS = Object.freeze({
    meta: 'affinity',
    bonus: 2,
    channels: ['magic'],
    label: 'Elemental Interaction Wheel',
    list: BC_ELEMENT_LIST,
    beats: BEATS,
    // The notes' own ruling: Anti-Magic cancels spells regardless of type. Defending only.
    wards: { anti_magic: ['*'] },
});

/** The Magic Affinity choices, as a sheet writes them ("Wind Magic", "Anti-Magic"). */
export const BC_AFFINITY_OPTIONS = Object.freeze(BC_ELEMENT_LIST.map(x => x.option));

/** Grade E to S, lowest first. */
export const BC_GRADES = Object.freeze(['E', 'D', 'C', 'B', 'A', 'S']);

/**
 * The Stage Classification (9 lowest, 0 apex) as level bands: ten levels a stage. Each grade
 * spans the stages it usually stands for. Arcane and Saint Stage sit outside the ladder and are
 * the GM's call, as in the lore.
 */
export const BC_GRADE_STAGES = Object.freeze({
    E: Object.freeze([9, 8]), D: Object.freeze([7, 6]), C: Object.freeze([5, 4]),
    B: Object.freeze([3, 2]), A: Object.freeze([1]), S: Object.freeze([0]),
});

/** The stage a level stands for: 1-10 Stage 9, 11-20 Stage 8 ... 91-100 Stage 0. */
export function bcStageOf(level) {
    const n = Math.max(1, Math.min(100, Math.round(Number(level) || 1)));
    return 9 - Math.floor((n - 1) / 10);
}

/** The grade a stage usually goes with. */
export function bcGradeOfStage(stage) {
    for (const [grade, stages] of Object.entries(BC_GRADE_STAGES)) if (stages.includes(Number(stage))) return grade;
    return '';
}
