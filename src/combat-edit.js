import { ladderOf, rungIndex } from './combat-roles.js';
import { emptyTypeData, normalizeCombatBlock, normalizeWeapon } from './combat-store.js';
import { isStatus } from './combat-status.js';
import {
    gearRules, kindOf, toolKindOf, ladderFor, tierOf, normalizeItem, normalizeCharGear, nextItemId,
    migrateLegacyWeapon, defaultName, fitsSlot as fits, MAX_BELT,
} from './combat-gear.js';
import { MAX_ABILITIES } from './combat-abilities.js';
import { applyXp, readLevel, hasLevelMeta, XP_PER_LEVEL } from './combat-level.js';

/**
 * Editing a character's combat data by hand (fork).
 *
 * Every function takes a record (a character or the player card) and a world type, changes one
 * thing, and says what happened. Values are stored under the type's immutable ids. Out-of-scale
 * numbers are accepted and flagged rather than refused: a boss may well exceed the scale.
 * Changes leave a history entry, and repeated edits of the same field within a minute are
 * folded into one so typing does not flood it.
 *
 * Pure: no DOM, no SillyTavern imports. The caller saves settings.
 */

const FOLD_MS = 60_000;
const HISTORY_CAP = 50;

/** The record's data for this type, created (with the block around it) if it is not there yet. */
export function ensureTypeData(record, dataKey) {
    if (!record.combat || typeof record.combat !== 'object') record.combat = normalizeCombatBlock(undefined);
    if (!record.combat.types) record.combat.types = {};
    if (!record.combat.types[dataKey]) record.combat.types[dataKey] = emptyTypeData();
    return record.combat.types[dataKey];
}

function log(data, target, from, to, at) {
    const last = data.history[data.history.length - 1];
    if (last && last.kind === 'edit' && last.target === target && at - last.at < FOLD_MS) {
        last.to = to;
        last.at = at;
        return;
    }
    data.history.push({ at, kind: 'edit', target, from, to });
    if (data.history.length > HISTORY_CAP) data.history.splice(0, data.history.length - HISTORY_CAP);
}

const blank = (v) => v === '' || v === null || v === undefined;

/**
 * @param {object} record
 * @param {object} type
 * @param {string} id A stat id of the type.
 * @param {number|string|null} value Blank removes the value.
 * @returns {{ ok: boolean, reason?: string, from?: any, to?: any, outOfScale?: boolean }}
 */
export function setStat(record, type, id, value, at = Date.now()) {
    const stat = type.stats.find(s => s.id === id);
    if (!stat) return { ok: false, reason: 'That type has no such stat.' };

    if (blank(value)) {
        const data = record.combat?.types?.[type.dataKey];
        if (!data || data.stats[id] === undefined) return { ok: true, from: null, to: null };
        const from = data.stats[id];
        delete data.stats[id];
        log(data, `stats.${id}`, from, null, at);
        return { ok: true, from, to: null };
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, reason: 'A stat must be a number.' };

    const data = ensureTypeData(record, type.dataKey);
    const from = data.stats[id] ?? null;
    if (from !== n) {
        data.stats[id] = n;
        log(data, `stats.${id}`, from, n, at);
    }
    const scale = stat.scale;
    const outOfScale = Boolean(scale && (n < scale.min || n > scale.max));
    return { ok: true, from, to: n, outOfScale };
}

/** @returns {{ ok: boolean, reason?: string, from?: any, to?: any }} */
export function setMeta(record, type, id, value, at = Date.now()) {
    const meta = type.meta.find(m => m.id === id);
    if (!meta) return { ok: false, reason: 'That type has no such field.' };

    let next;
    if (blank(value)) next = null;
    else if (meta.type === 'number') {
        next = Number(value);
        if (!Number.isFinite(next)) return { ok: false, reason: `${meta.label} must be a number.` };
    } else if (meta.type === 'choice') {
        if (!(meta.options || []).includes(value)) return { ok: false, reason: `${meta.label} must be one of its choices.` };
        next = String(value);
    } else {
        next = String(value);
    }

    const existing = record.combat?.types?.[type.dataKey];
    if (next === null && (!existing || existing.meta[id] === undefined)) return { ok: true, from: null, to: null };
    const data = ensureTypeData(record, type.dataKey);
    const from = data.meta[id] ?? null;
    if (from === next) return { ok: true, from, to: next };
    if (next === null) delete data.meta[id];
    else data.meta[id] = next;
    log(data, `meta.${id}`, from, next, at);
    return { ok: true, from, to: next };
}

