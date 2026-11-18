import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { debugLog, LOG_PREFIX } from './constants.js';
import { MESSAGE_RENDERED_EVENT } from './beats.js';
import { DEFAULT_KIT_URL, kitFolderName, kitFileUrl } from './content-kit.js';
import {
    normalizeSoundSettings, parseSoundMap, soundFileUrl, pickFile, findSfxTags, chipLabel, sfxPromptText, soundKey, SOUND_ROLES,
} from './sound-core.js';

/**
 * Sound effects at run time (fork): loads the sound map, sends the story model the list of sounds it may use, and turns
 * [sfx:name] in a reply into a small tappable chip that plays the sound. Off by default; off means no chip is made, nothing
 * is fetched and nothing is sent. The rules are in sound-core.js, the settings page is ui-sound.js.
 */

const KEY = 'sillynpc_sound_effects';
export const SOUND_MAP_EVENT = 'worldkit-sound-map-changed';

let map = null;
let mapUrl = '';
let status = 'Not loaded.';
let loading = null;
let lastFile = '';
let playing = new Set();
let generationEndedAt = 0;
let lastAutoKey = '';

/** The settings, repaired in place so a screen's reference stays the live one. */
export function soundSettings() {
    const settings = getSettings();
    if (!settings.sound || typeof settings.sound !== 'object' || Array.isArray(settings.sound)) settings.sound = {};
    Object.assign(settings.sound, normalizeSoundSettings(settings.sound));
    return settings.sound;
}

export function saveSoundSettings() {
    soundSettings();
    saveSettings();
}

export const soundsOn = () => getSettings().enabled !== false && soundSettings().enabled;
export const loadedMap = () => map;
export const mapStatus = () => status;

/** The map's address: the one typed on the settings page, else the sound pack of the installed Content Kit. */
export function effectiveMapUrl() {
    const typed = soundSettings().mapUrl;
    if (typed) return typed;
    const folder = kitFolderName(String(getSettings().contentKitUrl || '').trim() || DEFAULT_KIT_URL);
    return kitFileUrl(folder, 'sounds/common/map.json');
}

/** Reads the map. Safe to call as often as wanted; a second call while one is running waits for it. */
export function loadSoundMap(force = false) {
    const url = effectiveMapUrl();
    if (!force && map && mapUrl === url) return Promise.resolve(map);
    if (loading && mapUrl === url) return loading;
    mapUrl = url;
    status = 'Loading the sound map...';
    loading = (async () => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(response.status === 404 ? 'no map file there (download the Content Kit, or type another address)' : `the server answered ${response.status}`);
            const parsed = parseSoundMap(await response.text());
            if (!parsed) throw new Error('that file is not a Worldkit sound map');
            map = parsed;
            status = `${parsed.sounds.size} sounds loaded from "${parsed.name}".`;
        } catch (err) {
            map = null;
            status = `No sounds: ${err.message || err}.`;
            debugLog('Sound map failed', err);
        } finally {
            loading = null;
            applySfxPrompt();
            document.dispatchEvent(new Event(SOUND_MAP_EVENT));
        }
        return map;
    })();
    return loading;
}

/** Extra sound maps a module brings along (its own private folder), by address: url -> Promise of the parsed map or null. */
const extraMaps = new Map();

/** Reads a sound map at an address once; a missing or unreadable one is null (and silent). Never throws. */
export function loadMapAt(url) {
    const at = String(url || '').trim();
    if (!at) return Promise.resolve(null);
    if (!extraMaps.has(at)) {
        extraMaps.set(at, (async () => {
            try {
                const response = await fetch(at, { cache: 'no-store' });
                if (!response.ok) return null;
                return parseSoundMap(await response.text());
            } catch (err) {
                debugLog('Extra sound map failed', err);
                return null;
            }
        })());
    }
    return extraMaps.get(at);
}

/** Finds a sound: in the main map, else in the extra map at `extraUrl`. Returns { sound, base } or null. */
async function findSound(name, extraUrl = '') {
    const key = soundKey(name);
    const own = map?.sounds.get(key);
    if (own) return { sound: own, base: mapUrl };
    if (!extraUrl) return null;
    const extra = await loadMapAt(extraUrl);
    const sound = extra?.sounds.get(key);
    return sound ? { sound, base: String(extraUrl).trim() } : null;
}

