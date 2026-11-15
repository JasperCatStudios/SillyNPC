import { normalizeGear, normalizeItem, nextItemId } from './combat-gear.js';

/**
 * Your changes to a world's gear rules, and your named weapons (fork).
 *
 * A type's gear comes with the type and cannot be edited in place (built-ins are frozen), so what
 * you do in the Armoury is kept beside it as an overlay per type, like the ability overlay:
 *
 *   ladders      a tier ladder you replaced, by ladder id (the whole ladder)
 *   kinds        { added, edited, removed } weapon and focus kinds
 *   tools        { added, edited, removed } tool kinds
 *   catalogue    the world's Armoury: named weapons anyone can be given ("Areadbhar")
 *
 * The type's gear is then the built-in rules with the overlay laid over them. Nothing is lost:
 * resetting just takes the change out of the overlay.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const idOf = (v) => String(v ?? '').trim();

function normalizeParts(raw) {
    const o = obj(raw);
    const edited = {};
    for (const [id, v] of Object.entries(obj(o.edited))) if (v && typeof v === 'object') edited[idOf(id)] = { ...v, id: idOf(id) };
    const seen = new Set();
    const added = [];
    for (const v of list(o.added)) {
        const id = idOf(v?.id);
        if (!id || seen.has(id) || !v || typeof v !== 'object') continue;
        seen.add(id);
        added.push({ ...v, id });
    }
    return { added, edited, removed: [...new Set(list(o.removed).map(idOf).filter(Boolean))] };
}

export function emptyGearOverlay() {
    return { ladders: {}, kinds: { added: [], edited: {}, removed: [] }, tools: { added: [], edited: {}, removed: [] }, catalogue: [] };
}

/** An overlay with only the shapes it may have. Idempotent. */
export function normalizeGearOverlay(raw) {
    const o = obj(raw);
    const ladders = {};
    for (const [id, l] of Object.entries(obj(o.ladders))) if (l && typeof l === 'object' && Array.isArray(l.tiers)) ladders[idOf(id)] = l;
    const catalogue = [];
    const seen = new Set();
    for (const r of list(o.catalogue).slice(0, 200)) {
        const item = normalizeItem(r);
        if (!item.name || !item.kind) continue;
        if (!item.id || seen.has(item.id)) item.id = nextItemId([...catalogue]);
        seen.add(item.id);
        catalogue.push(item);
    }
    return { ladders, kinds: normalizeParts(o.kinds), tools: normalizeParts(o.tools), catalogue };
}

export const isGearOverlayEmpty = (raw) => {
    const o = normalizeGearOverlay(raw);
    const none = (p) => !p.added.length && !Object.keys(p.edited).length && !p.removed.length;
    return !Object.keys(o.ladders).length && none(o.kinds) && none(o.tools) && !o.catalogue.length;
};

function mergeParts(base, parts) {
    const out = [];
    for (const b of list(base)) {
        if (parts.removed.includes(b.id)) continue;
        out.push(parts.edited[b.id] ? { ...b, ...parts.edited[b.id], source: 'edited' } : { ...b, source: 'built-in' });
    }
    const have = new Set(out.map(x => x.id));
    for (const a of parts.added) if (!have.has(a.id)) out.push({ ...a, source: 'custom' });
    return out;
}

/**
 * A type's gear rules with the overlay laid over them, as raw gear (run it through normalizeGear
 * to use it). A replaced ladder replaces the whole ladder.
 */
export function mergeGear(baseGear, overlay) {
    const base = normalizeGear(baseGear);
    const ov = normalizeGearOverlay(overlay);
    return {
        ...base,
        ladders: { ...base.ladders, ...ov.ladders },
        kinds: mergeParts(base.kinds, ov.kinds),
        tools: mergeParts(base.tools, ov.tools),
    };
}

/* ---- changes you make ---------------------------------------------------------------- */

const inBase = (base, id) => list(base).some(x => x.id === id);

function saveInParts(base, parts, item) {
    const id = idOf(item?.id);
    if (!id) return parts;
    const p = normalizeParts(parts);
    p.removed = p.removed.filter(x => x !== id);
    if (inBase(base, id)) {
        p.edited[id] = { ...item, id };
        p.added = p.added.filter(x => x.id !== id);
    } else {
        const at = p.added.findIndex(x => x.id === id);
        if (at >= 0) p.added[at] = { ...item, id }; else p.added.push({ ...item, id });
    }
    return p;
}

function removeInParts(base, parts, id) {
    const p = normalizeParts(parts);
    p.added = p.added.filter(x => x.id !== id);
    delete p.edited[id];
    if (inBase(base, id) && !p.removed.includes(id)) p.removed.push(id);
    return p;
}

function resetInParts(parts, id) {
    const p = normalizeParts(parts);
    delete p.edited[id];
    p.removed = p.removed.filter(x => x !== id);
    return p;
}

/** Replaces a whole tier ladder (rename tiers, recolour, change the numbers). */
export function setLadder(overlay, ladderId, ladder) {
    const ov = normalizeGearOverlay(overlay);
    ov.ladders[idOf(ladderId)] = ladder;
    return ov;
}

/** Takes your change to a ladder back out: the world's own comes back. */
export function resetLadder(overlay, ladderId) {
    const ov = normalizeGearOverlay(overlay);
    delete ov.ladders[idOf(ladderId)];
    return ov;
}

export const saveKind = (baseGear, overlay, kind) => {
    const ov = normalizeGearOverlay(overlay);
    ov.kinds = saveInParts(normalizeGear(baseGear).kinds, ov.kinds, kind);
    return ov;
};
export const removeKind = (baseGear, overlay, id) => {
    const ov = normalizeGearOverlay(overlay);
    ov.kinds = removeInParts(normalizeGear(baseGear).kinds, ov.kinds, id);
    return ov;
};
export const resetKind = (overlay, id) => {
    const ov = normalizeGearOverlay(overlay);
    ov.kinds = resetInParts(ov.kinds, id);
    return ov;
};

export const saveTool = (baseGear, overlay, tool) => {
    const ov = normalizeGearOverlay(overlay);
    ov.tools = saveInParts(normalizeGear(baseGear).tools, ov.tools, tool);
    return ov;
};
export const removeTool = (baseGear, overlay, id) => {
    const ov = normalizeGearOverlay(overlay);
    ov.tools = removeInParts(normalizeGear(baseGear).tools, ov.tools, id);
    return ov;
};
export const resetTool = (overlay, id) => {
    const ov = normalizeGearOverlay(overlay);
    ov.tools = resetInParts(ov.tools, id);
    return ov;
};

/** Adds a named weapon to the world's Armoury (or replaces the one with the same id). */
export function saveCatalogueItem(overlay, item) {
    const ov = normalizeGearOverlay(overlay);
    const n = normalizeItem(item);
    if (!n.name || !n.kind) return ov;
    if (!n.id) n.id = nextItemId(ov.catalogue);
    const at = ov.catalogue.findIndex(x => x.id === n.id);
    if (at >= 0) ov.catalogue[at] = n; else ov.catalogue.push(n);
    return ov;
}

export function removeCatalogueItem(overlay, id) {
    const ov = normalizeGearOverlay(overlay);
    ov.catalogue = ov.catalogue.filter(x => x.id !== id);
    return ov;
}