/**
 * Sets or clears a proficiency's rank. A blank rank clears it; the XP is kept if there is any.
 * @returns {{ ok: boolean, reason?: string, from?: any, to?: any }}
 */
export function setRank(record, type, profId, rank, at = Date.now()) {
    const prof = type.proficiencies.find(p => p.id === profId);
    if (!prof) return { ok: false, reason: 'That type has no such proficiency.' };
    const ladder = ladderOf(type, prof.ladder);

    let next = null;
    if (!blank(rank)) {
        const idx = rungIndex(ladder, rank);
        if (idx < 0) return { ok: false, reason: `${rank} is not on the ${prof.label} ladder.` };
        next = ladder.rungs[idx];
    }

    const existing = record.combat?.types?.[type.dataKey];
    if (next === null && !existing?.profs?.[profId]) return { ok: true, from: null, to: null };
    const data = ensureTypeData(record, type.dataKey);
    const held = data.profs[profId];
    const from = held?.rank ?? null;
    if (from === next) return { ok: true, from, to: next };
    if (next === null) {
        if (held && held.xp) held.rank = null;
        else delete data.profs[profId];
    } else {
        data.profs[profId] = { rank: next, xp: held?.xp || 0 };
    }
    log(data, `profs.${profId}`, from, next, at);
    return { ok: true, from, to: next };
}

/** Removes one value from the unknown bucket. */
export function removeUnknown(record, type, key, at = Date.now()) {
    const data = record.combat?.types?.[type.dataKey];
    if (!data || data.unknown[key] === undefined) return { ok: false };
    const from = data.unknown[key];
    delete data.unknown[key];
    log(data, `unknown.${key}`, from, null, at);
    return { ok: true, from };
}

/**
 * Writes the current value of each pool after a blow. No history entry: a fight logs itself,
 * and a pool ticking down every exchange would flood the edit history. Unknown roles are ignored.
 *
 * @param {object} record
 * @param {object} type
 * @param {Record<string, number>} currents role -> current value
 * @returns {string[]} Roles that changed.
 */
export function setPoolCurrents(record, type, currents) {
    const known = new Set((type?.pools || []).map(p => p.role));
    const data = ensureTypeData(record, type.dataKey);
    const changed = [];
    for (const [role, cur] of Object.entries(currents || {})) {
        if (!known.has(role)) continue;
        const next = Math.max(0, Math.round(Number(cur)));
        if (!Number.isFinite(next) || data.pools[role] === next) continue;
        data.pools[role] = next;
        changed.push(role);
    }
    return changed;
}

/** Writes a level where the type keeps it. */
function writeLevel(data, type, level) {
    if (hasLevelMeta(type)) data.meta.level = level; else data.level = level;
}

/**
 * Gives XP. Filling the bar raises the level by one each time, and the level goes where the
 * type keeps it. Returns what happened, for showing.
 */
export function addXp(record, type, gain, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const before = { level: readLevel(type, data), xp: data.xp || 0 };
    const next = applyXp(before.level, before.xp, gain);
    data.xp = next.xp;
    writeLevel(data, type, next.level);
    log(data, 'xp', `${before.xp}`, `${next.xp}`, at);
    return { ok: true, gained: Math.max(0, Math.floor(Number(gain)) || 0), level: next.level, xp: next.xp, levelsGained: next.levelsGained };
}

