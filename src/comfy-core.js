/**
 * ComfyUI workflows (fork): checking one, filling its placeholders, and building the values for a scene.
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node. comfy-engine.js is the side that talks to
 * ComfyUI and to SillyTavern's workflow folder.
 *
 * A workflow here is ComfyUI's API format: the file you get from "Save (API Format)", an object keyed by
 * node id whose values have a class_type and inputs. The normal editor format ("Save") has a nodes list and
 * links and cannot be queued, so it is refused with an explanation rather than failing later inside ComfyUI.
 *
 * Placeholders are written in the workflow as text and replaced when it is queued. A value that is the whole
 * text (a "%seed%" input) becomes a number; a placeholder inside longer text is substituted into it.
 */

/** The names a workflow may use. `alias` lets workflows written for SillyTavern's own ComfyUI support work as they are. */
export const PLACEHOLDERS = Object.freeze([
    { token: '%prompt%', about: 'The picture\'s prompt: the character\'s image prompt and what is being drawn.' },
    { token: '%negative%', alias: ['%negative_prompt%'], about: 'The negative prompt.' },
    { token: '%seed%', about: 'A random seed.' },
    { token: '%width%', about: 'Width in pixels.' },
    { token: '%height%', about: 'Height in pixels.' },
    { token: '%ckpt%', alias: ['%model%'], about: 'The checkpoint chosen in the module settings.' },
    { token: '%lora%', about: 'The LoRA (empty removes a LoraLoader node that uses it).' },
    { token: '%lora_strength%', about: 'The LoRA strength.' },
    { token: '%steps%', about: 'Sampler steps.' },
    { token: '%cfg%', alias: ['%scale%'], about: 'CFG scale.' },
    { token: '%sampler%', about: 'Sampler name.' },
    { token: '%scheduler%', about: 'Scheduler name.' },
    { token: '%denoise%', about: 'Denoise strength.' },
    { token: '%image%', about: 'A reference picture uploaded to ComfyUI (for a LoadImage node).' },
]);

/** Extra names for a picture of the whole scene. Up to SCENE_SLOTS characters, each with a name and a prompt. */
export const SCENE_SLOTS = 6;
export const SCENE_PLACEHOLDERS = Object.freeze([
    { token: '%scene_prompt%', about: 'Everything in one sentence: location, the player and each character.' },
    { token: '%location%', about: 'Where the scene is.' },
    { token: '%player_prompt%', about: 'Your own character\'s image prompt.' },
    { token: '%player_name%', about: 'Your character\'s name.' },
    { token: '%char_count%', about: 'How many characters (not counting you) are in the picture.' },
    ...Array.from({ length: SCENE_SLOTS }, (_, i) => ({ token: `%char${i + 1}_prompt%`, about: `Character ${i + 1}'s image prompt.` })),
    ...Array.from({ length: SCENE_SLOTS }, (_, i) => ({ token: `%char${i + 1}_name%`, about: `Character ${i + 1}'s name.` })),
]);

const TOKEN_RE = /%[a-z][a-z0-9_]*%/gi;
const ALL_TOKENS = new Map();
for (const p of [...PLACEHOLDERS, ...SCENE_PLACEHOLDERS]) {
    ALL_TOKENS.set(p.token, p.token);
    for (const a of p.alias || []) ALL_TOKENS.set(a, p.token);
}

export const API_FORMAT_HELP = 'The workflow must be saved in API format. In ComfyUI open Settings, turn on "Enable Dev mode options", '
    + 'then use "Save (API Format)" in the menu. A file saved with the ordinary Save will not work.';

const isNode = (n) => n && typeof n === 'object' && !Array.isArray(n) && typeof n.class_type === 'string';

/**
 * What a workflow file is and whether it can be used.
 *
 * @param {string|object} source the file's text, or the parsed object
 * @returns {{ ok: boolean, format: 'api'|'editor'|'invalid'|'empty', message: string, placeholders: string[],
 *   hasPrompt: boolean, hasSlots: boolean, nodes: number }}
 */
