import { slug, POOL_KEYS, ROLE_KEYS, COVERED_EXTRA_KEYS } from '../../src/combat-type-draft.js';
import { ABILITY_KINDS, ABILITY_TRIGGERS } from '../../src/combat-abilities.js';
import { TOOL_EFFECTS } from '../../src/combat-gear-defaults.js';
import { GENERIC_DUAL, GENERIC_FLEE, GENERIC_TEAMS } from '../../src/combat-gear-defaults.js';
import { recordList, fieldGroup, setPath, getPath } from './type-editor-lists.js';

/**
 * The sections of the world type editor that replace the old box of JSON (fork). Each is a form over one part of
 * `draft.extra`: sheet fields, ranks, proficiencies, moves, advantage rules, abilities, weapons, tiers, tools,
 * elements, the roll extras, skill cards. Anything else a pasted file carries stays in the small "Other data" box.
 */

export { COVERED_EXTRA_KEYS as COVERED_KEYS };

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function section(title, intro) {
    const box = el('div', 'sillynpc-te-section');
    box.append(el('h4', 'sillynpc-combat-heading', title));
    if (intro) box.append(el('p', 'notes', intro));
    return box;
}

const RESULTS = ['miss', 'stalemate', 'hit', 'strong', 'crit'];

/**
 * @param {object} draft the editor's draft (draft.extra and draft.art are edited in place)
 * @param {() => void} touch called after every change
 * @returns {HTMLElement[]}
 */