/** Sets the progress toward the next level by hand, 0 to 199. */
export function setXp(record, type, xp, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const next = Math.max(0, Math.min(XP_PER_LEVEL - 1, Math.floor(Number(xp)) || 0));
    if ((data.xp || 0) !== next) { log(data, 'xp', `${data.xp || 0}`, `${next}`, at); data.xp = next; }
    return { ok: true, xp: next };
}

/** Sets the level by hand. */
export function setLevel(record, type, level, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const next = Math.max(1, Math.floor(Number(level)) || 1);
    const from = readLevel(type, data);
    if (from !== next) { log(data, 'level', `${from}`, `${next}`, at); writeLevel(data, type, next); }
    return { ok: true, level: next };
}

/** Sets which of the type's abilities the character has. Unknown ids are refused. */
export function setAbilities(record, type, ids, at = Date.now()) {
    const known = new Set((type.abilities || []).map(a => a.id));
    const next = [...new Set((ids || []).map(String))].filter(id => known.has(id));
    if (next.length > MAX_ABILITIES) return { ok: false, reason: `At most ${MAX_ABILITIES} abilities can be equipped.` };
    const data = ensureTypeData(record, type.dataKey);
    const from = [...(data.abilities || [])];
    if (JSON.stringify(from) !== JSON.stringify(next)) {
        data.abilities = next;
        log(data, 'abilities', from.join(', ') || null, next.join(', ') || null, at);
    }
    return { ok: true, from, to: next };
}

/** Sets the condition grade (E- near death ... S+ healthy). Blank clears it, which reads as S+. */
export function setStatus(record, type, grade, at = Date.now()) {
    const next = grade === '' || grade === null || grade === undefined ? null : String(grade);
    if (next !== null && !isStatus(next)) return { ok: false, reason: 'That is not a status grade.' };
    const data = ensureTypeData(record, type.dataKey);
    const from = data.status ?? null;
    if (from !== next) {
        data.status = next;
        log(data, 'status', from, next, at);
    }
    return { ok: true, from, to: next };
}

/** Sets what the character fights with. All blank clears it. */
export function setWeapon(record, type, weapon, at = Date.now()) {
    const next = normalizeWeapon(weapon);
    if (next?.prof && !(type.proficiencies || []).some(p => p.id === next.prof)) {
        return { ok: false, reason: 'That type has no such proficiency.' };
    }
    const data = ensureTypeData(record, type.dataKey);
    const from = data.weapon || null;
    data.weapon = next;
    log(data, 'weapon', from, next, at);
    // A character who already has gear keeps the main-hand item in step with what was typed.
    const main = data.gear?.items.find(i => i.id === data.gear.equipped.main);
    if (main) {
        if (next?.name) main.name = next.name;
        main.bonus.power = next?.power || 0;
    }
    return { ok: true, from, to: next };
}

/* ---- gear: weapons, tools, loadout (see combat-gear.js) ---------------------------------- */

const EQUIP_SLOTS = ['main', 'off', 'focus'];
const MAX_ITEMS = 60;

/**
 * The character's gear block, created if they have none. A character with only an old-style
 * weapon gets it as one item, equipped as the main hand (and a history entry says so); anyone
 * else starts with an empty block. Idempotent: it only migrates once.
 */
export function ensureGear(record, type, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    if (data.gear) return data.gear;
    const migrated = migrateLegacyWeapon(type, data);
    data.gear = migrated || { items: [], equipped: { main: null, off: null, focus: null }, belt: [] };
    if (migrated) {
        data.history.push({ at, kind: 'migrate-gear', target: 'gear', from: data.weapon || null, to: migrated.items[0].name });
        if (data.history.length > HISTORY_CAP) data.history.splice(0, data.history.length - HISTORY_CAP);
    }
    return data.gear;
}

/** The old `weapon` field kept as a mirror of the main hand, so older readers still work. */
function mirrorWeapon(data, rules) {
    const gear = data.gear;
    const item = gear?.items.find(i => i.id === gear.equipped.main);
    const kind = kindOf(rules, item?.kind);
    data.weapon = item ? { name: item.name, prof: kind?.prof || '', power: item.bonus.power || 0 } : null;
}