export function inspectWorkflow(source, options = {}) {
    const bound = Array.isArray(options.bindings) ? options.bindings : [];
    const base = { ok: false, placeholders: [], hasPrompt: false, hasSlots: false, nodes: 0 };
    if (source === undefined || source === null || (typeof source === 'string' && !source.trim())) {
        return { ...base, format: 'empty', message: 'No workflow chosen.' };
    }
    let graph = source;
    if (typeof source === 'string') {
        try { graph = JSON.parse(source); } catch { return { ...base, format: 'invalid', message: `That is not a JSON file. ${API_FORMAT_HELP}` }; }
    }
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
        return { ...base, format: 'invalid', message: `That is not a ComfyUI workflow. ${API_FORMAT_HELP}` };
    }
    if (Array.isArray(graph.nodes) || (graph.links && !Object.values(graph).some(isNode))) {
        return { ...base, format: 'editor', message: `This is a ComfyUI workflow in the editor format, not API format. ${API_FORMAT_HELP}` };
    }
    const nodes = Object.values(graph).filter(isNode);
    if (!nodes.length) {
        return { ...base, format: 'invalid', message: `No ComfyUI nodes were found in it. ${API_FORMAT_HELP}` };
    }
    const found = new Set();
    const text = JSON.stringify(graph);
    for (const m of text.match(TOKEN_RE) || []) {
        const canon = ALL_TOKENS.get(m.toLowerCase());
        if (canon) found.add(canon);
    }
    const placeholders = [...found];
    // A workflow driven by bindings (picture and prompt nodes) needs no %prompt%: a bound prompt input is where it goes.
    const hasPrompt = placeholders.some(p => p === '%prompt%' || p === '%scene_prompt%' || /^%char\d+_prompt%$/.test(p) || p === '%player_prompt%')
        || bound.some(b => b.role === 'prompt');
    const hasSlots = placeholders.some(p => /^%char\d+_(prompt|name)%$/.test(p) || p === '%player_prompt%' || p === '%location%')
        || bound.some(b => /_image$/.test(b.role));
    return {
        ok: true, format: 'api', placeholders, hasPrompt, hasSlots, nodes: nodes.length,
        message: hasPrompt
            ? `API format, ${nodes.length} nodes. ${bound.length ? `${bound.length} input${bound.length === 1 ? '' : 's'} bound. ` : ''}Placeholders used: ${placeholders.join(' ') || 'none'}.`
            : `API format, ${nodes.length} nodes, but it has no %prompt% (or %scene_prompt%), so every picture would come out the same.`,
    };
}

const SCENE_SENTENCE = (v) => v;

/**
 * The values to put into a workflow for a plain picture.
 *
 * @param {{ prompt: string, negative?: string, seed?: number, width?: number, height?: number, ckpt?: string,
 *   lora?: string, loraStrength?: number, steps?: number, cfg?: number, sampler?: string, scheduler?: string,
 *   denoise?: number, image?: string, scene?: object }} v
 * @returns {Record<string, string|number>} by canonical token
 */
