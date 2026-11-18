import { mulberry32 } from './combat-formula.js';
import { project } from './combat-roles.js';
import { resolveAttack, rollInitiative, grantsFollowUp, previewOdds, abilityChance } from './combat-math.js';
import { resolveAbilities, abilityList, abilityActions, passivesFor, fires, heals, blowMult, formAbilities } from './combat-abilities.js';
import { resolveLoadout, weaponName, gearRules, gatedAbilities } from './combat-gear.js';
import { resolveStyle } from './combat-style.js';
import { unarmedAttack, buildGearActions } from './combat-weapons.js';

/**
 * One fight (fork): who goes when, what they may do, and where the damage lands.
 *
 * Built on resolveAttack. A world type still supplies the rolls, the bands, the actions and
 * the follow-up rule; this only keeps the order and the pools. Sparring spends the guard
 * pool and stops when it is gone. A real fight spends armour, then health.
 *
 * The battle is not written onto the character here. The window does that, and only for a
 * character who already has combat data.
 *
 * Later phases (fork), each new and switched on only by what a fight is given, so a fight without
 * them replays exactly as before:
 *   crowding     opts.crowding: several on one target get in each other's way (teams.crowding)
 *   tools        the belt: `tool:<itemId>` actions, uses counted per fight (never written back)
 *   fleeing      attemptFlee: a roll against the pursuers' speed and luck (gear flee numbers);
 *                opts.aiFlee lets the computer's fighters run when a fight is lost
 *   effects      blind, cover (smoke), slow and stun, from tools, lasting a number of own turns
 *   forms        an ability with `form` changes which abilities its user has (combat-abilities.js)
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/** The abilities a fighter can use right now: all of them, or what their current form allows. */
export function activeAbilities(fighter) {
    return formAbilities(fighter?.abilities, fighter?.form || null);
}

/** Proficiencies this combatant may actually use: the faction card, plus anything they hold. */
function visibleProfIds(type, view) {
    const cards = type.skillCards;
    const faction = view.meta?.faction;
    const card = cards && faction && Array.isArray(cards[faction]) ? new Set(cards[faction]) : null;
    const ids = new Set();
    for (const p of type.proficiencies || []) {
        if (!card || card.has(p.id) || view.prof(p.id)?.rank) ids.add(p.id);
    }
    return ids;
}

/**
 * Actions this combatant can choose. Trained weapons and spells come first. With none, every
 * action on their card is offered untrained, so a fight can still start.
 */
/** What you can always do on your turn, whatever you hold: brace, dodge and (real fights only) recover. */
export const HEAL_USES = 2;
const clamp01 = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** How much of the next blow a brace turns away: the world's defense, so a sturdier fighter shrugs off more. */
export function defendShare(view) {
    const def = Number(view?.role?.('defense')) || 0;
    return Math.round(clamp01(0.25 + def * 0.008, 0.25, 0.75) * 100) / 100;
}

/** The chance a dodge turns the next blow aside: the world's evasion (or speed), so a quick fighter slips more. */
export function evadeChance(view) {
    const ev = Number(view?.role?.('evasion')) || Number(view?.role?.('speed')) || 0;
    return Math.round(clamp01(0.15 + ev * 0.01, 0.15, 0.7) * 100) / 100;
}

/** The three things anyone can do on a turn, with numbers that come from this fighter's own stats. */
function genericFor(view) {
    const block = defendShare(view);
    const evade = evadeChance(view);
    return {
        defend: { key: 'defend', label: 'Defend', self: true, generic: true, effect: { block }, desc: `Brace: the next blow against you does ${Math.round(block * 100)}% less damage (from your defense).` },
        evade: { key: 'evade', label: 'Evade', self: true, generic: true, effect: { evade }, desc: `Dodge: a ${Math.round(evade * 100)}% chance the next blow misses you completely (from your evasion).` },
        heal: { key: 'heal', label: 'Heal', self: true, generic: true, effect: { heal: 0.2 }, desc: `Catch your breath and recover a fifth of your health. ${HEAL_USES} times a fight.` },
    };
}

/**
 * Attacking with what you have when nothing is held. Built by the gear rules (combat-weapons.js) from
 * the world's own unarmed kind; if a world offers none usable, the first weapon attack stands in.
 */
export function unarmedAction(type, view) {
    const own = unarmedAttack(type);
    if (own) return own;
    const weaponProfs = new Set((view?.profs || []).filter(p => p.roles.includes('weapon')).map(p => p.id));
    const basis = (type.actions || []).find(a => weaponProfs.has(a.prof)) || (type.actions || [])[0];
    if (!basis) return null;
    return { key: 'unarmed', label: 'Attack', prof: basis.prof, power: Math.max(1, Math.round((Number(basis.power) || 0) * 0.6)), channel: basis.channel, desc: 'Strike with what you have.' };
}

/**
 * Why a fighter may not brace or dodge right now, or '' when they may. Never twice in a row, and never
 * more than two in any five turns: it is better than most moves but cannot be done every turn.
 */
export function defensiveLocked(fighter) {
    const turns = fighter?.turns || 0;
    const history = fighter?.defHistory || [];
    if (history.includes(turns - 1)) return 'You just braced or dodged. Attack, or use an ability, before you do it again.';
    if (history.filter(t => t >= turns - 4).length >= 2) return 'You cannot keep falling back: two braces or dodges in five turns is the limit.';
    return '';
}

/**
 * Defend, Evade and (a real fight only, a couple of times, and never for the computer) Heal, for this
 * fighter. Defend and Evade carry a locked reason while the limit above holds.
 */
export function genericActions(mode = 'fight', fighter = null, computer = false) {
    const g = genericFor(fighter?.view);
    const lock = defensiveLocked(fighter);
    const out = [lock ? { ...g.defend, locked: lock } : g.defend, lock ? { ...g.evade, locked: lock } : g.evade];
    if (!computer && mode !== 'spar' && !(fighter && (fighter.healUses || 0) >= HEAL_USES)) out.push(g.heal);
    return out;
}

/**
 * @param {{ player?: boolean, fighter?: object }} [options] player: the person at the screen is choosing, so
 *   Defend, Evade and Heal are offered too (the computer's fighters keep choosing among attacks).
 */
export function offeredActions(type, view, weapon, abilities = [], mode = 'fight', loadout = null, options = {}) {
    const out = offeredAttacks(type, view, weapon, abilities, mode, loadout);
    // The player's own choices, and the computer's too: everybody has the same moves.
    return options.generic || options.player ? [...out, ...genericActions(mode, options.fighter || { view }, Boolean(options.computer))] : out;
}

