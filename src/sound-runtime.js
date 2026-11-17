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

/** Plays one sound by name. Returns false when the name is not in the map or the browser refuses. */
export async function playSound(name) {
    const sound = map?.sounds.get(soundKey(name));
    if (!sound) return false;
    const file = pickFile(sound, lastFile);
    lastFile = file;
    const audio = new Audio(soundFileUrl(mapUrl, file));
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
