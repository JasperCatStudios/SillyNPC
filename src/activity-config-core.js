import { DEFAULT_TERMS, normalizeTerms } from './activity-terms.js';
import { GENERIC_RECIPES, GENERIC_FISH, GENERIC_SEEDS } from './activity-harvest-data.js';
import { normalizeScripts } from './activity-scripts-core.js';
import { restoreValue } from './activity-hunger-core.js';
import { normalizeMyRecipes } from './activity-recipe-creator-core.js';
import { normalizeCraft } from './craft/craft-core.js';
import { GENERIC_CRAFTS } from './activity-craft-data.js';

/**
 * Activities settings and world presets (fork): the data, without the I/O.
 *
 * Settings are the module's switches (button, talk, XP, music, difficulty). A world preset is one
 * named bundle that tells the module how to behave in a world: which activities exist, their
 * wording (terms), runes, class-change rules. The engine never hard-codes a world; it reads the active
 * preset. A world with no preset gets GENERIC_PRESET, so the module runs with nothing installed.
 * See docs/ACTIVITIES-PLAN.md sections 2 and 10.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/* ------------------------------------------------------------------ settings */

export const DIFFICULTY_IDS = Object.freeze(['easy', 'normal', 'hard']);

export const ACTIVITY_SETTINGS_DEFAULTS = Object.freeze({
    enabled: true,
    buttonShown: true,
    contextMessages: 6,
    talkOn: true,                 // the off switch for the partner's AI talk
    showTalk: true,               // the table talk part of the side panel (Chat and Log)
    talkCooldownSec: 8,           // at least this many seconds between the partner's table-talk requests (not for the start, the end or your own message)
    speakCooldownSec: 6,          // at least this many seconds between lines the partner speaks aloud
    cannedLines: true,            // built-in lines for the partner when the model is off (off means silence)
    showHowTo: true,              // the How to play tab
    talkTokens: 120,
    bondOn: true,
    xpOn: true,
    itemsOn: true,
    vitalsOn: true,
    energyCost: 10,
    activityMinutes: 30,          // story minutes an activity takes (0 says nothing about time)
    combatProfXp: true,
    combatProfXpPerUse: 2,
    combatProfXpCap: 12,
    musicOn: true,
    scripts: [],                  // the activity files the player added: [{ name, url }]
    myRecipes: [],                // dishes the player made in the recipe creator (see activity-recipe-creator-core.js)
    musicVolume: 0.5,
    assist: false,                // timing games: a wider zone and a slower marker
    actionKey: 'KeyA',            // the key (or mouse button, e.g. 'Mouse1') that presses the big action button in cooking and fishing
    soundMapUrl: '',              // a sound map just for activities (music and effects); '' uses the world preset's
    difficulty: 'normal',
    pairs: 8,                     // Study board size: 4, 8 or 12
    // Tea Time (see docs/TEA-TIME-DESIGN.md)
    teaLlm: true,                 // off: built-in openers and lines, no request
    teaRounds: 3,                 // 3 or 5
    teaFreeText: true,
    teaGuestAsks: true,           // the guest sometimes asks the player a question
    teaShowKnown: true,           // the "Known so far" note
    teaBatchOpeners: false,       // lite mode: one request for all the openers
    teaMaxTokens: 700,            // room for the JSON reply (a model that thinks first needs it)
    teaContextMessages: 6,
    presetId: '',                 // '' means pick by the active combat type
    presets: {},                  // user presets by id (imported or edited)
});

/** A key code ('KeyA', 'Space', 'ArrowUp') or a mouse button ('Mouse0' to 'Mouse4'). Anything else falls back. */
export function normalizeActionKey(v, fallback = 'KeyA') {
    const s = String(v ?? '').trim();
    return /^(Mouse[0-4]|(?!Mouse)[A-Za-z][A-Za-z0-9]{0,15})$/.test(s) ? s : fallback;
}