export function valuesFor(v) {
    const map = {
        '%prompt%': v.prompt ?? '', '%negative%': v.negative ?? '', '%seed%': v.seed ?? 0, '%width%': v.width ?? 768, '%height%': v.height ?? 1024,
        '%ckpt%': v.ckpt ?? '', '%lora%': v.lora ?? '', '%lora_strength%': Number.isFinite(+v.loraStrength) ? +v.loraStrength : 0.8,
        '%steps%': v.steps ?? 26, '%cfg%': v.cfg ?? 6, '%sampler%': v.sampler ?? 'euler_ancestral', '%scheduler%': v.scheduler ?? 'normal',
        '%denoise%': v.denoise ?? 1, '%image%': v.image ?? '',
    };
    // Scene names are always defined (empty when not drawing a scene), so a workflow that uses them still runs.
    Object.assign(map, v.scene || sceneValues({}));
    return map;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The scene's own placeholders: the location, you, and each character in a slot of their own, so a workflow
 * can give every person a separate prompt (regional prompting, one CLIPTextEncode per person, and so on).
 *
 * @param {{ characters?: Array<{ name: string, prompt?: string }>, player?: { name?: string, prompt?: string },
 *   location?: string, extra?: string }} scene
 * @returns {Record<string, string|number>}
 */
export function sceneValues(scene = {}) {
    const people = (scene.characters || []).filter(c => c && clean(c.name)).slice(0, SCENE_SLOTS);
    const out = {
        '%location%': clean(scene.location),
        '%player_name%': clean(scene.player?.name),
        '%player_prompt%': clean(scene.player?.prompt) || clean(scene.player?.name),
        '%char_count%': people.length,
    };
    for (let i = 0; i < SCENE_SLOTS; i++) {
        const c = people[i];
        out[`%char${i + 1}_name%`] = c ? clean(c.name) : '';
        out[`%char${i + 1}_prompt%`] = c ? (clean(c.prompt) || clean(c.name)) : '';
    }
    const bits = [];
    if (out['%location%']) bits.push(`Location: ${out['%location%']}.`);
    if (clean(scene.player?.name) || clean(scene.player?.prompt)) bits.push(`${out['%player_name%'] || 'The player'}: ${out['%player_prompt%']}.`);
    for (const c of people) bits.push(`${clean(c.name)}: ${clean(c.prompt) || clean(c.name)}.`);
    if (clean(scene.extra)) bits.push(clean(scene.extra));
    out['%scene_prompt%'] = SCENE_SENTENCE(bits.join(' '));
    return out;
}

/**
 * Fills a workflow's placeholders and returns the graph to queue.
 *
 * @param {string|object} source the workflow
 * @param {Record<string, string|number>} map from valuesFor()
 * @returns {object}
 * @throws {Error} with .code 'comfy-badjson' (not API format) or 'comfy-noprompt' (nothing to put a prompt into)
 */
export function fillWorkflow(source, map, options = {}) {
    const info = inspectWorkflow(source, options);
    if (!info.ok) {
        const e = new Error(info.message);
        e.code = 'comfy-badjson';
        e.format = info.format;
        throw e;
    }
    if (!info.hasPrompt) {
        const e = new Error(info.message);
        e.code = 'comfy-noprompt';
        throw e;
    }
    const graph = typeof source === 'string' ? JSON.parse(source) : JSON.parse(JSON.stringify(source));
    const lookup = (token) => map[ALL_TOKENS.get(token.toLowerCase())];

    // A LoRA node whose name is "%lora%" with no LoRA chosen is taken out and its neighbours joined.
    if (!clean(map['%lora%'])) {
        for (const [id, n] of Object.entries(graph)) {
            if (!isNode(n) || !/^LoraLoader/.test(n.class_type) || String(n.inputs?.lora_name || '').toLowerCase() !== '%lora%') continue;
            const src = [n.inputs.model, n.inputs.clip];
            for (const m of Object.values(graph)) {
                for (const [k, val] of Object.entries(m?.inputs || {})) {
                    if (Array.isArray(val) && String(val[0]) === id) m.inputs[k] = src[val[1]] ?? val;
                }
            }
            delete graph[id];
        }
    }
    const sub = (val) => {
        if (typeof val !== 'string') return val;
        const whole = /^%[a-z][a-z0-9_]*%$/i.test(val) ? lookup(val) : undefined;
        if (whole !== undefined) return whole;
        return val.replace(TOKEN_RE, (m) => { const r = lookup(m); return r === undefined ? m : String(r); });
    };
    for (const n of Object.values(graph)) {
        if (!isNode(n) || !n.inputs) continue;
        for (const k of Object.keys(n.inputs)) n.inputs[k] = sub(n.inputs[k]);
    }
    return graph;
}

/** The first image a finished job produced: prefers a SaveImage node, else any node's first picture. */
export function firstOutputImage(outputs, graph = null) {
    const all = [];
    for (const [id, out] of Object.entries(outputs || {})) {
        for (const img of out?.images || []) all.push({ id, img, save: graph?.[id]?.class_type === 'SaveImage' });
    }
    const pick = all.find(x => x.save) || all[0];
    return pick ? pick.img : null;
}

/* ------------------------------------------------------------------ the module's settings */

export const IMAGEGEN_DEFAULTS = Object.freeze({
    url: '',
    defaultWorkflow: '',
    sceneWorkflow: '',
    /** Used only for phone photos (selfies): a character's own phone workflow comes first. */
    phoneWorkflow: '',
    /** Scene pictures use a character's sheet instead of their portrait when they have one. */
    useSheets: true,
    ckpt: '', lora: '', loraStrength: 0.8,
    steps: 26, cfg: 6, sampler: 'euler_ancestral', scheduler: 'normal', denoise: 1, hires: false,
    negative: 'lowres, worst quality, bad anatomy, bad hands, extra fingers, missing fingers, deformed face, asymmetric eyes, blurry, jpeg artifacts, watermark, signature, text, logo, child',
    size: '768x1024',
    sceneSize: '1216x832',
    timeoutS: 300,
    /** Per workflow file: which node inputs take Worldkit's pictures, prompt, seed and size (comfy-bindings.js). */
    bindings: {},
    /** The wording for a scene built from reference pictures (scenePromptFromTemplate in comfy-bindings.js); empty is the default. */
    sceneTemplate: '',
    migrated: false,
});

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : d);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

