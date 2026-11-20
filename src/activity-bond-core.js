import { clampGrowth, syncValue, METERS } from './bonds-core.js';
import { normalizeStreaks } from './activity-streak-core.js';
import { normalizeGarden } from './activity-harvest-core.js';

/**
 * How an activity touches a bond, and the once-a-day rule (fork): the rules, without the I/O.
 *
 * A finished activity may nudge one of a partner's bond meters (affection, trust, respect). The nudge goes
 * through clampGrowth, the same turn caps, slowdown and rolling window a story reply goes through, so spending
 * every evening at tea cannot max a bond. On top of that an activity pays out a bond change once per partner
 * per in-story day (the "daily" record kept in the chat).
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const STORE_VERSION = 1;
const KEEP_DAYS = 30;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const tenth = (n) => Math.round(n * 10) / 10;

/** The chat's activity record, repaired: { version, daily: { day: { partner: [activityId] } }, open }. */
export function normalizeActivityStore(raw) {
    const r = obj(raw);
    const daily = {};
    const days = Object.keys(obj(r.daily)).slice(-KEEP_DAYS);
    for (const day of days) {
        const key = text(day, 80);
        if (!key) continue;
        daily[key] = {};
        for (const [who, ids] of Object.entries(obj(r.daily[day]))) {
            const name = text(who, 80);
            const list = [...new Set((Array.isArray(ids) ? ids : []).map(i => text(i, 40)).filter(Boolean))];
            if (name && list.length) daily[key][name] = list;
        }
    }
    // How many days in a row each activity has been done (see activity-streak-core.js).
    return { version: STORE_VERSION, daily, streaks: normalizeStreaks(r.streaks), garden: normalizeGarden(r.garden), open: null };
}

/**
 * The key for "today": the story's date when one is known, else the device date (so a chat with no scene header
 * still has a day that changes).
 * @param {string} [storyDate] the scene module's date text, if any
 */
export function dayKey(storyDate, now = new Date()) {
    const story = text(storyDate, 80);
    if (story) return `story:${story}`;
    const pad = (n) => String(n).padStart(2, '0');
    return `device:${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Whether this partner has already paid out a bond change for this activity today. */
export function gainedToday(store, day, partner, activityId) {
    const d = obj(obj(store).daily)[day];
    for (const [who, ids] of Object.entries(obj(d))) {
        if (same(who, partner) && Array.isArray(ids) && ids.includes(activityId)) return true;
    }
    return false;
}

/** Records that it paid out. Mutates and returns the store. */
export function markGained(store, day, partner, activityId) {
    const s = store;
    if (!s.daily || typeof s.daily !== 'object') s.daily = {};
    const d = (s.daily[day] ||= {});
    const who = Object.keys(d).find(n => same(n, partner)) || text(partner, 80);
    const list = (d[who] ||= []);
    if (!list.includes(activityId)) list.push(activityId);
    // Keep the newest days only.
    const days = Object.keys(s.daily);
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete s.daily[old];
    return s;
}

/**
 * Applies one nudge to a person's own edge toward the player, through clampGrowth.
 * Never opens a new bond turn: it uses the turn the store is on. Mutates the person.
 * @param {object} person a bonds-core person
 * @param {{ meter: string, amount: number }} nudge
 * @param {object} growth the bond growth settings
 * @param {number} turn the store's current turn
 * @returns {{ meter: string, delta: number, proposed: number, limited: string[] } | null}
 */
export function applyActivityNudge(person, nudge, growth, turn) {
    if (!person || !nudge || !METERS.includes(nudge.meter) || !(Number(nudge.amount) > 0)) return null;
    const edge = person.edges?.toPlayer;
    if (!edge) return null;
    const { delta, limited } = clampGrowth(edge, nudge.amount, growth, turn, nudge.meter);
    if (!delta) return { meter: nudge.meter, delta: 0, proposed: nudge.amount, limited };
    edge[nudge.meter] = tenth(edge[nudge.meter] + delta);
    if (delta > 0) {
        if (!Array.isArray(edge.gains?.[nudge.meter])) {
            edge.gains = edge.gains && typeof edge.gains === 'object' ? edge.gains : {};
            edge.gains[nudge.meter] = [];
        }
        edge.gains[nudge.meter].push({ turn, amount: delta });
    }
    syncValue(person);
    return { meter: nudge.meter, delta, proposed: nudge.amount, limited };
}
