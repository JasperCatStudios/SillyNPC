/**
 * The crafting game's rules (fork), without the screen: what a craft type is, how materials combine, how good the result is.
 *
 * A craft type (alchemy, smithing, a talisman craft, ...) is DATA: a few numeric properties, a shelf of materials that have those
 * properties, recipes that ask for slots (by tag) and property ranges, and the stages the player plays. Nothing here names a world.
 * See docs/CRAFTING-DESIGN.md (private) for the design.
 *
 * Quality: Q = materialWeight * M + (1 - materialWeight) * P + rankBonus, where M is how well the mixture fits the recipe, P the
 * average of the stage performances, and the rank bonus 0.02 per tier of the crafter's skill. A perfect needs M >= 0.85.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const MIX_RULES = Object.freeze(['sum', 'avg', 'max', 'min']);
export const GRADES = Object.freeze(['failed', 'poor', 'fair', 'good', 'perfect']);
export const STAGE_IDS = Object.freeze(['prep', 'tend', 'finish']);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (v, max = 30) => text(v, max).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : d);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const list = (v) => (Array.isArray(v) ? v : []);
const key = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Prepare quality changes only the `sum` properties: a perfect prep x1.10, good x1.00, miss x0.80. */
export const PREP_MULT = Object.freeze({ perfect: 1.1, good: 1, miss: 0.8 });
/** How a timing result counts as a score. */
export const QUALITY_SCORE = Object.freeze({ perfect: 1, good: 0.6, miss: 0 });

const DEFAULT_SHAPES = ['●', '■', '▲', '◆', '★', '♣', '♥', '♠', '✚', '⬟'];
const DEFAULT_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#f79646', '#8064a2', '#4bacc6', '#d4a017', '#7f7f7f'];

/* ------------------------------------------------------------------ normalizing a craft type */

function normalizeProperty(raw, at) {
    const r = obj(raw);
    const id = slug(r.id, 20);
    if (!id) return null;
    return { id, label: text(r.label, 24) || id, mix: MIX_RULES.includes(r.mix) ? r.mix : 'sum', max: Math.max(1, num(r.max, 10)), icon: /^fa-[a-z0-9-]+$/.test(String(r.icon || '')) ? r.icon : '' };
}

function normalizeMaterial(raw, at, propIds) {
    const r = obj(raw);
    const name = text(r.name, 40);
    if (!name) return null;
    const props = {};
    for (const [k, v] of Object.entries(obj(r.props))) if (propIds.includes(k) && Number.isFinite(Number(v))) props[k] = Number(v);
    const match = list(r.match).map(w => text(w, 30).toLowerCase()).filter(Boolean).slice(0, 8);
    return {
        id: slug(r.id, 30) || slug(name),
        name,
        match: match.length ? match : [name.toLowerCase()],
        category: text(r.category, 24),
        props, tags: list(r.tags).map(t => slug(t, 20)).filter(Boolean).slice(0, 8),
        tier: clamp(Math.round(num(r.tier, 1)), 1, 3),
        // A starter is always on the shelf, free, and fills the first empty slot it fits when a recipe is chosen (water in alchemy).
        starter: r.starter === true,
        shape: text(r.shape, 2) || DEFAULT_SHAPES[at % DEFAULT_SHAPES.length],
        letter: text(r.letter, 1).toUpperCase() || name[0].toUpperCase(),
        color: /^#[0-9a-fA-F]{6}$/.test(String(r.color || '')) ? r.color : DEFAULT_COLORS[at % DEFAULT_COLORS.length],
    };
}

function normalizeSlot(raw, at) {
    const r = obj(raw);
    return {
        id: slug(r.id, 20) || `slot${at + 1}`, label: text(r.label, 30) || 'an ingredient',
        tags: list(r.tags).map(t => slug(t, 20)).filter(Boolean).slice(0, 6),
        materials: list(r.materials).map(m => slug(m, 30)).filter(Boolean).slice(0, 20),
        qty: clamp(Math.round(num(r.qty, 1)), 1, 3), optional: r.optional === true,
    };
}

function normalizeTarget(raw) {
    const r = obj(raw);
    const ideal = list(r.ideal).map(Number).filter(Number.isFinite);
    const lo = ideal.length ? Math.min(...ideal) : num(r.min, 0);
    const hi = ideal.length > 1 ? Math.max(...ideal) : (ideal.length ? ideal[0] : num(r.max, lo));
    return { min: num(r.min, lo), ideal: [lo, hi], max: num(r.max, hi) };
}


