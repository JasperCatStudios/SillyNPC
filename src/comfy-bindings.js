import { SCENE_SLOTS } from './comfy-core.js';

/**
 * Workflow input bindings (fork).
 *
 * Some workflows are not written with %placeholders%. A group-photo workflow, for instance, takes four reference
 * people and a place as pictures loaded by picture nodes, plus a prompt node and a seed. A binding ties one input of
 * one node to something Worldkit supplies: { role, node, input }, meaning "put this role's value into that input of
 * that node". Pictures are the file names ComfyUI can load (the portraits are uploaded to it first).
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node.
 */

export const BINDING_ROLES = Object.freeze([
    { id: 'player_image', label: 'Your character (picture)', kind: 'image' },
    ...Array.from({ length: SCENE_SLOTS }, (_, i) => ({ id: `char${i + 1}_image`, label: `Person ${i + 1} (picture)`, kind: 'image' })),
    { id: 'location_image', label: 'Location (picture)', kind: 'image' },
    { id: 'prompt', label: 'Prompt (text)', kind: 'text' },
    { id: 'negative', label: 'Negative prompt (text)', kind: 'text' },
    { id: 'seed', label: 'Seed', kind: 'number' },
    { id: 'width', label: 'Width', kind: 'number' },
    { id: 'height', label: 'Height', kind: 'number' },
]);
const ROLE_IDS = new Set(BINDING_ROLES.map(r => r.id));

const isNode = (n) => n && typeof n === 'object' && !Array.isArray(n) && typeof n.class_type === 'string';
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const titleOf = (n) => String(n?._meta?.title || n?.class_type || '');

/** Repairs a list of bindings: known roles, a node and an input, one binding per node input and one per role. */
export function normalizeBindings(raw) {
    const out = [];
    const seenInput = new Set();
    const seenRole = new Set();
    for (const b of Array.isArray(raw) ? raw : []) {
        const role = str(b?.role);
        const node = str(String(b?.node ?? ''));
        const input = str(b?.input);
        if (!ROLE_IDS.has(role) || !node || !input) continue;
        const key = `${node}|${input}`;
        if (seenInput.has(key) || seenRole.has(role)) continue;
        seenInput.add(key);
        seenRole.add(role);
        out.push({ role, node, input });
    }
    return out;
}

/** Whether any binding supplies the prompt, which is what a workflow needs in place of a %prompt% placeholder. */
export const bindsPrompt = (bindings) => normalizeBindings(bindings).some(b => b.role === 'prompt');

/**
 * What a workflow offers to bind: its picture-loading nodes, its text inputs and the number inputs Worldkit can set.
 * `suggested` is a first guess at the bindings, read from the node titles ("1. person", "5. Location").
 *
 * @param {string|object} source the workflow text or object
 */
export function detectBindings(source) {
    let graph = source;
    if (typeof source === 'string') { try { graph = JSON.parse(source); } catch { graph = null; } }
    const out = { images: [], texts: [], numbers: [], suggested: [] };
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return out;
    const entries = Object.entries(graph).filter(([, n]) => isNode(n))
        .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]));
    for (const [id, n] of entries) {
        const inputs = n.inputs || {};
        const title = titleOf(n);
        if (/LoadImage/i.test(n.class_type) && typeof inputs.image === 'string') {
            out.images.push({ node: id, input: 'image', title, current: inputs.image });
        }
        for (const [k, v] of Object.entries(inputs)) {
            if (/^(text|prompt|PromptState|text_g|text_l|positive|negative)$/i.test(k) && typeof v === 'string' && !/^%/.test(v)) {
                if (/^PromptState$/i.test(k)) {
                    let text = '';
                    try { text = String(JSON.parse(v)?.text ?? ''); } catch { text = ''; }
                    out.texts.push({ node: id, input: k, title, current: text.slice(0, 120) });
                } else if (!/LoadImage|Loader|Info|Label/i.test(n.class_type)) {
                    out.texts.push({ node: id, input: k, title, current: v.slice(0, 120) });
                }
            }
            if (/^(seed|noise_seed)$/i.test(k)) out.numbers.push({ node: id, input: k, title, role: 'seed', cls: n.class_type });
            if (/^width$/i.test(k)) out.numbers.push({ node: id, input: k, title, role: 'width' });
            if (/^height$/i.test(k)) out.numbers.push({ node: id, input: k, title, role: 'height' });
        }
    }
    // First guess: pictures in their numbered order (1 = you, then the others), the one titled for a place last.
    const numbered = out.images
        .map(i => ({ ...i, n: Number((/(^|\W)(\d+)\s*[.)]/.exec(i.title) || [])[2]) || 99 }))
        .sort((a, b) => a.n - b.n || Number(a.node) - Number(b.node));
    const place = numbered.find(i => /location|place|background|scene|setting/i.test(i.title));
    const people = numbered.filter(i => i !== place);
    people.forEach((img, i) => {
        if (i === 0) out.suggested.push({ role: 'player_image', node: img.node, input: img.input });
        else if (i <= SCENE_SLOTS) out.suggested.push({ role: `char${i}_image`, node: img.node, input: img.input });
    });
    if (place) out.suggested.push({ role: 'location_image', node: place.node, input: place.input });
    const prompt = out.texts.find(t => /prompt/i.test(t.title) && !/negative/i.test(t.title)) || out.texts.find(t => !/negative/i.test(t.title));
    if (prompt) out.suggested.push({ role: 'prompt', node: prompt.node, input: prompt.input });
    const neg = out.texts.find(t => /negative/i.test(t.title) || /negative/i.test(t.input));
    if (neg && neg !== prompt) out.suggested.push({ role: 'negative', node: neg.node, input: neg.input });
    for (const role of ['seed', 'width', 'height']) {
        // The seed that really feeds the sampler (a RandomNoise or KSampler input) beats one on a helper node.
        const n = (role === 'seed' && out.numbers.find(x => x.role === role && /Noise|KSampler/i.test(x.cls || ''))) || out.numbers.find(x => x.role === role);
        if (n) out.suggested.push({ role, node: n.node, input: n.input });
    }
    out.suggested = normalizeBindings(out.suggested);
    return out;
}