function offeredAttacks(type, view, weapon, abilities = [], mode = 'fight', loadout = null) {
    const visible = visibleProfIds(type, view);
    const actions = (type.actions || []).filter(a => !a.prof || visible.has(a.prof));
    const held = new Set(view.profs
        .filter(p => p.rankIndex >= 0 && (p.roles.includes('weapon') || p.roles.includes('magic')))
        .map(p => p.id));
    const trained = actions.filter(a => held.has(a.prof));
    const pool = trained.length ? trained : actions;
    // A weapon names the proficiency it is used with: only that kind of action is offered.
    const withWeapon = weapon?.prof ? pool.filter(a => a.prof === weapon.prof) : [];
    const base = [...(withWeapon.length ? withWeapon : pool), ...abilityActions(abilities, mode)];
    // Holding a weapon: its own attack, named after it, stands in for the world's basic one.
    const gear = loadout ? buildGearActions(type, loadout) : null;
    // Holding nothing: the weapons the world lists are not theirs to swing. One plain Attack stands in for them.
    if (loadout && gear && !gear.weapon && !weapon?.prof) {
        const weaponProfs = new Set((view.profs || []).filter(p => p.roles.includes('weapon')).map(p => p.id));
        const rest = base.filter(a => a.ability || !weaponProfs.has(a.prof));
        const fists = unarmedAction(type, view);
        const kept = [...(fists ? [fists] : []), ...rest.filter(a => !gear.replaces.has(a.key) && !gear.byKey.has(a.key)), ...gear.focus];
        return kept;
    }
    if (!gear || (!gear.weapon && !gear.focus.length)) return base;
    const rest = base.filter(a => !gear.replaces.has(a.key) && !gear.byKey.has(a.key));
    return [...(gear.weapon ? [gear.weapon] : []), ...rest, ...gear.focus];
}

/** Whether the combatant can pay the action's cost from a pool they have. */
export function canPay(view, action) {
    const cost = action?.cost;
    const amount = Number(cost?.amount) || 0;
    if (!amount) return true;
    const pool = view?.pools?.[cost.pool];
    return Boolean(pool) && pool.cur >= amount;
}

/**
 * An action's power for this fighter. A weapon action already carries the weapon's own power; any
 * other action adds the old weapon bonus, as it always has.
 */
function actionPower(action, fighter) {
    return (Number(action.power) || 0) + (action.weapon ? 0 : (Number(fighter.weapon?.power) || 0));
}

/** The weapon's numbers for expected damage: its hit and multiplier, but not the crit die. */
function gearForPreview(action) {
    return action.gear ? { hit: action.gear.hit, crit: 0, mult: action.gear.mult } : null;
}

const oddsCache = new Map();

/** Expected damage of one action, cached: it depends on the two sheets, not on how hurt anyone is. */
function expectedDamage(type, me, foe, action, diff) {
    const key = `${type.id}|${me.sig}|${foe.sig}|${action.key}|${diff}`;
    if (!oddsCache.has(key)) {
        const power = actionPower(action, me);
        const out = previewOdds(type, me.view, foe.view, {
            prof: action.prof, power, channel: action.channel, ...(action.element ? { element: action.element } : {}),
        }, { diff, gear: gearForPreview(action) });
        if (oddsCache.size > 4000) oddsCache.clear();
        oddsCache.set(key, out.expected);
    }
    return oddsCache.get(key) * blowMult(action.effect, me.view);
}

/** How much a cost hurts: spending a tenth of a pool is cheap, spending most of it is not. */
function costFactor(view, action) {
    const amount = Number(action?.cost?.amount) || 0;
    if (!amount) return 1;
    const pool = view.pools[action.cost.pool];
    if (!pool || !(pool.max > 0)) return 1;
    return 1 / (1 + 0.75 * (amount / pool.max));
}

/** The best expected damage an attacker could do to a defender right now. */
function bestExpected(type, attacker, defender, diff, mode, abilities = activeAbilities(attacker)) {
    const acts = offeredActions(type, attacker.view, attacker.weapon, abilities, mode, attacker.loadout)
        .filter(a => !a.self && canPay(attacker.view, a));
    return acts.reduce((m, a) => Math.max(m, expectedDamage(type, attacker, defender, a, diff)), 0);
}

/**
 * What an opponent does when it is their turn.
 *
 * Given the two fighters (extra = { me, foe, mode, diff }) every choice is worth a share of
 * somebody's health, and the best one wins:
 *   an attack     the damage it is expected to do, as a share of the foe's pool
 *   a brace       the blow it is expected to take off the next hit, as a share of mine
 *   a heal        the health it would put back (a real fight only), as a share of mine
 * each discounted by what it costs against the pool it is paid from, so the biggest move is
 * not simply spent first. Without the fighters it falls back to the hardest hit by power.
 * Null when nothing is affordable.
 */
export function chooseAction(type, view, weapon, extra = {}) {
    const { me, foe, mode = 'fight', diff = 0, rng } = extra;
    const all = offeredActions(type, view, weapon, me ? activeAbilities(me) : undefined, mode, me?.loadout,
        me ? { generic: true, computer: true, fighter: me } : {}).filter(a => canPay(view, a));
    // Bracing and dodging are chosen by the fighter's combat style (below), not by comparing blows.
    const acts = all.filter(a => !a.generic);
    const guards = all.filter(a => a.generic && !a.locked);
    if (!acts.length) return guards[0] || null;
    const attacks = acts.filter(a => !a.self);
    const selfActs = acts.filter(a => a.self);
    if (!attacks.length) return selfActs[0] || null;
    if (!me || !foe) {
        return attacks.reduce((best, act) => ((Number(act.power) || 0) > (Number(best.power) || 0) ? act : best));
    }

    // Which pool a blow lands on in this kind of fight.
    const hit = mode === 'spar' && view.pools.guard ? 'guard' : 'health';
    const mineMax = Math.max(1, me.view.pools[hit]?.max || 1);
    const theirMax = Math.max(1, foe.view.pools[hit]?.max || 1);
    const incoming = bestExpected(type, foe, me, -diff, mode);

    const valueOf = (act) => {
        const worth = costFactor(view, act);
        if (!act.self) return (expectedDamage(type, me, foe, act, diff) / theirMax) * worth;
        let v = 0;
        const block = Number(act.effect?.block) || 0;
        const heal = Number(act.effect?.heal) || 0;
        if (block > 0 && !(me.shield > 0)) {
            // Bracing is worth more the more hurt I am; at full strength it mostly wastes a turn.
            const pool = me.view.pools[hit];
            const hurt = pool && pool.max > 0 ? 1 - pool.cur / pool.max : 0;
            v += ((incoming * block) / mineMax) * (0.25 + 0.75 * hurt);
        }
        if (heal > 0 && mode !== 'spar') {
            const h = me.view.pools.health;
            if (h) v += Math.min(h.max - h.cur, Math.round(h.max * heal)) / Math.max(1, h.max);
        }
        if (act.form) {
            // Entering a form is worth what it adds to the best blow, over the next couple of turns.
            const inForm = formAbilities(me.abilities, act.form);
            const gain = bestExpected(type, me, foe, diff, mode, inForm) - bestExpected(type, me, foe, diff, mode);
            v += Math.max(0, gain) * 2 / theirMax;
        }
        return v * 0.95 * worth;
    };

    // First the style: a chance to brace or dodge instead, shaped by how hurt they are and how hard the
    // next blow is expected to land. Only with a random source, so a fight with a seed replays exactly.
    if (guards.length && typeof rng === 'function') {
        const style = me.style || { defend: 0, evade: 0 };
        const pool = me.view.pools[hit];
        const hurt = pool && pool.max > 0 ? 1 - pool.cur / pool.max : 0;
        const danger = incoming / mineMax;
        const urge = Math.min(1.6, Math.max(0.3, 0.4 + 1.2 * hurt + 1.5 * danger));
        const want = (key) => {
            if (!guards.some(g => g.key === key)) return 0;
            if (key === 'defend' && me.shield > 0) return 0;
            if (key === 'evade' && me.evade > 0) return 0;
            return Math.min(0.9, Math.max(0, ((Number(style[key]) || 0) / 100) * urge * 0.65));
        };
        const pd = want('defend');
        const pe = want('evade');
        const p = 1 - (1 - pd) * (1 - pe);
        if (p > 0 && rng() < p) {
            const key = rng() * (pd + pe) < pd ? 'defend' : 'evade';
            const g = guards.find(x => x.key === key);
            if (g) return g;
        }
    }

    let best = null;
    let bestValue = -1;
    for (const act of acts) {
        const v = valueOf(act);
        if (v > bestValue + 1e-9) { best = act; bestValue = v; }
    }
    return best || attacks[0];
}

