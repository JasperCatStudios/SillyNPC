/**
 * Combat style (fork): how a computer-controlled fighter chooses between attacking, defending and evading.
 *
 * A style is three priorities from 0 to 100:
 *   attack  how much they would rather simply strike (always the top of the list by default)
 *   defend  how readily they brace
 *   evade   how readily they dodge
 * Defend and evade are limited by the fight itself (see defensiveLock in combat-fight.js: never two in a
 * row, never more than two in four turns), so a high number means "often, within those limits", not "always".
 * Healing is not part of a style: the computer's fighters do not use the plain Heal.
 *
 * Everyone has a default worked out from their own sheet (their world's defense, evasion/speed and attack,
 * and their class), so nothing has to be set; a number written on a character replaces the default for it.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const STYLE_KEYS = Object.freeze(['attack', 'defend', 'evade']);
export const STYLE_LABELS = Object.freeze({ attack: 'Attack', defend: 'Defend', evade: 'Evade' });

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const whole = (v) => Math.round(Number(v));

/** Classes that lean one way. Matched on words, so "Great Knight" and "Dark Knight" both count. */
const LEANS = Object.freeze({
    defend: /knight|fortress|paladin|general|armor|guard|shield|bastion|defender/,
    evade: /myrmidon|thief|assassin|swordmaster|dancer|trickster|rogue|ninja|duelist|dodger|scout/,
    attack: /fighter|warrior|brawler|berserk|hero|grappler|barbarian|mercenary|bandit|brigand|destroyer/,
});

/** A stored style, repaired; null when nothing usable is stored (the default applies). */
export function normalizeStyle(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    let any = false;
    for (const key of STYLE_KEYS) {
        const n = whole(raw[key]);
        if (Number.isFinite(n)) { out[key] = clamp(n, 0, 100); any = true; }
    }
    return any ? out : null;
}

/**
 * What a fighter is like when nobody has said: worked out from their numbers. Attack stays on top;
 * the other two follow their share of the fighter's strengths, then lean with the class.
 *
 * @param {object} view a projected sheet (project() in combat-roles.js)
 * @param {{ class?: string }} [meta]
 * @returns {{ attack: number, defend: number, evade: number }}
 */
export function defaultStyle(view, meta = {}) {
    const read = (id) => { try { return Number(view?.role?.(id)) || 0; } catch { return 0; } };
    const off = Math.max(1, read('attack'));
    const def = Math.max(0, read('defense'));
    const ev = Math.max(0, read('evasion') || read('speed'));
    const total = off + def + ev;
    let defend = 12 + 50 * (def / total);
    let evade = 10 + 50 * (ev / total);
    const cls = String(meta?.class || view?.meta?.class || '').toLowerCase();
    if (LEANS.defend.test(cls)) defend += 22;
    else if (LEANS.evade.test(cls)) evade += 22;
    else if (LEANS.attack.test(cls)) { defend -= 8; evade -= 8; }
    // The listed order is attack, defend, evade: evade only passes defend for a fighter who is built for it.
    if (!LEANS.evade.test(cls) && evade > defend) evade = defend;
    return { attack: 100, defend: clamp(whole(defend), 5, 60), evade: clamp(whole(evade), 5, 60) };
}

/** The style a fighter fights with: their own numbers over their default. */
export function resolveStyle(view, stored, meta) {
    return { ...defaultStyle(view, meta), ...(normalizeStyle(stored) || {}) };
}

/** "Attack 100 · Defend 28 · Evade 22", for screens and the log. */
export function styleText(style) {
    return STYLE_KEYS.map(k => `${STYLE_LABELS[k]} ${style?.[k] ?? 0}`).join(' · ');
}