/** An item with its kind and tier made sound for this type, or a reason it cannot be. */
function fitItem(rules, raw) {
    const item = normalizeItem(raw);
    if (item.tool) {
        const kind = toolKindOf(rules, item.kind);
        if (!kind) return { ok: false, reason: 'That type has no such tool.' };
        if (!item.name) item.name = kind.label;
        if (raw?.maxUses === undefined && raw?.uses === undefined) { item.maxUses = kind.uses; item.uses = kind.uses; }
        item.tier = '';
        item.pair = false;
        return { ok: true, item };
    }
    const kind = kindOf(rules, item.kind);
    if (!kind) return { ok: false, reason: 'That type has no such weapon kind.' };
    const tier = tierOf(ladderFor(rules, kind), item.tier);
    item.tier = tier?.id || '';
    if (!item.name) item.name = defaultName(kind, tier);
    if (item.pair && !kind.dualable) item.pair = false;
    return { ok: true, item };
}

/**
 * Gives the character a weapon, focus or tool.
 * @param {object} raw { name, kind, tier, pair, desc, special, bonus, tool, uses }
 * @param {{ equip?: 'main'|'off'|'focus' }} [opts] put it straight into a slot
 */
export function addItem(record, type, raw, opts = {}, at = Date.now()) {
    const rules = gearRules(type);
    const fit = fitItem(rules, raw);
    if (!fit.ok) return fit;
    const gear = ensureGear(record, type, at);
    if (gear.items.length >= MAX_ITEMS) return { ok: false, reason: 'That is as many items as one character can carry.' };
    const item = fit.item;
    item.id = nextItemId(gear.items);
    gear.items.push(item);
    const data = record.combat.types[type.dataKey];
    log(data, `gear.${item.id}`, null, item.name, at);
    if (opts.equip) {
        const out = equip(record, type, opts.equip, item.id, at);
        if (!out.ok) return { ok: true, item, equipped: false, reason: out.reason };
    }
    return { ok: true, item };
}

/** Changes an item. Kind and tier are re-checked; a tool's uses stay inside 0..maxUses. */
export function updateItem(record, type, id, patch, at = Date.now()) {
    const rules = gearRules(type);
    const gear = ensureGear(record, type, at);
    const at_ = gear.items.findIndex(i => i.id === id);
    if (at_ < 0) return { ok: false, reason: 'That item is not carried.' };
    const from = gear.items[at_];
    const merged = { ...from, ...patch, bonus: { ...from.bonus, ...(patch?.bonus || {}) }, id };
    if (from.tool) merged.tool = true;
    const fit = fitItem(rules, merged);
    if (!fit.ok) return fit;
    fit.item.id = id;
    gear.items[at_] = fit.item;
    // A weapon that stopped being able to go where it was equipped comes out of that slot.
    for (const slot of EQUIP_SLOTS) if (gear.equipped[slot] === id && !fits(rules, fit.item, slot).ok) gear.equipped[slot] = null;
    const data = record.combat.types[type.dataKey];
    mirrorWeapon(data, rules);
    log(data, `gear.${id}`, from.name, fit.item.name, at);
    return { ok: true, item: fit.item };
}

export function removeItem(record, type, id, at = Date.now()) {
    const rules = gearRules(type);
    const gear = ensureGear(record, type, at);
    const from = gear.items.find(i => i.id === id);
    if (!from) return { ok: false, reason: 'That item is not carried.' };
    gear.items = gear.items.filter(i => i.id !== id);
    for (const slot of EQUIP_SLOTS) if (gear.equipped[slot] === id) gear.equipped[slot] = null;
    gear.belt = gear.belt.filter(x => x !== id);
    const data = record.combat.types[type.dataKey];
    mirrorWeapon(data, rules);
    log(data, `gear.${id}`, from.name, null, at);
    return { ok: true };
}

