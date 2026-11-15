import { mulberry32 } from './combat-formula.js';
import { project } from './combat-roles.js';
import { resolveAttack, rollInitiative, grantsFollowUp, previewOdds } from './combat-math.js';
import { resolveAbilities, abilityActions, passivesFor, fires, heals, blowMult } from './combat-abilities.js';
import { resolveLoadout, weaponName } from './combat-gear.js';
import { buildGearActions } from './combat-weapons.js';

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
 * Pure: no DOM, no SillyTavern imports. Abilities are not in this piece.
 */

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
export function offeredActions(type, view, weapon, abilities = [], mode = 'fight', loadout = null) {
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
        const out = previewOdds(type, me.view, foe.view, { prof: action.prof, power, channel: action.channel }, { diff, gear: gearForPreview(action) });
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
function bestExpected(type, attacker, defender, diff, mode) {
    const acts = offeredActions(type, attacker.view, attacker.weapon, attacker.abilities, mode, attacker.loadout)
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
    const { me, foe, mode = 'fight', diff = 0 } = extra;
    const acts = offeredActions(type, view, weapon, me?.abilities, mode, me?.loadout).filter(a => canPay(view, a));
    if (!acts.length) return null;
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
        return v * 0.95 * worth;
    };

    let best = null;
    let bestValue = -1;
    for (const act of acts) {
        const v = valueOf(act);
        if (v > bestValue + 1e-9) { best = act; bestValue = v; }
    }
    return best || attacks[0];
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
            state.over = { loser: side };
            return true;
        }
    }
    return false;
}

/** Moves the turn to the next combatant still standing. A full lap starts the next round. */
function advance(state) {
    if (checkOver(state)) return;
    const n = state.order.length;
    for (let step = 1; step <= n; step++) {
        const idx = (state.turn + step) % n;
        if (!state.fighters[state.order[idx]].down) {
            if (idx <= state.turn) state.round++;
            state.turn = idx;
            return;
        }
    }
}

/**
 * Starts a fight.
 *
 * @param {object} type World type.
 * @param {{ id: string, name: string, side: 'player'|'foe', data: object, weapon?: object }[]} people
 * @param {{ seed?: number, rng?: () => number, mode?: 'spar'|'fight', diff?: number, poolScale?: number }} [opts]
 *   diff is the player's edge. It is added to their rolls and taken off their opponent's.
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
            abilities: resolveAbilities(type, p.data?.abilities).filter(ab => !Array.isArray(ab.modes) || ab.modes.includes(mode)),
            shield: 0,
            sig: JSON.stringify([p.data?.stats, p.data?.meta, p.data?.profs, p.data?.abilities, p.weapon, loadout.main, loadout.off, loadout.focus]),
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
    const action = actor.gearActions?.byKey.get(actionKey)
        || [...(type.actions || []), ...abilityActions(actor.abilities, state.mode)].find(a => a.key === actionKey);
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

    const events = [];
    const foeView = action.self ? actor.view : target.view;

    // The turn opens: passives that heal.
    if (state.mode !== 'spar') {
        for (const ab of passivesFor(actor.abilities, 'turnStart', state.mode, actor.view)) {
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
        if (Number(action.effect?.heal) > 0) healed = healFighter(actor, Number(action.effect.heal));
        events.push({
            actor: actor.id, target: actor.id, action: action.key, label: action.label, ability: true,
            healed, braced: block > 0 ? block : 0, pool: 'health', band: '', taken: 0, down: false,
        });
        state.log.push(...events);
        advance(state);
        return { ok: true, events };
    }

    const followMult = Number(type.resolution?.followUpMult) || 1;
    // hand: 'off' is the second blade of a pair (or a separate off-hand weapon): a lesser strike.
    const strike = (follow, hand = 'main') => {
        const off = hand === 'off' ? actor.gearActions?.off : null;
        const result = resolveAttack(type, actor.view, target.view, {
            prof: action.prof, power: off ? off.power : actionPower(action, actor), channel: action.channel,
        }, { rng: state.rng, diff: playerDiff(state, actor), gear: off ? off.gear : action.gear });
        let damage = result.damage;
        const notes = [];
        let blocked = 0;
        let drain = Number(action.effect?.drain) || 0;
        let firedDefend = [];
        if (damage > 0) {
            let mult = blowMult(action.effect, actor.view) * (follow ? followMult : 1);
            for (const ab of passivesFor(actor.abilities, 'attack', state.mode, actor.view)) {
                if (!fires(ab, actor.view, target.view, state.rng)) continue;
                mult *= blowMult(ab.effect, actor.view);
                drain += Number(ab.effect?.drain) || 0;
                notes.push(ab.label);
            }
            damage = Math.max(1, Math.round(damage * mult));
            if (target.shield > 0) { blocked = target.shield; target.shield = 0; notes.push('braced'); }
            // Each defending passive is rolled once; what it does (block, heal, counter) all follows from that roll.
            firedDefend = passivesFor(target.abilities, 'defend', state.mode, target.view)
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
            // A weapon attack is already named after the weapon; other actions keep the weapon beside them.
            weapon: action.weapon ? '' : (actor.weaponName || ''), follow, band: result.band,
            ...(action.weapon ? { tier: actor.loadout.main.tierLabel } : {}),
            ...(off ? { offhand: true } : {}),
            ...(result.gearCrit ? { gearCrit: true } : {}), total: result.total, natural: result.natural,
            damage, margin: result.margin, advantage: result.advantage.labels,
            pool: applied.pool, taken: applied.taken, down: applied.down,
            passives: notes, blocked: Math.round(blocked * 100), healed, drained,
        });
        // A counter: the one who was struck hits back at once, with the best attack that costs nothing.
        if (damage > 0 && !target.down) {
            for (const ab of firedDefend) {
                const strength = Number(ab.effect?.counter) || 0;
                if (!(strength > 0)) continue;
                const back = offeredActions(type, target.view, target.weapon, [], state.mode, target.loadout).find(x => !x.self && !(x.cost?.amount));
                if (!back) continue;
                const r = resolveAttack(type, target.view, actor.view, {
                    prof: back.prof, power: actionPower(back, target), channel: back.channel,
                }, { rng: state.rng, diff: playerDiff(state, target), gear: back.gear });
                const dealt = r.damage > 0 ? Math.max(1, Math.round(r.damage * strength)) : 0;
                const hitBack = applyDamage(actor, dealt, state.mode);
                events.push({
                    actor: target.id, target: actor.id, action: back.key, label: ab.label, counter: true,
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
    state.log.push(...events);
    advance(state);
    return { ok: true, events };
}

/** Passes the turn when a combatant has nothing they can do. */
export function skipTurn(state, reason) {
    if (!state || state.over) return { ok: false, reason: 'The fight is over.' };
    const actor = currentActor(state);
    state.log.push({ actor: actor?.id, skip: true, reason: reason || 'Cannot act.' });
    advance(state);
    return { ok: true };
}
