import { gearRules, weaponName } from './combat-gear.js';

/**
 * Attacking with what you hold (fork): turns a fighter's loadout into the actions they can take.
 *
 * A fighter with an equipped weapon gets one weapon action named after it ("Dual Scimitars",
 * "Falcon Blade"), in place of the world's fixed basic attack for that proficiency ("Iron Sword").
 * Its numbers are the basic attack's own plus the weapon's:
 *
 *   power  the basic attack's power + the weapon kind's + the tier's + the item's bonus
 *   hit    kind + tier + item, added to the attack roll
 *   crit   the tier's and the item's chance (percent) to upgrade a landed blow one band
 *   mult   the tier's multiplier on the damage the world's formula gives
 *
 * so a plain Common weapon of a kind whose numbers are zero does exactly what the old fixed attack
 * did, and a fighter with no weapon is untouched (they keep every action they had). A pair of
 * blades, or a separate off-hand weapon, adds a second strike at a discount (the gear's `dual`
 * numbers). A focus (a book, a staff) adds its tier to the spells of its proficiency.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const isPlain = (a) => a && !a.self && !(Number(a.cost?.amount) > 0) && !a.effect;
const weaponRoleProfs = (type) => new Set((type.proficiencies || []).filter(p => (p.roles || []).includes('weapon')).map(p => p.id));

const cache = new WeakMap();

/**
 * @param {object} type the world type
 * @param {object} loadout from resolveLoadout
 * @returns {{
 *   weapon: object|null,   the weapon action (key 'weapon'), or null when the fighter holds nothing
 *   off: object|null,      what the off-hand strike adds: { name, power, gear }
 *   focus: object[],       the focus's spells, as copies with the focus's numbers
 *   replaces: Set<string>, keys of the world's basic attacks the weapon action stands in for
 *   byKey: Map<string, object> every action built here, by key
 * }}
 */
/**
 * Fighting with nothing in hand: the world's own unarmed kind (fists, hand-to-hand, hakuda), on the same
 * footing as a weapon. It rides on the proficiency that kind names, so a trained brawler hits and lands
 * better, and on the attack role the damage formula already reads, which a world binds to strength.
 * @returns {object|null} an action, or null when the world has no usable proficiency for it
 */
export function unarmedAttack(type) {
    const rules = gearRules(type);
    const kind = rules.kinds.find(k => k.id === rules.unarmed) || rules.kinds.find(k => k.slot === 'natural');
    const actions = type.actions || [];
    const weaponProfs = weaponRoleProfs(type);
    const prof = kind?.prof || actions.find(a => isPlain(a) && weaponProfs.has(a.prof))?.prof || '';
    if (!prof) return null;
    const base = actions.find(a => isPlain(a) && a.prof === prof) || null;
    const power = (Number(base?.power) || 0) + (Number(kind?.power) || 0);
    const hit = Number(kind?.hit) || 0;
    return {
        key: 'unarmed', label: 'Attack', prof, channel: kind?.channel || base?.channel || undefined, power,
        gear: { hit, crit: 0, mult: 1, slot: 'main' },
        desc: `Unarmed (${kind?.label || 'fists'}): power ${power}, hit ${hit >= 0 ? '+' : ''}${hit}. Uses your skill and strength.`,
    };
}

export function buildGearActions(type, loadout) {
    if (!loadout) return { weapon: null, off: null, focus: [], replaces: new Set(), byKey: new Map() };
    if (cache.has(loadout)) return cache.get(loadout);
    const rules = gearRules(type);
    const main = loadout.main;
    const out = { weapon: null, off: null, focus: [], replaces: new Set(), byKey: new Map() };

    if (main && !main.default) {
        const actions = type.actions || [];
        const weaponProfs = weaponRoleProfs(type);
        // The world's own basic attack for this proficiency: what the weapon attack is built on.
        const basics = actions.filter(a => isPlain(a) && main.prof && a.prof === main.prof);
        const base = basics[0] || (!main.prof ? actions.find(a => isPlain(a) && weaponProfs.has(a.prof)) : null) || null;
        for (const a of basics) out.replaces.add(a.key);
        if (base) out.replaces.add(base.key);
        const basePower = Number(base?.power) || 0;
        out.weapon = {
            key: 'weapon',
            // One button, "Attack": it strikes with whatever is in hand, by that weapon's kind and tier.
            label: 'Attack',
            weaponLabel: weaponName(loadout) || main.name,
            prof: main.prof || base?.prof || '',
            channel: main.channel || base?.channel || undefined,
            power: basePower + main.power,
            desc: `${weaponName(loadout) || main.name}: ${main.tierLabel ? `${main.tierLabel} ` : ''}${main.kindLabel}. Power ${basePower + main.power}, hit ${main.hit >= 0 ? '+' : ''}${main.hit}, crit ${main.crit}%, damage x${main.mult}.`,
            weapon: true,
            gear: { hit: main.hit, crit: main.crit, mult: main.mult, slot: 'main' },
            tier: main.tier,
        };
        out.byKey.set('weapon', out.weapon);
        if (loadout.off) {
            const o = loadout.off;
            out.off = {
                name: o.name,
                power: basePower + o.power,
                gear: { hit: o.hit + rules.dual.offHit, crit: o.crit, mult: o.mult * rules.dual.offMult, slot: 'off' },
            };
        }
    }

    if (loadout.focus) {
        const f = loadout.focus;
        for (const a of type.actions || []) {
            if (!f.prof || a.prof !== f.prof || a.self) continue;
            const clone = { ...a, power: (Number(a.power) || 0) + f.power, gear: { hit: f.hit, crit: f.crit, mult: f.mult, slot: 'focus' }, focusName: f.name };
            out.focus.push(clone);
            out.byKey.set(clone.key, clone);
        }
    }
    cache.set(loadout, out);
    return out;
}