/** Puts an item in the main hand, off hand or focus slot, or empties the slot when id is blank. */
export function equip(record, type, slot, id, at = Date.now()) {
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, reason: 'That is not a slot.' };
    const rules = gearRules(type);
    const gear = ensureGear(record, type, at);
    const data = record.combat.types[type.dataKey];
    const from = gear.equipped[slot];
    if (id === null || id === undefined || id === '') {
        gear.equipped[slot] = null;
    } else {
        const item = gear.items.find(i => i.id === id);
        if (!item) return { ok: false, reason: 'That item is not carried.' };
        const ok = fits(rules, item, slot);
        if (!ok.ok) return ok;
        const kind = kindOf(rules, item.kind);
        if (slot === 'off' && gear.equipped.main && kindOf(rules, gear.items.find(i => i.id === gear.equipped.main)?.kind)?.hands === 2) {
            return { ok: false, reason: 'A two-handed weapon needs both hands.' };
        }
        // One item cannot fill two slots.
        for (const s of EQUIP_SLOTS) if (s !== slot && gear.equipped[s] === id) gear.equipped[s] = null;
        gear.equipped[slot] = id;
        if (slot === 'main' && kind.hands === 2) gear.equipped.off = null;
    }
    mirrorWeapon(data, rules);
    log(data, `equip.${slot}`, from, gear.equipped[slot], at);
    return { ok: true, from, to: gear.equipped[slot] };
}

/** Sets which tools go into the fight (at most MAX_BELT, tools only, no repeats). */
export function setBelt(record, type, ids, at = Date.now()) {
    const gear = ensureGear(record, type, at);
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (wanted.length > MAX_BELT) return { ok: false, reason: `A belt holds ${MAX_BELT} tools.` };
    const tools = new Set(gear.items.filter(i => i.tool).map(i => i.id));
    if (wanted.some(id => !tools.has(id))) return { ok: false, reason: 'Only tools go on the belt.' };
    const from = gear.belt;
    gear.belt = wanted;
    log(record.combat.types[type.dataKey], 'belt', from, wanted, at);
    return { ok: true, from, to: wanted };
}

/** One use of a tool is spent. Uses never go below zero. */
export function spendUses(record, type, itemId, n = 1, at = Date.now()) {
    const gear = ensureGear(record, type, at);
    const item = gear.items.find(i => i.id === itemId && i.tool);
    if (!item) return { ok: false, reason: 'That tool is not carried.' };
    const from = item.uses;
    item.uses = Math.max(0, item.uses - Math.max(1, Math.floor(Number(n)) || 1));
    log(record.combat.types[type.dataKey], `uses.${itemId}`, from, item.uses, at);
    return { ok: true, left: item.uses };
}

/** Refill: every tool back to its full uses. Returns how many tools had been used. */
export function refillTools(record, type, at = Date.now()) {
    const gear = record.combat?.types?.[type.dataKey]?.gear;
    if (!gear) return { ok: true, count: 0 };
    let count = 0;
    for (const item of gear.items) {
        if (item.tool && item.uses < item.maxUses) { item.uses = item.maxUses; count++; }
    }
    if (count) log(record.combat.types[type.dataKey], 'refill', count, 0, at);
    return { ok: true, count };
}

/** Repairs a gear block in place (ids, equipped and belt pointers); for imports and hand edits. */
export function repairGear(record, type) {
    const data = record?.combat?.types?.[type.dataKey];
    if (!data?.gear) return false;
    data.gear = normalizeCharGear(data.gear);
    return true;
}

/** The proficiencies worth showing for a character under a type: its skill card, plus any it holds. */
export function visibleProfs(type, data) {
    const cards = type.skillCards;
    const faction = data?.meta?.faction;
    const card = cards && faction && Array.isArray(cards[faction]) ? new Set(cards[faction]) : null;
    return type.proficiencies.filter(p => !card || card.has(p.id) || data?.profs?.[p.id]?.rank);
}
