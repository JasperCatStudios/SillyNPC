import { run } from './combat-formula.js';
import { STAT_ROLES } from './combat-roles.js';

/**
 * One attack, resolved by a world type's own rules (fork).
 *
 * This is the smallest piece of the fight engine: given two projected combatants, an action
 * and a random source, it says what band the attack landed in and how much damage it did. It
 * reads roles only, so Fire Emblem's threshold roll and Bleach's opposed roll go through the
 * same code with different formulas. Turn order and pools are combat-fight.js; the battle
 * window is modules/combat/combat-window.js. Abilities come later.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const has = (side, tag) => Boolean(side?.tagSet?.has(String(tag)));
const FNS = { has };

const ROLL_ROLES = ['initiative', 'speed', 'accuracy', 'evasion', 'luck', 'presence', 'awareness', 'endurance'];

/** The proficiency a defender is assumed to fight with when none is named: their best. */
function bestProf(c) {
    return [...c.profs]
        .filter(p => p.rankIndex >= 0 && (p.roles.includes('weapon') || p.roles.includes('magic')))
        .sort((x, y) => y.rankIndex - x.rankIndex)[0] || null;
}

/** What a weapon adds to an attack: the numbers the formulas can read as `a.gear`. */
function gearContext(gear) {
    return {
        hit: Number(gear?.hit) || 0,
        crit: Math.max(0, Math.min(100, Number(gear?.crit) || 0)),
        mult: Number(gear?.mult) > 0 ? Number(gear.mult) : 1,
    };
}

/** The band one step up (hit to strong, strong to crit), or the same band at the top or on a miss. */
function bandUp(bands, band) {
    const order = [];
    for (const b of bands) if (b.result !== 'miss' && b.result !== 'stalemate' && !order.includes(b.result)) order.push(b.result);
    const i = order.indexOf(band);
    return i >= 0 && i < order.length - 1 ? order[i + 1] : band;
}

/** One combatant, as the formulas see them for one action. */
function sideContext(c, prof, channel) {
    const ch = channel || prof?.channel || null;
    const mod = {};
    for (const id of [...ROLL_ROLES, 'attack', 'defense']) mod[id] = c.mod(id, ch);
    mod.roll = prof ? c.mod(prof.rollRole || 'attack', ch) : 0;

    const side = {
        attack: c.role('attack', ch),
        defense: c.role('defense', ch),
        mod,
        prof: { id: prof?.id || '', bonus: prof?.bonus || 0, rank: prof?.rank || null },
        tagSet: new Set([...c.tags, ...(prof?.tags || [])]),
    };
    for (const id of ROLL_ROLES) side[id] = c.role(id, ch);
    return side;
}

function bandFor(bands, value) {
    for (const b of bands) if (value <= b.upTo) return b.result;
    return bands[bands.length - 1]?.result || 'miss';
}

/** The combined effect of every advantage rule that applies. */
function advantage(type, a, d) {
    const out = { hit: 0, dmgMult: 1, labels: [] };
    for (const rule of type.advantage || []) {
        if (run(rule.if, { a, d }, { fns: FNS })) {
            out.hit += Number(rule.hit) || 0;
            out.dmgMult *= Number(rule.dmgMult) || 1;
            if (rule.label) out.labels.push(rule.label);
        }
    }
    return out;
}

/** Wraps an rng so the first die rolled can be read back: the formulas lead with the d20. */
function watched(rng) {
    const state = { first: null };
    const next = () => {
        const v = rng();
        if (state.first === null) state.first = v;
        return v;
    };
    return { next, state };
}

/**
 * @param {object} type World type.
 * @param {object} attacker Projected combatant (project()).
 * @param {object} defender Projected combatant.
 * @param {{ prof: string, power?: number, channel?: string }} act
 * @param {{ rng: () => number, diff?: number, defenderProf?: string }} opts
 * @returns {{ band: string, total: number, natural: number, damage: number, advantage: object, margin?: number }}
 */
