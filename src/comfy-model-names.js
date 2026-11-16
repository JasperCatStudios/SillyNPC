/**
 * Model file names in a ComfyUI workflow (fork). A workflow made on another computer names its model files
 * as they are laid out there ("flux3\flux3-image-klein.safetensors"); here the same file may sit in another
 * folder ("flux\flux3-image-klein.safetensors"), and ComfyUI then refuses the whole prompt. When the folder
 * differs but the file is the same, the name is corrected to the one this ComfyUI lists.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const BACKSLASH = String.fromCharCode(92);
const norm = (s) => String(s ?? '').split(BACKSLASH).join('/').trim();
const base = (s) => norm(s).split('/').pop().toLowerCase();

/**
 * @param {string} value What the workflow asks for.
 * @param {string[]} options What this ComfyUI lists.
 * @returns {string|null} The listed name to use instead, or null when the value is listed already, nothing matches,
 *   or more than one different file would.
 */
export function matchModelName(value, options) {
    const list = Array.isArray(options) ? options.map(String) : [];
    if (!list.length || typeof value !== 'string' || !value.trim()) return null;
    if (list.includes(value)) return null;
    const same = list.filter(o => norm(o).toLowerCase() === norm(value).toLowerCase());
    if (same.length === 1) return same[0];
    const file = base(value);
    if (!file) return null;
    const hits = list.filter(o => base(o) === file);
    return hits.length === 1 ? hits[0] : null;
}

/**
 * Corrects the model names in a graph, using the lists ComfyUI gives for each node type.
 *
 * @param {Record<string, any>} graph API-format graph, changed in place.
 * @param {(classType: string) => Promise<Record<string, string[]>>} optionsFor For a node type, its file-list inputs
 *   ({ unet_name: [...], ... }). Called once per type.
 * @returns {Promise<{ fixed: { node: string, input: string, from: string, to: string }[] }>}
 */
export async function fixModelNames(graph, optionsFor) {
    const fixed = [];
    const cache = new Map();
    for (const [id, node] of Object.entries(graph || {})) {
        if (!node || typeof node !== 'object' || !node.class_type || !node.inputs) continue;
        const strings = Object.entries(node.inputs).filter(([, v]) => typeof v === 'string' && v.trim());
        if (!strings.length) continue;
        if (!cache.has(node.class_type)) {
            let lists = {};
            try { lists = (await optionsFor(node.class_type)) || {}; } catch { lists = {}; }
            cache.set(node.class_type, lists);
        }
        const lists = cache.get(node.class_type);
        for (const [input, value] of strings) {
            const to = matchModelName(value, lists[input]);
            if (to) { node.inputs[input] = to; fixed.push({ node: id, input, from: value, to }); }
        }
    }
    return { fixed };
}