function normalizeOutputs(raw, fallbackName) {
    const out = {};
    for (const g of GRADES) {
        const o = obj(obj(raw)[g]);
        const name = text(o.name, 60);
        if (!name) continue;
        out[g] = { name, note: text(o.note, 60), qty: clamp(Math.round(num(o.qty, 1)), 1, 9) };
    }
    if (!Object.keys(out).length && fallbackName) out.good = { name: fallbackName, note: '', qty: 1 };
    return out;
}

function normalizeRecipe(raw, propIds, at) {
    const r = obj(raw);
    const name = text(r.name, 50);
    if (!name) return null;
    const targets = {};
    for (const [k, v] of Object.entries(obj(r.targets))) if (propIds.includes(k)) targets[k] = normalizeTarget(v);
    const slots = list(r.slots).slice(0, 4).map(normalizeSlot);
    return {
        id: slug(r.id, 30) || slug(name) || `r${at}`, name, desc: text(r.desc, 90),
        level: clamp(Math.round(num(r.level, 1)), 1, 5),
        slots: slots.length ? slots : [normalizeSlot({ id: 'base', label: 'an ingredient' }, 0)],
        targets, outputs: normalizeOutputs(r.outputs, name),
        ...(r.hidden === true ? { hidden: true } : {}),
    };
}

/**
 * A craft type repaired: unknown fields dropped, missing ones defaulted. Returns null without an id.
 * @param {object} raw
 * @param {string} [idHint]
 */
export function normalizeCraft(raw, idHint = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = slug(raw.id || idHint, 30);
    if (!id) return null;
    const properties = list(raw.properties).map(normalizeProperty).filter(Boolean).slice(0, 4);
    const propIds = properties.map(p => p.id);
    const materials = list(raw.materials).map((m, i) => normalizeMaterial(m, i, propIds)).filter(Boolean).slice(0, 40);
    const recipes = list(raw.recipes).map((r, i) => normalizeRecipe(r, propIds, i)).filter(Boolean).slice(0, 40);
    const stages = list(raw.stages).map(s => (typeof s === 'string' ? { stage: s } : obj(s))).filter(s => STAGE_IDS.includes(s.stage)).slice(0, 6)
        .map(s => ({ stage: s.stage, weight: Math.max(0, num(s.weight, 1)), params: obj(s.params) }));
    return {
        id, label: text(raw.label, 40) || id, icon: /^fa-[a-z0-9-]+$/.test(String(raw.icon || '')) ? raw.icon : 'fa-hammer',
        prof: slug(raw.prof, 40), music: text(raw.music, 60),
        materialWeight: clamp(num(raw.materialWeight, 0.3), 0, 0.8),
        properties, materials, recipes,
        stages: stages.length ? stages : [{ stage: 'prep', weight: 1, params: {} }, { stage: 'tend', weight: 3, params: {} }, { stage: 'finish', weight: 1, params: {} }],
        effects: list(raw.effects).slice(0, 8).map(e => {
            const q = obj(e);
            return propIds.includes(q.prop) && STAGE_IDS.includes(q.stage) && text(q.param, 20)
                ? { prop: q.prop, stage: q.stage, param: text(q.param, 20), per: num(q.per, 0), from: num(q.from, 0), label: text(q.label, 60) } : null;
        }).filter(Boolean),
        terms: Object.fromEntries(Object.entries(obj(raw.terms)).map(([k, v]) => [slug(k, 20), text(v, 40)]).filter(([k, v]) => k && v).slice(0, 16)),
    };
}

/* ------------------------------------------------------------------ mixing */

/**
 * The mixture of the chosen materials. `picks` is [{ material, qty }]; `prep` ('perfect' | 'good' | 'miss') changes the `sum`
 * properties only. Returns { <propId>: value } (0 for a property no material has).
 */
export function mixture(craft, picks, prep = 'good') {
    const mult = PREP_MULT[prep] ?? 1;
    const out = {};
    for (const p of craft?.properties || []) {
        const rows = (picks || []).map(x => ({ v: Number(x.material?.props?.[p.id]) || 0, q: Math.max(1, Math.round(Number(x.qty) || 1)) })).filter(r => r.q > 0);
        if (!rows.length) { out[p.id] = 0; continue; }
        if (p.mix === 'sum') out[p.id] = rows.reduce((n, r) => n + r.v * r.q, 0) * mult;
        else if (p.mix === 'avg') out[p.id] = rows.reduce((n, r) => n + r.v * r.q, 0) / rows.reduce((n, r) => n + r.q, 0);
        else if (p.mix === 'max') out[p.id] = Math.max(...rows.map(r => r.v));
        else out[p.id] = Math.min(...rows.map(r => r.v));
    }
    return out;
}

