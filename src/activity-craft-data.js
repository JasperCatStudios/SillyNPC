/**
 * The built-in crafts (fork): a neutral alchemy craft that works in any world, written as data in the craft format
 * (see src/craft/craft-core.js). A world preset can bring its own crafts (its own materials, recipes, words, art and sounds), and
 * the Customize screen can rename things; nothing here is specific to a game. Plain fantasy names.
 *
 * Pure data; no imports.
 */

export const GENERIC_ALCHEMY = Object.freeze({
    id: 'alchemy',
    label: 'Alchemy',
    icon: 'fa-flask',
    prof: 'alchemy',
    music: 'activity_craft_alchemy_music',
    materialWeight: 0.3,
    properties: [
        { id: 'potency', label: 'Potency', mix: 'sum', max: 24, icon: 'fa-bolt' },
        { id: 'purity', label: 'Purity', mix: 'avg', max: 10, icon: 'fa-droplet' },
        { id: 'volatility', label: 'Volatility', mix: 'max', max: 10, icon: 'fa-fire' },
    ],
    materials: [
        { id: 'meadow-herb', name: 'Meadow Herb', match: ['meadow herb', 'herb', 'herbs'], category: 'Herb', props: { potency: 5, purity: 6, volatility: 2 }, tags: ['herb'], tier: 1, shape: '♣', letter: 'M', color: '#6aa84f' },
        { id: 'silver-moss', name: 'Silver Moss', match: ['silver moss', 'moss'], category: 'Herb', props: { potency: 4, purity: 7, volatility: 1 }, tags: ['herb'], tier: 1, shape: '◆', letter: 'S', color: '#9fb4c7' },
        { id: 'moon-blossom', name: 'Moon Blossom', match: ['moon blossom', 'blossom'], category: 'Herb', props: { potency: 7, purity: 8, volatility: 2 }, tags: ['herb'], tier: 3, shape: '★', letter: 'B', color: '#b4a7d6' },
        { id: 'fire-pepper', name: 'Fire Pepper', match: ['fire pepper', 'pepper'], category: 'Herb', props: { potency: 6, purity: 3, volatility: 6 }, tags: ['herb', 'spice'], tier: 2, shape: '▲', letter: 'F', color: '#e06666' },
        { id: 'night-berry', name: 'Night Berry', match: ['night berry', 'berry'], category: 'Herb', props: { potency: 8, purity: 3, volatility: 7 }, tags: ['herb'], tier: 2, shape: '●', letter: 'N', color: '#674ea7' },
        { id: 'spring-water', name: 'Spring Water', match: ['spring water', 'water'], category: 'Liquid', props: { potency: 1, purity: 9, volatility: 0 }, tags: ['water', 'liquid'], tier: 1, shape: '■', letter: 'W', color: '#4fa3d1' },
        { id: 'rain-water', name: 'Rain Water', match: ['rain water'], category: 'Liquid', props: { potency: 2, purity: 7, volatility: 1 }, tags: ['water', 'liquid'], tier: 1, shape: '⬟', letter: 'R', color: '#76a5af' },
        { id: 'honey', name: 'Honey', match: ['honey'], category: 'Liquid', props: { potency: 2, purity: 8, volatility: 0 }, tags: ['liquid', 'sweet'], tier: 2, shape: '♥', letter: 'H', color: '#f1c232' },
    ],
    effects: [
        { prop: 'volatility', stage: 'tend', param: 'drift', per: 0.1, from: 3, label: 'A volatile mix: the heat will wander.' },
        { prop: 'purity', stage: 'finish', param: 'zone', per: 0.05, from: 5, label: 'A pure mix: the finishing tap is easier.' },
        { prop: 'potency', stage: 'tend', param: 'progress', per: 0.04, from: 8, label: 'A strong mix: it takes longer to tend.' },
    ],
    stages: [{ stage: 'prep', weight: 1 }, { stage: 'tend', weight: 3 }, { stage: 'finish', weight: 1 }],
    terms: { tended: 'the simmer', craftVerb: 'Brew', workplace: 'the workshop', prep: 'Grind', finish: 'Seal' },
    recipes: [
        {
            id: 'healing-draught', name: 'Healing Draught', level: 1, desc: 'Closes small wounds. Any herb and some water.',
            slots: [{ id: 'base', label: 'a herb', tags: ['herb'] }, { id: 'liquid', label: 'a liquid', tags: ['water'] }, { id: 'extra', label: 'anything extra', optional: true }],
            targets: { potency: { min: 4, ideal: [6, 10], max: 14 }, volatility: { ideal: [0, 3], max: 5 } },
            outputs: { perfect: { name: 'Healing Draught', note: 'excellent quality', qty: 2 }, good: { name: 'Healing Draught', note: 'good quality' }, fair: { name: 'Healing Draught', note: 'weak' }, poor: { name: 'Healing Draught', note: 'barely holds together' }, failed: { name: 'Murky Brew', note: 'a failed brew' } },
        },
        {
            id: 'soothing-tonic', name: 'Soothing Tonic', level: 1, desc: 'Calms the nerves. Needs a pure mix.',
            slots: [{ id: 'base', label: 'a herb', tags: ['herb'] }, { id: 'liquid', label: 'a sweet liquid', tags: ['liquid'] }],
            targets: { purity: { min: 5, ideal: [7, 10], max: 10 }, volatility: { ideal: [0, 3], max: 5 } },
            outputs: { perfect: { name: 'Soothing Tonic', note: 'excellent quality', qty: 2 }, good: { name: 'Soothing Tonic', note: 'good quality' }, fair: { name: 'Soothing Tonic', note: 'a little weak' }, failed: { name: 'Murky Brew', note: 'a failed brew' } },
        },
        {
            id: 'antidote', name: 'Antidote', level: 2, desc: 'Clears most poisons. Strong and pure.',
            slots: [{ id: 'base', label: 'a herb', tags: ['herb'] }, { id: 'liquid', label: 'a liquid', tags: ['water'] }, { id: 'extra', label: 'a second herb', tags: ['herb'], optional: true }],
            targets: { potency: { min: 7, ideal: [9, 13], max: 17 }, purity: { min: 5, ideal: [6, 10], max: 10 }, volatility: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Antidote', note: 'excellent quality', qty: 2 }, good: { name: 'Antidote', note: 'good quality' }, fair: { name: 'Antidote', note: 'weak' }, failed: { name: 'Murky Brew', note: 'a failed brew' } },
        },
        {
            id: 'stamina-tonic', name: 'Stamina Tonic', level: 3, desc: 'A fiery tonic. Strong, and it bites back.',
            slots: [{ id: 'base', label: 'a herb', tags: ['herb'] }, { id: 'spice', label: 'something fiery', tags: ['spice'] }, { id: 'liquid', label: 'a liquid', tags: ['liquid'] }],
            targets: { potency: { min: 9, ideal: [11, 16], max: 20 }, volatility: { ideal: [3, 7], max: 9 } },
            outputs: { perfect: { name: 'Stamina Tonic', note: 'excellent quality', qty: 2 }, good: { name: 'Stamina Tonic', note: 'good quality' }, fair: { name: 'Stamina Tonic', note: 'rough' }, failed: { name: 'Murky Brew', note: 'a failed brew' } },
        },
    ],
});

/** Every built-in craft by id. */
export const GENERIC_CRAFTS = Object.freeze({ [GENERIC_ALCHEMY.id]: GENERIC_ALCHEMY });
