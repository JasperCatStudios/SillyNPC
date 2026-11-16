import { getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { extension_settings } from '../../../../extensions.js';
import { getSettings, saveSettings } from './settings.js';
import { getPlayerCard, loadStateFromMetadata } from './status-logic.js';
import { charactersMentionedIn } from './mentions.js';
import { LOG_PREFIX } from './constants.js';
import {
    normalizeImagegen, parseSize, inspectWorkflow, fillWorkflow, valuesFor, sceneValues, firstOutputImage, SCENE_SLOTS,
    personPicture, sheetPathOf, phoneWorkflowName,
} from './comfy-core.js';

/**
 * The image generation module's engine (fork): ComfyUI, a workflow per character, and pictures of a scene.
 *
 * The workflows come from SillyTavern's own ComfyUI folder (data/<user>/user/workflows), the one its Image
 * Generation extension uses, read through its own endpoints. They have to be in ComfyUI's API format; the
 * rules for that, and the placeholders, are in comfy-core.js.
 *
 * The phone no longer carries a ComfyUI engine of its own: it asks this one.
 */

const POLL_MS = 1000;

import { normalizeBindings, applyBindings, scenePromptFromTemplate } from './comfy-bindings.js';

/* ---- settings -------------------------------------------------------------------------- */

/** The bindings saved for a workflow file (see comfy-bindings.js). */
export function bindingsFor(name) {
    return normalizeBindings(imagegenSettings().bindings?.[name]);
}

/** Saves a workflow's bindings; an empty list forgets them. */
export function setBindings(name, bindings) {
    const s = imagegenSettings();
    const list = normalizeBindings(bindings);
    if (list.length) s.bindings[name] = list; else delete s.bindings[name];
    saveImagegenSettings();
}

/** A picture path as something a browser can load: served paths get their leading slash. */
export function portraitUrl(path) {
    const p = String(path || '').trim();
    if (!p) return '';
    return /^(data:|https?:|blob:|\/)/i.test(p) ? p : `/${p}`;
}

/** The chat's current background picture, when it has one. */
export function currentBackgroundUrl() {
    try {
        const node = document.getElementById('bg1') || document.getElementById('bg_custom');
        const value = node ? getComputedStyle(node).backgroundImage : '';
        const m = /url\(["']?([^"')]+)["']?\)/.exec(value || '');
        return m ? new URL(m[1], location.href).pathname.replace(/^\/?/, '/') : '';
    } catch { return ''; }
}

/** The module's settings, repaired in place (so a reference taken earlier is still the live one). */
export function imagegenSettings() {
    const settings = getSettings();
    const fixed = normalizeImagegen(settings.imagegen);
    if (settings.imagegen && typeof settings.imagegen === 'object') {
        for (const key of Object.keys(settings.imagegen)) delete settings.imagegen[key];
        Object.assign(settings.imagegen, fixed);
    } else settings.imagegen = fixed;
    return settings.imagegen;
}

export function saveImagegenSettings() {
    imagegenSettings();
    saveSettings();
}

/**
 * One-time carry-over from the phone, which used to hold the ComfyUI settings itself. Only fills what
 * the module has not been given, and only once.
 */
export function migrateFromPhone() {
    const s = imagegenSettings();
    if (s.migrated) return false;
    let moved = false;
    try {
        const images = extension_settings.sillynpc_phone?.images;
        if (images && typeof images === 'object') {
            const c = images.comfy && typeof images.comfy === 'object' ? images.comfy : {};
            const usesComfy = images.mode === 'comfy' || /:8188(\/|$)/.test(String(images.apiUrl || ''));
            if (!s.url && usesComfy && String(images.apiUrl || '').trim()) { s.url = String(images.apiUrl).trim().replace(/\/+$/, ''); moved = true; }
            for (const k of ['ckpt', 'lora', 'loraStrength', 'steps', 'cfg', 'sampler', 'scheduler', 'hires', 'negative']) {
                if (c[k] !== undefined && c[k] !== '') { s[k] = c[k]; moved = true; }
            }
            if (images.size && usesComfy) { s.size = String(images.size); moved = true; }
        }
    } catch (err) { console.warn(LOG_PREFIX, 'Could not read the phone settings for the image module', err); }
    s.migrated = true;
    saveImagegenSettings();
    return moved;
}

/** The ComfyUI address: the module's, or - until one is set - the one the phone had. */
export function comfyBase() {
    const own = imagegenSettings().url;
    if (own) return own;
    try {
        const images = extension_settings.sillynpc_phone?.images;
        const url = String(images?.apiUrl || '').trim().replace(/\/+$/, '');
        if (url && (images?.mode === 'comfy' || /:8188(\/|$)/.test(url))) return url;
    } catch { /* no phone settings */ }
    return '';
}

/* ---- errors ---------------------------------------------------------------------------- */

export function comfyErr(code, msg, extra) {
    const e = new Error(msg);
    e.code = code;
    Object.assign(e, extra || {});
    return e;
}

/** An error as one plain sentence for the person using it. */
export function describeComfyError(e) {
    switch (e?.code) {
        case 'comfy-noaddr': return 'Enter the ComfyUI address in the Images module, for example http://127.0.0.1:8188';
        case 'comfy-net': return `Cannot reach ComfyUI at ${e.base || 'that address'}. Is it running with --enable-cors-header?`;
        case 'comfy-nockpt': return 'ComfyUI has no checkpoints: put one in models/checkpoints.';
        case 'comfy-node': return `ComfyUI refused the workflow: ${e.message}`;
        case 'comfy-exec': return `ComfyUI failed while drawing: ${e.message}`;
        case 'comfy-timeout': return `ComfyUI did not finish in ${e.secs} s, so the job was removed from the queue.`;
        case 'comfy-badjson': return e.message;
        case 'comfy-noprompt': return e.message;
        case 'comfy-workflow': return e.message;
        default: return e?.message || 'The picture could not be drawn.';
    }
}

/* ---- SillyTavern's workflow folder ------------------------------------------------------ */

let workflowCache = null;

/** The workflow files in SillyTavern's ComfyUI folder, by file name. */
export async function listWorkflows(force = false) {
    if (workflowCache && !force) return workflowCache;
    const response = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
    if (!response.ok) throw comfyErr('comfy-workflow', `SillyTavern could not list the workflow folder (HTTP ${response.status}).`);
    const list = await response.json();
    workflowCache = Array.isArray(list) ? list.map(String) : [];
    return workflowCache;
}

/** The text of one workflow file. */
export async function loadWorkflowText(name) {
    const response = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
    if (!response.ok) throw comfyErr('comfy-workflow', `Could not read the workflow "${name}" (HTTP ${response.status}).`);
    const raw = await response.text();
    let text = raw;
    // SillyTavern sends the file's text as a JSON string.
    try { const parsed = JSON.parse(raw); if (typeof parsed === 'string') text = parsed; } catch { /* already plain */ }
    return text;
}

/** Whether a workflow file can be used, with the reason when it cannot. */
export async function checkWorkflow(name) {
    if (!name) return inspectWorkflow('');
    try { return inspectWorkflow(await loadWorkflowText(name), { bindings: bindingsFor(name) }); }
    catch (err) { return { ok: false, format: 'invalid', message: describeComfyError(err), placeholders: [], hasPrompt: false, hasSlots: false, nodes: 0 }; }
}

/* ---- ComfyUI ---------------------------------------------------------------------------- */

let infoCache = null;

/** What ComfyUI offers: checkpoints, LoRAs, samplers and schedulers. */
export async function comfyInfo(force = false) {
    if (infoCache && !force && infoCache.base === comfyBase()) return infoCache;
    const base = comfyBase();
    if (!base) throw comfyErr('comfy-noaddr', 'no address');
    const pick = async (node, field) => {
        try {
            const r = await fetch(`${base}/object_info/${node}`);
            if (!r.ok) return [];
            const j = await r.json();
            const opt = j?.[node]?.input?.required?.[field];
            return Array.isArray(opt?.[0]) ? opt[0].map(String) : [];
        } catch (e) { if (e instanceof TypeError) throw comfyErr('comfy-net', 'unreachable', { base }); return []; }
    };
    const [ckpts, loras, samplers, schedulers] = await Promise.all([
        pick('CheckpointLoaderSimple', 'ckpt_name'), pick('LoraLoader', 'lora_name'),
        pick('KSampler', 'sampler_name'), pick('KSampler', 'scheduler'),
    ]);
    infoCache = { ckpts, loras, samplers, schedulers, base, at: Date.now() };
    return infoCache;
}

/** The plain graph used when no workflow file is chosen: the module's own settings, in core nodes. */
export function builtinGraph(v) {
    const s = imagegenSettings();
    const g = {};
    g['4'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: v.ckpt } };
    let model = ['4', 0];
    let clip = ['4', 1];
    if (v.lora) {
        const st = Number.isFinite(+v.loraStrength) ? Math.max(-2, Math.min(2, +v.loraStrength)) : 0.8;
        g['10'] = { class_type: 'LoraLoader', inputs: { lora_name: v.lora, strength_model: st, strength_clip: st, model, clip } };
        model = ['10', 0]; clip = ['10', 1];
    }
    g['6'] = { class_type: 'CLIPTextEncode', inputs: { text: v.prompt, clip } };
    g['7'] = { class_type: 'CLIPTextEncode', inputs: { text: v.negative, clip } };
    g['5'] = { class_type: 'EmptyLatentImage', inputs: { width: v.width, height: v.height, batch_size: 1 } };
    const sampler = (latent, denoise, steps) => ({
        class_type: 'KSampler',
        inputs: { seed: v.seed, steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler, denoise, model, positive: ['6', 0], negative: ['7', 0], latent_image: latent },
    });
    g['3'] = sampler(['5', 0], 1, s.steps);
    let last = ['3', 0];
    if (s.hires) {
        g['11'] = { class_type: 'LatentUpscaleBy', inputs: { upscale_method: 'nearest-exact', scale_by: 1.5, samples: last } };
        g['12'] = sampler(['11', 0], 0.45, Math.max(8, Math.round(s.steps * 0.6)));
        last = ['12', 0];
    }
    g['8'] = { class_type: 'VAEDecode', inputs: { samples: last, vae: ['4', 2] } };
    g['9'] = { class_type: 'SaveImage', inputs: { filename_prefix: 'worldkit', images: ['8', 0] } };
    return g;
}