/**
 * Plays one sound by name. Returns false when the name is not in the map or the browser refuses.
 * `mapUrl` (optional): a second map to look in when the main one does not have the name.
 */
export async function playSound(name, { mapUrl: extraUrl = '' } = {}) {
    const found = await findSound(name, extraUrl);
    if (!found) return false;
    const { sound, base } = found;
    const file = pickFile(sound, lastFile);
    lastFile = file;
    const audio = new Audio(soundFileUrl(base, file));
    audio.volume = Math.min(1, sound.volume * soundSettings().volume);
    playing.add(audio);
    const done = () => playing.delete(audio);
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    try {
        await audio.play();
        return true;
    } catch (err) {
        done();
        debugLog('Sound refused', err);
        return false;
    }
}

export function stopSounds() {
    for (const audio of playing) { try { audio.pause(); } catch { /* gone */ } }
    playing.clear();
}

/* ---- loops (music) ------------------------------------------------------------------------ */

/** Looping sounds that are playing, by sound key: { audio, target, timer }. stopSounds() leaves these alone. */
const loops = new Map();

/** Moves a loop's volume to `to` over `ms` (at once when ms is 0). Replaces a fade already running. */
function rampLoop(entry, to, ms, then) {
    clearInterval(entry.timer);
    const from = entry.audio.volume;
    if (!(ms > 0) || from === to) {
        entry.audio.volume = to;
        then?.();
        return;
    }
    const started = Date.now();
    entry.timer = setInterval(() => {
        const k = Math.min(1, (Date.now() - started) / ms);
        entry.audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        if (k >= 1) { clearInterval(entry.timer); then?.(); }
    }, 50);
}

/**
 * Starts a looping sound (music) from the sound map, fading in over its `fadeMs`. `volume` (0 to 1) scales the map's own
 * volume and the sound-effects volume, so a module can have its own music volume. Playing the same loop again only
 * changes its volume. Returns false when the name is not in the map or the browser refuses (it must follow a tap).
 * @param {string} name
 * @param {{ volume?: number, fadeMs?: number }} [opts]
 */
export async function playLoop(name, { volume = 1, fadeMs, mapUrl: extraUrl = '' } = {}) {
    try { await loadSoundMap(); } catch { /* the map may simply be missing */ }
    const key = soundKey(name);
    const found = await findSound(name, extraUrl);
    if (!found) return false;
    const { sound, base } = found;
    const target = Math.max(0, Math.min(1, sound.volume * soundSettings().volume * volume));
    const held = loops.get(key);
    if (held) { rampLoop(held, target, 300); return true; }
    const audio = new Audio(soundFileUrl(base, pickFile(sound, '')));
    audio.loop = true;
    const fade = fadeMs ?? sound.fadeMs ?? 0;
    audio.volume = fade > 0 ? 0 : target;
    // The sound's own volume and fade are kept, because it may come from an extra map the main one does not know.
    const entry = { audio, timer: null, base: sound.volume, fadeMs: sound.fadeMs ?? 0 };
    loops.set(key, entry);
    try {
        await audio.play();
    } catch (err) {
        loops.delete(key);
        debugLog('Loop refused', err);
        return false;
    }
    // Stopped while it was starting.
    if (loops.get(key) !== entry) { try { audio.pause(); } catch { /* gone */ } return true; }
    if (fade > 0) rampLoop(entry, target, fade);
    return true;
}

/** Changes the volume of a playing loop (the same scaling as playLoop). */
export function setLoopVolume(name, volume = 1) {
    const key = soundKey(name);
    const held = loops.get(key);
    if (held) rampLoop(held, Math.max(0, Math.min(1, held.base * soundSettings().volume * volume)), 200);
}

/** Stops one loop, fading out over `fadeMs` (default: its own fadeMs). */
export function stopLoop(name, { fadeMs } = {}) {
    const key = soundKey(name);
    const held = loops.get(key);
    if (!held) return;
    loops.delete(key);
    const ms = fadeMs ?? held.fadeMs ?? 0;
    rampLoop(held, 0, ms, () => { try { held.audio.pause(); } catch { /* gone */ } });
}

