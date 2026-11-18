/**
 * Streaks for every activity (fork): how many days in a row an activity has been done, and how many times in all.
 * The rules, without the I/O.
 *
 * Kept in the chat, per activity: one record for the player overall ("days in a row doing Study with anyone") and one
 * per partner ("with Ada"). A record is { last, run, best, total }: the last day it was done (a day key as in
 * activity-bond-core.js), the current run of days in a row, the best run, and how many times in all.
 *
 * A day is "the next one" when its date is one day after the last. Dates are read from a device key
 * ("device:2026-11-18") exactly, and from a story date ("story:Wednesday, December 31, 1999") when it can be read. A story
 * date that cannot be read (an invented calendar) cannot be compared, so a new day key then counts as the next day: the run
 * is never broken by something that cannot be measured.
 *
 * Proficiency activities (the ones that train a skill) get a skill XP bonus from the run: +10% for each day after the
 * first, at most +50%.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const MAX_BONUS_PERCENT = 50;
export const BONUS_PER_DAY = 10;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const whole = (v) => Math.max(0, Math.floor(Number(v)) || 0);
const DAY_MS = 86400000;

/** A day's number (whole days since 1970) from a day key, or null when the date cannot be read. */
export function dayIndex(key) {
    const s = String(key ?? '').trim();
    if (s.startsWith('device:')) {
        const m = /^device:(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS) : null;
    }
    if (s.startsWith('story:')) {
        const t = s.slice(6).replace(/^[A-Za-z]+,\s*/, '').trim();
        if (!t) return null;
        const ms = Date.parse(t);
        if (!Number.isFinite(ms)) return null;
        const d = new Date(ms);
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
    }
    return null;
}

const emptyRecord = () => ({ last: '', run: 0, best: 0, total: 0 });

function normalizeRecord(raw) {
    const r = obj(raw);
    const run = whole(r.run);
    return { last: text(r.last, 90), run, best: Math.max(run, whole(r.best)), total: whole(r.total) };
}

/** The whole streak record, repaired: { [activityId]: { all: record, with: { [partner]: record } } }. */
export function normalizeStreaks(raw) {
    const out = {};
    for (const [id, entry] of Object.entries(obj(raw)).slice(0, 60)) {
        const activity = text(id, 40);
        if (!activity) continue;
        const e = obj(entry);
        const withs = {};
        for (const [who, rec] of Object.entries(obj(e.with)).slice(0, 80)) {
            const name = text(who, 80);
            if (name) withs[name] = normalizeRecord(rec);
        }
        out[activity] = { all: normalizeRecord(e.all), with: withs };
    }
    return out;
}

/** What one more play on `day` does to a record. */
function bump(rec, day) {
    const next = { ...rec, total: rec.total + 1 };
    if (rec.last === day) return next;               // the same day again: counted as a play, the run stays
    const was = dayIndex(rec.last);
    const now = dayIndex(day);
    let run;
    if (!rec.last || rec.run < 1) run = 1;
    else if (was === null || now === null) run = rec.run + 1;      // cannot be measured: not broken
    else if (now - was === 1) run = rec.run + 1;
    else run = 1;                                     // a gap, or the story went backwards
    next.run = run;
    next.best = Math.max(rec.best, run);
    next.last = day;
    return next;
}

/**
 * Records one finished activity. Returns the new streaks (nothing given is changed) and what it came to.
 * @returns {{ streaks: object, run: number, best: number, total: number, withRun: number, newDay: boolean }}
 */
export function touchStreak(streaks, activityId, partner, day) {
    const all = normalizeStreaks(streaks);
    const id = text(activityId, 40);
    const entry = all[id] || { all: emptyRecord(), with: {} };
    const newDay = entry.all.last !== day;
    entry.all = bump(entry.all, day);
    const name = Object.keys(entry.with).find(n => n.toLowerCase() === String(partner ?? '').trim().toLowerCase()) || text(partner, 80);
    if (name) entry.with[name] = bump(entry.with[name] || emptyRecord(), day);
    all[id] = entry;
    return { streaks: all, run: entry.all.run, best: entry.all.best, total: entry.all.total, withRun: name ? entry.with[name].run : 0, newDay };
}

/** A record as it stands today: a run is shown as broken (0) once more than a day has passed since it was last extended. */
function aliveRun(rec, today) {
    if (rec.run < 1) return 0;
    if (rec.last === today) return rec.run;
    const was = dayIndex(rec.last);
    const now = dayIndex(today);
    if (was === null || now === null) return rec.run;
    const gap = now - was;
    return gap === 1 ? rec.run : 0;       // yesterday: it is still alive until today passes; anything else is over
}

/**
 * What to show for an activity today.
 * @returns {{ run: number, best: number, total: number, doneToday: boolean, withRun: number, withTotal: number }}
 */
export function streakView(streaks, activityId, partner, today) {
    const e = normalizeStreaks(streaks)[text(activityId, 40)];
    if (!e) return { run: 0, best: 0, total: 0, doneToday: false, withRun: 0, withTotal: 0 };
    const name = Object.keys(e.with).find(n => n.toLowerCase() === String(partner ?? '').trim().toLowerCase());
    const w = name ? e.with[name] : emptyRecord();
    return {
        run: aliveRun(e.all, today), best: e.all.best, total: e.all.total, doneToday: e.all.last === today,
        withRun: aliveRun(w, today), withTotal: w.total,
    };
}

/** The skill XP bonus for a run, in percent: nothing for the first day, +10% for each day after, at most +50%. */
export function streakBonus(run) {
    const n = whole(run);
    return n < 2 ? 0 : Math.min(MAX_BONUS_PERCENT, (n - 1) * BONUS_PER_DAY);
}

/** XP with the bonus added, rounded. */
export function boostXp(xp, run) {
    return Math.round(whole(xp) * (1 + streakBonus(run) / 100));
}

/** "3 days in a row", "1 day", or '' for none. */
export function runText(run) {
    const n = whole(run);
    return n < 1 ? '' : `${n} day${n === 1 ? '' : 's'} in a row`;
}

/** "5 times in all". */
export function totalText(total) {
    const n = whole(total);
    return n < 1 ? '' : `${n} time${n === 1 ? '' : 's'} in all`;
}