/** The side that opposes this one. */
const otherSide = (side) => (side === 'player' ? 'foe' : 'player');

/**
 * Team fights (fork). Anyone may fight on either side, one to four a side (see gear teams). The
 * outnumbered get their back to the wall: for each foe more than they have friends standing, a
 * bonus to hit and to damage, capped. Even sides, and every 1 against 1, get nothing.
 * @returns {{ hit: number, mult: number }}
 */
export function teamEdge(type, state, actor) {
    const wall = gearRules(type).teams.backToWall;
    const extra = Math.min(Math.max(0, wall.max || 0), Math.max(0, living(state, otherSide(actor.side)).length - living(state, actor.side).length));
    return { hit: extra * (wall.hitPerFoe || 0), mult: 1 + extra * (wall.multPerFoe || 0) };
}

/**
 * Crowding (fork, a fight started with crowding on): bodies on one side get in each other's way.
 * Each friend who has already gone for the same target this round costs the next attacker
 * teams.crowding.hitPerAttacker on the roll, down to teams.crowding.max. The first attacker on a
 * target is never crowded, so 1 against 1 and spread-out teams are untouched.
 * @returns {number} a roll modifier, 0 or below
 */
export function crowdPenalty(type, state, actor, target) {
    if (!state?.crowding || !actor || !target) return 0;
    const rule = gearRules(type).teams.crowding;
    const engaged = state.engaged?.round === state.round ? state.engaged.by[target.id] || [] : [];
    const friends = engaged.filter(id => id !== actor.id && state.fighters[id]?.side === actor.side).length;
    const per = Number(rule.hitPerAttacker) || 0;
    const floor = Math.min(0, Number(rule.max) || 0);
    return Math.max(floor, friends * per) || 0;
}

/** Notes that this fighter went for that target this round, for crowding. */
function engage(state, actor, target) {
    if (!state.crowding) return;
    if (state.engaged?.round !== state.round) state.engaged = { round: state.round, by: {} };
    const list = state.engaged.by[target.id] || (state.engaged.by[target.id] = []);
    if (!list.includes(actor.id)) list.push(actor.id);
}

/**
 * What lasting effects do to one blow's roll: the attacker's blindness, and the cover (smoke) the
 * defender stands in. 0 when neither has any, which is every fight without tools.
 */
export function effectHit(attacker, defender) {
    let hit = 0;
    for (const e of attacker?.effects || []) if (e.type === 'blind') hit += Number(e.hit) || 0;
    for (const e of defender?.effects || []) if (e.type === 'cover') hit += Number(e.hit) || 0;
    return hit;
}

/** A lasting effect on a fighter. It wears off after `turns` of that fighter's own turns. */
function addEffect(state, fighter, effect) {
    if (!fighter.effects) fighter.effects = [];
    fighter.effects.push({ ...effect, left: Math.max(1, Math.round(Number(effect.left) || 1)), at: state.turnNo || 0 });
}

/** One of their own turns has ended: effects count down. One put on during this very turn does not. */
function tickEffects(state, fighter) {
    if (!fighter?.effects?.length) return;
    for (const e of fighter.effects) if (e.at !== (state.turnNo || 0)) e.left--;
    fighter.effects = fighter.effects.filter(e => e.left > 0);
}

/** The share of their health a fighter has left (1 when the world has no health pool). */
function healthShare(fighter) {
    const h = fighter.view.pools.health;
    return h && h.max > 0 ? h.cur / h.max : 1;
}

/** A side's standing health, as a share of what it started with in all. */
function sideShare(state, side) {
    let cur = 0;
    let max = 0;
    for (const f of state.order.map(id => state.fighters[id]).filter(x => x.side === side)) {
        const h = f.view.pools.health;
        if (!h) continue;
        max += h.max;
        if (!f.down) cur += h.cur;
    }
    return max > 0 ? cur / max : 1;
}

/** When a computer-run fighter runs: below this share of their health ... */
const RUN_BELOW = 0.2;
/** ... with their side's standing health under this share of the other side's (outnumbered, or not). */
const RUN_GAP_OUTNUMBERED = 0.6;
const RUN_GAP_EVEN = 0.3;

/**
 * Whether a computer-run fighter turns to run (a fight started with aiFlee only): real fights
 * only, badly hurt, their side clearly losing, and a fair chance of getting away. One who is not
 * outnumbered needs to be losing by much more before they give up the field (balance sims: an
 * even duel should seldom end in running).
 */
export function wantsToFlee(type, state, actor) {
    if (!state?.aiFlee || state.mode !== 'fight' || !actor) return false;
    if (healthShare(actor) >= RUN_BELOW) return false;
    const mine = sideShare(state, actor.side);
    const theirs = sideShare(state, otherSide(actor.side));
    const outnumbered = livingOf(state, otherSide(actor.side)).length > livingOf(state, actor.side).length;
    if (mine >= theirs * (outnumbered ? RUN_GAP_OUTNUMBERED : RUN_GAP_EVEN)) return false;
    const odds = fleeChance(type, state, actor);
    return Boolean(odds) && odds.chance >= 30;
}

/** A healing tool a computer-run fighter would reach for now: in a real fight, below a third of their health. */
function healTool(state, actor) {
    if (state.mode !== 'fight' || healthShare(actor) >= 0.35) return null;
    return toolActions(state, actor).find(t => t.usable && t.effect.type === 'heal') || null;
}

/**
 * Who this fighter goes for when nobody is choosing for them: the opponent they would hurt most,
 * counted as a share of that opponent's health, with the badly hurt favoured (finishing a wounded
 * foe beats chipping a fresh one). Deterministic. Null when nobody opposes them.
 */
