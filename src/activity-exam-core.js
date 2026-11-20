import { credentialTiers } from './activity-terms.js';
import { scoreOf } from './activity-drill-core.js';

/**
 * The certification exam (fork): a graded set of drills that raises one skill by one rank and awards a credential
 * (a "seal" in one world, a badge in another; the words are the preset's terms, never written here).
 *
 * The exam is for the NEXT rank of a skill. Which credential it pays is worked out from where that rank sits on the skill's
 * own ladder, spread evenly over the credential tiers the preset names (lowest rank, lowest tier). So a ladder of any length
 * (E to S, a numbered grade ladder, ...) and any number of tiers work with no table to keep in step.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const EXAM_DEFAULTS = Object.freeze({
    // The share of a drill's points a test needs at the lowest tier, and how much more each tier adds (capped at `passMax`).
    passBase: 0.45, passStep: 0.08, passMax: 0.85,
    // Tests in the exam: this many at the lowest tier, one more at each tier, up to `testsMax`.
    testsMin: 2, testsMax: 5,
    // The share of the XP toward the next rank the skill must already hold before the exam may be taken (0 turns it off),
    // and how many attempts a skill may have per story day (0 means no limit).
    readyShare: 0.5, attemptsPerDay: 1,
});

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? clamp(n, lo, hi) : d; };
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A preset's exam settings, repaired. `tiers` empty means "use the credential tiers"; `drills` empty means "any drill". */
export function normalizeExam(raw) {
    const r = obj(raw);
    return {
        tiers: (Array.isArray(r.tiers) ? r.tiers : []).map(t => text(t, 40)).filter(Boolean).slice(0, 12),
        drills: (Array.isArray(r.drills) ? r.drills : []).map(slug).filter(Boolean).slice(0, 20),
        passBase: num(r.passBase, 0.1, 0.9, EXAM_DEFAULTS.passBase),
        passStep: num(r.passStep, 0, 0.3, EXAM_DEFAULTS.passStep),
        testsMin: Math.round(num(r.testsMin, 1, 8, EXAM_DEFAULTS.testsMin)),
        readyShare: num(r.readyShare, 0, 1, EXAM_DEFAULTS.readyShare),
        attemptsPerDay: Math.round(num(r.attemptsPerDay, 0, 20, EXAM_DEFAULTS.attemptsPerDay)),
    };
}

/** The credential tier names this preset's exam hands out, lowest first. */
export function examTiers(preset) {
    const own = normalizeExam(preset?.exam).tiers;
    return own.length ? own : credentialTiers(preset);
}

/** Which tier a rung belongs to: the ladder is cut into equal parts, one per tier. `index` is 0-based. */
export function tierOfRung(index, rungCount, tierCount) {
    const n = Math.floor(Number(rungCount));
    const t = Math.floor(Number(tierCount));
    const i = Math.floor(Number(index));
    if (!(n >= 1) || !(t >= 1) || !Number.isFinite(i)) return 0;
    return clamp(Math.floor((clamp(i, 0, n - 1) * t) / n), 0, t - 1);
}

/**
 * What the exam is for. `rankIndex` is where the skill stands now (-1 for no rank yet); the exam is for the next rung.
 * @returns {{ ok: boolean, reason?: string, targetIndex?: number, targetRung?: string, fromRung?: string|null, tier?: number, tierName?: string }}
 */
export function examTarget(preset, { rungs = [], rankIndex = -1 } = {}) {
    const list = Array.isArray(rungs) ? rungs : [];
    if (!list.length) return { ok: false, reason: 'That skill has no ranks.' };
    const have = Math.floor(Number(rankIndex));
    const here = Number.isFinite(have) ? have : -1;
    if (here >= list.length - 1) return { ok: false, reason: 'That skill is already at its highest rank.' };
    const targetIndex = here + 1;
    const names = examTiers(preset);
    const tier = tierOfRung(targetIndex, list.length, names.length);
    return { ok: true, targetIndex, targetRung: list[targetIndex], fromRung: here >= 0 ? list[here] : null, tier, tierName: names[tier] };
}

/** The name of the credential for a tier, such as "Beginner Seal": the tier word and the preset's credential word. */
export const credentialName = (tierName, credentialWord) => `${tierName} ${credentialWord}`.trim();