/** How well a value meets a target: 1 inside the ideal band, 0.5 to 1 between a limit and the band, 0.3 beyond a limit. */
export function fitScore(value, target) {
    if (!target) return 1;
    const v = Number(value) || 0;
    const [lo, hi] = target.ideal;
    if (v >= lo && v <= hi) return 1;
    if (v < lo) return v < target.min ? 0.3 : 0.5 + 0.5 * ((v - target.min) / Math.max(1e-9, lo - target.min));
    return v > target.max ? 0.3 : 0.5 + 0.5 * ((target.max - v) / Math.max(1e-9, target.max - hi));
}

/** M: the mean fit over the recipe's targets (1 for a recipe with none). */
export function mixtureFit(recipe, mix) {
    const keys = Object.keys(recipe?.targets || {});
    if (!keys.length) return 1;
    return keys.reduce((n, k) => n + fitScore(mix?.[k], recipe.targets[k]), 0) / keys.length;
}

/** Whether a material may go in a slot: it names the material, or shares one of the slot's tags (a slot with neither takes anything). */
export function slotAccepts(slot, material) {
    if (!material) return false;
    if (slot.materials?.length && !slot.materials.includes(material.id)) return false;
    if (slot.tags?.length) return slot.tags.some(t => (material.tags || []).includes(t));
    return true;
}

/**
 * Whether the chosen materials can be started: every required slot filled, and the mixture inside every target's hard limits.
 * `filled` is { <slotId>: material | null }, `prep` the assumed prep.
 * @returns {{ ok: boolean, reasons: string[], mix: object, fit: number }}
 */
export function checkStart(craft, recipe, filled, prep = 'good') {
    const reasons = [];
    const picks = [];
    for (const slot of recipe.slots) {
        const m = filled?.[slot.id] || null;
        if (!m) { if (!slot.optional) reasons.push(`Choose ${slot.label}.`); continue; }
        if (!slotAccepts(slot, m)) { reasons.push(`${m.name} does not fit ${slot.label}.`); continue; }
        picks.push({ material: m, qty: slot.qty });
    }
    const mix = mixture(craft, picks, prep);
    if (!reasons.length) {
        for (const [k, t] of Object.entries(recipe.targets)) {
            const label = craft.properties.find(p => p.id === k)?.label || k;
            const v = Math.round((mix[k] || 0) * 10) / 10;
            if (v < t.min) reasons.push(`${label} ${v}, needs at least ${t.min}.`);
            else if (v > t.max) reasons.push(`${label} ${v}, must be at most ${t.max}.`);
        }
    }
    return { ok: reasons.length === 0, reasons, mix, fit: mixtureFit(recipe, mix) };
}

/* ------------------------------------------------------------------ the process */

/** A rank's tier, 0 (novice) to 4 (master), from its position on the ladder. An unknown rank is tier 0. */
export function rankTier(index, rungs) {
    const n = Math.floor(Number(rungs));
    const i = Math.floor(Number(index));
    if (!Number.isFinite(i) || !Number.isFinite(n) || n < 2 || i < 0) return 0;
    return clamp(Math.floor((4 * Math.min(i, n - 1)) / (n - 1)), 0, 4);
}

/** How hard the recipe is for this crafter: below 1 makes zones narrower, above 1 wider. Clamped to 0.6 to 1.3. */
export const difficultyScale = (recipeLevel, tier) => clamp(1 - 0.12 * ((Number(recipeLevel) || 1) - ((Number(tier) || 0) + 1)), 0.6, 1.3);

/** A parameter after the craft's effects: param x (1 + per x (value - from)), clamped to 0.5x to 2x. */
export function effectScale(craft, mix, stage, param) {
    let scale = 1;
    for (const e of craft?.effects || []) {
        if (e.stage !== stage || e.param !== param) continue;
        scale *= clamp(1 + e.per * ((Number(mix?.[e.prop]) || 0) - e.from), 0.5, 2);
    }
    return clamp(scale, 0.5, 2);
}

/** One line per active effect, for the select screen: "Volatility is high: the heat will wander". */
export function effectForecasts(craft, mix) {
    return (craft?.effects || []).filter(e => e.label && Math.abs((Number(mix?.[e.prop]) || 0) - e.from) >= 1e-9).map(e => e.label);
}

