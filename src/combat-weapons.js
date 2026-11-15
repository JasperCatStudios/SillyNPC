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
            label: weaponName(loadout) || main.name,
            prof: main.prof || base?.prof || '',
            channel: main.channel || base?.channel || undefined,
            power: basePower + main.power,
            desc: `${main.tierLabel ? `${main.tierLabel} ` : ''}${main.kindLabel}.`,
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
