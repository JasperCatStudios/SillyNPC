/**
 * The Scene module's location map (fork): one global list of places, each with a world label, a parent (so places
 * form a tree), the other names it goes by, and the background picture it uses.
 *
 *   { id, name, world, parentId, aliases: [{ pattern, isRegex }], background }
 *
 * Aliases work like character aliases: isRegex true is a regular expression (case-insensitive) tested on the place
 * text; otherwise the alias is an exact, case-insensitive match of a whole part of the place text. The place's own
 * name is an exact alias too. There is no loose "contains" matching, so a parent's name never finds a child.
 *
 * Grew out of the cancelled Location backgrounds module (foldPlace, the dedupe, the file import that skips places
 * already there). Pure: no DOM, no SillyTavern imports. Tested in tests/scene-locations.test.mjs.
 */

export const LOCATIONS_FORMAT = 'worldkit-scene-locations';
export const LOCATIONS_VERSION = 1;

export const SCENE_DEFAULTS = Object.freeze({
    /** The whole Scene module. Off: no listeners do any work, nothing is read or switched. */
    enabled: false,
    /** Switch the chat background to the matched place's picture. */
    backgrounds: false,
    /** Only places with this world label (or none) are matched. Empty: every place. */
    matchWorld: '',
});

const str = (v) => (typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)));

