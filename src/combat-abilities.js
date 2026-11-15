import { abilityChance } from './combat-math.js';

/**
 * Abilities (fork): the things a character can do beyond the plain actions of a world type.
 *
 * A world type lists them under type.abilities. Each has a kind:
 *
 *   passive    never chosen. It may fire by chance when its trigger comes up:
 *                trigger 'attack'    the owner strikes      effect.dmgMult multiplies the blow
 *                trigger 'defend'    the owner is struck    effect.block is the share negated,
 *                                                           effect.heal the share of health regained
 *                trigger 'turnStart' the owner's turn opens effect.heal
 *   active     chosen on the owner's turn, pays its cost, and strikes like an action:
 *                prof, power, and optionally effect.dmgMult
 *   defensive  chosen on the owner's turn, aimed at themselves:
 *                effect.block braces against the next blow, effect.heal restores health
 *
 * chance is a formula over the owner's roles, 0 to 100 (for example a role over four, plus five).
 * It is read through the same formula engine as everything else, so no stat is named here.
 *
 * Healing never happens in a spar: the engine drops it whatever the type says.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/** Most abilities one character can have equipped. */
export const MAX_ABILITIES = 5;

export const ABILITY_KINDS = Object.freeze(['passive', 'active', 'defensive']);
export const ABILITY_TRIGGERS = Object.freeze(['attack', 'defend', 'turnStart']);

const num = (v) => Number(v) || 0;

export function abilityList(type) {
    return Array.isArray(type?.abilities) ? type.abilities : [];
}

/** The abilities a character holds, as type entries, in the type's order. Unknown ids are dropped. */
export function resolveAbilities(type, ids) {
    const have = new Set(Array.isArray(ids) ? ids.map(String) : []);
    return abilityList(type).filter(a => have.has(a.id)).slice(0, MAX_ABILITIES);
}

/** Whether an ability does any healing. */
export const heals = (a) => num(a?.effect?.heal) > 0;

/** How much of its health the owner has lost, 0 (untouched) to 1 (nothing left). */
export function missingShare(view) {
    const h = view?.pools?.health;
    return h && h.max > 0 ? Math.max(0, Math.min(1, 1 - h.cur / h.max)) : 0;
}

/**
 * The multiplier an effect puts on a blow: its own, grown by how hurt the owner is
 * (missingBonus 1 means a blow is doubled by the time the owner has nothing left).
 */
export function blowMult(effect, view) {
    return (num(effect?.dmgMult) || 1) * (1 + num(effect?.missingBonus) * missingShare(view));
}

/**
 * Passives for one trigger. Healing ones are left out of a spar. One with whenBelow only
 * counts while the owner's health is under that share (0.5: below half).
 */
export function passivesFor(abilities, trigger, mode, view) {
    return (abilities || []).filter(a => a.kind === 'passive' && a.trigger === trigger
        && !(mode === 'spar' && heals(a) && !num(a.effect?.block) && !num(a.effect?.dmgMult) && !num(a.effect?.counter))
        && (!num(a.whenBelow) || !view || (1 - missingShare(view)) < num(a.whenBelow)));
}

/** The abilities offered as turn choices, shaped like actions. No healing in a spar. */
export function abilityActions(abilities, mode) {
    const out = [];
    for (const a of abilities || []) {
        if (a.kind === 'passive') continue;
        if (a.kind === 'defensive') {
            if (mode === 'spar' && heals(a)) continue;
            out.push({ key: `ability:${a.id}`, label: a.label, ability: true, self: true, cost: a.cost, effect: a.effect || {}, desc: a.desc });
        } else {
            out.push({
                key: `ability:${a.id}`, label: a.label, ability: true, prof: a.prof, power: num(a.power),
                channel: a.channel, cost: a.cost, effect: a.effect || {}, desc: a.desc,
            });
        }
    }
    return out;
}

/** Rolls an ability's chance with the fight's own random source. */
export function fires(ability, ownerView, otherView, rng) {
    if (!ability.chance) return true;
    const pct = Math.max(0, Math.min(100, abilityChance(ability.chance, ownerView, otherView)));
    return rng() * 100 < pct;
}

/** The chance as a whole percent, for display. */
export function chancePercent(ability, ownerView, otherView) {
    if (!ability.chance) return 100;
    return Math.round(Math.max(0, Math.min(100, abilityChance(ability.chance, ownerView, otherView))));
}

/** Validation for one type's abilities: [{ errors, warnings }] folded by the caller. */
export function validateAbilities(type, validateExpr) {
    const errors = [];
    const warnings = [];
    const seen = new Set();
    const profIds = new Set((type.proficiencies || []).map(p => p.id));
    const pools = new Set((type.pools || []).map(p => p.role));
    for (const a of abilityList(type)) {
        const name = `Ability "${a?.id || a?.label || '?'}"`;
        if (!a?.id) { errors.push('An ability has no id.'); continue; }
        if (seen.has(a.id)) errors.push(`${name} is listed twice.`);
        seen.add(a.id);
        if (!ABILITY_KINDS.includes(a.kind)) errors.push(`${name} has an unknown kind.`);
        if (a.kind === 'passive' && !ABILITY_TRIGGERS.includes(a.trigger)) errors.push(`${name} needs a trigger: attack, defend or turnStart.`);
        if (a.chance) {
            const check = validateExpr(String(a.chance), { names: () => true, calls: ['has'] });
            if (!check.ok) errors.push(`${name} chance: ${check.error}`);
        } else if (a.kind === 'passive') warnings.push(`${name} has no chance, so it always fires.`);
        if (a.prof && !profIds.has(a.prof)) errors.push(`${name} uses an unknown proficiency.`);
        if (a.cost?.pool && !pools.has(a.cost.pool)) errors.push(`${name} is paid from a pool the type does not have.`);
        if (heals(a) && Array.isArray(a.modes) && a.modes.includes('spar')) warnings.push(`${name} heals; healing is skipped in a spar whatever it says.`);
        const e = a.effect || {};
        if (num(a.whenBelow) < 0 || num(a.whenBelow) > 1) errors.push(`${name} whenBelow must be between 0 and 1.`);
        if (num(e.missingBonus) < 0 || num(e.missingBonus) > 5) errors.push(`${name} missingBonus must be between 0 and 5.`);
        if (num(e.drain) < 0 || num(e.drain) > 1) errors.push(`${name} drain must be between 0 and 1.`);
        if (num(e.counter) < 0 || num(e.counter) > 3) errors.push(`${name} counter must be between 0 and 3.`);
        if (num(e.counter) > 0 && !(a.kind === 'passive' && a.trigger === 'defend')) errors.push(`${name} counter only works on a defend passive.`);
        if (num(e.drain) > 0 && a.kind === 'defensive') errors.push(`${name} drain needs a blow to take from.`);
    }
    return { errors, warnings };
}