const setText = (node, input, value) => {
    const cur = node.inputs[input];
    // Some prompt nodes keep their text inside a JSON state string.
    if (typeof cur === 'string' && /^\s*\{/.test(cur)) {
        try {
            const state = JSON.parse(cur);
            if (state && typeof state === 'object' && 'text' in state) { state.text = value; node.inputs[input] = JSON.stringify(state); return; }
        } catch { /* plain text */ }
    }
    node.inputs[input] = value;
};

/** Takes a node out, and every input in the graph that was wired to it (an optional picture slot left empty). */
function dropNode(graph, id) {
    delete graph[id];
    for (const n of Object.values(graph)) {
        if (!isNode(n) || !n.inputs) continue;
        for (const [k, v] of Object.entries(n.inputs)) {
            if (Array.isArray(v) && String(v[0]) === String(id)) delete n.inputs[k];
        }
    }
}

/**
 * Puts the bound values into a graph. A picture role with no picture takes its node out, so a slot nobody fills is
 * simply left empty (when the workflow allows it; otherwise ComfyUI says which input it needs).
 *
 * @param {object} graph an API-format graph (not modified)
 * @param {Array<{ role: string, node: string, input: string }>} bindings
 * @param {{ images?: Record<string, string>, prompt?: string, negative?: string, seed?: number, width?: number, height?: number }} values
 * @returns {object} the new graph
 */
export function applyBindings(graph, bindings, values = {}) {
    const out = JSON.parse(JSON.stringify(graph));
    for (const b of normalizeBindings(bindings)) {
        const node = out[b.node];
        if (!isNode(node)) continue;
        node.inputs = node.inputs || {};
        const role = BINDING_ROLES.find(r => r.id === b.role);
        if (role.kind === 'image') {
            const file = values.images?.[b.role];
            if (file) node.inputs[b.input] = file;
            else dropNode(out, b.node);
        } else if (role.kind === 'text') {
            const text = values[b.role];
            if (text !== undefined && text !== null) setText(node, b.input, String(text));
        } else {
            const n = Number(values[b.role]);
            if (Number.isFinite(n)) node.inputs[b.input] = n;
        }
    }
    return out;
}

/* ---------------------------------------------------------------------- prompts for picture workflows */

/** The default wording for a picture built from reference pictures; the owner can write their own. */
export const DEFAULT_SCENE_TEMPLATE = 'A group photo of {count} people{at}. {people} {extra}';

/**
 * The prompt for a scene made from reference pictures: who is in which picture, then the place and anything extra.
 * {people} names each picture slot ("Picture 1 is Veta."). The template may use {count}, {at}, {location}, {people}, {extra}.
 */
export function scenePromptFromTemplate(template, scene = {}) {
    const people = [];
    let n = 0;
    if (clean(scene.player?.name)) people.push(`Picture ${++n} is ${clean(scene.player.name)}.`);
    for (const c of (scene.characters || []).filter(x => x && clean(x.name)).slice(0, SCENE_SLOTS)) people.push(`Picture ${++n} is ${clean(c.name)}.`);
    const loc = clean(scene.location);
    const tpl = String(template || DEFAULT_SCENE_TEMPLATE);
    return clean(tpl
        .replace(/\{count\}/g, String(Math.max(1, n)))
        .replace(/\{at\}/g, loc ? ` at ${loc}` : '')
        .replace(/\{location\}/g, loc)
        .replace(/\{people\}/g, people.join(' '))
        .replace(/\{extra\}/g, clean(scene.extra)));
}