/** Stops every loop. */
export function stopLoops(opts) {
    for (const key of [...loops.keys()]) stopLoop(key, opts);
}

/* ---- the instruction to the story model ------------------------------------------------ */

const ROLES = { system: extension_prompt_roles.SYSTEM, user: extension_prompt_roles.USER, assistant: extension_prompt_roles.ASSISTANT };

/** Puts the list of sounds in front of the model, or takes it away. */
export function applySfxPrompt() {
    try {
        const s = soundSettings();
        const text = soundsOn() ? sfxPromptText(s, map) : '';
        setExtensionPrompt(KEY, text, extension_prompt_types.IN_CHAT, s.depth, false, ROLES[s.role] ?? extension_prompt_roles.SYSTEM);
    } catch (err) {
        debugLog('Sound instruction not placed', err);
    }
}

export { SOUND_ROLES };

/* ---- the chips ----------------------------------------------------------------------- */

/** Replaces the [sfx:name] tags in a message with chips. Names that are not in the map become a quiet, dead chip. */
export function decorateSfx(mesEl) {
    if (!soundsOn() || !map) return [];
    const root = mesEl?.querySelector?.('.mes_text');
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement?.closest('code, pre, .sillynpc-sfx-chip') || !/\[\s*sfx\s*:/i.test(node.nodeValue)
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const names = [];
    for (const node of nodes) {
        const text = node.nodeValue;
        const tags = findSfxTags(text);
        if (!tags.length) continue;
        const frag = document.createDocumentFragment();
        let at = 0;
        for (const tag of tags) {
            if (tag.start > at) frag.append(text.slice(at, tag.start));
            frag.append(makeChip(tag.name));
            names.push(tag.name);
            at = tag.end;
        }
        if (at < text.length) frag.append(text.slice(at));
        node.replaceWith(frag);
    }
    return names;
}

function makeChip(key) {
    const known = map.sounds.has(key);
    const chip = document.createElement('span');
    chip.className = `sillynpc-sfx-chip${known ? '' : ' is-missing'}`;
    chip.dataset.sfx = key;
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-volume-high';
    chip.append(icon, document.createTextNode(` ${chipLabel(key)}`));
    if (!known) {
        chip.title = 'This sound is not in the sound map.';
        return chip;
    }
    chip.title = 'Play this sound';
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    const go = (e) => {
        e.stopPropagation();
        e.preventDefault();
        chip.classList.add('is-playing');
        playSound(key).finally(() => setTimeout(() => chip.classList.remove('is-playing'), 600));
    };
    chip.addEventListener('click', go);
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
    return chip;
}

async function onMessageRendered(mesEl) {
    if (!soundsOn()) return;
    if (!map) await loadSoundMap();
    const names = decorateSfx(mesEl);
    const s = soundSettings();
    if (!s.auto || !names.length) return;
    try {
        const id = Number(mesEl?.getAttribute?.('mesid'));
        const chat = getContext()?.chat;
        if (!Array.isArray(chat) || id !== chat.length - 1) return;
        const message = chat[id];
        if (!message || message.is_user || message.is_system) return;
        const key = `${getContext().chatId}:${id}:${String(message.mes).length}:${String(message.mes).slice(-40)}`;
        if (key === lastAutoKey || Date.now() - generationEndedAt > 15000) return;
        lastAutoKey = key;
        for (const name of names) {
            await playSound(name);
            await new Promise(resolve => setTimeout(resolve, 700));
        }
    } catch (err) {
        console.warn(LOG_PREFIX, 'Automatic sound failed', err);
    }
}

/** Wires the events. Called once at start-up. */
export function initSound() {
    eventSource.on(MESSAGE_RENDERED_EVENT, (mesEl) => { onMessageRendered(mesEl).catch(err => console.warn(LOG_PREFIX, 'Sound chips failed', err)); });
    eventSource.on(event_types.GENERATION_ENDED, () => { generationEndedAt = Date.now(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => { generationEndedAt = Date.now(); });
    eventSource.on(event_types.GENERATION_STARTED, (type) => {
        if (type === 'quiet' || type === 'impersonate') return;
        applySfxPrompt();
    });
    eventSource.on(event_types.CHAT_CHANGED, stopSounds);
    if (soundsOn()) loadSoundMap().catch(() => {});
}