/** How a place name is compared: lower case, no accents, no apostrophes or punctuation, no leading the/a/an. */
export function foldPlace(text) {
    return String(text ?? '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/^(the|a|an)\s+/, '')
        .trim();
}

/** An id made from a name: "Harbour Inn" -> "harbour-inn". */
export function slugify(name) {
    return foldPlace(name).replace(/\s+/g, '-').slice(0, 60) || 'place';
}

/** An id not yet used in the list. */
export function uniqueId(list, base) {
    const taken = new Set((list || []).map(e => e?.id));
    const root = slugify(base);
    if (!taken.has(root)) return root;
    let n = 2;
    while (taken.has(`${root}-${n}`)) n++;
    return `${root}-${n}`;
}

/** Aliases in the character-alias shape. Strings (or a comma separated string) become exact aliases. */
function repairAliases(raw) {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    const out = Array.isArray(raw) ? raw : [];
    const fixed = [];
    for (const a of list) {
        if (typeof a === 'string') { if (a.trim()) fixed.push({ pattern: a.trim(), isRegex: false }); continue; }
        if (!a || typeof a !== 'object') continue;
        if (typeof a.pattern !== 'string') a.pattern = str(a.pattern);
        a.isRegex = a.isRegex === true;
        fixed.push(a);
    }
    out.length = 0;
    out.push(...fixed);
    return out;
}

const byId = (list) => new Map((list || []).map(e => [e.id, e]));

/** The chain of parents above an entry, nearest first. Stops at a loop. */
export function ancestorsOf(list, entry, map = byId(list)) {
    const out = [];
    const seen = new Set([entry?.id]);
    let at = entry?.parentId ? map.get(entry.parentId) : null;
    while (at && !seen.has(at.id)) {
        out.push(at);
        seen.add(at.id);
        at = at.parentId ? map.get(at.parentId) : null;
    }
    return out;
}

/** The entries with every parent before its children, otherwise in the order given. */
function parentsFirst(list) {
    const map = byId(list);
    return (list || [])
        .map((e, i) => ({ e, i, depth: ancestorsOf(list, e, map).length }))
        .sort((a, b) => a.depth - b.depth || a.i - b.i)
        .map(x => x.e);
}

/** Whether `parentId` may be the parent of `id`: not itself, and not one of its own descendants. */
export function canParent(list, id, parentId) {
    if (!parentId) return true;
    if (parentId === id) return false;
    const map = byId(list);
    const parent = map.get(parentId);
    if (!parent) return false;
    return !ancestorsOf(list, parent, map).some(a => a.id === id);
}

/**
 * Repairs the list IN PLACE and returns it: each entry keeps its object (an editor holding a reference keeps
 * editing the saved one), ids are unique, aliases have the alias shape, a parent that is missing or would make a
 * loop is cleared. Nothing a person typed is dropped here, not even an empty name or alias; that is only done to
 * imported files (normalizeLocations).
 *
 * Old shapes are read too: `file` (the old module's picture) and `parent`.
 */
export function repairLocations(list) {
    if (!Array.isArray(list)) return [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (!list[i] || typeof list[i] !== 'object' || Array.isArray(list[i])) list.splice(i, 1);
    }
    const seen = new Set();
    for (const e of list) {
        e.name = str(e.name);
        let id = str(e.id).trim();
        if (!id || seen.has(id)) {
            const base = id || e.name || 'place';
            let candidate = slugify(base);
            let n = 2;
            while (seen.has(candidate) || list.some(o => o !== e && o.id === candidate)) candidate = `${slugify(base)}-${n++}`;
            id = candidate;
        }
        e.id = id;
        seen.add(id);
        e.world = str(e.world).trim();
        if (e.parentId === undefined && e.parent !== undefined) e.parentId = e.parent;
        delete e.parent;
        e.parentId = str(e.parentId).trim();
        e.aliases = repairAliases(e.aliases);
        if (e.background === undefined && e.file !== undefined) e.background = e.file;
        delete e.file;
        e.background = str(e.background).trim();
    }
    for (const e of list) {
        if (e.parentId && !canParent(list, e.id, e.parentId)) e.parentId = '';
    }
    return list;
}

/** The settings key, repaired in place. */
export function repairSceneSettings(raw) {
    const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    s.enabled = s.enabled === true;
    s.backgrounds = s.backgrounds === true;
    s.matchWorld = str(s.matchWorld).trim();
    if (!Array.isArray(s.locations)) s.locations = [];
    repairLocations(s.locations);
    return s;
}

/** A fresh, repaired copy of the settings (for tests and for reading without touching). */
export function normalizeSceneSettings(raw) {
    const copy = raw && typeof raw === 'object' ? JSON.parse(JSON.stringify(raw)) : {};
    return repairSceneSettings(copy);
}

/**
 * Places from anything a file may hold, cleaned for import: a list, or { locations }, { places } or the old
 * module's { entries }. Entries without a name are dropped, duplicate aliases collapse, and a place that repeats
 * another (same name, same parent, same world) is dropped, its children moved onto the one kept.
 * A parent given by name instead of id is accepted when exactly one place has that name.
 */
export function normalizeLocations(raw) {
    const source = Array.isArray(raw) ? raw
        : Array.isArray(raw?.locations) ? raw.locations
            : Array.isArray(raw?.places) ? raw.places
                : Array.isArray(raw?.entries) ? raw.entries : [];
    const list = JSON.parse(JSON.stringify(source.filter(e => e && typeof e === 'object')));
    // Parents named instead of id'd, before the ids are repaired.
    const named = new Map();
    for (const e of list) {
        const key = foldPlace(e.name);
        named.set(key, named.has(key) ? null : e);
    }
    const ids = new Set(list.map(e => str(e.id).trim()).filter(Boolean));
    for (const e of list) {
        const p = str(e.parentId ?? e.parent).trim();
        if (p && !ids.has(p)) {
            const hit = named.get(foldPlace(p));
            if (hit) {
                if (!str(hit.id).trim()) { hit.id = uniqueId(list, hit.name); ids.add(hit.id); }
                e.parentId = hit.id;
                delete e.parent;
            }
        }
    }
    repairLocations(list);
    for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.name = e.name.trim();
        if (!e.name) list.splice(i, 1);
    }
    for (const e of list) {
        const seen = new Set();
        e.aliases = e.aliases.filter(a => {
            const p = a.pattern.trim();
            if (!p) return false;
            a.pattern = p;
            const key = a.isRegex ? `r:${p}` : `x:${foldPlace(p)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    // Duplicates by name within the same parent and world: keep the first, move the rest's children.
    const kept = new Map();
    const moved = new Map();
    const out = [];
    for (const e of parentsFirst(list)) {
        if (moved.has(e.parentId)) e.parentId = moved.get(e.parentId);
        const key = `${foldPlace(e.name)}|${e.parentId}|${foldPlace(e.world)}`;
        if (kept.has(key)) { moved.set(e.id, kept.get(key).id); continue; }
        kept.set(key, e);
        out.push(e);
    }
    return repairLocations(out);
}

/** The file the map is exported as. Only the map: no pictures. */
export function exportLocations(list) {
    return {
        format: LOCATIONS_FORMAT,
        version: LOCATIONS_VERSION,
        locations: (list || []).map(e => ({
            id: e.id, name: e.name, world: e.world, parentId: e.parentId,
            aliases: (e.aliases || []).filter(a => a.pattern.trim()).map(a => ({ pattern: a.pattern, isRegex: a.isRegex })),
            background: e.background,
        })),
    };
}

/**
 * The places in a file's text, or null when it is not a list of places (not JSON, or another format).
 * @returns {null|object[]}
 */
export function parseLocationFile(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch { return null; }
    if (data && typeof data === 'object' && !Array.isArray(data) && data.format && data.format !== LOCATIONS_FORMAT) return null;
    const isList = Array.isArray(data) || Array.isArray(data?.locations) || Array.isArray(data?.places) || Array.isArray(data?.entries);
    if (!isList) return null;
    return normalizeLocations(data);
}

/**
 * Adds imported places to the list IN PLACE. Merged by id: a place whose id is already there is kept as it is.
 * A place with a new id that repeats one already there (same name, parent and world) is skipped too, and its
 * children go under the one already there. Nothing is ever duplicated.
 * @returns {{ added: number, skipped: number }}
 */
export function mergeLocations(target, incoming) {
    const map = new Map();          // incoming id -> id in the target
    let added = 0;
    let skipped = 0;
    for (const inc of parentsFirst(normalizeLocations(incoming))) {
        if (target.some(e => e.id === inc.id)) { map.set(inc.id, inc.id); skipped++; continue; }
        const parentId = map.get(inc.parentId) ?? (target.some(e => e.id === inc.parentId) ? inc.parentId : '');
        const dup = target.find(e => foldPlace(e.name) === foldPlace(inc.name) && e.parentId === parentId
            && foldPlace(e.world) === foldPlace(inc.world));
        if (dup) { map.set(inc.id, dup.id); skipped++; continue; }
        target.push({ ...inc, parentId, aliases: inc.aliases.map(a => ({ ...a })) });
        map.set(inc.id, inc.id);
        added++;
    }
    repairLocations(target);
    return { added, skipped };
}

/** A new place, added to the list. */
export function addLocation(list, { name = 'New place', parentId = '', world = '' } = {}) {
    const entry = { id: uniqueId(list, name), name, world, parentId: parentId && list.some(e => e.id === parentId) ? parentId : '', aliases: [], background: '' };
    list.push(entry);
    return entry;
}

/** Removes a place; its children move up to its parent. */
export function removeLocation(list, id) {
    const at = list.findIndex(e => e.id === id);
    if (at < 0) return false;
    const [gone] = list.splice(at, 1);
    for (const e of list) if (e.parentId === id) e.parentId = gone.parentId || '';
    return true;
}

/** The world labels in use, sorted. */
export function worldLabels(list) {
    const seen = new Map();
    for (const e of list || []) if (e.world && !seen.has(foldPlace(e.world))) seen.set(foldPlace(e.world), e.world);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

const inWorld = (entry, world) => !world || !entry.world || foldPlace(entry.world) === foldPlace(world);

/**
 * The places as a tree, parents first, each with its depth. Siblings are sorted by name. A place whose parent is
 * missing (or filtered out by the world label) is drawn at the top.
 * @returns {{ entry: object, depth: number }[]}
 */
export function treeOrder(list, { world = '' } = {}) {
    const shown = (list || []).filter(e => inWorld(e, world));
    const ids = new Set(shown.map(e => e.id));
    const kids = new Map();
    for (const e of shown) {
        const p = e.parentId && ids.has(e.parentId) && e.parentId !== e.id ? e.parentId : '';
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(e);
    }
    const sort = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const out = [];
    const seen = new Set();
    const walk = (parent, depth) => {
        for (const e of (kids.get(parent) || []).sort(sort)) {
            if (seen.has(e.id)) continue;
            seen.add(e.id);
            out.push({ entry: e, depth });
            walk(e.id, depth + 1);
        }
    };
    walk('', 0);
    // Anything left over sits in a loop of parents: show it at the top rather than lose it.
    for (const e of shown) if (!seen.has(e.id)) { seen.add(e.id); out.push({ entry: e, depth: 0 }); walk(e.id, 1); }
    return out;
}

/** "Harbour Inn > Common Room". */
export function pathLabel(list, entry) {
    if (!entry) return '';
    return [...ancestorsOf(list, entry).reverse().map(a => a.name), entry.name].join(' > ');
}

/** The background of a place, or of its nearest parent that has one. */
export function backgroundFor(list, entry) {
    if (!entry) return '';
    if (entry.background) return entry.background;
    for (const a of ancestorsOf(list, entry)) if (a.background) return a.background;
    return '';
}

/* ---- matching ------------------------------------------------------------------------------------------------- */

/** The whole place text and its parts ("Harbour Inn - Common Room" -> both, and the whole). */
export function placeParts(text) {
    const whole = String(text ?? '').trim();
    const parts = whole.split(/\s+[-–—]\s+|[,/>|;()]/).map(p => p.trim()).filter(Boolean);
    const out = [];
    const seen = new Set([foldPlace(whole)]);
    for (const p of parts) {
        const f = foldPlace(p);
        if (f && !seen.has(f)) { seen.add(f); out.push({ raw: p, folded: f }); }
    }
    return { whole, folded: foldPlace(whole), parts: out };
}

const regexCache = new Map();
function compile(pattern) {
    if (regexCache.has(pattern)) return regexCache.get(pattern);
    let re = null;
    try { re = new RegExp(pattern, 'i'); } catch { re = null; }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(pattern, re);
    return re;
}

/** Whether an alias pattern is a regex that does not compile. */
export function badRegex(alias) {
    return !!(alias?.isRegex && alias.pattern && !compile(alias.pattern));
}

const RANK = { whole: 3, part: 2, regex: 2 };

/** Every way one place matches the text, best first. */
function hitsFor(entry, split) {
    const hits = [];
    const labels = [{ pattern: entry.name, isRegex: false, own: true }, ...(entry.aliases || []).map(a => ({ ...a, own: false }))];
    for (const label of labels) {
        const pattern = String(label.pattern || '').trim();
        if (!pattern) continue;
        if (label.isRegex) {
            const re = compile(pattern);
            const m = re ? re.exec(split.whole) : null;
            if (m && m[0].length) hits.push({ entry, label: pattern, own: label.own, scope: 'regex', length: m[0].length, matched: m[0] });
            continue;
        }
        const key = foldPlace(pattern);
        if (!key) continue;
        if (key === split.folded) hits.push({ entry, label: pattern, own: label.own, scope: 'whole', length: key.length, matched: split.whole });
        else {
            const part = split.parts.find(p => p.folded === key);
            if (part) hits.push({ entry, label: pattern, own: label.own, scope: 'part', length: key.length, matched: part.raw });
        }
    }
    hits.sort((a, b) => RANK[b.scope] - RANK[a.scope] || b.length - a.length);
    return hits;
}

/**
 * Which place a scene's place text means.
 *
 * 1. Every place whose name or alias matches: exactly the whole text, exactly one part of it ("Harbour Inn - Common
 *    Room" has the parts "Harbour Inn" and "Common Room"), or by its regex.
 * 2. A place is dropped when one of its own children (or deeper) matched as well: the most specific place wins.
 *    A child is only ever found through its own name or aliases, never through its parent's.
 * 3. The rest are ranked: the whole text before a part or a regex; then a place whose parent also matched (so
 *    "Harbour Inn - Common Room" picks the Common Room under Harbour Inn, not one under another place); then the
 *    deeper place; then the longer label.
 * 4. When two places are still level, nothing is picked: the result is a tie and lists them.
 *
 * @param {object[]} list
 * @param {string} text
 * @param {{ world?: string }} [options] only places with this world label, or none
 * @returns {{ kind: 'empty'|'none'|'match'|'tie', entry: object|null, hit: object|null, ties: object[], hits: object[],
 *   dropped: object[], split: object }}
 */
export function matchPlace(list, text, { world = '' } = {}) {
    const split = placeParts(text);
    const result = { kind: 'empty', entry: null, hit: null, ties: [], hits: [], dropped: [], split };
    if (!split.folded && !split.whole) return result;
    const map = byId(list);
    const all = [];
    for (const entry of list || []) {
        if (!inWorld(entry, world)) continue;
        const best = hitsFor(entry, split)[0];
        if (best) all.push(best);
    }
    result.hits = all;
    if (!all.length) { result.kind = 'none'; return result; }

    const hitIds = new Set(all.map(h => h.entry.id));
    const ancestorIds = new Map(all.map(h => [h.entry.id, ancestorsOf(list, h.entry, map).map(a => a.id)]));
    const hasHitBelow = new Set();
    for (const [, ups] of ancestorIds) for (const id of ups) if (hitIds.has(id)) hasHitBelow.add(id);
    const left = all.filter(h => !hasHitBelow.has(h.entry.id));
    result.dropped = all.filter(h => hasHitBelow.has(h.entry.id));

    const score = (h) => [
        RANK[h.scope],
        ancestorIds.get(h.entry.id).some(id => hitIds.has(id)) ? 1 : 0,
        // Depth in the tree is NOT a tie-breaker: two unrelated places that match equally (the same name in two worlds) are a
        // tie to be settled by the owner, never silently the deeper one. A place below a matched place already wins above.
        h.length,
    ];
    const cmp = (a, b) => {
        const x = score(a); const y = score(b);
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
        return 0;
    };
    left.sort(cmp);
    const top = left.filter(h => cmp(h, left[0]) === 0);
    if (top.length > 1) {
        result.kind = 'tie';
        result.ties = top.map(h => h.entry);
        return result;
    }
    result.kind = 'match';
    result.entry = top[0].entry;
    result.hit = top[0];
    return result;
}

const SCOPE_TEXT = { whole: 'equals the whole text', part: 'equals the part', regex: 'regex matches' };

/**
 * Why a text matched what it did, line by line, for the editor's test box. Uses matchPlace itself.
 * @returns {{ result: ReturnType<typeof matchPlace>, lines: string[] }}
 */
export function explainMatch(list, text, options = {}) {
    const result = matchPlace(list, text, options);
    const lines = [];
    const { split } = result;
    if (result.kind === 'empty') return { result, lines: ['Type a place, or paste a whole scene header line.'] };
    lines.push(`Compared as: "${split.folded}"${split.parts.length ? `; parts: ${split.parts.map(p => `"${p.folded}"`).join(', ')}` : ''}`);
    if (options.world) lines.push(`Only places labelled "${options.world}" (or with no label) are tried.`);
    for (const h of result.hits) {
        const what = h.own ? 'name' : (h.scope === 'regex' ? 'regex alias' : 'alias');
        lines.push(`${pathLabel(list, h.entry)}: ${what} "${h.label}" ${SCOPE_TEXT[h.scope]} "${h.matched}"`);
    }
    for (const h of result.dropped) lines.push(`${h.entry.name} is set aside: a place inside it matched too.`);
    if (result.kind === 'none') lines.push('No place matches. Add this name as a place, or as an alias of one.');
    else if (result.kind === 'tie') {
        lines.push(`Ambiguous: ${result.ties.map(e => pathLabel(list, e)).join(' and ')} match equally well. `
            + 'Nothing is picked; the scene keeps its previous place. Make one alias more specific, or give the places parents.');
    } else lines.push(`Result: ${pathLabel(list, result.entry)}`);
    return { result, lines };
}