export function buildDataSections(draft, touch) {
    draft.extra = draft.extra && typeof draft.extra === 'object' ? draft.extra : {};
    const X = draft.extra;
    draft.art = draft.art || {};
    for (const key of ['kinds', 'profs', 'abilities', 'factions']) draft.art[key] = draft.art[key] || {};
    const art = draft.art;

    // Lists and maps that appear in the type only once something is added.
    const peek = (key) => () => (Array.isArray(X[key]) ? X[key] : []);
    const make = (key) => () => (Array.isArray(X[key]) ? X[key] : (X[key] = []));
    const objectAt = (path) => ({
        get: () => getPath(X, path),
        set: (value) => setPath(X, path, value && Object.keys(value).length ? value : undefined),
    });

    // Choices that depend on other parts of the draft.
    const channelOptions = () => draft.channels.filter(c => c.label).map(c => ({ value: c.id || slug(c.label), label: c.label }));
    const ladderOptions = () => Object.keys(X.ladders || {});
    const profOptions = () => (Array.isArray(X.proficiencies) ? X.proficiencies : []).filter(p => p.id).map(p => ({ value: p.id, label: p.label || p.id }));
    const kindOptions = () => (Array.isArray(X.gear?.kinds) ? X.gear.kinds : []).filter(k => k.id).map(k => ({ value: k.id, label: k.label || k.id }));
    const gearLadderOptions = () => Object.keys(X.gear?.ladders || {});
    const poolOptions = () => POOL_KEYS;
    const roleOptions = () => ROLE_KEYS;
    const uniqueKey = (base) => (taken) => { let id = base; for (let i = 2; taken.has(id); i++) id = `${base}_${i}`; return id; };

    const sections = [];

    /* ---- sheet fields ---- */
    const meta = section('8. Sheet fields',
        'Extra fields on a character\'s sheet besides the stats, such as a class or a level. A choice field offers a list; a number field has limits.');
    meta.append(recordList({
        list: make('meta'), peek: peek('meta'), onChange: touch, idFromLabel: true, addLabel: 'Add a sheet field',
        empty: 'No extra sheet fields.',
        name: (r) => r.label || r.id,
        make: () => ({ id: '', label: '', type: 'number', min: 0, max: 100, default: 0 }),
        fields: [
            { key: 'label', label: 'Name', placeholder: 'e.g. Class' },
            { key: 'id', label: 'Id', placeholder: 'made from the name', help: 'Characters keep their value under this id.' },
            { key: 'type', label: 'Kind', type: 'select', options: ['choice', 'number'] },
            { key: 'options', label: 'Choices', type: 'csv', placeholder: 'Mage, Knight, Rogue', help: 'For a choice field: the list it offers.' },
            { key: 'min', label: 'Lowest', type: 'number' },
            { key: 'max', label: 'Highest', type: 'number' },
            {
                key: 'default', label: 'Starts at', placeholder: 'a number, or one of the choices',
                set: (rec, v) => { if (v === undefined) delete rec.default; else rec.default = rec.type === 'number' && Number.isFinite(Number(v)) ? Number(v) : v; },
            },
            { key: 'aliases', label: 'Also called', type: 'csv', help: 'Other names a sheet may use for it.' },
        ],
    }));
    sections.push(meta);

    /* ---- ranks and proficiencies ---- */
    const prof = section('9. Ranks and proficiencies',
        'A proficiency is a skill a character can be trained in (Swordplay, Archery, Spellcraft). Its value is a rank on a ladder you define: for example E, D, C, B, A, S. '
        + 'The rank gives a bonus to the roll.');
    prof.append(recordList({
        title: 'Rank ladders', help: 'A ladder lists its ranks from lowest to highest. The "zero" rank is the one that gives no bonus; each step above or below it adds or takes away the bonus per step.',
        map: { ...objectAt('ladders') }, onChange: touch, addLabel: 'Add a ladder', empty: 'No ladders yet. A proficiency needs one.',
        name: (r) => `${r.id}${Array.isArray(r.rungs) ? ` (${r.rungs.join(' ')})` : ''}`,
        make: (taken) => ({ id: uniqueKey('rank')(taken), rungs: ['E', 'D', 'C', 'B', 'A', 'S'], zeroAt: 'E', bonusPerRung: 1 }),
        fields: [
            { key: 'id', label: 'Name of the ladder', placeholder: 'rank' },
            { key: 'rungs', label: 'Ranks, lowest first', type: 'csv', placeholder: 'E, D, C, B, A, S' },
            { key: 'zeroAt', label: 'Rank that gives no bonus', type: 'select', options: (rec) => (Array.isArray(rec.rungs) ? rec.rungs : []) },
            { key: 'bonusPerRung', label: 'Bonus per rank step', type: 'number', step: 0.5 },
        ],
    }));
    prof.append(recordList({
        title: 'Proficiencies',
        list: make('proficiencies'), peek: peek('proficiencies'), onChange: touch, idFromLabel: true, addLabel: 'Add a proficiency',
        empty: 'No proficiencies yet.',
        name: (r) => r.label || r.id,
        make: () => ({ id: '', label: '', ladder: ladderOptions()[0] || '', roles: ['weapon'], channel: channelOptions()[0]?.value || '' }),
        icon: { table: art.profs, label: 'Icon' },
        fields: [
            { key: 'label', label: 'Proficiency name', placeholder: 'e.g. Sword' },
            { key: 'id', label: 'Id', placeholder: 'made from the name' },
            { key: 'ladder', label: 'Proficiency value (rank ladder)', type: 'select', options: ladderOptions, help: 'Which ladder its rank is measured on.' },
            { key: 'channel', label: 'Damage channel', type: 'select', options: channelOptions },
            { key: 'roles', label: 'Used for', type: 'csv', placeholder: 'weapon, magic, heal, support, passive, movement, defense' },
            { key: 'tags', label: 'Tags', type: 'csv', placeholder: 'melee, red', help: 'Words advantage rules can look for (a weapon triangle).' },
            { key: 'rollRole', label: 'Rolls with the role', type: 'select', options: roleOptions, help: 'Optional: use another stat role for this skill\'s roll.' },
            { key: 'grantsTag.tag', label: 'Grants the tag', placeholder: 'e.g. mounted' },
            { key: 'grantsTag.from', label: '...from this rank', placeholder: 'e.g. C' },
        ],
    }));
    sections.push(prof);

    /* ---- moves and rules ---- */
    const rules = section('10. Moves and advantage rules',
        'Moves are the plain attacks a fighter can pick. Advantage rules give a bonus when two things meet, such as a type advantage.');
    rules.append(recordList({
        title: 'Moves', list: make('actions'), peek: peek('actions'), onChange: touch, idKey: 'key', idFromLabel: true, addLabel: 'Add a move', empty: 'No moves yet.',
        name: (r) => r.label || r.key,
        make: () => ({ key: '', label: '', prof: '', power: 5 }),
        fields: [
            { key: 'label', label: 'Move name', placeholder: 'e.g. Iron Sword' },
            { key: 'key', label: 'Id', placeholder: 'made from the name' },
            { key: 'prof', label: 'Proficiency', type: 'select', options: profOptions },
            { key: 'power', label: 'Power', type: 'number', help: 'Added to the damage.' },
            { key: 'channel', label: 'Damage channel', type: 'select', options: channelOptions },
            { key: 'cost.pool', label: 'Costs from the pool', type: 'select', options: poolOptions },
            { key: 'cost.amount', label: 'Cost', type: 'number' },
        ],
    }));
    rules.append(recordList({
        title: 'Advantage rules', help: 'The condition reads tags: has(a,\'red\') && has(d,\'green\') means the attacker has the red tag and the defender the green one.',
        list: make('advantage'), peek: peek('advantage'), onChange: touch, addLabel: 'Add a rule', empty: 'No advantage rules.',
        name: (r) => r.label || r.if,
        make: () => ({ label: '', if: "has(a,'red') && has(d,'green')", hit: 2, dmgMult: 1.2 }),
        fields: [
            { key: 'label', label: 'Name', placeholder: 'e.g. Type advantage' },
            { key: 'if', label: 'When', placeholder: "has(a,'red') && has(d,'green')" },
            { key: 'hit', label: 'Bonus to hit', type: 'number' },
            { key: 'dmgMult', label: 'Damage multiplier', type: 'number', step: 0.05 },
        ],
    }));
    sections.push(rules);

    /* ---- abilities ---- */
    const abil = section('11. Abilities',
        'Named techniques a character can have equipped. A passive may fire by chance; an active one is chosen on a turn and costs something; a defensive one is aimed at yourself.');
    abil.append(recordList({
        list: make('abilities'), peek: peek('abilities'), onChange: touch, idFromLabel: true, addLabel: 'Add an ability', empty: 'No abilities yet.',
        name: (r) => `${r.label || r.id}${r.category ? ` - ${r.category}` : ''}`,
        make: () => ({ id: '', label: '', category: '', kind: 'passive', trigger: 'attack', chance: '10', effect: { dmgMult: 1.2 }, desc: '' }),
        icon: { table: art.abilities, label: 'Ability icon' },
        fields: [
            { key: 'label', label: 'Ability name', placeholder: 'e.g. Shikai Release' },
            { key: 'id', label: 'Id', placeholder: 'made from the name' },
            { key: 'category', label: 'Group', placeholder: 'e.g. Crests', help: 'Abilities are listed under their group.' },
            { key: 'kind', label: 'Kind', type: 'select', options: ABILITY_KINDS },
            { key: 'trigger', label: 'Fires when (passive)', type: 'select', options: ABILITY_TRIGGERS, help: 'attack: they strike. defend: they are struck. turnStart: their turn opens.' },
            { key: 'chance', label: 'Chance (passive)', placeholder: 'e.g. 10 + a.luck/5', help: 'A percent, or a formula over the owner\'s roles.' },
            { key: 'prof', label: 'Proficiency (active)', type: 'select', options: profOptions },
            { key: 'power', label: 'Power (active)', type: 'number' },
            { key: 'channel', label: 'Damage channel', type: 'select', options: channelOptions },
            { key: 'cost.pool', label: 'Costs from the pool', type: 'select', options: poolOptions },
            { key: 'cost.amount', label: 'Cost', type: 'number' },
            { key: 'effect.dmgMult', label: 'Damage multiplier', type: 'number', step: 0.05 },
            { key: 'effect.block', label: 'Share of a blow blocked (0 to 1)', type: 'number', step: 0.05 },
            { key: 'effect.heal', label: 'Share of health restored (0 to 1)', type: 'number', step: 0.01 },
            { key: 'effect.counter', label: 'Counter-strike', type: 'number', step: 0.05 },
            { key: 'effect.missingBonus', label: 'Grows as health is lost', type: 'number', step: 0.05 },
            { key: 'whenBelow', label: 'Only below this share of health (0 to 1)', type: 'number', step: 0.05 },
            { key: 'element', label: 'Element', placeholder: 'for a world with an element wheel' },
            { key: 'desc', label: 'Description', type: 'area' },
        ],
    }));
    sections.push(abil);

    /* ---- gear ---- */
    const gearBox = section('12. Weapons, tiers and tools',
        'What fighters carry: the kinds of weapon, the tiers (quality levels) a weapon can come in, tools used instead of an attack, and named weapons. Anything left empty uses the built-in defaults.');
    const G = () => (X.gear && typeof X.gear === 'object' ? X.gear : (X.gear = {}));
    const gpeek = (key) => () => (Array.isArray(X.gear?.[key]) ? X.gear[key] : []);
    const gmake = (key) => () => { const g = G(); return Array.isArray(g[key]) ? g[key] : (g[key] = []); };
    gearBox.append(recordList({
        title: 'Weapon kinds', list: gmake('kinds'), peek: gpeek('kinds'), onChange: touch, idFromLabel: true, addLabel: 'Add a weapon kind', empty: 'Uses the built-in kinds.',
        name: (r) => r.label || r.id,
        make: () => ({ id: '', label: '', slot: 'hand', hands: 1, dualable: false, range: 'melee', prof: '', channel: channelOptions()[0]?.value || '', power: 0, hit: 0, weight: 5, verb: 'strikes' }),
        icon: { table: art.kinds, label: 'Icon' },
        fields: [
            { key: 'label', label: 'Name', placeholder: 'e.g. Sword' },
            { key: 'id', label: 'Id', placeholder: 'made from the name' },
            { key: 'slot', label: 'Held in', type: 'select', options: ['hand', 'focus', 'natural'], help: 'hand: held. focus: a book or staff. natural: fists or claws.' },
            { key: 'hands', label: 'Hands it needs', type: 'number' },
            { key: 'dualable', label: 'Can be held in both hands as a pair', type: 'bool' },
            { key: 'range', label: 'Range', type: 'select', options: ['melee', 'ranged'] },
            { key: 'prof', label: 'Proficiency', type: 'select', options: profOptions },
            { key: 'channel', label: 'Damage channel', type: 'select', options: channelOptions },
            { key: 'ladder', label: 'Tier ladder', type: 'select', options: gearLadderOptions },
            { key: 'power', label: 'Power', type: 'number' },
            { key: 'hit', label: 'Bonus to hit', type: 'number' },
            { key: 'weight', label: 'Weight', type: 'number' },
            { key: 'verb', label: 'Verb in the log', placeholder: 'slashes' },
        ],
    }));
    gearBox.append(fieldGroup({
        title: 'Bare hands', help: 'The weapon kind used when nothing is held.',
        source: () => X.gear || {}, ensure: G, onChange: touch,
        fields: [{ key: 'unarmed', label: 'Kind used unarmed', type: 'select', options: kindOptions }],
    }));
    gearBox.append(recordList({
        title: 'Tier ladders', help: 'The quality levels of a weapon, lowest first: each tier adds power, hit and crit and multiplies damage.',
        map: { get: () => X.gear?.ladders, set: (v) => setPath(X, 'gear.ladders', v && Object.keys(v).length ? v : undefined) },
        onChange: touch, addLabel: 'Add a tier ladder', empty: 'Uses the built-in tier ladder.',
        name: (r) => `${r.label || r.id}${Array.isArray(r.tiers) ? ` (${r.tiers.length} tiers)` : ''}`,
        make: (taken) => ({ id: uniqueKey('tiers')(taken), label: 'Tier', defaultTier: '', tiers: [] }),
        fields: [
            { key: 'id', label: 'Id of the ladder', placeholder: 'e.g. default' },
            { key: 'label', label: 'Name', placeholder: 'e.g. Tier' },
            { key: 'defaultTier', label: 'Tier a plain weapon has', type: 'select', options: (rec) => (Array.isArray(rec.tiers) ? rec.tiers : []).map(t => ({ value: t.id, label: t.label || t.id })) },
        ],
        extra: (ladder, body, changed) => {
            if (!Array.isArray(ladder.tiers)) ladder.tiers = [];
            body.append(recordList({
                title: 'Tiers', list: () => ladder.tiers, peek: () => ladder.tiers, onChange: changed, idFromLabel: true, addLabel: 'Add a tier', empty: 'No tiers.',
                name: (r) => r.label || r.id,
                make: () => ({ id: '', label: '', prefix: '', color: '#9e9e9e', icon: 'fa-solid fa-circle', rarity: '', power: 0, hit: 0, crit: 0, mult: 1 }),
                fields: [
                    { key: 'label', label: 'Tier name' }, { key: 'id', label: 'Id' },
                    { key: 'prefix', label: 'Name given to a plain weapon', placeholder: 'e.g. Steel' },
                    { key: 'color', label: 'Colour', placeholder: '#9e9e9e' },
                    { key: 'icon', label: 'Built-in icon class', placeholder: 'fa-solid fa-circle' },
                    { key: 'rarity', label: 'Rarity word' },
                    { key: 'power', label: 'Power', type: 'number' }, { key: 'hit', label: 'Bonus to hit', type: 'number' },
                    { key: 'crit', label: 'Crit chance, %', type: 'number' }, { key: 'mult', label: 'Damage multiplier', type: 'number', step: 0.01 },
                    { key: 'signature', label: 'A signature tier (one of a kind)', type: 'bool' },
                ],
            }));
        },
    }));
    gearBox.append(recordList({
        title: 'Tools', help: 'Items used instead of an attack: a thrown knife, a smoke bomb, a healing salve.',
        list: gmake('tools'), peek: gpeek('tools'), onChange: touch, idFromLabel: true, addLabel: 'Add a tool', empty: 'Uses the built-in tools.',
        name: (r) => r.label || r.id,
        make: () => ({ id: '', label: '', uses: 1, verb: 'uses', effect: { type: 'damage', power: 3, area: 'one' } }),
        fields: [
            { key: 'label', label: 'Name', placeholder: 'e.g. Smoke bomb' }, { key: 'id', label: 'Id' },
            { key: 'uses', label: 'Uses', type: 'number' }, { key: 'verb', label: 'Verb in the log', placeholder: 'throws' },
            { key: 'effect.type', label: 'Does', type: 'select', options: TOOL_EFFECTS },
            { key: 'effect.area', label: 'Aimed at', type: 'select', options: ['one', 'side', 'all', 'self'] },
            { key: 'effect.power', label: 'Power', type: 'number' }, { key: 'effect.hit', label: 'Hit change', type: 'number' },
            { key: 'effect.turns', label: 'Lasts turns', type: 'number' }, { key: 'effect.share', label: 'Health share restored', type: 'number', step: 0.05 },
            { key: 'effect.flee', label: 'Helps fleeing, %', type: 'number' }, { key: 'effect.slow', label: 'Slows by', type: 'number' },
            { key: 'effect.chance', label: 'Chance, %', placeholder: 'a number or a formula' },
            { key: 'effect.range', label: 'Range', type: 'select', options: ['melee', 'ranged'] },
            { key: 'effect.fightOnly', label: 'Only inside a fight', type: 'bool' },
        ],
    }));
    gearBox.append(recordList({
        title: 'Named weapons', help: 'A catalogue of named weapons a character can be given (the Armoury lists these).',
        list: gmake('catalogue'), peek: gpeek('catalogue'), onChange: touch, idFromLabel: false, addLabel: 'Add a named weapon', empty: 'No named weapons.',
        name: (r) => r.name || r.id,
        make: () => ({ id: '', name: '', kind: kindOptions()[0]?.value || '', tier: '', desc: '' }),
        fields: [
            { key: 'name', label: 'Name' }, { key: 'id', label: 'Id', placeholder: 'e.g. my_iron_sword' },
            { key: 'kind', label: 'Kind', type: 'select', options: kindOptions },
            { key: 'tier', label: 'Tier', placeholder: 'a tier id from the ladder' },
            { key: 'desc', label: 'Description', type: 'area' },
            { key: 'bonus.power', label: 'Power bonus', type: 'number' }, { key: 'bonus.hit', label: 'Hit bonus', type: 'number' }, { key: 'bonus.crit', label: 'Crit bonus', type: 'number' },
        ],
    }));
    const numberFields = (defaults) => Object.keys(defaults).filter(k => typeof defaults[k] === 'number').map(k => ({ key: k, label: k, type: 'number', placeholder: String(defaults[k]) }));
    gearBox.append(fieldGroup({
        title: 'Two weapons at once', help: 'Placeholders show the built-in numbers; leave empty to use them.',
        source: () => X.gear?.dual || {}, ensure: () => (G().dual || (G().dual = {})), prune: () => { if (X.gear?.dual && !Object.keys(X.gear.dual).length) delete X.gear.dual; },
        onChange: touch, fields: numberFields(GENERIC_DUAL),
    }));
    gearBox.append(fieldGroup({
        title: 'Fleeing', source: () => X.gear?.flee || {}, ensure: () => (G().flee || (G().flee = {})), prune: () => { if (X.gear?.flee && !Object.keys(X.gear.flee).length) delete X.gear.flee; },
        onChange: touch, fields: numberFields(GENERIC_FLEE),
    }));
    gearBox.append(fieldGroup({
        title: 'Team fights', source: () => X.gear?.teams || {}, ensure: () => (G().teams || (G().teams = {})), prune: () => { if (X.gear?.teams && !Object.keys(X.gear.teams).length) delete X.gear.teams; },
        onChange: touch,
        fields: [
            { key: 'maxPerSide', label: 'Most fighters a side', type: 'number', placeholder: String(GENERIC_TEAMS.maxPerSide) },
            ...Object.keys(GENERIC_TEAMS.backToWall).map(k => ({ key: `backToWall.${k}`, label: `Back to the wall: ${k}`, type: 'number', placeholder: String(GENERIC_TEAMS.backToWall[k]) })),
            ...Object.keys(GENERIC_TEAMS.crowding).map(k => ({ key: `crowding.${k}`, label: `Crowding: ${k}`, type: 'number', placeholder: String(GENERIC_TEAMS.crowding[k]) })),
        ],
    }));
    gearBox.append(fieldGroup({
        title: 'Burden', help: 'Optional: a formula for how much a fighter can carry.',
        source: () => X.gear || {}, ensure: G, onChange: touch,
        fields: [{ key: 'burden', label: 'Burden formula', placeholder: 'e.g. 10 + stat.strength/2' }],
    }));
    sections.push(gearBox);

    /* ---- elements ---- */
    const elBox = section('13. Elements',
        'An optional wheel of magic types. A fighter whose element beats the other\'s gets a bonus, whether attacking or defending.');
    const E = () => (X.elements && typeof X.elements === 'object' ? X.elements : (X.elements = {}));
    const pruneElements = () => { if (X.elements && !Object.keys(X.elements).length) delete X.elements; };
    elBox.append(fieldGroup({
        title: 'The wheel', source: () => X.elements || {}, ensure: E, prune: pruneElements, onChange: touch,
        fields: [
            { key: 'meta', label: 'Sheet field naming a fighter\'s element', placeholder: 'e.g. affinity', help: 'One of the sheet fields above.' },
            { key: 'label', label: 'Name in the log', placeholder: 'Elemental edge' },
            { key: 'bonus', label: 'Roll bonus for the side whose element wins', type: 'number' },
            { key: 'dmgMult', label: 'Damage multiplier for the winning side', type: 'number', step: 0.05 },
            { key: 'channels', label: 'Only these damage channels clash', type: 'csv', placeholder: 'magic' },
        ],
    }));
    elBox.append(recordList({
        title: 'Elements', help: 'Each element can beat others (it gets the edge against them) and ward off others (as a defender it turns their attacks aside). Use * for every other element.',
        list: () => (Array.isArray(E().list) ? E().list : (E().list = [])), peek: () => (Array.isArray(X.elements?.list) ? X.elements.list : []),
        onChange: () => { pruneElements(); touch(); }, idFromLabel: true, addLabel: 'Add an element', empty: 'No elements.',
        name: (r) => r.label || r.id,
        make: () => ({ id: '', label: '' }),
        fields: [
            { key: 'label', label: 'Name', placeholder: 'e.g. Fire' }, { key: 'id', label: 'Id' },
            { key: 'group', label: 'Group', placeholder: 'optional' },
            { key: 'option', label: 'How a sheet writes it', placeholder: 'e.g. Fire Magic' },
            { key: 'aliases', label: 'Also called', type: 'csv' },
            { label: 'Beats (element ids)', type: 'csv', placeholder: 'e.g. wind, earth', get: (rec) => X.elements?.beats?.[rec.id], set: (rec, v) => setPath(E(), `beats.${rec.id}`, v) },
            { label: 'Wards off (element ids)', type: 'csv', placeholder: 'e.g. * (every other element)', get: (rec) => X.elements?.wards?.[rec.id], set: (rec, v) => setPath(E(), `wards.${rec.id}`, v) },
        ],
    }));
    sections.push(elBox);

    /* ---- roll extras ---- */
    const extras = section('14. Roll extras and skill cards',
        'Optional extras for the roll above: results forced by a natural roll, how much each result multiplies damage, how the difficulty setting shifts rolls, and what is at stake.');
    const R = () => (X.resolution && typeof X.resolution === 'object' ? X.resolution : (X.resolution = {}));
    const pruneResolution = () => { if (X.resolution && !Object.keys(X.resolution).length) delete X.resolution; };
    extras.append(recordList({
        title: 'Natural rolls', help: 'A die roll that decides the result by itself, for example 1 is always a miss and 20 is always a crit.',
        map: { read: (id, v) => ({ id, result: v }), write: (rec) => rec.result, get: () => X.resolution?.natural, set: (v) => { setPath(X, 'resolution.natural', v && Object.keys(v).length ? v : undefined); pruneResolution(); } },
        onChange: touch, addLabel: 'Add a natural roll', empty: 'None.',
        name: (r) => `${r.id} = ${r.result || '?'}`,
        make: (taken) => ({ id: uniqueKey('20')(taken), result: 'crit' }),
        fields: [{ key: 'id', label: 'Die shows', placeholder: 'e.g. 20' }, { key: 'result', label: 'Result', type: 'select', options: RESULTS }],
    }));
    extras.append(recordList({
        title: 'Damage by result', help: 'How much each result multiplies damage (a miss is 0).',
        map: { read: (id, v) => ({ id, mult: v }), write: (rec) => rec.mult, get: () => X.resolution?.bandMult, set: (v) => { setPath(X, 'resolution.bandMult', v && Object.keys(v).length ? v : undefined); pruneResolution(); } },
        onChange: touch, addLabel: 'Add a result', empty: 'None.',
        name: (r) => `${r.id} x${r.mult ?? '?'}`,
        make: (taken) => ({ id: RESULTS.find(x => !taken.has(x)) || 'hit', mult: 1 }),
        fields: [{ key: 'id', label: 'Result', type: 'select', options: RESULTS }, { key: 'mult', label: 'Multiplier', type: 'number', step: 0.1, placeholder: 'e.g. 1.5 (0 for a miss)' }],
    }));
    extras.append(recordList({
        title: 'Difficulty', help: 'How each difficulty level (1 easy to 5 hard) shifts the roll.',
        list: () => (Array.isArray(R().difficulty) ? R().difficulty : (R().difficulty = [])), peek: () => (Array.isArray(X.resolution?.difficulty) ? X.resolution.difficulty : []),
        onChange: () => { pruneResolution(); touch(); }, addLabel: 'Add a level', empty: 'None.',
        name: (r) => `Level ${r.level ?? '?'}: ${r.mod ?? 0}`,
        make: () => ({ level: 1, mod: 0 }),
        fields: [{ key: 'level', label: 'Level', type: 'number', placeholder: 'e.g. 1 (easy) to 5 (hard)' }, { key: 'mod', label: 'Roll change', type: 'number', placeholder: 'e.g. -1' }],
    }));
    extras.append(fieldGroup({
        title: 'What is at stake', source: () => X.stakes || {}, ensure: () => (X.stakes && typeof X.stakes === 'object' ? X.stakes : (X.stakes = {})),
        prune: () => { if (X.stakes && !Object.keys(X.stakes).length) delete X.stakes; }, onChange: touch,
        fields: [{ key: 'injuries', label: 'A fight can leave injuries', type: 'bool' }, { key: 'death', label: 'A fight can be fatal', type: 'bool' }],
    }));
    extras.append(recordList({
        title: 'Skill cards', help: 'Groups of proficiencies shown together on a sheet.',
        map: { read: (id, v) => ({ id, profs: Array.isArray(v) ? v : [] }), write: (rec) => rec.profs || [], ...objectAt('skillCards') },
        onChange: touch, addLabel: 'Add a card', empty: 'None.',
        name: (r) => r.id,
        make: (taken) => ({ id: uniqueKey('card')(taken), profs: [] }),
        fields: [{ key: 'id', label: 'Card name', placeholder: 'e.g. Martial arts' }, { key: 'profs', label: 'Proficiency ids', type: 'csv' }],
    }));
    sections.push(extras);

    /* ---- lorebook import ---- */
    const loreBox = section('15. Reading a lorebook sheet',
        'Optional. When a character\'s lorebook entry has a table of attributes, these rules turn it into this world\'s stats: which lore attribute feeds which stats, and how its numbers are scaled.');
    const L = () => (X.loreImport && typeof X.loreImport === 'object' ? X.loreImport : (X.loreImport = {}));
    const pruneLore = () => { if (X.loreImport && !Object.keys(X.loreImport).length) delete X.loreImport; };
    const statChoices = () => draft.stats.map(s => s.id || slug(s.label)).filter(Boolean);
    loreBox.append(recordList({
        title: 'Attributes', help: 'Name an attribute as the lorebook writes it (STR, Strength...) and list the stats it feeds, separated by commas.',
        map: { read: (id, v) => ({ id, stats: Array.isArray(v) ? v : [] }), write: (rec) => rec.stats || [], get: () => X.loreImport?.statMap, set: (v) => { setPath(X, 'loreImport.statMap', v && Object.keys(v).length ? v : undefined); pruneLore(); } },
        onChange: touch, addLabel: 'Add an attribute', empty: 'None.',
        name: (r) => `${r.id} feeds ${(r.stats || []).join(', ') || '?'}`,
        make: (taken) => ({ id: uniqueKey('ATTR')(taken), stats: [] }),
        fields: [
            { key: 'id', label: 'Attribute in the lorebook', placeholder: 'STR' },
            { key: 'stats', label: 'Feeds these stats', type: 'csv', placeholder: statChoices().slice(0, 3).join(', ') || 'strength', help: 'Use the stat ids of this world (the Stats section above).' },
        ],
    }));
    const scaleField = (which, index, label, example) => ({
        label, type: 'number', placeholder: `e.g. ${example}`,
        get: () => X.loreImport?.scale?.[which]?.[index],
        set: (_rec, v) => {
            const current = Array.isArray(X.loreImport?.scale?.[which]) ? [...X.loreImport.scale[which]] : [undefined, undefined];
            current[index] = v;
            if (current[0] === undefined && current[1] === undefined) setPath(X, `loreImport.scale.${which}`, undefined);
            else setPath(L(), `scale.${which}`, [current[0] ?? 0, current[1] ?? 0]);
            pruneLore();
        },
    });
    loreBox.append(fieldGroup({
        title: 'Scale', help: 'The lorebook\'s own numbers run from one range and are stretched onto this world\'s stat range (for example 1 to 15 becomes 0 to 100).',
        source: () => X.loreImport?.scale || {}, ensure: () => {}, onChange: touch,
        fields: [scaleField('from', 0, 'Lorebook lowest', '1'), scaleField('from', 1, 'Lorebook highest', '15'), scaleField('to', 0, 'This world lowest', '0'), scaleField('to', 1, 'This world highest', '100')],
    }));
    sections.push(loreBox);

    return sections;
}