export function pickTarget(type, state, actor) {
    const hit = state.mode === 'spar' && actor.view.pools.guard ? 'guard' : 'health';
    let best = null;
    let bestScore = -1;
    for (const foe of living(state, otherSide(actor.side))) {
        const pool = foe.view.pools[hit];
        const max = Math.max(1, pool?.max || 1);
        const hurt = pool ? 1 - pool.cur / max : 0;
        const score = bestExpected(type, actor, foe, state.diff * (actor.side === 'player' ? 1 : -1), state.mode) / max + 0.5 * hurt;
        if (score > bestScore + 1e-9) { best = foe; bestScore = score; }
    }
    return best;
}

/**
 * The current fighter takes their turn by themselves: the computer's best choice against the
 * opponent they would pick. A fighter with nothing they can do (or nobody to hit) stands down.
 * @returns {{ actor: object, events: object[] } | null} null when the fight is over
 */
export function autoTurn(type, state) {
    if (!state || state.over) return null;
    const actor = currentActor(state);
    if (!actor) return null;
    // New choices, each switched on by what the fight was given: running away, and the belt.
    if (wantsToFlee(type, state, actor)) {
        const out = attemptFlee(type, state);
        return { actor, events: out.events || [] };
    }
    const salve = healTool(state, actor);
    if (salve) {
        const out = takeTurn(type, state, salve.key, actor.id);
        if (out.ok) return { actor, events: out.events || [] };
    }
    const target = pickTarget(type, state, actor);
    const action = target ? chooseAction(type, actor.view, actor.weapon, {
        me: actor, foe: target, mode: state.mode, diff: playerDiff(state, actor), rng: state.rng,
    }) : null;
    if (!target || !action) {
        actor.down = true;
        skipTurn(state, `${actor.name} has nothing they can do.`);
        return { actor, events: [] };
    }
    const out = takeTurn(type, state, action.key, target.id);
    return { actor, events: out.events || [] };
}

function spend(fighter, action) {
    const amount = Number(action?.cost?.amount) || 0;
    if (!amount) return;
    const pool = fighter.view.pools[action.cost.pool];
    if (pool) pool.cur = Math.max(0, pool.cur - amount);
}

/**
 * Puts damage on the pools that matter for this kind of fight.
 * Sparring: the guard pool, and they yield at 0. A real fight: armour, then health.
 * @returns {{ pool: string, taken: number, down: boolean }}
 */
function applyDamage(fighter, amount, mode) {
    const left = Math.max(0, Math.round(Number(amount) || 0));
    const pools = fighter.view.pools;
    if (mode === 'spar' && pools.guard) {
        const taken = Math.min(pools.guard.cur, left);
        pools.guard.cur -= taken;
        const down = pools.guard.cur <= 0;
        fighter.down = down;
        return { pool: 'guard', taken, down };
    }
    let rest = left;
    if (pools.armor && rest > 0) {
        const taken = Math.min(pools.armor.cur, rest);
        pools.armor.cur -= taken;
        rest -= taken;
    }
    if (pools.health && rest > 0) pools.health.cur = Math.max(0, pools.health.cur - rest);
    const down = (pools.health?.cur ?? 1) <= 0;
    fighter.down = down;
    return { pool: 'health', taken: left, down };
}

function livingOf(state, side) {
    return state.order.map(id => state.fighters[id]).filter(f => f.side === side && !f.down);
}

/** The combatant whose turn it is, or null when the fight is over. */
export function currentActor(state) {
    if (!state || state.over) return null;
    return state.fighters[state.order[state.turn]] || null;
}

/** Combatants on a side who have not yielded or fallen. */
export function living(state, side) {
    return livingOf(state, side);
}

function checkOver(state) {
    const sides = [...new Set(state.order.map(id => state.fighters[id].side))];
    for (const side of sides) {
        if (!livingOf(state, side).length) {
            // The last of a side to leave got away rather than fell: the side fled the field.
            const ranOff = state.justFled && state.fighters[state.justFled]?.side === side;
            state.over = ranOff ? { loser: side, fled: true } : { loser: side };
            return true;
        }
    }
    return false;
}

/**
 * Moves the turn to the next combatant still standing. A full lap starts the next round. A stunned
 * fighter's turn passes at once (written in the log), and the turn moves on again.
 */
function advance(state) {
    const n = state.order.length;
    for (let hop = 0; hop <= n * 4; hop++) {
        if (checkOver(state)) return;
        let moved = false;
        for (let step = 1; step <= n; step++) {
            const idx = (state.turn + step) % n;
            if (!state.fighters[state.order[idx]].down) {
                if (idx <= state.turn) state.round++;
                state.turn = idx;
                moved = true;
                break;
            }
        }
        const next = state.fighters[state.order[state.turn]];
        if (!moved || !(next?.stun > 0)) return;
        next.stun--;
        state.turnNo = (state.turnNo || 0) + 1;
        state.log.push({ actor: next.id, skip: true, stunned: true, reason: `${next.name} is stunned and loses the turn.` });
        tickEffects(state, next);
    }
}

/** The current fighter's turn is over: their effects count down and the next one is up. */
function endTurn(state, actor) {
    // A guard holds until its owner next acts: it is "fresh" through the turn it was declared, and lapses at the end of the next.
    if (actor?.guarding) { if (actor.guarding.fresh) actor.guarding.fresh = false; else actor.guarding = null; }
    if (actor) tickEffects(state, actor);
    state.turnNo = (state.turnNo || 0) + 1;
    advance(state);
    state.justFled = null;
}

/**
 * Starts a fight.
 *
 * @param {object} type World type.
 * @param {{ id: string, name: string, side: 'player'|'foe', data: object, weapon?: object }[]} people
 * @param {{ seed?: number, rng?: () => number, mode?: 'spar'|'fight', diff?: number, poolScale?: number,
 *   crowding?: boolean, aiFlee?: boolean }} [opts]
 *   diff is the player's edge. It is added to their rolls and taken off their opponent's.
 *   crowding turns on the crowding rule (crowdPenalty); aiFlee lets computer-run fighters run away
 *   (wantsToFlee). Both are off unless given.
 */
