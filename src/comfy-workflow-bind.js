/**
 * ComfyUI workflows for the Phone (fork): putting the placeholders in for you, and filling them.
 *
 * A workflow saved from ComfyUI ("Save (API Format)") has the values of the day it was made on: one
 * prompt, one picture, one seed, one size. The phone needs to know WHERE to put the prompt, the character
 * sheet, the seed and the size. bindWorkflow finds those inputs and writes %prompt%, %image%, %seed%,
 * %width% and %height% into them, so a workflow can be pasted as it is. substituteValue then fills the
 * placeholders when a picture is drawn, including inside the JSON state some node packs keep in a text
 * input (a prompt box that stores {"text": "..."}), where a plain replace would break the JSON.
 *
 * Running it again on a workflow that is already bound changes nothing it already did.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const isLink = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The parsed JSON inside a string input, or null (node packs store their widget state this way). */
function jsonOf(v) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (t[0] !== '{') return null;
    try { const o = JSON.parse(t); return isObj(o) ? o : null; } catch { return null; }
}

/** The state inputs of a node (name ends in State) that parse as JSON: [[input name, object], ...]. */
const states = (node) => Object.entries(node.inputs).map(([k, v]) => [k, jsonOf(v)]).filter(([k, o]) => /State$/.test(k) && o);

/**
 * Whether the workflow has a prompt helper: a node that writes a long prompt from a short idea. The phone
 * then sends it the idea, not a finished prompt.
 *
 * @param {string} text
 */
export function hasPromptHelper(text) {
    try {
        const g = JSON.parse(String(text || ''));
        return Object.values(g).some(n => isObj(n) && /AIPrompt|PromptHelper|PromptEnhanc/i.test(String(n.class_type || '')));
    } catch { return false; }
}

/**
 * @param {string} text An API-format workflow.
 * @returns {{ ok: boolean, changed: boolean, error?: 'badjson'|'uiformat'|'empty'|'noprompt', json?: string,
 *   found: { image: string[], prompt: string[], seed: string[], helper: string[], size: string[] }, notes: string[] }}
 */