let abortController = null;

/** Stops the picture being drawn, and takes it out of ComfyUI's queue. */
export function cancelImageGen() {
    try { abortController?.abort(); } catch { /* already over */ }
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

/**
 * Puts a picture into ComfyUI's input folder and returns the name a LoadImage node can use. The source is a URL
 * (a served portrait path, a data URL) or a Blob. Each slot has a file name of its own, overwritten each time,
 * so ComfyUI's input folder does not fill up.
 */
async function uploadReference(base, source, fileName = 'worldkit-reference.png') {
    const blob = source instanceof Blob ? source : await (await fetch(portraitUrl(source))).blob();
    const form = new FormData();
    form.append('image', blob, fileName);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const response = await fetch(`${base}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw comfyErr('comfy-node', `reference upload HTTP ${response.status}`, { status: response.status });
    const data = await response.json();
    if (!data?.name) throw comfyErr('comfy-node', 'reference upload: no name', { status: 500 });
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/** Queues a graph, waits for it, and returns the first picture. */
async function runGraph(graph) {
    const base = comfyBase();
    if (!base) throw comfyErr('comfy-noaddr', 'no address');
    const ctrl = new AbortController();
    abortController = ctrl;
    const signal = ctrl.signal;
    let promptId = null;
    const giveUp = async () => {
        try { if (promptId) await fetch(`${base}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) }); } catch { /* best effort */ }
        try { await fetch(`${base}/interrupt`, { method: 'POST' }); } catch { /* best effort */ }
    };
    try {
        let response;
        try {
            response = await fetch(`${base}/prompt`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'worldkit' }) });
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw comfyErr('comfy-net', 'unreachable', { base });
        }
        if (!response.ok) {
            let j = null; try { j = await response.json(); } catch { /* not json */ }
            const ne = j?.node_errors && Object.values(j.node_errors)[0];
            const first = ne?.errors?.[0];
            const msg = first ? `${ne.class_type || ''}: ${first.message}${first.details ? ' - ' + first.details : ''}` : (j?.error?.message || `HTTP ${response.status}`);
            throw comfyErr('comfy-node', msg.slice(0, 260), { status: response.status });
        }
        promptId = (await response.json())?.prompt_id;
        if (!promptId) throw comfyErr('comfy-node', 'no prompt_id', { status: 500 });

        const limit = imagegenSettings().timeoutS * 1000;
        const started = Date.now();
        let entry = null;
        while (Date.now() - started < limit) {
            await wait(POLL_MS, signal);
            let history;
            try { history = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, { signal }); }
            catch (e) { if (e.name === 'AbortError') throw e; continue; }
            if (!history.ok) continue;
            entry = (await history.json())?.[promptId];
            if (!entry) continue;
            const status = entry.status;
            if (status?.status_str === 'error') {
                const m = (status.messages || []).find(x => x?.[0] === 'execution_error')?.[1];
                throw comfyErr('comfy-exec', `${m?.node_type || ''}: ${m?.exception_message || 'execution error'}`.trim().slice(0, 260), { status: 400 });
            }
            if (status?.completed || Object.keys(entry.outputs || {}).length) break;
        }
        if (!entry || !Object.keys(entry.outputs || {}).length) {
            await giveUp();
            throw comfyErr('comfy-timeout', 'timeout', { secs: Math.round(limit / 1000), status: 400 });
        }
        const image = firstOutputImage(entry.outputs, graph);
        if (!image) throw comfyErr('comfy-exec', 'The workflow finished but produced no picture. It needs a SaveImage (or PreviewImage) node.', { status: 400 });
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
        const view = await fetch(`${base}/view?${query}`, { signal });
        if (!view.ok) throw comfyErr('comfy-exec', `view HTTP ${view.status}`, { status: view.status });
        return await view.blob();
    } catch (e) {
        if (e.name === 'AbortError') await giveUp();
        throw e;
    } finally {
        if (abortController === ctrl) abortController = null;
    }
}