export function startFight(type, people, opts = {}) {
    const seed = (Number(opts.seed) || 0) >>> 0;
    const rng = typeof opts.rng === 'function' ? opts.rng : mulberry32(seed || 1);
    const mode = opts.mode === 'fight' ? 'fight' : 'spar';
    const fighters = {};
    const rolled = [];
    const poolScale = Number(opts.poolScale) > 0 ? Number(opts.poolScale) : 1;
    for (const p of people) {
        const view = project(p.data, type);
        // Pools are sized for the fight's intended length. Health shows as a percentage, so this never reads as a bigger number.
        if (poolScale !== 1) {
            for (const role of ['health', 'guard', 'armor']) {
                const pool = view.pools[role];
                if (!pool) continue;
                pool.max = Math.max(1, Math.round(pool.max * poolScale));
                pool.cur = pool.cur > 0 ? Math.min(pool.max, Math.max(1, Math.round(pool.cur * poolScale))) : 0;
            }
        }
        const loadout = resolveLoadout(type, p.data, { weapon: p.weapon });
        const gearActions = buildGearActions(type, loadout);
        const fighter = {
            id: p.id, name: p.name, side: p.side === 'player' ? 'player' : 'foe', view, down: false,
            // A fighter who holds gear but was given no old-style weapon still names a proficiency, so the
            // weapon is the attack and the world's other basic attacks are not offered beside it.
            weapon: p.weapon || (loadout.main.default ? null : { name: loadout.main.name, prof: loadout.main.prof, power: 0 }),
            loadout, gearActions,
            // What they hold, in words, for the screen and the report: only when they really hold something.
            weaponName: loadout.main.default ? (p.weapon?.name || '') : weaponName(loadout),
            abilities: gatedAbilities(gearRules(type), abilityList(type), resolveAbilities(type, p.data?.abilities), loadout).filter(ab => !Array.isArray(ab.modes) || ab.modes.includes(mode)),
            shield: 0,
            evade: 0,
            healUses: 0,
            // How this fighter chooses when the computer plays them (see combat-style.js), and the
            // turn counters that limit bracing and dodging.
            style: resolveStyle(view, p.data?.style, { class: view.meta?.class }),
            turns: 0,
            defHistory: [],
            opening: null,
            sig: JSON.stringify([p.data?.stats, p.data?.meta, p.data?.profs, p.data?.abilities, p.weapon, loadout.main, loadout.off, loadout.focus]),
            // Fork: lasting effects, a stun, running away, a form, and the belt's uses for this fight.
            effects: [],
            stun: 0,
            fled: false,
            fleeTries: 0,
            form: null,
            toolUses: Object.fromEntries((loadout.tools || []).map(t => [t.itemId, Math.max(0, Number(t.uses) || 0)])),
        };
        if (mode === 'spar' && view.pools.guard) fighter.down = view.pools.guard.cur <= 0;
        else fighter.down = (view.pools.health?.cur ?? 1) <= 0;
        fighters[p.id] = fighter;
        rolled.push({ id: p.id, init: rollInitiative(type, view, rng) });
    }
    rolled.sort((a, b) => b.init - a.init || String(a.id).localeCompare(String(b.id)));
    const state = {
        typeId: type.id,
        poolScale,
        mode,
        diff: Number(opts.diff) || 0,
        seed,
        rng,
        round: 1,
        order: rolled.map(r => r.id),
        initiative: Object.fromEntries(rolled.map(r => [r.id, r.init])),
        turn: 0,
        fighters,
        log: [],
        over: null,
        // Fork: rules a fight is started with. Both off unless asked for, so older fights replay the same.
        crowding: Boolean(opts.crowding),
        aiFlee: Boolean(opts.aiFlee),
        engaged: null,
        turnNo: 0,
        justFled: null,
    };
    const first = rolled.findIndex(r => !fighters[r.id].down);
    state.turn = first < 0 ? 0 : first;
    checkOver(state);
    return state;
}

function playerDiff(state, actor) {
    return actor.side === 'player' ? state.diff : -state.diff;
}

/** Puts back a number of health points, up to the maximum. Returns what was gained. */
function healPoints(fighter, points) {
    const pool = fighter.view.pools.health;
    if (!pool) return 0;
    const gain = Math.max(0, Math.min(pool.max - pool.cur, Math.round(points)));
    pool.cur += gain;
    return gain;
}

function healFighter(fighter, share) {
    const pool = fighter.view.pools.health;
    if (!pool || !(share > 0)) return 0;
    const gain = Math.max(0, Math.min(pool.max - pool.cur, Math.round(pool.max * share)));
    pool.cur += gain;
    return gain;
}

/**
 * One combatant's action: pay, strike, and a follow-up when the type allows and the target
 * is still standing. Then the turn passes.
 *
 * Abilities go through here too: a chosen one is an action named "ability:<id>", and passives
 * roll from the fight's own random source after the attack roll, so a seed still replays.
 *
 * @returns {{ ok: boolean, reason?: string, events?: object[] }}
 */
