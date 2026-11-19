import { ladderOf, rungIndex } from './combat-roles.js';
import { ensureTypeData, logEdit } from './combat-edit.js';
import { MAX_ABILITIES } from './combat-abilities.js';

/**
 * Progress from activities and fights (fork): proficiency XP, rank-ups, ability unlocks, the
 * class-change gate, and counting the proficiencies a fight used. See docs/ACTIVITIES-PLAN.md section 4.
 *
 * Rank ladders come from the active combat type, so nothing here is Fire Emblem specific: a
 * rank ladder (E- ... S+) and a grade ladder (Bleach, Black Clover) work the same way.
 *
 * Pure: no DOM, no SillyTavern imports. The caller saves settings.
 */

/** Default XP to climb one rung: base + step * (the rung being reached). 13 rungs is about 1,000 XP. */
export const DEFAULT_RANK_TABLE = Object.freeze({ base: 20, step: 10 });

export const PROF_XP_DEFAULTS = Object.freeze({ perUse: 2, cap: 12, loserShare: 0.5 });

const whole = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || min);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** The rank table with every number in range; anything missing is the default. */
export function normalizeRankTable(raw) {
    const r = obj(raw);
    const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
    return { base: num(r.base, 1, 100000, DEFAULT_RANK_TABLE.base), step: num(r.step, 0, 100000, DEFAULT_RANK_TABLE.step) };
}

/** XP needed to reach the rung at `index` from the one below it (an untrained prof is below rung 0). */
export function xpToRung(index, table) {
    const t = normalizeRankTable(table);
    return t.base + t.step * Math.max(0, whole(index, 0));
}

/**
 * Adds proficiency XP. Does not change what it is given.
 * @param {{ profs?: Record<string,{rank:any,xp:number}> }} typeData
 * @param {string} profId
 * @param {number} amount
 * @param {{ rungs: string[] }} ladder
 * @param {{ base?: number, step?: number }} [table]
 * @returns {{ typeData: object, rankUps: {prof:string, from:string|null, to:string}[], gained: number }}
 */
export function addProfXp(typeData, profId, amount, ladder, table) {
    const rungs = Array.isArray(ladder?.rungs) ? ladder.rungs : [];
    const gain = whole(amount, 0);
    const held = obj(obj(typeData).profs?.[profId]);
    const startIdx = held.rank == null ? -1 : rungIndex(ladder, held.rank);
    const out = { ...obj(typeData), profs: { ...obj(obj(typeData).profs) } };
    if (!rungs.length || gain <= 0 || startIdx < -1) {
        // No ladder, nothing gained, or a rank that is not on the ladder: left exactly as it was.
        return { typeData: out, rankUps: [], gained: 0 };
    }
    let idx = startIdx;
    let xp = whole(held.xp, 0) + gain;
    const rankUps = [];
    while (idx < rungs.length - 1) {
        const need = xpToRung(idx + 1, table);
        if (xp < need) break;
        xp -= need;
        idx += 1;
        rankUps.push({ prof: profId, from: rankUps.length ? rungs[idx - 1] : (startIdx < 0 ? null : rungs[startIdx]), to: rungs[idx] });
    }
    // The top rung holds no leftover: there is nowhere to put it.
    if (idx >= rungs.length - 1) xp = 0;
    out.profs[profId] = { rank: idx < 0 ? null : rungs[idx], xp };
    return { typeData: out, rankUps, gained: gain };
}

/**
 * Adds proficiency XP to a record, writes the result and a history entry, and returns the rank-ups.
 * @returns {{ ok: boolean, reason?: string, gained?: number, rankUps?: object[] }}
 */
export function applyProfXp(record, type, profId, amount, table, at = Date.now()) {
    const prof = (type?.proficiencies || []).find(p => p.id === profId);
    if (!prof) return { ok: false, reason: 'That type has no such proficiency.' };
    const ladder = ladderOf(type, prof.ladder);
    const data = ensureTypeData(record, type.dataKey);
    const before = data.profs[profId]?.rank ?? null;
    const res = addProfXp(data, profId, amount, ladder, table);
    if (!res.gained) return { ok: true, gained: 0, rankUps: [] };
    data.profs[profId] = res.typeData.profs[profId];
    const after = data.profs[profId].rank;
    logEdit(data, `profs.${profId}`, before, after, at);
    return { ok: true, gained: res.gained, rankUps: res.rankUps };
}

/* ------------------------------------------------------------------ ability unlocks */

/**
 * The abilities a character has newly reached, from two sources: an `unlock: { prof, rank }` on
 * the ability, and a table of { ability, prof, rank } (a world preset's `unlocks`).
 * Abilities already in `typeData.unlocked` are not listed again.
 * @returns {string[]} ability ids
 */