/**
 * Draws one picture.
 *
 * @param {{ prompt: string, negative?: string, workflow?: string, size?: string, ref?: string, lora?: string,
 *   loraStrength?: number, scene?: object }} job workflow is a file name in SillyTavern's workflow folder;
 *   empty uses the module's own plain graph. A scene fills the scene placeholders too.
 * @returns {Promise<Blob>}
 */
export async function generateImage(job) {
    const s = imagegenSettings();
    const base = comfyBase();
    if (!base) throw comfyErr('comfy-noaddr', 'no address');
    const { w, h } = parseSize(job.size || s.size);
    const seed = Math.floor(Math.random() * 2 ** 32);
    let ckpt = s.ckpt;
    const firstCheckpoint = async () => {
        const info = await comfyInfo();
        const first = info.ckpts[0] || '';
        if (!first) throw comfyErr('comfy-nockpt', 'no checkpoints');
        return first;
    };
    if (!job.workflow && !ckpt) ckpt = await firstCheckpoint();
    const values = {
        prompt: job.prompt ?? '', negative: job.negative ?? s.negative, seed, width: w, height: h, ckpt,
        lora: job.lora || s.lora, loraStrength: Number.isFinite(+job.loraStrength) ? +job.loraStrength : s.loraStrength,
        steps: s.steps, cfg: s.cfg, sampler: s.sampler, scheduler: s.scheduler, denoise: s.denoise,
        scene: job.scene,
    };
    let graph;
    if (job.workflow) {
        const text = await loadWorkflowText(job.workflow);
        // A workflow that names the checkpoint with %ckpt% (or %model%) and none was chosen uses the first one ComfyUI has.
        if (!ckpt && /%(ckpt|model)%/i.test(text)) { try { ckpt = await firstCheckpoint(); } catch { /* leave it empty */ } values.ckpt = ckpt; }
        if (job.ref && /%image%/i.test(text)) values.image = await uploadReference(base, job.ref);
        const bindings = bindingsFor(job.workflow);
        graph = fillWorkflow(text, valuesFor(values), { bindings });
        if (bindings.length) {
            // Pictures first (the portraits and the place go into ComfyUI's input folder), then the bound inputs.
            const images = {};
            for (const [role, source] of Object.entries(job.portraits || {})) {
                if (!source || !bindings.some(b => b.role === role)) continue;
                try { images[role] = await uploadReference(base, source, `worldkit_${role}.png`); }
                catch (err) { if (err?.name === 'AbortError') throw err; console.warn(LOG_PREFIX, `Could not upload the picture for ${role}`, err); }
            }
            graph = applyBindings(graph, bindings, { images, prompt: values.prompt, negative: values.negative, seed, width: w, height: h });
        }
    } else {
        graph = builtinGraph({ ...values, width: w, height: h });
    }
    return runGraph(graph);
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/* ---- Vistalyze ------------------------------------------------------------------------- */

/**
 * Where the chat is, according to the Vistalyze extension (if it is installed and has been working in this chat).
 * It keeps its locations and scene changes on the chat's own messages (message.extra.vistalyze), so the current
 * place is the last "scene" record, and the picture is the background file it applied. Nothing is asked of it.
 *
 * @returns {{ name: string, key: string, background: string }|null}
 */
export function vistalyzeScene() {
    try {
        const chat = getContext()?.chat || [];
        let scene = null;
        for (let i = chat.length - 1; i >= 0 && !scene; i--) {
            const list = chat[i]?.extra?.vistalyze ?? chat[i]?.vistalyze;
            if (!Array.isArray(list)) continue;
            for (let j = list.length - 1; j >= 0; j--) if (list[j]?.type === 'scene' && list[j]?.location) { scene = list[j]; break; }
        }
        if (!scene) return null;
        let name = '';
        for (let i = chat.length - 1; i >= 0 && !name; i--) {
            const list = chat[i]?.extra?.vistalyze ?? chat[i]?.vistalyze;
            if (!Array.isArray(list)) continue;
            const def = list.slice().reverse().find(r => r?.type === 'location_def' && r.key === scene.location);
            if (def?.name) name = String(def.name);
        }
        const background = scene.image ? `/backgrounds/${encodeURIComponent(String(scene.image))}` : '';
        return { name, key: String(scene.location), background };
    } catch { return null; }
}

/** The workflow for a phone photo of this character: theirs for the phone, else the module's phone one. */
export function phoneWorkflowFor(char) {
    return phoneWorkflowName(char, imagegenSettings());
}

/* ---- characters and scenes -------------------------------------------------------------- */

/** The workflow a character draws with: their own, else the module's default (else the plain graph). */
export function workflowFor(char) {
    return String(char?.imageWorkflow || '').trim() || imagegenSettings().defaultWorkflow;
}

/** A picture of one character, from their image prompt (and whatever is being drawn), with their workflow. */
export async function generateForCharacter(char, { extra = '', size = '', ref = '' } = {}) {
    const s = imagegenSettings();
    const base = String(char?.imagePrompt || '').trim();
    const prompt = [base || String(char?.name || ''), String(extra || '').trim()].filter(Boolean).join(', ');
    const negative = [String(char?.imageNegative || '').trim(), s.negative].filter(Boolean).join(', ');
    return generateImage({ prompt, negative, workflow: workflowFor(char), size, ref, lora: '' });
}

/**
 * Who is in the scene right now: the characters the tracker has in it (else those named in the last few
 * messages), you, and where it is. Everything can be changed in the scene dialog before drawing.
 */
export function gatherScene() {
    const context = getContext();
    const records = getSettings().characters || [];
    let names = [];
    let location = '';
    try {
        const state = loadStateFromMetadata();
        names = (state?.characters || []).map(c => String(c?.name || '').trim()).filter(Boolean);
        const loc = state?.global && Object.entries(state.global).find(([k]) => k.toLowerCase() === 'location');
        location = loc ? String(loc[1] ?? '').trim() : '';
    } catch { /* no tracker state */ }
    let chosen = names.map(n => records.find(r => String(r.name).toLowerCase() === n.toLowerCase())).filter(Boolean);
    if (!chosen.length) {
        const recent = (context?.chat || []).slice(-6).map(m => String(m?.mes || '')).join('\n');
        try { chosen = charactersMentionedIn(recent, records); } catch { chosen = []; }
    }
    const seen = new Set();
    const characters = chosen.filter(c => c && !seen.has(c.id) && seen.add(c.id)).map(c => ({
        id: c.id, name: c.name, prompt: String(c.imagePrompt || '').trim(), negative: String(c.imageNegative || '').trim(), image: personPicture(c, imagegenSettings()), sheet: sheetPathOf(c),
    }));
    let player = { name: '', prompt: '' };
    try {
        const card = getPlayerCard();
        player = { name: String(card?.name || context?.name1 || ''), prompt: String(card?.imagePrompt || '').trim(), image: personPicture(card, imagegenSettings()) };
    } catch { player = { name: String(context?.name1 || ''), prompt: '', image: '' }; }
    // Vistalyze knows the place by name and has put its picture on the chat: use both when it is there.
    const viz = vistalyzeScene();
    if (viz?.name) location = viz.name;
    return { characters, player, location, background: viz?.background || currentBackgroundUrl(), vistalyze: Boolean(viz) };
}

/**
 * Draws the scene: each person in a slot of their own, you, the location, and the scene workflow.
 *
 * @param {{ characters: Array<{ name: string, prompt?: string }>, player?: object, location?: string, extra?: string,
 *   workflow?: string, size?: string }} scene
 */
export async function generateScene(scene) {
    const s = imagegenSettings();
    const workflow = scene.workflow || s.sceneWorkflow || s.defaultWorkflow;
    const slots = sceneValues(scene);
    const negatives = (scene.characters || []).map(c => String(c.negative || '').trim()).filter(Boolean);
    const negative = [s.negative, ...new Set(negatives)].filter(Boolean).join(', ');
    const bindings = workflow ? bindingsFor(workflow) : [];
    const pictureWorkflow = bindings.some(b => /_image$/.test(b.role));
    // A workflow built from reference pictures gets its wording from the scene template; one built from
    // placeholders gets the combined scene sentence.
    const prompt = pictureWorkflow ? scenePromptFromTemplate(s.sceneTemplate, scene) : slots['%scene_prompt%'];
    // Who goes in which picture: you first, then the others in the order they were chosen, then the place.
    const portraits = {};
    if (scene.player?.image) portraits.player_image = scene.player.image;
    (scene.characters || []).slice(0, SCENE_SLOTS).forEach((c, i) => { if (c?.image) portraits[`char${i + 1}_image`] = c.image; });
    if (scene.locationImage) portraits.location_image = scene.locationImage;
    return generateImage({
        prompt, negative, workflow, size: scene.size || s.sceneSize, scene: slots, portraits,
    });
}