export function takeTurn(type, state, actionKey, targetId) {
    if (!state || state.over) return { ok: false, reason: 'The fight is over.' };
    const actor = currentActor(state);
    if (!actor) return { ok: false, reason: 'Nobody is left to act.' };
    if (String(actionKey).startsWith('tool:')) return useTool(type, state, actor, String(actionKey).slice(5), targetId);
    if (actionKey === 'guard') return guardAlly(state, actor, targetId);
    const action = actor.gearActions?.byKey.get(actionKey)
        || [...(type.actions || []), ...abilityActions(activeAbilities(actor), state.mode)].find(a => a.key === actionKey)
        || (actionKey === 'unarmed' ? unarmedAction(type, actor.view) : null)
        || genericActions('fight', actor).find(a => a.key === actionKey);
    if (!action) {
        const held = String(actionKey).startsWith('ability:') && actor.abilities.find(x => `ability:${x.id}` === actionKey);
        if (held && state.mode === 'spar' && heals(held)) return { ok: false, reason: 'There is no healing in a spar.' };
        return { ok: false, reason: 'That is not an action.' };
    }
    if (!canPay(actor.view, action)) return { ok: false, reason: 'Not enough left to pay for that.' };
    if (action.self && state.mode === 'spar' && Number(action.effect?.heal) > 0) {
        return { ok: false, reason: 'There is no healing in a spar.' };
    }
    const target = action.self ? actor : state.fighters[targetId];
    if (!action.self && (!target || target.side === actor.side || target.down)) {
        return { ok: false, reason: 'Pick someone still standing on the other side.' };
    }
    const defensive = Boolean(action.generic && (action.key === 'defend' || action.key === 'evade'));
    if (defensive) {
        const lock = defensiveLocked(actor);
        if (lock) return { ok: false, reason: lock };
    }
    // A dodge or a brace lasts until this fighter next acts; an opening from a dodge is spent on this turn's attack.
    actor.evade = 0;
    const turnIndex = actor.turns || 0;
    actor.turns = turnIndex + 1;
    if (defensive) (actor.defHistory ||= []).push(turnIndex);
    const opening = !action.self ? actor.opening : null;
    if (!action.self) actor.opening = null;

    const events = [];
    const foeView = action.self ? actor.view : target.view;

    // The turn opens: passives that heal.
    if (state.mode !== 'spar') {
        for (const ab of passivesFor(activeAbilities(actor), 'turnStart', state.mode, actor.view)) {
            if (!fires(ab, actor.view, foeView, state.rng)) continue;
            const gain = healFighter(actor, Number(ab.effect?.heal));
            if (gain > 0) events.push({ actor: actor.id, target: actor.id, passive: true, label: ab.label, healed: gain, pool: 'health', band: '', taken: 0, down: false });
        }
    }

    spend(actor, action);

    if (action.self) {
        const block = Number(action.effect?.block) || 0;
        let healed = 0;
        if (block > 0) actor.shield = Math.max(actor.shield, Math.min(1, block));
        const evade = Number(action.effect?.evade) || 0;
        if (evade > 0) actor.evade = Math.min(1, evade);
        if (action.key === 'heal') actor.healUses = (actor.healUses || 0) + 1;
        if (Number(action.effect?.heal) > 0) healed = healFighter(actor, Number(action.effect.heal));
        // A form: from now on their abilities are the form's (see formAbilities).
        if (action.form) actor.form = { ...action.form };
        events.push({
            actor: actor.id, target: actor.id, action: action.key, label: action.label, ability: true,
            ...(action.prof ? { prof: action.prof } : {}),
            healed, braced: block > 0 ? block : 0, ...(evade > 0 ? { evading: evade } : {}), pool: 'health', band: '', taken: 0, down: false,
            ...(action.form ? { form: action.form.label } : {}),
        });
        state.log.push(...events);
        endTurn(state, actor);
        return { ok: true, events };
    }

    const followMult = Number(type.resolution?.followUpMult) || 1;
    // hand: 'off' is the second blade of a pair (or a separate off-hand weapon): a lesser strike.
    const aimed = target;
    const strike = (follow, hand = 'main') => {
        // A friend standing guard steps in: the blow is rolled against them (their defense, their brace, their
        // defending abilities) and lands on them. Looked at again for every strike, so a follow-up finds them gone if they fell.
        const target = guardianOf(state, aimed) || aimed;
        const off = hand === 'off' ? actor.gearActions?.off : null;
        const edge = teamEdge(type, state, actor);
        // Crowding and lasting effects: both 0 in a fight that has neither, so the roll is as it was.
        const press = crowdPenalty(type, state, actor, target) + effectHit(actor, target) + (opening ? opening.hit : 0);
        const result = resolveAttack(type, actor.view, target.view, {
            prof: action.prof, power: off ? off.power : actionPower(action, actor), channel: action.channel,
            ...(action.element && !off ? { element: action.element } : {}),
        }, { rng: state.rng, diff: playerDiff(state, actor) + edge.hit + press, gear: off ? off.gear : action.gear });
        let damage = result.damage;
        const notes = [];
        let braceUsed = false;
        let dodgedBlow = false;
        // A dodge in hand: one chance to turn the blow aside completely.
        if (damage > 0 && target.evade > 0) {
            const dodged = state.rng() < target.evade;
            target.evade = 0;
            // A clean dodge leaves the attacker off balance: the dodger's next attack finds an opening.
            if (dodged) { damage = 0; notes.push('evaded'); target.opening = { hit: 3, mult: 1.25 }; dodgedBlow = true; }
        }
        let blocked = 0;
        let drain = Number(action.effect?.drain) || 0;
        let firedDefend = [];
        if (damage > 0) {
            let mult = blowMult(action.effect, actor.view) * (follow ? followMult : 1) * edge.mult * (opening ? opening.mult : 1);
            for (const ab of passivesFor(activeAbilities(actor), 'attack', state.mode, actor.view)) {
                if (!fires(ab, actor.view, target.view, state.rng)) continue;
                mult *= blowMult(ab.effect, actor.view);
                drain += Number(ab.effect?.drain) || 0;
                notes.push(ab.label);
            }
            damage = Math.max(1, Math.round(damage * mult));
            if (target.shield > 0) { blocked = target.shield; target.shield = 0; notes.push('braced'); braceUsed = true; }
            // Each defending passive is rolled once; what it does (block, heal, counter) all follows from that roll.
            firedDefend = passivesFor(activeAbilities(target), 'defend', state.mode, target.view)
                .filter(ab => fires(ab, target.view, actor.view, state.rng));
            for (const ab of firedDefend) {
                const share = Number(ab.effect?.block) || 0;
                if (share > 0) { blocked = Math.max(blocked, Math.min(1, share)); notes.push(ab.label); }
            }
            if (blocked > 0) damage = Math.round(damage * (1 - blocked));
        }
        const applied = applyDamage(target, damage, state.mode);
        let healed = 0;
        let drained = 0;
        if (state.mode !== 'spar' && damage > 0) {
            if (drain > 0) drained = healPoints(actor, damage * drain);
            if (!target.down) {
                for (const ab of firedDefend) {
                    if (!heals(ab)) continue;
                    healed += healFighter(target, Number(ab.effect.heal));
                    if (!notes.includes(ab.label)) notes.push(ab.label);
                }
            }
        }
        events.push({
            actor: actor.id, target: target.id, action: action.key, label: off ? off.name : action.label,
            ...(action.prof ? { prof: action.prof } : {}),
            // A weapon attack is already named after the weapon; other actions keep the weapon beside them.
            weapon: actor.weaponName || '', follow, band: result.band,
            ...(action.weapon ? { tier: actor.loadout.main.tierLabel } : {}),
            ...(off ? { offhand: true } : {}),
            ...(result.gearCrit ? { gearCrit: true } : {}), total: result.total, natural: result.natural,
            damage, margin: result.margin, advantage: result.element ? [...result.advantage.labels, result.element.label] : result.advantage.labels,
            pool: applied.pool, taken: applied.taken, down: applied.down,
            passives: notes, blocked: Math.round(blocked * 100), healed, drained,
            ...(opening ? { opening: true } : {}),
            ...(dodgedBlow ? { evaded: true } : {}),
            ...(target !== aimed ? { guarded: aimed.id } : {}),
        });
        // A brace that turned a blow aside is answered at once: a riposte at the defender's own best free attack.
        if (braceUsed && result.damage > 0 && !target.down && !actor.down) {
            const back = offeredActions(type, target.view, target.weapon, [], state.mode, target.loadout).find(x => !x.self && !(x.cost?.amount));
            if (back) {
                const r = resolveAttack(type, target.view, actor.view, {
                    prof: back.prof, power: actionPower(back, target), channel: back.channel,
                }, { rng: state.rng, diff: playerDiff(state, target) + effectHit(target, actor), gear: back.gear });
                const dealt = r.damage > 0 ? Math.max(1, Math.round(r.damage * 0.6)) : 0;
                const hitBack = applyDamage(actor, dealt, state.mode);
                events.push({
                    actor: target.id, target: actor.id, action: back.key, label: 'Riposte', counter: true, riposte: true,
                    ...(back.prof ? { prof: back.prof } : {}),
                    weapon: target.weaponName || '', follow: false, band: r.band, total: r.total, natural: r.natural,
                    damage: dealt, advantage: [], pool: hitBack.pool, taken: hitBack.taken, down: hitBack.down,
                    passives: [], blocked: 0, healed: 0, drained: 0,
                });
            }
        }
        // A counter: the one who was struck hits back at once, with the best attack that costs nothing.
        if (damage > 0 && !target.down) {
            for (const ab of firedDefend) {
                const strength = Number(ab.effect?.counter) || 0;
                if (!(strength > 0)) continue;
                const back = offeredActions(type, target.view, target.weapon, [], state.mode, target.loadout).find(x => !x.self && !(x.cost?.amount));
                if (!back) continue;
                const r = resolveAttack(type, target.view, actor.view, {
                    prof: back.prof, power: actionPower(back, target), channel: back.channel,
                }, { rng: state.rng, diff: playerDiff(state, target) + effectHit(target, actor), gear: back.gear });
                const dealt = r.damage > 0 ? Math.max(1, Math.round(r.damage * strength)) : 0;
                const hitBack = applyDamage(actor, dealt, state.mode);
                events.push({
                    actor: target.id, target: actor.id, action: back.key, label: ab.label, counter: true,
                    ...(back.prof ? { prof: back.prof } : {}),
                    weapon: back.weapon ? '' : (target.weaponName || ''), follow: false, band: r.band, total: r.total, natural: r.natural,
                    damage: dealt, advantage: [], pool: hitBack.pool, taken: hitBack.taken, down: hitBack.down,
                    passives: [], blocked: 0, healed: 0, drained: 0,
                });
                break;
            }
        }
    };
    strike(false);
    if (action.weapon && actor.gearActions?.off && !target.down && !actor.down) strike(false, 'off');
    if (!target.down && !actor.down && grantsFollowUp(type, actor.view, target.view, state.rng)) strike(true);
    engage(state, actor, target);
    state.log.push(...events);
    endTurn(state, actor);
    return { ok: true, events };
}