export function unlocksFor(typeData, type, table = []) {
    const done = new Set(Array.isArray(typeData?.unlocked) ? typeData.unlocked : []);
    const profs = obj(typeData?.profs);
    const reached = (profId, rank) => {
        const prof = (type?.proficiencies || []).find(p => p.id === profId);
        if (!prof) return false;
        const ladder = ladderOf(type, prof.ladder);
        const need = rungIndex(ladder, rank);
        const have = profs[profId]?.rank == null ? -1 : rungIndex(ladder, profs[profId].rank);
        return need >= 0 && have >= need;
    };
    const found = [];
    const consider = (id, gate) => {
        if (!id || done.has(id) || found.includes(id) || !gate?.prof) return;
        if (reached(gate.prof, gate.rank)) found.push(id);
    };
    for (const a of type?.abilities || []) consider(a.id, a.unlock);
    for (const row of Array.isArray(table) ? table : []) consider(row?.ability, row);
    return found;
}

/**
 * Records new unlocks: each goes in `unlocked`, and into the ability slots while there is room.
 * @returns {{ added: string[], equipped: string[], waiting: string[] }} waiting: unlocked but no free slot
 */
export function applyUnlocks(record, type, ids, at = Date.now()) {
    const known = new Set((type?.abilities || []).map(a => a.id));
    const fresh = [...new Set((ids || []).map(String))].filter(id => known.has(id));
    const data = ensureTypeData(record, type.dataKey);
    const unlocked = Array.isArray(data.unlocked) ? data.unlocked : [];
    const added = fresh.filter(id => !unlocked.includes(id));
    if (!added.length) return { added: [], equipped: [], waiting: [] };
    data.unlocked = [...unlocked, ...added];
    const slots = Array.isArray(data.abilities) ? data.abilities : (data.abilities = []);
    const equipped = [];
    const waiting = [];
    for (const id of added) {
        if (slots.includes(id)) continue;
        if (slots.length < MAX_ABILITIES) { slots.push(id); equipped.push(id); } else waiting.push(id);
    }
    logEdit(data, 'unlocked', null, added.join(', '), at);
    return { added, equipped, waiting };
}

/* ------------------------------------------------------------------ class change */

export const CLASS_CUSTOM_MAX = 60;

/** The class to show: the free-text one when set, else the chosen one. '' when neither. */
export function displayClass(data) {
    const meta = obj(obj(data).meta);
    const custom = String(meta.classCustom ?? '').trim();
    return custom || String(meta.class ?? '').trim();
}

/**
 * Sets (or with blank clears) the free-text class. `class` itself is not touched, so the type's
 * pick list validation stays intact.
 */
export function setClassCustom(record, type, text, at = Date.now()) {
    const next = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CLASS_CUSTOM_MAX);
    const existing = record.combat?.types?.[type.dataKey];
    if (!next && !existing?.meta?.classCustom) return { ok: true, from: null, to: null };
    const data = ensureTypeData(record, type.dataKey);
    const from = data.meta.classCustom ?? null;
    if (from === (next || null)) return { ok: true, from, to: next || null };
    if (next) data.meta.classCustom = next; else delete data.meta.classCustom;
    logEdit(data, 'meta.classCustom', from, next || null, at);
    return { ok: true, from, to: next || null };
}

/**
 * Whether a class change is allowed.
 * gate: { prof, rank } (a rank to have reached, null for none) and `knowledge` needed; `knowledgeWord` is the preset's term for it.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function classGate(typeData, type, { gate = null, knowledge = 0, haveKnowledge = 0, knowledgeWord = 'knowledge' } = {}) {
    const reasons = [];
    if (gate?.prof) {
        const prof = (type?.proficiencies || []).find(p => p.id === gate.prof);
        if (prof) {
            const ladder = ladderOf(type, prof.ladder);
            const need = rungIndex(ladder, gate.rank);
            const rank = obj(typeData?.profs)[gate.prof]?.rank;
            const have = rank == null ? -1 : rungIndex(ladder, rank);
            if (need >= 0 && have < need) reasons.push(`${prof.label} rank ${gate.rank} is needed.`);
        }
    }
    if (whole(knowledge) > whole(haveKnowledge)) reasons.push(`${whole(knowledge)} ${knowledgeWord} is needed (${whole(haveKnowledge)} so far).`);
    return { ok: !reasons.length, reasons };
}

/* ------------------------------------------------------------------ combat proficiency XP */

/**
 * How many times each fighter used each proficiency in a fight, from the log's turn events.
 * An event counts when it names an actor and a prof and is not a skipped turn or a passive.
 * @param {object[]} log state.log
 * @returns {Record<string, Record<string, number>>} actor id -> prof id -> uses
 */
