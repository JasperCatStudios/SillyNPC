/**
 * Drop-in activities (fork): the registry a person's own activity registers itself with.
 *
 * A browser cannot list a folder, so an activity is found by registration, not scanning: any script that runs in the page
 * (a SillyTavern extension, or one file) calls
 *
 *     window.WorldkitActivities.register({
 *         id: 'my-fishing', label: 'River Fishing', tab: 'leisure', icon: 'fa-fish', blurb: 'My own fishing game.',
 *         solo: true, music: 'my_river_loop',
 *         run(api) { ... },          // draws into api.win.main and ends with api.settle(...) and api.result(...)
 *     });
 *
 * and the tile appears on the Activities hub in the tab it names, with the same streaks, energy cost, partner choice and
 * Customize card as the built-in ones. What \`run\` receives is described in docs/MAKE-AN-ACTIVITY.md.
 *
 * Pure and DOM-free (the window global is attached by the module that owns the hub), so node can test it.
 */

import { HUB_TABS } from './activity-config-core.js';

export const CUSTOM_KIND = 'custom';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : undefined);

/**
 * Checks a definition and makes the hub entry for it.
 * @returns {{ ok: true, activity: object, run: Function } | { ok: false, reason: string }}
 */
export function normalizeCustomActivity(def) {
    if (!def || typeof def !== 'object') return { ok: false, reason: 'The activity must be an object.' };
    const id = text(def.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return { ok: false, reason: 'The activity needs an id (letters, numbers, dashes).' };
    if (typeof def.run !== 'function') return { ok: false, reason: `"${id}" needs a run(api) function.` };
    const minutes = int(def.minutes, 0, 600);
    const energy = int(def.energy, 0, 100);
    return {
        ok: true,
        run: def.run,
        activity: {
            id, kind: CUSTOM_KIND, custom: true,
            label: text(def.label, 40) || id,
            tab: HUB_TABS.some(t => t[0] === def.tab) ? def.tab : 'leisure',
            icon: /^fa-[a-z0-9-]+$/.test(String(def.icon || '')) ? def.icon : 'fa-puzzle-piece',
            blurb: text(def.blurb, 120),
            ...(def.solo ? { solo: true } : {}),
            ...(text(def.music, 60) ? { music: text(def.music, 60) } : {}),
            ...(minutes !== undefined ? { minutes } : {}),
            ...(energy !== undefined ? { energy } : {}),
        },
    };
}

/** The registry: register, remove, list. \`onChange\` is called after every change (the hub redraws). */
export function createRegistry({ onChange } = {}) {
    const entries = new Map();
    const changed = () => { try { onChange?.(); } catch (err) { console.warn('[Worldkit] activity registry listener failed', err); } };
    return {
        /** Adds (or replaces, by id) an activity. Returns { ok, reason? }; never throws. */
        register(def) {
            const made = normalizeCustomActivity(def);
            if (!made.ok) { console.warn('[Worldkit] activity not registered:', made.reason); return { ok: false, reason: made.reason }; }
            entries.set(made.activity.id, made);
            changed();
            return { ok: true, id: made.activity.id };
        },
        unregister(id) {
            const had = entries.delete(String(id ?? ''));
            if (had) changed();
            return had;
        },
        /** The hub entries of every registered activity. */
        list() { return [...entries.values()].map(e => ({ ...e.activity })); },
        /** The run function of a registered activity, or null. */
        runnerOf(id) { return entries.get(String(id ?? ''))?.run || null; },
        has(id) { return entries.has(String(id ?? '')); },
    };
}

/**
 * The tiles for one hub tab: the preset's own, then the registered ones for that tab. A registered activity whose id the preset
 * already uses is left out (the preset's wins), and one the preset switched off with the same id stays off.
 */
export function tilesForTab(presetActivities, customActivities, tab) {
    const own = (presetActivities || []).filter(a => a.tab === tab && !a.off);
    const taken = new Set((presetActivities || []).map(a => a.id));
    return own.concat((customActivities || []).filter(a => a.tab === tab && !taken.has(a.id)));
}