/** Who is standing guard over this fighter right now, or null. */
export function guardianOf(state, fighter) {
    if (!fighter) return null;
    for (const id of state.order) {
        const f = state.fighters[id];
        if (f && f.id !== fighter.id && f.side === fighter.side && !f.down && !f.fled && f.guarding?.id === fighter.id) return f;
    }
    return null;
}

/**
 * Guard a friend: a turn spent standing in front of them. Until the guard next acts, every blow aimed at the friend is
 * rolled against the guard instead - the same roll as any attack, the attacker against the one who chose to guard, with
 * their defense and their defending abilities - and the first of them meets a brace as well. The lock on braces and
 * dodges applies, because this is one.
 *
 * @returns {{ ok: boolean, reason?: string, events?: object[] }}
 */
function guardAlly(state, actor, allyId) {
    const ally = state.fighters[allyId];
    if (!ally || ally.id === actor.id || ally.side !== actor.side || ally.down || ally.fled) {
        return { ok: false, reason: 'Pick a friend who is still standing.' };
    }
    const lock = defensiveLocked(actor);
    if (lock) return { ok: false, reason: lock };
    actor.evade = 0;
    const turnIndex = actor.turns || 0;
    actor.turns = turnIndex + 1;
    (actor.defHistory ||= []).push(turnIndex);
    const block = defendShare(actor.view);
    actor.shield = Math.max(actor.shield || 0, block);
    actor.guarding = { id: ally.id, fresh: true };
    const events = [{
        actor: actor.id, target: ally.id, action: 'guard', label: 'Guard', guard: true, braced: block,
        pool: 'health', band: '', taken: 0, down: false,
    }];
    state.log.push(...events);
    endTurn(state, actor);
    return { ok: true, events };
}

/** Passes the turn when a combatant has nothing they can do. */
export function skipTurn(state, reason) {
    if (!state || state.over) return { ok: false, reason: 'The fight is over.' };
    const actor = currentActor(state);
    state.log.push({ actor: actor?.id, skip: true, reason: reason || 'Cannot act.' });
    endTurn(state, actor);
    return { ok: true };
}

/* ---- tools on the belt (fork) ------------------------------------------------------- */

const OFFENSIVE = new Set(['damage', 'blind', 'stun']);

/**
 * The belt as turn choices for one fighter: a `tool:<itemId>` action per tool, with how many uses
 * are left in this fight and whether it can be used now. Uses are counted per fight: the belt is
 * full again for the next one, and nothing is written back to the sheet. No tool works in a spar.
 * @returns {{ key: string, itemId: string, label: string, name: string, verb: string, effect: object,
 *   uses: number, usable: boolean, reason: string, needsTarget: boolean }[]}
 */
export function toolActions(state, fighter) {
    const out = [];
    for (const t of fighter?.loadout?.tools || []) {
        const uses = Number(fighter.toolUses?.[t.itemId]) || 0;
        const e = t.effect || {};
        let reason = '';
        if (state?.mode === 'spar') reason = 'Tools stay on the belt in a spar.';
        else if (uses <= 0) reason = 'Used up for this fight.';
        else if (e.type === 'heal' && !needsHealing(state, fighter, e)) reason = 'Nobody it would help is hurt.';
        out.push({
            key: `tool:${t.itemId}`, itemId: t.itemId, label: t.name, name: t.name, verb: t.verb || 'uses', effect: e,
            uses, usable: !reason, reason, needsTarget: OFFENSIVE.has(e.type) && (e.area || 'one') === 'one', tool: true,
        });
    }
    return out;
}

function needsHealing(state, fighter, e) {
    const who = e.area === 'self' || !e.area ? [fighter] : livingOf(state, fighter.side);
    return who.some(f => { const h = f.view.pools.health; return h && h.cur < h.max; });
}

/** A tool's chance (0 to 100): a number, a formula over a (the user) and d (the target), or sure. */
function toolChance(e, user, target) {
    if (e.chance === undefined || e.chance === null || e.chance === '') return 100;
    const pct = typeof e.chance === 'string' ? abilityChance(e.chance, user.view, target.view) : Number(e.chance);
    return Math.max(0, Math.min(100, Number(pct) || 0));
}

/** The channel a thrown tool hits through: the world's first (its physical one). */
const toolChannel = (type) => (type.channels || [])[0]?.id;

/**
 * Uses a tool from the belt in place of an attack. Damage tools roll like a blow with the tool's
 * power and no weapon; blind and stun roll their chance; smoke covers the user's side (harder to
 * hit, easier to get away); a salve heals. Then the turn passes.
 */