/** The score of a timing result for a stage that counts it. */
export const qualityScore = (q) => QUALITY_SCORE[q] ?? 0;

/** P: the weight-averaged performance of the stages (each 0 to 1). `results` is [{ stage, weight, performance }]. */
export function processScore(results) {
    const rows = (results || []).filter(r => (Number(r.weight) || 0) > 0);
    const total = rows.reduce((n, r) => n + r.weight, 0);
    return total > 0 ? clamp(rows.reduce((n, r) => n + r.weight * clamp(Number(r.performance) || 0, 0, 1), 0) / total, 0, 1) : 0;
}

/**
 * Q and the grade. A ruin (a stage the player destroyed the work in) is always a failure. A perfect needs M >= 0.85.
 * @returns {{ q: number, grade: string }}
 */
export function craftQuality({ fit, performance, tier = 0, materialWeight = 0.3, ruined = false } = {}) {
    const w = clamp(Number(materialWeight), 0, 0.8);
    const q = clamp(w * clamp(fit, 0, 1) + (1 - w) * clamp(performance, 0, 1) + 0.02 * clamp(tier, 0, 4), 0, 1.2);
    let grade = ruined || q < 0.2 ? 'failed' : q >= 0.9 ? 'perfect' : q >= 0.7 ? 'good' : q >= 0.4 ? 'fair' : 'poor';
    if (grade === 'perfect' && fit < 0.85) grade = 'good';
    return { q, grade };
}

/**
 * The item for a grade: its own output; else the nearest lower grade's (never the failure's), else the nearest higher one's.
 * A failed craft gives only the failure's output, or nothing when the recipe has none.
 */
export function outputFor(recipe, grade) {
    const outs = recipe?.outputs || {};
    if (grade === 'failed') return outs.failed ? { ...outs.failed, grade: 'failed' } : null;
    const order = ['poor', 'fair', 'good', 'perfect'];
    const at = order.indexOf(grade);
    const lower = order.slice(0, Math.max(0, at)).reverse();
    const higher = order.slice(at + 1);
    for (const g of [grade, ...lower, ...higher]) if (outs[g]) return { ...outs[g], grade: g };
    return null;
}

const GRADE_XP = Object.freeze({ perfect: 1.5, good: 1, fair: 0.7, poor: 0.4, failed: 0.2 });
const DIFFICULTY_XP = Object.freeze({ easy: 0.8, normal: 1, hard: 1.3 });

/**
 * What a finished craft is worth (the uniform outcome the settle step takes).
 * @param {{ craft: object, recipe: object, grade: string, tier?: number, difficulty?: string, partner?: boolean, consume?: object[] }} a
 * @returns {{ grade: string, levelXp: number, profXp: number, partnerProfXp: number, bonds: object[], items: object[], consume: object[], subject: string }}
 */
export function craftRewards({ craft, recipe, grade, tier = 0, difficulty = 'normal', partner = false, consume = [] }) {
    const mult = (GRADE_XP[grade] ?? 1) * (DIFFICULTY_XP[difficulty] ?? 1);
    // Crafting far below your level pays half, so an easy recipe cannot be farmed.
    const farm = (Number(recipe?.level) || 1) < (Number(tier) || 0) ? 0.5 : 1;
    const profXp = Math.round(12 * (0.6 + 0.2 * (Number(recipe?.level) || 1)) * mult * farm);
    const out = outputFor(recipe, grade);
    return {
        grade,
        levelXp: Math.round(6 * mult * farm),
        profXp,
        partnerProfXp: partner ? Math.floor(profXp / 2) : 0,
        bonds: partner && (grade === 'perfect' || grade === 'good') ? [{ meter: 'trust', amount: grade === 'perfect' ? 1 : 0.5 }] : [],
        items: out ? [{ name: out.name, qty: out.qty, kind: 'crafted', note: out.note }] : [],
        consume,
        subject: craft?.prof || '',
    };
}

/**
 * Puts the starter materials in the empty required slots they fit, in order. Returns a new `filled` ({ <slotId>: material }); what is
 * already chosen is kept.
 */
export function autofillStarters(craft, recipe, filled = {}) {
    const out = { ...filled };
    const starters = (craft?.materials || []).filter(m => m.starter);
    for (const slot of recipe?.slots || []) {
        if (out[slot.id] || slot.optional) continue;
        const m = starters.find(s => slotAccepts(slot, s));
        if (m) out[slot.id] = m;
    }
    return out;
}