/**
 * The tests of an exam: a list of { drill, difficulty, need }. Harder tiers have more tests, harder settings and a higher
 * share of points to reach. Drills are taken in turn from `drillIds` (the preset's list, else every drill given).
 * @param {object} preset
 * @param {{ tier: number }} target
 * @param {string[]} drillIds the drills that may be used, in order
 */
export function examPlan(preset, target, drillIds) {
    const cfg = normalizeExam(preset?.exam);
    const tiers = examTiers(preset).length;
    const tier = clamp(Math.floor(Number(target?.tier)) || 0, 0, tiers - 1);
    const allowed = cfg.drills.length ? drillIds.filter(id => cfg.drills.includes(id)) : [...drillIds];
    const pool = allowed.length ? allowed : [...drillIds];
    if (!pool.length) return [];
    const count = clamp(cfg.testsMin + tier, 1, Math.max(cfg.testsMin, EXAM_DEFAULTS.testsMax));
    const tests = [];
    for (let i = 0; i < count; i++) {
        const progress = (tier + (count > 1 ? i / (count - 1) : 1)) / tiers;     // 0 to 1 through the exam and the tiers
        tests.push({
            drill: pool[i % pool.length],
            difficulty: progress < 0.34 ? 'easy' : progress < 0.67 ? 'normal' : 'hard',
            need: Math.round(clamp(cfg.passBase + cfg.passStep * tier, 0.1, EXAM_DEFAULTS.passMax) * 100) / 100,
        });
    }
    return tests;
}

/**
 * Whether the skill has been trained enough to sit the exam for its next rank, and whether the day's attempts are used up.
 * `xp` is the XP held toward the next rank and `needXp` what that rank takes. `debug` ignores every limit.
 * @returns {{ ok: boolean, reason: string, share: number }}
 */
export function examAllowed(preset, { xp = 0, needXp = 0, attemptsToday = 0, debug = false } = {}) {
    const cfg = normalizeExam(preset?.exam);
    const share = needXp > 0 ? clamp(Number(xp) / needXp, 0, 1) : 1;
    if (debug) return { ok: true, reason: '', share };
    if (cfg.readyShare > 0 && share < cfg.readyShare) {
        return { ok: false, share, reason: `Not ready yet: train this skill more first (${Math.round(share * 100)}% of the way, ${Math.round(cfg.readyShare * 100)}% needed).` };
    }
    if (cfg.attemptsPerDay > 0 && attemptsToday >= cfg.attemptsPerDay) {
        return { ok: false, share, reason: `Already tried today (${cfg.attemptsPerDay} attempt${cfg.attemptsPerDay === 1 ? '' : 's'} a day for each skill). Come back tomorrow.` };
    }
    return { ok: true, reason: '', share };
}

/** One test's verdict from the drill's results: { score, need, passed }. */
export function judgeTest(results, need) {
    const score = Math.round(scoreOf(results) * 100) / 100;
    return { score, need, passed: score >= need };
}

/** The exam's verdict: every test must be passed. `verdicts` are judgeTest outputs, in order. */
export function judgeExam(verdicts, plannedCount) {
    const list = Array.isArray(verdicts) ? verdicts : [];
    const passed = list.length >= plannedCount && list.every(v => v.passed);
    const average = list.length ? list.reduce((n, v) => n + v.score, 0) / list.length : 0;
    return { passed, average: Math.round(average * 100) / 100, done: list.length };
}

/**
 * What the exam is worth. A pass raises the skill by one rank (`promote`) and pays the credential (`credential`); XP comes from
 * the average score either way, and a pass pays a little more. A partner who examines you earns a small trust nudge on a pass.
 */
export function examRewards({ passed, average, tests = 1, partner = false, credential = '' }) {
    const grade = !passed ? (average >= 0.4 ? 'fair' : 'poor') : average >= 0.9 ? 'perfect' : 'good';
    const mult = { perfect: 1.5, good: 1, fair: 0.6, poor: 0.3 }[grade];
    return {
        grade, passed: Boolean(passed),
        promote: Boolean(passed),
        credential: passed ? String(credential || '') : '',
        profXp: Math.round(tests * 3 * mult),
        levelXp: Math.round((6 + tests) * mult),
        bonds: partner && passed ? [{ meter: 'trust', amount: grade === 'perfect' ? 1.5 : 1 }] : [],
    };
}