function useTool(type, state, actor, itemId, targetId) {
    const tool = toolActions(state, actor).find(t => t.itemId === itemId);
    if (!tool) return { ok: false, reason: 'That is not on the belt.' };
    if (!tool.usable) return { ok: false, reason: tool.reason };
    const e = tool.effect;
    const area = e.area || 'one';
    let targets;
    if (OFFENSIVE.has(e.type)) {
        if (area === 'one') {
            const t = state.fighters[targetId];
            if (!t || t.side === actor.side || t.down) return { ok: false, reason: 'Pick someone still standing on the other side.' };
            targets = [t];
        } else targets = livingOf(state, otherSide(actor.side));
    } else targets = area === 'self' ? [actor] : livingOf(state, actor.side);

    actor.toolUses[itemId] = Math.max(0, (Number(actor.toolUses[itemId]) || 0) - 1);
    const events = [];
    const base = { actor: actor.id, tool: true, toolType: e.type, label: tool.name, verb: tool.verb, usesLeft: actor.toolUses[itemId] };
    for (const t of targets) {
        const ev = { ...base, target: t.id, band: '', taken: 0, damage: 0, pool: 'health', down: false, landed: true };
        if (e.type === 'damage') {
            const r = resolveAttack(type, actor.view, t.view, { prof: '', power: Number(e.power) || 0, channel: toolChannel(type) },
                { rng: state.rng, diff: playerDiff(state, actor) + effectHit(actor, t) });
            const applied = applyDamage(t, r.damage, state.mode);
            Object.assign(ev, { band: r.band, total: r.total, natural: r.natural, damage: r.damage, pool: applied.pool, taken: applied.taken, down: applied.down });
            if (Number(e.slow) > 0 && !t.down) { addEffect(state, t, { type: 'slow', slow: Number(e.slow), left: e.turns || 1 }); ev.slowed = Number(e.slow); }
        } else if (e.type === 'blind' || e.type === 'stun') {
            const pct = toolChance(e, actor, t);
            ev.chance = Math.round(pct);
            ev.landed = state.rng() * 100 < pct;
            if (ev.landed && e.type === 'blind') addEffect(state, t, { type: 'blind', hit: Number(e.hit ?? -3), left: e.turns || 1 });
            if (ev.landed && e.type === 'stun') t.stun = Math.max(t.stun || 0, Math.max(1, Math.round(Number(e.turns) || 1)));
        } else if (e.type === 'smoke') {
            addEffect(state, t, { type: 'cover', hit: Number(e.hit ?? -3), flee: Number(e.flee) || 0, left: e.turns || 1 });
        } else if (e.type === 'heal') {
            ev.healed = healFighter(t, Number(e.share) || 0.25);
        }
        events.push(ev);
    }
    state.log.push(...events);
    endTurn(state, actor);
    return { ok: true, events };
}

/* ---- running away (fork) ------------------------------------------------------------ */

/** How quick and lucky a fighter is, for a chase: speed, plus half their luck where the world has one. */
function agility(view) {
    const read = (id) => { try { return Number(view.role(id)) || 0; } catch { return 0; } };
    return read('speed') + 0.5 * read('luck');
}

/**
 * The odds of getting away, before the roll. The gear's flee numbers:
 *   base + perSpeed x (my agility - the quickest pursuer's) + perCover x friends who stay (two at most)
 *   + the cover smoke gives + perTry x earlier tries - perExtraFoe x each pursuer after the first,
 * kept between min and max. A pursuer who is stunned does not chase; one slowed is slower.
 * Null in a spar (there you yield) or when the fight is over.
 * @returns {{ chance: number, pursuers: object[], quickest: object|null } | null}
 */
export function fleeChance(type, state, actor) {
    if (!state || state.over || state.mode === 'spar' || !actor || actor.down) return null;
    const r = gearRules(type).flee;
    const pursuers = livingOf(state, otherSide(actor.side)).filter(f => !(f.stun > 0));
    let quickest = null;
    let best = -Infinity;
    for (const p of pursuers) {
        const slow = (p.effects || []).filter(e => e.type === 'slow').reduce((s, e) => s + (Number(e.slow) || 0), 0);
        const a = agility(p.view) - slow;
        if (a > best) { best = a; quickest = p; }
    }
    const mine = agility(actor.view);
    const friends = Math.min(2, livingOf(state, actor.side).filter(f => f !== actor).length);
    const smoke = Math.max(0, ...(actor.effects || []).filter(e => e.type === 'cover').map(e => Number(e.flee) || 0));
    const raw = r.base
        + (quickest ? r.perSpeed * (mine - best) : 0)
        + r.perCover * friends
        + smoke
        + r.perTry * (actor.fleeTries || 0)
        - r.perExtraFoe * Math.max(0, pursuers.length - 1);
    const chance = pursuers.length ? Math.round(Math.max(r.min, Math.min(r.max, raw))) : 100;
    return { chance, pursuers, quickest };
}

/**
 * The current fighter tries to run. One roll against fleeChance:
 *   missed        they are caught: the turn is lost, and the next try is easier (perTry)
 *   made it       they get away; unless it was clean (cleanMargin under the chance), the quickest
 *                 pursuer lands a parting blow at partingMult first, and one that drops them ends it
 * A fighter who gets away is out of the fight (fled), not fallen. When the last of a side runs,
 * the fight is over and that side fled (state.over.fled).
 * @returns {{ ok: boolean, reason?: string, events?: object[], escaped?: boolean }}
 */
export function attemptFlee(type, state) {
    if (!state || state.over) return { ok: false, reason: 'The fight is over.' };
    const actor = currentActor(state);
    if (!actor) return { ok: false, reason: 'Nobody is left to act.' };
    const odds = fleeChance(type, state, actor);
    if (!odds) return { ok: false, reason: 'There is no running from a spar: yield instead.' };
    const r = gearRules(type).flee;
    const roll = state.rng() * 100;
    const events = [];
    const ev = { actor: actor.id, target: actor.id, flee: true, chance: odds.chance, band: '', taken: 0, pool: 'health', down: false };
    if (roll >= odds.chance) {
        actor.fleeTries = (actor.fleeTries || 0) + 1;
        events.push({ ...ev, escaped: false });
    } else {
        const clean = odds.chance - roll >= r.cleanMargin;
        const chaser = odds.quickest;
        if (!clean && chaser) {
            const back = offeredActions(type, chaser.view, chaser.weapon, [], state.mode, chaser.loadout).find(x => !x.self && !(x.cost?.amount));
            if (back) {
                const hit = resolveAttack(type, chaser.view, actor.view, { prof: back.prof, power: actionPower(back, chaser), channel: back.channel },
                    { rng: state.rng, diff: playerDiff(state, chaser) + effectHit(chaser, actor), gear: back.gear });
                const dealt = hit.damage > 0 ? Math.max(1, Math.round(hit.damage * r.partingMult)) : 0;
                const applied = applyDamage(actor, dealt, state.mode);
                events.push({
                    actor: chaser.id, target: actor.id, action: back.key, label: back.label, parting: true,
                    weapon: back.weapon ? '' : (chaser.weaponName || ''), follow: false, band: hit.band, total: hit.total, natural: hit.natural,
                    damage: dealt, advantage: [], pool: applied.pool, taken: applied.taken, down: applied.down,
                    passives: [], blocked: 0, healed: 0, drained: 0,
                });
            }
        }
        if (actor.down) events.push({ ...ev, escaped: false, cutDown: true });
        else {
            actor.fled = true;
            actor.down = true;
            state.justFled = actor.id;
            events.push({ ...ev, escaped: true, clean });
        }
    }
    state.log.push(...events);
    endTurn(state, actor);
    return { ok: true, events, escaped: Boolean(actor.fled) };
}