/** A readable name for an action key code. */
export function actionKeyLabel(code) {
    const s = normalizeActionKey(code);
    if (/^Key[A-Z]$/.test(s)) return s.slice(3);
    if (/^Digit[0-9]$/.test(s)) return s.slice(5);
    const mouse = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse back button', Mouse4: 'Mouse forward button' };
    return mouse[s] || s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The settings with every value in range; anything missing is the default. */
export function normalizeActivitySettings(raw) {
    const r = obj(raw);
    const d = ACTIVITY_SETTINGS_DEFAULTS;
    const bool = (k) => (typeof r[k] === 'boolean' ? r[k] : d[k]);
    // User presets are kept exactly as stored (only unusable ones are dropped), so a preset written for a newer version is
    // never damaged by an older one. They are repaired when read (see presetFor), not here.
    const presets = {};
    for (const [id, p] of Object.entries(obj(r.presets))) {
        const clean = normalizePreset(p, id);
        if (clean) presets[clean.id] = p;
    }
    return {
        enabled: bool('enabled'), buttonShown: bool('buttonShown'),
        contextMessages: int(r.contextMessages, 0, 30, d.contextMessages),
        talkOn: bool('talkOn'), showTalk: bool('showTalk'), cannedLines: bool('cannedLines'),
        talkCooldownSec: int(r.talkCooldownSec, 0, 300, d.talkCooldownSec), speakCooldownSec: int(r.speakCooldownSec, 0, 300, d.speakCooldownSec), showHowTo: bool('showHowTo'),
        talkTokens: int(r.talkTokens, 30, 400, d.talkTokens),
        bondOn: bool('bondOn'), xpOn: bool('xpOn'), itemsOn: bool('itemsOn'), vitalsOn: bool('vitalsOn'),
        energyCost: int(r.energyCost, 0, 100, d.energyCost),
        activityMinutes: int(r.activityMinutes, 0, 600, d.activityMinutes),
        combatProfXp: bool('combatProfXp'),
        combatProfXpPerUse: int(r.combatProfXpPerUse, 0, 50, d.combatProfXpPerUse),
        combatProfXpCap: int(r.combatProfXpCap, 0, 500, d.combatProfXpCap),
        musicOn: bool('musicOn'),
        scripts: normalizeScripts(r.scripts),
        myRecipes: normalizeMyRecipes(r.myRecipes, normalizeRecipe),
        assist: bool('assist'),
        actionKey: normalizeActionKey(r.actionKey, d.actionKey),
        soundMapUrl: text(r.soundMapUrl, 300),
        musicVolume: Math.min(1, Math.max(0, Number.isFinite(Number(r.musicVolume)) ? Number(r.musicVolume) : d.musicVolume)),
        difficulty: DIFFICULTY_IDS.includes(r.difficulty) ? r.difficulty : d.difficulty,
        pairs: [4, 8, 12].includes(Number(r.pairs)) ? Number(r.pairs) : d.pairs,
        teaLlm: bool('teaLlm'),
        teaRounds: Number(r.teaRounds) === 5 ? 5 : 3,
        teaFreeText: bool('teaFreeText'), teaGuestAsks: bool('teaGuestAsks'), teaShowKnown: bool('teaShowKnown'), teaBatchOpeners: bool('teaBatchOpeners'),
        teaMaxTokens: int(r.teaMaxTokens, 500, 2000, d.teaMaxTokens),
        teaContextMessages: int(r.teaContextMessages, 0, 30, d.teaContextMessages),
        presetId: text(r.presetId, 60),
        presets,
    };
}

/* ------------------------------------------------------------------ presets */

/** The kinds of activity the module can run. A preset lists which are on, and may relabel them. */
export const ACTIVITY_KINDS = Object.freeze(['memory', 'mastermind', 'tea', 'harvest', 'craft', 'drill', 'exam']);

/** Tabs of the hub. */
export const HUB_TABS = Object.freeze([
    ['leisure', 'Leisure'],
    ['study', 'Study'],
    ['crafting', 'Crafting'],
    ['training', 'Training'],
]);

/**
 * The activity tiles a preset can hold. Only `study` is built so far; the others are listed by the preset
 * and shown as "coming soon" by the hub, so a preset written today keeps working as phases land.
 */
export const GENERIC_ACTIVITIES = Object.freeze([
    { id: 'study', label: 'Study', kind: 'memory', tab: 'study', icon: 'fa-book-open', blurb: 'Match the tiles in pairs and build up what you know.', solo: true },
    // ARCHIVED (off): the clue puzzle (kind 'mastermind', src/activity-mastermind-core.js, games/potion-ui.js) is kept but hidden. It is not a crafting game; a new crafting design replaces it. Remove `off` to bring the tile back.
    { id: 'potion', label: 'Brewing', kind: 'mastermind', off: true, tab: 'study', icon: 'fa-flask', blurb: 'Work out the recipe from the clues.', solo: true },
    { id: 'tea', label: 'Tea Time', kind: 'tea', tab: 'leisure', icon: 'fa-mug-hot', blurb: 'Share a cup and see how the conversation goes.' },
    { id: 'alchemy', label: 'Alchemy', kind: 'craft', craft: 'alchemy', tab: 'crafting', icon: 'fa-flask', blurb: 'Choose herbs and water, grind, simmer and seal a potion.', solo: true },
    { id: 'cook', label: 'Cooking', kind: 'harvest', tab: 'leisure', icon: 'fa-utensils', blurb: 'Time three steps and cook a dish together.', solo: true },
    { id: 'fish', label: 'Fishing', kind: 'harvest', tab: 'leisure', icon: 'fa-fish', blurb: 'Wait for a bite, hook it and reel it in.', solo: true },
    { id: 'garden', label: 'Gardening', kind: 'harvest', tab: 'leisure', icon: 'fa-seedling', blurb: 'Plant, tend and harvest. Plants grow as you tend them on different days.', solo: true },
]);

export const GENERIC_PRESET = Object.freeze({
    format: 'worldkit-activities',
    version: 1,
    id: 'generic',
    name: 'Generic',
    world: '',
    soundMap: '',
    activities: GENERIC_ACTIVITIES,
    study: Object.freeze({ runes: [], profs: [] }),
    potion: Object.freeze({ recipe: 'Herbal Tonic', failed: 'Murky Brew', names: {}, profs: [] }),
    harvest: Object.freeze({ recipes: GENERIC_RECIPES, fish: GENERIC_FISH, seeds: GENERIC_SEEDS }),
    tea: Object.freeze({ category: 'Tea', music: 'activity_tea_music', snacks: ['Strawberry shortcake', 'Macarons', 'Butter cookies', 'Fruit tart', 'Scones with jam', 'Honey cake', 'Finger sandwiches', 'Cheese and grapes', 'Sweet pastry', 'Smoked skewer'], fallback: ['Mint', 'Chamomile', 'Black tea', 'Green tea', 'Spiced chai'] }),
    classChange: Object.freeze({ mode: 'both', studyKnowledge: 100, rankGate: null }),
    terms: Object.freeze({ examinerRule: 'partner' }),
});

/** The newest preset format this build understands. A preset with a higher version still loads, and keeps what it holds. */
export const PRESET_VERSION = 1;

const PRESET_KNOWN = new Set(['format', 'version', 'id', 'name', 'world', 'soundMap', 'assets', 'activities', 'study', 'potion', 'harvest', 'crafts', 'tea', 'classChange', 'terms']);
export const HARVEST_MODES = Object.freeze(['cook', 'fish', 'garden']);
const ACTIVITY_BASE_KNOWN = new Set(['id', 'kind', 'music', 'label', 'tab', 'icon', 'blurb', 'soon', 'off', 'solo', 'minutes', 'energy']);
const ACTIVITY_KNOWN = new Set(['id', 'mode', 'craft', 'music', 'kind', 'label', 'tab', 'icon', 'blurb', 'soon', 'off', 'solo', 'minutes', 'energy']);
const EXTRA_MAX_CHARS = 200000;
const slugId = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);