/** Repairs the module's settings. Every field is present afterwards. */
export function normalizeImagegen(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = IMAGEGEN_DEFAULTS;
    return {
        url: str(r.url).trim().replace(/\/+$/, ''),
        defaultWorkflow: str(r.defaultWorkflow).trim(),
        sceneWorkflow: str(r.sceneWorkflow).trim(),
        phoneWorkflow: str(r.phoneWorkflow).trim(),
        useSheets: r.useSheets === undefined ? true : Boolean(r.useSheets),
        ckpt: str(r.ckpt), lora: str(r.lora), loraStrength: num(r.loraStrength, d.loraStrength, -2, 2),
        steps: Math.round(num(r.steps, d.steps, 1, 150)), cfg: num(r.cfg, d.cfg, 1, 30),
        sampler: str(r.sampler, d.sampler) || d.sampler, scheduler: str(r.scheduler, d.scheduler) || d.scheduler,
        denoise: num(r.denoise, d.denoise, 0.01, 1), hires: Boolean(r.hires),
        negative: typeof r.negative === 'string' ? r.negative : d.negative,
        size: /^\d+\s*[x×]\s*\d+$/.test(str(r.size).trim()) ? str(r.size).trim() : d.size,
        sceneSize: /^\d+\s*[x×]\s*\d+$/.test(str(r.sceneSize).trim()) ? str(r.sceneSize).trim() : d.sceneSize,
        timeoutS: Math.round(num(r.timeoutS, d.timeoutS, 30, 1800)),
        bindings: r.bindings && typeof r.bindings === 'object' && !Array.isArray(r.bindings) ? { ...r.bindings } : {},
        sceneTemplate: str(r.sceneTemplate),
        migrated: Boolean(r.migrated),
    };
}

/** "832x1216" as { w, h }, snapped to what a model can draw. */
export function parseSize(text, fallback = { w: 768, h: 1024 }) {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(text || '').trim());
    const fit = (n) => Math.max(256, Math.min(2048, Math.round(n / 8) * 8));
    return m ? { w: fit(+m[1]), h: fit(+m[2]) } : fallback;
}

/* ------------------------------------------------------------ character sheets and phone workflows */

/** A picture file named like "...charactersheet..." (also "character_sheet", "Character Sheet") is a character sheet. */
export const SHEET_NAME = /character[\s_-]*sheet/i;

/**
 * A character's sheet: the one chosen for them, else any picture in their gallery whose file name says it is one.
 * @returns {string} a path, or ''
 */
export function sheetPathOf(char) {
    const own = String(char?.sheetImage || '').trim();
    if (own) return own;
    const found = (Array.isArray(char?.images) ? char.images : []).find(p => SHEET_NAME.test(String(p).split(/[\\/]/).pop() || ''));
    return found ? String(found) : '';
}

/** The picture a scene or workflow should be shown of someone: their sheet when sheets are in use, else their portrait. */
export function personPicture(char, settings) {
    const sheet = settings?.useSheets === false ? '' : sheetPathOf(char);
    return sheet || String(char?.imageUrl || '').trim();
}

/** The workflow for a phone photo: the character's phone workflow, else the module's. Never their general one. */
export function phoneWorkflowName(char, settings) {
    return String(char?.phoneWorkflow || '').trim() || String(settings?.phoneWorkflow || '').trim();
}