export function resolveAttack(type, attacker, defender, act, opts) {
    const res = type.resolution;
    const diff = Number(opts?.diff) || 0;
    const sides = Number(res.die) || 20;
    const aProf = attacker.prof(act.prof);
    const channel = act.channel || aProf?.channel || null;
    const dProf = opts?.defenderProf ? defender.prof(opts.defenderProf)
        : (defender.prof(act.prof)?.rankIndex >= 0 ? defender.prof(act.prof) : bestProf(defender));

    const a = sideContext(attacker, aProf, channel);
    const d = sideContext(defender, dProf, channel);
    // What the attacker's weapon adds. Only the attacker has any: it is theirs for this blow.
    const gear = gearContext(opts?.gear);
    a.gear = gear;
    d.gear = gearContext(null);
    const adv = advantage(type, a, d);

    const w = watched(opts.rng);
    let total = Number(run(res.roll, { a, d, diff, adv }, { rng: w.next, fns: FNS })) || 0;
    // A world whose roll formula never mentions gear still gets the weapon's hit bonus.
    if (gear.hit && !/\bgear\b/.test(String(res.roll))) total += gear.hit;
    const natural = w.state.first === null ? 0 : 1 + Math.floor(w.state.first * sides);

    let band;
    let margin;
    if (res.mode === 'opposed') {
        // The defender rolls the same formula from their own side. Difficulty is the
        // attacker's alone: it is the player's edge or handicap, not the opponent's.
        const defenderRoll = Number(run(res.roll, { a: d, d: a, diff: 0, adv: { hit: 0, dmgMult: 1 } },
            { rng: opts.rng, fns: FNS })) || 0;
        margin = total - defenderRoll;
        if (margin < 0) band = 'miss';
        else if (res.natural?.[natural] && margin > 0) band = res.natural[natural];
        else band = bandFor(res.bands, margin);
    } else if (res.natural?.[natural]) {
        band = res.natural[natural];
    } else {
        band = bandFor(res.bands, total);
    }

    // A weapon's crit chance: a blow that landed may land one band better. The die is only rolled
    // for a weapon that has a chance, so a fight without such weapons replays exactly as before.
    let gearCrit = false;
    if (gear.crit > 0 && band !== 'miss' && band !== 'stalemate' && typeof opts.rng === 'function' && opts.rng() * 100 < gear.crit) {
        const up = bandUp(res.bands || [], band);
        if (up !== band) { band = up; gearCrit = true; }
    }

    let damage = 0;
    if (band !== 'miss' && band !== 'stalemate') {
        const mult = Number(res.bandMult?.[band] ?? 0);
        const base = Number(res.bandBase?.[band] ?? 0);
        damage = Number(run(res.damage, {
            act: { power: Number(act.power) || 0 }, a, d, adv, band: { mult, base },
        }, { rng: opts.rng, fns: FNS })) || 0;
        // The tier's multiplier on what the world's own formula gave.
        if (damage > 0 && gear.mult !== 1) damage = Math.max(1, Math.round(damage * gear.mult));
    }
    return { band, total, natural, damage, advantage: adv, ...(gearCrit ? { gearCrit } : {}), ...(margin === undefined ? {} : { margin }) };
}

/**
 * Initiative for one combatant, by the type's own formula (usually speed plus a die).
 * Rolls with the supplied rng, so a battle stays replayable from its seed.
 */
export function rollInitiative(type, combatant, rng) {
    const expr = type?.resolution?.initiative || 'a.initiative';
    const prof = bestProf(combatant);
    const a = sideContext(combatant, prof, prof?.channel);
    return Number(run(expr, { a }, { rng, fns: FNS })) || 0;
}

/** An ability's chance formula (0 to 100), read over the owner's roles. */
export function abilityChance(expr, owner, other) {
    return Number(run(expr, {
        a: sideContext(owner, bestProf(owner), bestProf(owner)?.channel),
        d: sideContext(other, bestProf(other), bestProf(other)?.channel),
    }, { fns: FNS })) || 0;
}

/** Whether this attacker strikes again before the defender acts, by the type's follow-up rule. */
export function grantsFollowUp(type, attacker, defender, rng) {
    // A chance (0 to 100) rolled from the fight's own random source, or the older yes/no rule.
    const chance = type?.resolution?.followUpChance;
    if (chance && typeof rng === 'function') {
        const aP = bestProf(attacker);
        const dP = bestProf(defender);
        const pct = Math.max(0, Math.min(100, Number(run(chance, {
            a: sideContext(attacker, aP, aP?.channel),
            d: sideContext(defender, dP, dP?.channel),
        }, { fns: FNS })) || 0));
        return rng() * 100 < pct;
    }
    const expr = type?.resolution?.followUp;
    if (!expr) return false;
    const aProf = bestProf(attacker);
    const dProf = bestProf(defender);
    return Boolean(run(expr, {
        a: sideContext(attacker, aProf, aProf?.channel),
        d: sideContext(defender, dProf, dProf?.channel),
    }, { fns: FNS }));
}

/** A generator that returns a fixed die face, for enumerating outcomes. */
function fixedFaces(faces, sides) {
    let i = 0;
    return () => {
        const face = faces[Math.min(i++, faces.length - 1)];
        return (face - 0.5) / sides;
    };
}

/**
 * The exact odds of each band, by trying every face of the die.
 *
 * @returns {{ odds: Record<string, number>, damage: { min: number, max: number } }}
 *   odds sum to 1. damage covers the bands that deal any.
 */
export function previewOdds(type, attacker, defender, act, opts = {}) {
    const res = type.resolution;
    const sides = Number(res.die) || 20;
    const odds = {};
    let min = Infinity;
    let max = 0;
    let n = 0;
    let sum = 0;
    const record = (r) => {
        odds[r.band] = (odds[r.band] || 0) + 1;
        n++;
        sum += r.damage;
        if (r.damage > 0) { min = Math.min(min, r.damage); max = Math.max(max, r.damage); }
    };
    for (let face = 1; face <= sides; face++) {
        if (res.mode === 'opposed') {
            for (let other = 1; other <= sides; other++) {
                record(resolveAttack(type, attacker, defender, act, {
                    ...opts, rng: fixedFaces([face, other], sides),
                }));
            }
        } else {
            record(resolveAttack(type, attacker, defender, act, { ...opts, rng: fixedFaces([face], sides) }));
        }
    }
    for (const k of Object.keys(odds)) odds[k] /= n;
    return { odds, expected: n ? sum / n : 0, damage: { min: Number.isFinite(min) ? min : 0, max } };
}

export { STAT_ROLES };
