import { run } from './combat-formula.js';
import { STAT_ROLES } from './combat-roles.js';

/**
 * One attack, resolved by a world type's own rules (fork).
 *
 * This is the smallest piece of the fight engine: given two projected combatants, an action
 * and a random source, it says what band the attack landed in and how much damage it did. It
 * reads roles only, so Fire Emblem's threshold roll and Bleach's opposed roll go through the
 * same code with different formulas. Turn order, pools, abilities and the battle window build
 * on this later.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const has = (side, tag) => Boolean(side?.tagSet?.has(String(tag)));
const FNS = { has };

const ROLL_ROLES = ['speed', 'accuracy', 'evasion', 'luck', 'presence', 'awareness', 'endurance'];

/** The proficiency a defender is assumed to fight with when none is named: their best. */
function bestProf(c) {
    return [...c.profs]
        .filter(p => p.rankIndex >= 0 && (p.roles.includes('weapon') || p.roles.includes('magic')))
        .sort((x, y) => y.rankIndex - x.rankIndex)[0] || null;
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
    const adv = advantage(type, a, d);

    const w = watched(opts.rng);
    const total = Number(run(res.roll, { a, d, diff, adv }, { rng: w.next, fns: FNS })) || 0;
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

    let damage = 0;
    if (band !== 'miss' && band !== 'stalemate') {
        const mult = Number(res.bandMult?.[band] ?? 0);
        const base = Number(res.bandBase?.[band] ?? 0);
        damage = Number(run(res.damage, {
            act: { power: Number(act.power) || 0 }, a, d, adv, band: { mult, base },
        }, { rng: opts.rng, fns: FNS })) || 0;
    }
    return { band, total, natural, damage, advantage: adv, ...(margin === undefined ? {} : { margin }) };
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
    const record = (r) => {
        odds[r.band] = (odds[r.band] || 0) + 1;
        n++;
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
    return { odds, damage: { min: Number.isFinite(min) ? min : 0, max } };
}

export { STAT_ROLES };