export function bindWorkflow(text) {
    const found = { image: [], prompt: [], seed: [], helper: [], size: [] };
    const notes = [];
    let g;
    try { g = JSON.parse(String(text || '')); } catch { return { ok: false, changed: false, error: 'badjson', found, notes }; }
    if (!isObj(g)) return { ok: false, changed: false, error: 'badjson', found, notes };
    if (Array.isArray(g.nodes)) return { ok: false, changed: false, error: 'uiformat', found, notes };
    const ids = Object.keys(g).filter(id => isObj(g[id]) && isObj(g[id].inputs) && g[id].class_type);
    if (!ids.length) return { ok: false, changed: false, error: 'empty', found, notes };

    const before = JSON.stringify(g);
    const has = (ph) => before.includes(ph);
    const already = { prompt: has('%prompt%'), image: has('%image%') || has('%sheet%'), seed: has('%seed%'), size: has('%width%') && has('%height%') };

    // The picture: the first image loader. Another one is left alone and said so.
    if (!already.image) {
        const loaders = ids.filter(id => /LoadImage/i.test(g[id].class_type) && typeof g[id].inputs.image === 'string');
        if (loaders.length) {
            g[loaders[0]].inputs.image = '%image%';
            found.image.push(loaders[0]);
            if (loaders.length > 1) notes.push(`Only the first image loader (node ${loaders[0]}) takes the character sheet; node ${loaders.slice(1).join(', ')} keeps its own picture.`);
        }
    }

    // The prompt: a prompt box that keeps {"text": ...} as state, else a text-encode node that is not the negative one.
    if (!already.prompt) {
        const boxed = ids.filter(id => states(g[id]).some(([, o]) => typeof o.text === 'string'));
        if (boxed.length) {
            const id = boxed[0];
            for (const [k, o] of states(g[id])) {
                if (typeof o.text !== 'string') continue;
                o.text = '%prompt%';
                g[id].inputs[k] = JSON.stringify(o);
            }
            found.prompt.push(id);
        } else {
            const negative = new Set();
            for (const id of ids) {
                if (!/ZeroOut|Negative/i.test(g[id].class_type)) continue;
                for (const v of Object.values(g[id].inputs)) if (isLink(v)) negative.add(String(v[0]));
            }
            const encoders = ids.filter(id => /TextEncode/i.test(g[id].class_type) && typeof g[id].inputs.text === 'string' && !negative.has(id));
            if (encoders.length) {
                g[encoders[0]].inputs.text = '%prompt%';
                found.prompt.push(encoders[0]);
            }
        }
    }

    // The seed: a seed node that keeps {"runSeed": ...} as state, else a sampler with a plain number.
    if (!already.seed) {
        const seeded = ids.filter(id => states(g[id]).some(([, o]) => 'runSeed' in o));
        if (seeded.length) {
            const id = seeded[0];
            for (const [k, o] of states(g[id])) {
                if (!('runSeed' in o)) continue;
                o.runSeed = '%seed%';
                g[id].inputs[k] = JSON.stringify(o);
            }
            if ('seed' in g[id].inputs && !isLink(g[id].inputs.seed)) g[id].inputs.seed = '%seed%';
            found.seed.push(id);
        } else {
            const sampler = ids.find(id => /Sampler/i.test(g[id].class_type) && typeof g[id].inputs.seed === 'number');
            if (sampler) { g[sampler].inputs.seed = '%seed%'; found.seed.push(sampler); }
        }
    }

    // A prompt helper writes the long prompt from the idea it is given. Its own saved idea is the demo's, and
    // would be added to every picture, so it is emptied; its seed follows the picture's, so each picture gets
    // a newly written prompt.
    for (const id of ids.filter(i => /AIPrompt|PromptHelper|PromptEnhanc/i.test(g[i].class_type))) {
        for (const [k, o] of states(g[id])) {
            if (typeof o.idea !== 'string') continue;
            if (o.idea.trim()) o.idea = '';
            if (typeof o.seed === 'number') o.seed = '%seed%';
            g[id].inputs[k] = JSON.stringify(o);
            if (!found.helper.includes(id)) found.helper.push(id);
        }
    }

    // The size: a sizes node that keeps {"w": ..., "h": ...} as state.
    if (!already.size) {
        const sized = ids.filter(id => /Sizes?/i.test(g[id].class_type) && states(g[id]).some(([, o]) => typeof o.w === 'number' && typeof o.h === 'number'));
        if (sized.length) {
            const id = sized[0];
            for (const [k, o] of states(g[id])) {
                if (typeof o.w !== 'number' || typeof o.h !== 'number') continue;
                o.w = '%width%';
                o.h = '%height%';
                g[id].inputs[k] = JSON.stringify(o);
            }
            found.size.push(id);
        }
    }

    const ok = already.prompt || found.prompt.length > 0;
    if (!ok) notes.push('No prompt input was found. Put %prompt% where the prompt text goes.');
    if (!already.image && !found.image.length) notes.push('No image loader was found, so the character sheet will not be used by this workflow.');
    const json = JSON.stringify(g, null, 1);
    return { ok, changed: JSON.stringify(g) !== before, error: ok ? undefined : 'noprompt', json, found, notes };
}

/** One placeholder replaced in plain text. */
function replaceIn(s, map, keys) {
    let out = s;
    for (const k of keys) if (out.includes(k)) out = out.split(k).join(String(map[k] ?? ''));
    return out;
}

/**
 * A graph input with its placeholders filled. A value that is exactly one placeholder keeps its type
 * (a seed stays a number); inside JSON state the substitution is done on the parsed value and written
 * back, so a prompt with quotes and line breaks cannot break it.
 *
 * @param {any} val
 * @param {Record<string, any>} map
 * @param {string[]} keys
 */
export function substituteValue(val, map, keys) {
    if (typeof val !== 'string') return val;
    if (keys.includes(val)) return map[val];
    if (keys.some(k => val.includes(k))) {
        const o = jsonOf(val);
        if (o) {
            const walk = (x) => {
                if (typeof x === 'string') return keys.includes(x) ? map[x] : replaceIn(x, map, keys);
                if (Array.isArray(x)) return x.map(walk);
                if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]));
                return x;
            };
            return JSON.stringify(walk(o));
        }
    }
    return replaceIn(val, map, keys);
}
