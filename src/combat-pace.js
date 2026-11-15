import { project } from './combat-roles.js';
import { startFight, takeTurn, skipTurn, currentActor, living, chooseAction } from './combat-fight.js';

/**
 * How long a fight should last (fork).
 *
 * Stats are on a 0 to 100 scale in every world type. How long a real fight takes is not left to
 * the damage numbers: it is set by how the two fighters compare, and the pools are then sized
 * so the fight comes out about that long. A turn here is one action by either side.
 *
 *   foe much weaker      Easy     about 5
 *   evenly matched       Medium   about 10
 *   foe stronger         Hard     about 20
 *   far stronger         Boss     about 30
 *
 * "Stronger" is the foe's power over yours, where power is the mean of the best attack,
 * best defence, speed and health, raised by level when the type has one. A spar (guard pool,
 * yield at 0) is aimed at half as long.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/** Power ratio (foe over player) and the turns a real fight should take at it. */
export const PACE_KNOTS = Object.freeze([[0.7, 5], [1.0, 10], [1.4, 20], [1.9, 30]]);
export const SPAR_SHARE = 0.5;
const CAP = 300;

function safe(fn, fallback) {
    try {
        const v = fn();
        return Number.isFinite(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

/** One fighter's overall power on the 0 to 100 scale, level included when the type has one. */
export function powerOf(type, view) {
    const channels = (type.channels || []).map(c => c.id);
    const best = (role) => Math.max(...(channels.length ? channels : [null]).map(ch => safe(() => view.role(role, ch), 0)));
    const parts = [best('attack'), best('defense'), safe(() => view.role('speed'), 0), view.pools?.health?.max ?? 0];
    const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
    const level = safe(() => Number(view.role('level')), 0);
    return Math.max(1, mean) * (1 + Math.max(0, level) / 40);
}

export function turnsForRatio(ratio) {
    const k = PACE_KNOTS;
    if (!(ratio > k[0][0])) return k[0][1];
    for (let i = 1; i < k.length; i++) {
        if (ratio <= k[i][0]) {
            const [x0, y0] = k[i - 1];
            const [x1, y1] = k[i];
            return y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0);
        }
    }
    return k[k.length - 1][1];
}

export function labelForTurns(turns) {
    if (turns < 7) return 'Easy';
    if (turns < 15) return 'Medium';
    if (turns < 25) return 'Hard';
    return 'Boss';
}

/**
 * How the foe measures up to the player, and so how long the fight should be.
 * @param {object[]} people As for startFight: [{ id, side, data }, ...].
 * @returns {{ ratio: number, turns: number, label: string }}
 */
export function rate(type, people) {
    const mine = people.find(p => p.side === 'player');
    const theirs = people.find(p => p.side === 'foe');
    if (!mine || !theirs) return { ratio: 1, turns: 10, label: 'Medium' };
    const ratio = powerOf(type, project(theirs.data, type)) / powerOf(type, project(mine.data, type));
    const turns = turnsForRatio(ratio);
    return { ratio, turns, label: labelForTurns(turns) };
}

/** Median actions in `runs` seeded fights, both sides playing the computer's choice. */
export function simulate(type, people, opts, poolScale, runs = 41) {
    const lengths = [];
    for (let i = 0; i < runs; i++) {
        const state = startFight(type, people, { ...opts, seed: 9000 + i, poolScale });
        let n = 0;
        let guard = 0;
        while (!state.over && guard++ < CAP * 3 && n < CAP) {
            const actor = currentActor(state);
            if (!actor) break;
            const target = living(state, actor.side === 'player' ? 'foe' : 'player')[0];
            const action = target ? chooseAction(type, actor.view, actor.weapon, { me: actor, foe: target, mode: state.mode, diff: actor.side === 'player' ? state.diff : -state.diff }) : null;
            if (!target || !action) {
                actor.down = true;
                skipTurn(state, 'nothing to do');
            } else {
                takeTurn(type, state, action.key, target.id);
                n++;
            }
        }
        lengths.push(n);
    }
    lengths.sort((a, b) => a - b);
    return lengths[Math.floor(lengths.length / 2)];
}

/**
 * Sizes the pools so the fight comes out near its target length.
 * @returns {{ scale: number, expected: number, target: number, ratio: number, label: string }}
 */
export function calibrate(type, people, opts = {}) {
    const mode = opts.mode === 'fight' ? 'fight' : 'spar';
    const rated = rate(type, people);
    const target = Math.max(2, mode === 'spar' ? rated.turns * SPAR_SHARE : rated.turns);
    let lo = Math.log(0.05);
    let hi = Math.log(80);
    let scale = 1;
    let got = 0;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        scale = Math.exp(mid);
        got = simulate(type, people, { ...opts, mode }, scale);
        if (got < target) lo = mid; else hi = mid;
    }
    return { scale, expected: got, target, ratio: rated.ratio, label: rated.label, turns: rated.turns };
}
