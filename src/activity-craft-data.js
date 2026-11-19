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
        { id: 'spring-water', name: 'Spring Water', match: ['spring water', 'water'], category: 'Liquid', props: { potency: 1, purity: 9, volatility: 0 }, tags: ['water', 'liquid'], tier: 1, starter: true, shape: '■', letter: 'W', color: '#4fa3d1' },
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

export const GENERIC_SMITHING = Object.freeze({
    id: 'smithing',
    label: 'Smithing',
    icon: 'fa-hammer',
    prof: 'smithing',
    music: 'activity_craft_smithing_music',
    materialWeight: 0.3,
    properties: [
        { id: 'mass', label: 'Mass', mix: 'sum', max: 20, icon: 'fa-weight-hanging' },
        { id: 'hardness', label: 'Hardness', mix: 'avg', max: 10, icon: 'fa-gem' },
        { id: 'brittleness', label: 'Brittleness', mix: 'max', max: 10, icon: 'fa-burst' },
    ],
    materials: [
        { id: 'iron-ingot', name: 'Iron Ingot', match: ['iron ingot', 'iron'], category: 'Metal', props: { mass: 5, hardness: 5, brittleness: 3 }, tags: ['metal'], tier: 1, shape: '■', letter: 'I', color: '#9e9e9e' },
        { id: 'copper-ingot', name: 'Copper Ingot', match: ['copper ingot', 'copper'], category: 'Metal', props: { mass: 4, hardness: 3, brittleness: 1 }, tags: ['metal'], tier: 1, shape: '●', letter: 'C', color: '#cc7a3a' },
        { id: 'steel-ingot', name: 'Steel Ingot', match: ['steel ingot', 'steel'], category: 'Metal', props: { mass: 5, hardness: 8, brittleness: 4 }, tags: ['metal'], tier: 2, shape: '◆', letter: 'S', color: '#6f8fb0' },
        { id: 'silver-ingot', name: 'Silver Ingot', match: ['silver ingot', 'silver'], category: 'Metal', props: { mass: 4, hardness: 4, brittleness: 2 }, tags: ['metal', 'fine'], tier: 3, shape: '★', letter: 'V', color: '#d9e1ea' },
        { id: 'oak-handle', name: 'Oak Handle', match: ['oak handle', 'handle'], category: 'Part', props: { mass: 2, hardness: 3, brittleness: 0 }, tags: ['handle'], tier: 1, shape: '▲', letter: 'H', color: '#8b5a2b' },
        { id: 'leather-grip', name: 'Leather Grip', match: ['leather grip', 'leather'], category: 'Part', props: { mass: 1, hardness: 2, brittleness: 0 }, tags: ['handle', 'binding'], tier: 1, shape: '♣', letter: 'L', color: '#a0522d' },
    ],
    effects: [
        { prop: 'brittleness', stage: 'work', param: 'drift', per: 0.1, from: 3, label: 'A brittle metal: the heat will wander.' },
        { prop: 'mass', stage: 'work', param: 'progress', per: 0.05, from: 7, label: 'A heavy piece: more strikes to shape it.' },
        { prop: 'hardness', stage: 'finish', param: 'zone', per: -0.03, from: 5, label: 'A hard metal: the quench is trickier.' },
    ],
    stages: [{ stage: 'prep', weight: 1 }, { stage: 'work', weight: 4 }, { stage: 'finish', weight: 1 }],
    terms: { worked: 'the metal', craftVerb: 'Forge', workplace: 'the forge', prep: 'Shape', finish: 'Quench' },
    recipes: [
        {
            id: 'iron-dagger', name: 'Iron Dagger', level: 1, desc: 'A short blade. One metal and a grip.',
            slots: [{ id: 'metal', label: 'a metal', tags: ['metal'] }, { id: 'grip', label: 'a handle', tags: ['handle'] }],
            targets: { mass: { min: 5, ideal: [6, 9], max: 12 }, brittleness: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Iron Dagger', note: 'finely made', qty: 1 }, good: { name: 'Iron Dagger', note: 'well made' }, fair: { name: 'Iron Dagger', note: 'rough' }, poor: { name: 'Iron Dagger', note: 'barely holds an edge' }, failed: { name: 'Scrap Iron', note: 'ruined in the forge' } },
        },
        {
            id: 'horseshoe', name: 'Horseshoe', level: 1, desc: 'Plain and useful. Any metal will do.',
            slots: [{ id: 'metal', label: 'a metal', tags: ['metal'] }],
            targets: { mass: { min: 3, ideal: [4, 7], max: 10 }, brittleness: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Horseshoe', note: 'finely made', qty: 2 }, good: { name: 'Horseshoe', note: 'well made' }, fair: { name: 'Horseshoe', note: 'uneven' }, failed: { name: 'Scrap Iron', note: 'ruined in the forge' } },
        },
        {
            id: 'iron-sword', name: 'Iron Sword', level: 2, desc: 'A proper blade. Two lengths of metal and a handle.',
            slots: [{ id: 'metal', label: 'a metal', tags: ['metal'] }, { id: 'metal2', label: 'more metal', tags: ['metal'] }, { id: 'grip', label: 'a handle', tags: ['handle'] }],
            targets: { mass: { min: 9, ideal: [11, 15], max: 19 }, hardness: { min: 3, ideal: [4, 7], max: 10 }, brittleness: { ideal: [0, 4], max: 6 } },
            outputs: { perfect: { name: 'Iron Sword', note: 'finely made', qty: 1 }, good: { name: 'Iron Sword', note: 'well made' }, fair: { name: 'Iron Sword', note: 'rough' }, poor: { name: 'Iron Sword', note: 'chipped' }, failed: { name: 'Scrap Iron', note: 'ruined in the forge' } },
        },
        {
            id: 'steel-sword', name: 'Steel Sword', level: 3, desc: 'Hard and keen. It needs hard metal and a steady hand.',
            slots: [{ id: 'metal', label: 'a hard metal', tags: ['metal'] }, { id: 'metal2', label: 'more metal', tags: ['metal'] }, { id: 'grip', label: 'a handle', tags: ['handle'] }],
            targets: { mass: { min: 10, ideal: [12, 16], max: 20 }, hardness: { min: 5, ideal: [6, 9], max: 10 }, brittleness: { ideal: [0, 5], max: 7 } },
            outputs: { perfect: { name: 'Steel Sword', note: 'finely made', qty: 1 }, good: { name: 'Steel Sword', note: 'well made' }, fair: { name: 'Steel Sword', note: 'rough' }, failed: { name: 'Scrap Iron', note: 'ruined in the forge' } },
        },
    ],
});

/** Every built-in craft by id. */
export const GENERIC_CRAFTS = Object.freeze({ [GENERIC_ALCHEMY.id]: GENERIC_ALCHEMY, [GENERIC_SMITHING.id]: GENERIC_SMITHING });