/* ------------------------------------------------------------------ a partner's help */

/** How well a partner's help goes: a task is done perfectly, normally, or fails. */
export const HELP_SCORE = Object.freeze({ perfect: 1, normal: 0.6, fail: 0 });

/** The chances for a partner of a given skill tier (0 to 4): the better they are, the likelier a perfect and the rarer a failure. */
export function helpOdds(tier) {
    const t = clamp(Math.floor(Number(tier) || 0), 0, 4);
    const perfect = 0.1 + 0.1 * t;
    const fail = 0.35 - 0.07 * t;
    return { perfect, normal: 1 - perfect - fail, fail };
}

/** Rolls the partner's task with an injected random source. */
export function rollHelp(tier, rng = Math.random) {
    const o = helpOdds(tier);
    const r = rng();
    return r < o.perfect ? 'perfect' : r < o.perfect + o.normal ? 'normal' : 'fail';
}

export const REACTIONS = Object.freeze(['praise', 'critique', 'empathize']);

/**
 * What the player's answer to the partner's work does. Each answer speaks to a different bond, and is worth most when it fits what
 * happened: praise a perfect job (affection), critique a failure so they learn (respect), empathize with a failure (trust). An
 * answer that does not fit is worth little or nothing. Bond nudges are only ever positive.
 * @returns {{ meter: string, amount: number }}
 */
export function reactionEffect(result, choice) {
    const table = {
        praise: { meter: 'affection', perfect: 1, normal: 0.5, fail: 0 },
        critique: { meter: 'respect', perfect: 0, normal: 0.5, fail: 1 },
        empathize: { meter: 'trust', perfect: 0, normal: 0.5, fail: 1 },
    };
    const row = table[choice];
    if (!row) return { meter: '', amount: 0 };
    return { meter: row.meter, amount: row[result] ?? 0 };
}

/* ------------------------------------------------------------------ the shelf */

/**
 * The materials to show on the shelf. With the Inventory on (`pack` given as [{ name, qty }]) only the materials found in the pack,
 * each with the count; with it off (`pack` null) every material, unlimited (count null). Pack items that are a recipe output or a
 * crafted item are never taken for a material.
 */
export function shelf(craft, pack, { outputNames = [] } = {}) {
    const blocked = new Set((outputNames || []).map(key));
    if (!pack) return (craft?.materials || []).map(m => ({ material: m, count: null }));
    // Starters are free even with the Inventory on, and are listed first.
    const found = (craft?.materials || []).filter(m => m.starter).map(m => ({ material: m, count: null }));
    for (const m of (craft?.materials || []).filter(x => !x.starter)) {
        let count = 0;
        for (const item of pack) {
            const name = String(item?.name || '').toLowerCase();
            if (!name || blocked.has(key(name)) || item?.kind === 'crafted') continue;
            if (m.match.some(w => name === w || name.split(/[^\p{L}\p{N}]+/u).includes(w))) count += Math.max(1, Number(item.qty) || 1);
        }
        if (count > 0) found.push({ material: m, count });
    }
    return found;
}

/** Every output name of a craft (to keep them off the shelf). */
export const outputNamesOf = (craft) => (craft?.recipes || []).flatMap(r => Object.values(r.outputs || {}).map(o => o.name));

/** The items used up by a finished craft, as [{ name, qty }], taken from the pack by the materials' match words (inventory on only). */
export function consumeFor(picks, pack, { outputNames = [] } = {}) {
    if (!pack) return [];
    const blocked = new Set((outputNames || []).map(key));
    const left = pack.map(i => ({ name: i.name, qty: Math.max(1, Number(i.qty) || 1), kind: i.kind }));
    const used = new Map();
    for (const { material, qty } of picks || []) {
        if (material?.starter) continue;          // a starter is provided, never taken from the pack
        let want = Math.max(1, Math.round(Number(qty) || 1));
        for (const item of left) {
            if (want <= 0) break;
            const name = String(item.name || '').toLowerCase();
            if (item.qty <= 0 || blocked.has(key(name)) || item.kind === 'crafted') continue;
            if (!material.match.some(w => name === w || name.split(/[^\p{L}\p{N}]+/u).includes(w))) continue;
            const take = Math.min(item.qty, want);
            item.qty -= take;
            want -= take;
            used.set(item.name, (used.get(item.name) || 0) + take);
        }
    }
    return [...used].map(([name, qty]) => ({ name, qty }));
}