/** The fields of `raw` that are not in `known`, copied as plain data (functions and cycles dropped), capped in size. */
function extraOf(raw, known) {
    const out = {};
    for (const [k, v] of Object.entries(obj(raw))) {
        if (known.has(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        try {
            const copy = JSON.parse(JSON.stringify(v));
            if (copy !== undefined) out[k] = copy;
        } catch { /* not plain data: skip it */ }
    }
    return JSON.stringify(out).length > EXTRA_MAX_CHARS ? {} : out;
}

/**
 * Brings a preset written in an older format up to the current one, in memory (the stored preset is never changed).
 * Version 1 is the only format so far, so this passes it through; later formats add their mappings here, oldest first.
 */
export function upgradePreset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    return raw;
}

/** A normalized preset as plain data to write to a file: what the build understands plus every field it kept in `extra`. */
export function exportPreset(preset) {
    const { extra, newer, ...rest } = obj(preset);
    const activities = (rest.activities || []).map(a => { const { extra: ax, unsupported, ...ar } = obj(a); return { ...obj(ax), ...ar }; });
    return { ...obj(extra), ...rest, activities };
}

function normalizeActivity(raw) {
    const r = obj(raw);
    const id = text(r.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return null;
    let kind = ACTIVITY_KINDS.includes(r.kind) ? r.kind : '';
    // A kind this build does not know is kept, shown as unavailable, and written back untouched.
    const unsupported = !kind;
    if (unsupported) kind = text(r.kind, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!kind) return null;
    // An unknown kind keeps every field its own kind may use (mode, craft, ...), because this build cannot tell which are its.
    const extra = extraOf(r, unsupported ? ACTIVITY_BASE_KNOWN : ACTIVITY_KNOWN);
    return {
        id, kind,
        ...(unsupported ? { unsupported: true, soon: true } : {}),
        // Which craft type a craft activity plays (an id in the preset's crafts).
        ...(kind === 'craft' ? { craft: slugId(r.craft) || id } : {}),
        // Which harvest game this is (cook, fish or garden). An older preset with no mode gets it from the id.
        ...(kind === 'harvest' ? { mode: HARVEST_MODES.includes(r.mode) ? r.mode : (HARVEST_MODES.includes(id) ? id : '') } : {}),
        ...(Object.keys(extra).length ? { extra } : {}),
        label: text(r.label, 40) || id,
        tab: HUB_TABS.some(t => t[0] === r.tab) ? r.tab : (kind === 'memory' || kind === 'mastermind' || kind === 'exam' ? 'study' : kind === 'craft' ? 'crafting' : kind === 'drill' ? 'training' : 'leisure'),
        icon: /^fa-[a-z0-9-]+$/.test(String(r.icon || '')) ? r.icon : 'fa-star',
        blurb: text(r.blurb, 120),
        // A looping music tag from the sound map, played while this activity is open (empty means none).
        ...(text(r.music, 60) ? { music: text(r.music, 60) } : {}),
        ...(r.soon && !unsupported ? { soon: true } : {}),
        ...(r.off ? { off: true } : {}),
        // Can be played alone (no partner): the puzzles and the leisure tasks, not the ones that need a guest.
        ...(r.solo ? { solo: true } : {}),
        // Story minutes this activity takes; without it the Activities setting is used.
        ...(Number.isFinite(Number(r.minutes)) && String(r.minutes ?? '').trim() !== '' ? { minutes: Math.max(0, Math.min(600, Math.round(Number(r.minutes)))) } : {}),
        // Its own energy cost (0 to 100); without one the Activities setting is used.
        ...(Number.isFinite(Number(r.energy)) && String(r.energy ?? '').trim() !== '' ? { energy: Math.max(0, Math.min(100, Math.round(Number(r.energy)))) } : {}),
    };
}

export function normalizeRecipe(raw) {
    const r = obj(raw);
    const name = text(r.name, 50);
    if (!name) return null;
    const needs = (Array.isArray(r.needs) ? r.needs : []).slice(0, 4).map(n => {
        const q = obj(n);
        const any = (Array.isArray(q.any) ? q.any : []).map(w => text(w, 30).toLowerCase()).filter(Boolean).slice(0, 20);
        return any.length ? { label: text(q.label, 40) || 'an ingredient', any, qty: int(q.qty, 1, 9, 1) } : null;
    }).filter(Boolean);
    const restore = restoreValue(r.restore);
    // restore: the hunger (0 to 100) eating this dish gives while the Vitals Tracker is on; without one the default for a dish is used.
    return { id: text(r.id, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || name.toLowerCase().replace(/[^a-z0-9]+/g, ''), name, needs, desc: text(r.desc, 90), ...(restore !== null ? { restore } : {}) };
}

/**
 * The craft types of a preset: the preset's own, repaired; the built-in ones fill in any id it does not define, so a preset that only
 * adds a talisman craft still has alchemy.
 */
export function normalizeCrafts(raw) {
    const out = {};
    for (const [id, c] of Object.entries(obj(raw))) {
        const craft = normalizeCraft(c, id);
        if (craft && craft.recipes.length && craft.materials.length) out[craft.id] = craft;
    }
    for (const [id, c] of Object.entries(GENERIC_CRAFTS)) if (!out[id]) out[id] = normalizeCraft(c, id);
    return out;
}

/**
 * The lists for cooking, fishing and gardening. A list the preset leaves out, or that has nothing usable in it, is the built-in one,
 * so a preset that only changes wording still works.
 */
export function normalizeHarvest(raw) {
    const r = obj(raw);
    const recipes = (Array.isArray(r.recipes) ? r.recipes : []).map(normalizeRecipe).filter(Boolean).slice(0, 40);
    const fish = (Array.isArray(r.fish) ? r.fish : []).map(f => {
        const q = obj(f);
        const name = text(q.name, 50);
        return name ? { name, weight: int(q.weight, 1, 100, 10), difficulty: int(q.difficulty, 1, 3, 1), size: int(q.size, 1, 9, 2) } : null;
    }).filter(Boolean).slice(0, 40);
    const seeds = (Array.isArray(r.seeds) ? r.seeds : []).map(s => {
        const q = obj(s);
        const name = text(q.name, 50);
        const produce = text(q.produce, 50);
        return name && produce ? { name, produce, needs: int(q.needs, 1, 3, 2), yield: int(q.yield, 1, 5, 2), kind: text(q.kind, 24) || 'food', ...(q.free ? { free: true } : {}) } : null;
    }).filter(Boolean).slice(0, 40);
    return {
        recipes: recipes.length ? recipes : GENERIC_RECIPES.map(normalizeRecipe),
        fish: fish.length ? fish : GENERIC_FISH.map(f => ({ ...f })),
        seeds: seeds.length ? seeds : GENERIC_SEEDS.map(s => ({ ...s })),
    };
}

/**
 * A preset repaired: unknown fields dropped, missing ones defaulted, unusable activities skipped.
 * Returns null when there is nothing usable (not an object). A preset with no activity list uses the
 * generic one, so a preset that only changes wording or runes still works.
 */
export function normalizePreset(raw, idHint = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = upgradePreset(raw);
    const id = text(r.id || idHint, 60).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return null;
    const list = (Array.isArray(r.activities) ? r.activities : []).map(normalizeActivity).filter(Boolean);
    const seen = new Set();
    const activities = (list.length ? list : GENERIC_ACTIVITIES.map(normalizeActivity)).filter(a => (seen.has(a.id) ? false : seen.add(a.id)));
    const study = obj(r.study);
    const gate = obj(r.classChange).rankGate;
    return {
        format: 'worldkit-activities',
        version: PRESET_VERSION,
        ...(Number(r.version) > PRESET_VERSION ? { newer: true } : {}),
        ...(Object.keys(extraOf(r, PRESET_KNOWN)).length ? { extra: extraOf(r, PRESET_KNOWN) } : {}),
        id,
        name: text(r.name, 60) || id,
        world: text(r.world, 60),
        // The address of a sound map for this world's activities (kept in the user's own folder, never in a public pack).
        soundMap: text(r.soundMap, 300),
        // Where this preset's own art lives in the Content Kit (a folder under art/activities/); empty means none.
        assets: { base: text(obj(r.assets).base, 80).replace(/^\/+|\.\.+/g, '') },
        activities,
        study: {
            runes: (Array.isArray(study.runes) ? study.runes : []).map(v => text(v, 4)).filter(Boolean).slice(0, 12),
            profs: (Array.isArray(study.profs) ? study.profs : []).map(v => text(v, 40)).filter(Boolean).slice(0, 6),
        },
        potion: {
            recipe: text(obj(r.potion).recipe, 40) || 'Herbal Tonic',
            failed: text(obj(r.potion).failed, 40) || 'Murky Brew',
            names: Object.fromEntries(Object.entries(obj(obj(r.potion).names)).map(([k, v]) => [text(k, 20).toLowerCase(), text(v, 24)]).filter(([k, v]) => k && v)),
            profs: (Array.isArray(obj(r.potion).profs) ? r.potion.profs : []).map(v => text(v, 40)).filter(Boolean).slice(0, 6),
        },
        harvest: normalizeHarvest(r.harvest),
        crafts: normalizeCrafts(r.crafts),
        tea: {
            category: text(obj(r.tea).category, 24) || 'Tea',
            // The hunger a shared drink and a snack give (see activity-hunger-core.js); empty uses the built-in values.
            restore: Object.fromEntries(['drink', 'snack', 'dish'].map(k => [k, restoreValue(obj(obj(r.tea).restore)[k])]).filter(([, v]) => v !== null)),
            snacks: (Array.isArray(obj(r.tea).snacks) ? r.tea.snacks : ['Strawberry shortcake', 'Macarons', 'Butter cookies', 'Fruit tart', 'Scones with jam', 'Honey cake', 'Finger sandwiches', 'Cheese and grapes', 'Sweet pastry', 'Smoked skewer']).map(v => text(v, 40)).filter(Boolean).slice(0, 30),
            // The sound-map name of the tea music loop. Empty means none; a map without it plays nothing.
            music: obj(r.tea).music === undefined ? 'activity_tea_music' : text(obj(r.tea).music, 60),
            fallback: (Array.isArray(obj(r.tea).fallback) && r.tea.fallback.length ? r.tea.fallback : ['Mint', 'Chamomile', 'Black tea', 'Green tea', 'Spiced chai']).map(v => text(v, 40)).filter(Boolean).slice(0, 30),
        },
        classChange: {
            mode: ['presets', 'free', 'both'].includes(obj(r.classChange).mode) ? r.classChange.mode : 'both',
            studyKnowledge: int(obj(r.classChange).studyKnowledge, 0, 100000, 100),
            rankGate: gate && typeof gate === 'object' && text(gate.prof, 40) ? { prof: text(gate.prof, 40), rank: text(gate.rank, 20) } : null,
        },
        terms: normalizeTerms(r.terms),
    };
}

/**
 * Which preset applies: the one the user picked, else the built-in one whose `world` matches the active
 * combat type, else Generic. `builtIns` and `userPresets` are { id: preset } maps.
 * @returns {object} a normalized preset (never null)
 */
export function presetFor({ presetId = '', typeId = '', builtIns = {}, userPresets = {} } = {}) {
    const all = { ...builtIns, ...userPresets };
    const picked = presetId && all[presetId] ? normalizePreset(all[presetId], presetId) : null;
    if (picked) return picked;
    if (typeId) {
        const match = Object.values(all).map(p => normalizePreset(p)).filter(Boolean).find(p => p.world && p.world === typeId);
        if (match) return match;
    }
    return normalizePreset(GENERIC_PRESET);
}

/** The activities of a preset that belong on one hub tab, in order, with the ones switched off left out. */
export function activitiesOnTab(preset, tab) {
    return (preset?.activities || []).filter(a => a.tab === tab && !a.off);
}

export { DEFAULT_TERMS };