export function profUsesFromLog(log) {
    const out = {};
    for (const e of Array.isArray(log) ? log : []) {
        if (!e || e.skip || e.passive || !e.actor || !e.prof) continue;
        const mine = (out[e.actor] ||= {});
        mine[e.prof] = (mine[e.prof] || 0) + 1;
    }
    return out;
}

/**
 * The proficiencies that count once for a fighter just for being in the fight: passives the
 * fighter has reached the granting rank of (riding, flying, heavy armour in Fire Emblem).
 * @returns {string[]} prof ids
 */
export function passiveProfsFor(typeData, type) {
    const profs = obj(typeData?.profs);
    const ids = [];
    for (const p of type?.proficiencies || []) {
        if (!(p.roles || []).includes('passive')) continue;
        const rank = profs[p.id]?.rank;
        if (rank == null) continue;
        const from = p.grantsTag?.from;
        const ladder = ladderOf(type, p.ladder);
        if (from && rungIndex(ladder, rank) < rungIndex(ladder, from)) continue;
        ids.push(p.id);
    }
    return ids;
}

/**
 * Proficiency XP for one fighter from a fight: per use, capped per prof, the losing side's share.
 * @param {Record<string, number>} uses prof id -> uses
 * @param {string[]} passives prof ids that count once
 * @param {{ won: boolean }} result
 * @param {{ perUse?: number, cap?: number, loserShare?: number }} [cfg]
 * @returns {Record<string, number>} prof id -> XP
 */
export function combatProfXp(uses, passives, { won = true } = {}, cfg = {}) {
    const perUse = whole(cfg.perUse ?? PROF_XP_DEFAULTS.perUse, 0);
    const cap = whole(cfg.cap ?? PROF_XP_DEFAULTS.cap, 0);
    const share = won ? 1 : Math.max(0, Math.min(1, Number(cfg.loserShare ?? PROF_XP_DEFAULTS.loserShare)));
    const counted = { ...obj(uses) };
    for (const id of passives || []) counted[id] = (counted[id] || 0) + 1;
    const out = {};
    for (const [id, n] of Object.entries(counted)) {
        const xp = Math.floor(Math.min(cap, whole(n) * perUse) * share);
        if (xp > 0) out[id] = xp;
    }
    return out;
}

/* ------------------------------------------------------------------ report */

/**
 * The story report line for one character's progress: "Ada reached Reason C and learned Fireball."
 * Empty when nothing happened. `labels` maps ability ids to their names (an id is shown when absent).
 * @param {{ name: string, type: object, rankUps?: object[], learned?: string[] }} p
 */
export function progressLine({ name, type, rankUps = [], learned = [] }) {
    const label = (id) => (type?.proficiencies || []).find(x => x.id === id)?.label || id;
    const ability = (id) => (type?.abilities || []).find(x => x.id === id)?.label || id;
    // Only the highest rank reached per prof is worth saying.
    const best = new Map();
    for (const r of rankUps) best.set(r.prof, r.to);
    const parts = [...best].map(([prof, to]) => `reached ${label(prof)} ${to}`);
    const names = learned.map(ability);
    if (names.length) parts.push(`learned ${names.join(', ')}`);
    if (!parts.length) return '';
    const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return `${name} ${joined}.`;
}

/* ------------------------------------------------------------------ play history on a card */

const GRADE_ORDER = ['poor', 'fair', 'good', 'perfect'];

/**
 * Adds one play to a card's `actStats`: { <activityId>: { plays, best, knowledge? } }. Returns a new object;
 * what it is given is not changed. `best` is the best grade reached.
 */
export function recordPlay(actStats, activityId, grade, knowledge = 0) {
    const out = { ...obj(actStats) };
    const held = obj(out[activityId]);
    const had = GRADE_ORDER.indexOf(held.best);
    const now = GRADE_ORDER.indexOf(grade);
    const entry = { plays: whole(held.plays, 0) + 1, best: now > had ? grade : (had >= 0 ? held.best : '') };
    const k = whole(held.knowledge, 0) + whole(knowledge, 0);
    if (k > 0 || held.knowledge !== undefined) entry.knowledge = k;
    out[activityId] = entry;
    return out;
}

/** The study knowledge a card has built up, 0 when none. */
export const knowledgeOfCard = (actStats) => whole(obj(obj(actStats).study).knowledge, 0);

/** Spends all of a card's study knowledge (a class change resets it to 0). Returns a new object. */
export function resetKnowledge(actStats) {
    const out = { ...obj(actStats) };
    if (out.study) out.study = { ...obj(out.study), knowledge: 0 };
    return out;
}
