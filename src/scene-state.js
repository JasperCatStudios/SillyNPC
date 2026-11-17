import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { getRequestHeaders } from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import { sceneFromChat, deviceScene } from './scene-header.js';
import { repairSceneSettings, backgroundFor } from './scene-locations.js';
import { repairWeatherSettings, isTouchDevice } from './weather-settings.js';
import {
    SCENE_META_KEY, BG_MARK_KEY, SCENE_CHANGED_EVENT, backgroundCss, standAside, resolveLocation, sceneChanges, sceneKey,
} from './scene-core.js';

export { SCENE_CHANGED_EVENT };

/**
 * The Scene module, SillyTavern side (fork): keeps where and when the story is, from the scene header of the newest
 * message that has one (scene-header.js), matches the place against the location map (scene-locations.js), switches
 * the chat background when the place changes, and tells everyone else through SCENE_CHANGED_EVENT.
 *
 * Other modules read the scene with getScene() (null while the module is off) or listen for
 *   eventSource.on('worldkit-scene-changed', ({ before, after, changed }) => ...)
 * where changed lists 'place', 'weather' and 'time'.
 *
 * Who is in the scene is not here: that is src/scene-cast.js.
 *
 * Off by default. Off means off: no listeners are attached, nothing is read and no background is touched. The only
 * thing written into a chat is its metadata entry: the last place seen (so a chat whose header messages are gone still
 * knows where it was) and the background this module put on it (so a background you locked yourself is left alone).
 */

let current = null;
let lastKey = '';
let attached = false;
let chatTimer = 0;
let bgStatus = '';
const statusListeners = new Set();

/** The module's settings, repaired in place (a reference taken earlier is still the live one). */
export function sceneSettings() {
    const settings = getSettings();
    if (!settings.scene || typeof settings.scene !== 'object' || Array.isArray(settings.scene)) settings.scene = {};
    const s = repairSceneSettings(settings.scene);
    s.weather = repairWeatherSettings(s.weather, { touch: isTouchDevice() });
    return s;
}

export function saveSceneSettings() {
    saveSettings();
}

/**
 * Where and when the story is now, or null while the module is off (or before anything was read).
 * A copy: changing it changes nothing. With no scene header in the chat, the time is the device's, read now.
 *
 * @returns {null|{ source: 'header'|'device', ms: number|null, hour: number|null, minute: number|null, weekday: string,
 *   dateText: string, timeText: string, place: string, placeMain: string, area: string, weatherText: string,
 *   weatherKind: string, weatherIntensity: string, tempText: string, messageId: number|null,
 *   location: { id: string, name: string, path: string }|null, match: string, ties: string[], chatId: string|null }}
 */
export function getScene() {
    try {
        if (!current || !sceneSettings().enabled) return null;
        const out = { ...current, location: current.location ? { ...current.location } : null, ties: [...current.ties] };
        if (out.source === 'device') {
            const now = deviceScene(new Date());
            for (const key of ['ms', 'hour', 'minute', 'weekday', 'dateText', 'timeText']) out[key] = now[key];
        }
        return out;
    } catch {
        return null;
    }
}

/** What the background switcher last did, or why it did nothing. */
export function backgroundStatus() {
    return bgStatus;
}

/** Called whenever the scene or the background status changes. Returns an unsubscribe. */
/** The places in the map changed from outside the Scene pane (a Content Kit import): screens showing the map redraw. */
const locationListeners = new Set();
export function onLocationsChanged(fn) {
    locationListeners.add(fn);
    return () => locationListeners.delete(fn);
}
export function notifyLocationsChanged() {
    for (const fn of [...locationListeners]) { try { fn(); } catch (err) { console.warn('[Worldkit] map listener failed', err); } }
}

export function onSceneStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

function notifyStatus() {
    for (const fn of [...statusListeners]) {
        try { fn(); } catch (err) { debugLog('Scene status listener failed', err); }
    }
}

function chatMeta() {
    const context = getContext();
    return context?.chatId && context.chatMetadata ? context.chatMetadata : null;
}

function chatStore() {
    const meta = chatMeta();
    if (!meta) return null;
    if (!meta[SCENE_META_KEY] || typeof meta[SCENE_META_KEY] !== 'object') meta[SCENE_META_KEY] = {};
    return meta[SCENE_META_KEY];
}

/**
 * Reads the scene again. Cheap and idempotent: the same chat state (a redraw) does nothing; a reply, a swipe, an edit
 * or another chat recomputes, and only a real change is announced.
 * @param {{ force?: boolean }} [options] force: read and announce even when nothing seems to have changed
 */
export function refreshScene({ force = false } = {}) {
    const s = sceneSettings();
    if (!s.enabled) { current = null; return null; }
    const context = getContext();
    const chatId = context?.chatId || null;
    const chat = chatId && Array.isArray(context.chat) ? context.chat : null;
    const key = sceneKey(chatId, chat);
    if (!force && current && key === lastKey) return current;
    lastKey = key;

    const store = chatStore();
    const scene = sceneFromChat(chat, { lastPlace: store?.lastPlace || '' });
    const previous = current && current.chatId === chatId ? current.location : null;
    const next = { ...scene, ...resolveLocation(s.locations, scene, previous, { world: s.matchWorld }), chatId };

    if (store && scene.source === 'header' && scene.place && store.lastPlace !== scene.place) {
        store.lastPlace = scene.place;
        context.saveMetadataDebounced?.();
    }

    const before = current;
    current = next;
    const changed = sceneChanges(before, next);
    if (changed.length || force) {
        debugLog('Scene changed', changed, next);
        try {
            eventSource.emit(SCENE_CHANGED_EVENT, { before, after: getScene(), changed: changed.length ? changed : ['place', 'weather', 'time'] });
        } catch (err) {
            console.warn(LOG_PREFIX, 'Scene event failed', err);
        }
    }
    if (force || changed.includes('place')) syncBackground();
    notifyStatus();
    return current;
}

/** Match the place again (after the map was edited). Announces only a real change. */
export function rematchScene() {
    if (!sceneSettings().enabled) return;
    lastKey = '';
    refreshScene();
}

/* ---- backgrounds -------------------------------------------------------------------------------------------------- */

/** The backgrounds SillyTavern has, by file name. */
export async function listBackgrounds() {
    const response = await fetch('/api/backgrounds/all', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`SillyTavern could not list the backgrounds (HTTP ${response.status}).`);
    const data = await response.json();
    // Each entry is { filename, isAnimated } in current versions, a bare name in older ones.
    return (Array.isArray(data?.images) ? data.images : [])
        .map(i => String(typeof i === 'string' ? i : i?.filename || ''))
        .filter(Boolean);
}

/**
 * Puts a background file on the chat, locked for this chat the way SillyTavern locks one, and marked as this
 * module's so it is never mistaken for one you locked.
 * @returns {boolean} whether it changed anything
 */
function applyBackgroundFile(file) {
    const context = getContext();
    const meta = chatMeta();
    if (!meta || !file) return false;
    const css = backgroundCss(file);
    if (meta.custom_background === css && meta[BG_MARK_KEY] === css) return false;
    meta.custom_background = css;
    meta[BG_MARK_KEY] = css;
    context.saveMetadataDebounced?.();
    const bg = document.getElementById('bg1');
    if (bg) bg.style.backgroundImage = css;
    return true;
}

function setBgStatus(text) {
    bgStatus = text;
}

/**
 * Switches the chat background to the current place's picture (or its nearest parent's), unless switching is off,
 * no place matched, the place has no picture, or you locked a background of your own in this chat.
 * @returns {boolean} whether the background changed
 */
export function syncBackground() {
    const s = sceneSettings();
    let changed = false;
    if (!s.enabled || !s.backgrounds) setBgStatus('Background switching is off.');
    else if (!chatMeta()) setBgStatus('No chat is open.');
    else if (!current?.location) setBgStatus('No place matched, so the background is left as it is.');
    else {
        const entry = s.locations.find(e => e.id === current.location.id);
        const file = backgroundFor(s.locations, entry);
        const aside = standAside(chatMeta());
        if (!file) setBgStatus(`${current.location.path} has no background (nor has any place above it).`);
        else if (aside) setBgStatus(aside);
        else {
            changed = applyBackgroundFile(file);
            setBgStatus(`Background: ${file}`);
            if (changed) debugLog(`Scene background for "${current.location.path}": ${file}`);
        }
    }
    notifyStatus();
    return changed;
}

/* ---- switching on and off ----------------------------------------------------------------------------------------- */

const onNewText = () => {
    try { refreshScene(); } catch (err) { console.warn(LOG_PREFIX, 'Scene update failed', err); }
};
// An edit or a deletion can touch a message that is not the last one, which the key does not see.
const onRewrite = () => {
    lastKey = '';
    onNewText();
};
const onChatChanged = () => {
    current = null;
    lastKey = '';
    clearTimeout(chatTimer);
    // SillyTavern puts the chat's own background on first, so this waits a moment.
    chatTimer = setTimeout(() => {
        try { refreshScene({ force: true }); } catch (err) { console.warn(LOG_PREFIX, 'Scene update failed', err); }
    }, 700);
};

const HANDLERS = [
    [event_types.MESSAGE_RECEIVED, onNewText],
    [event_types.CHARACTER_MESSAGE_RENDERED, onNewText],
    [event_types.USER_MESSAGE_RENDERED, onNewText],
    [event_types.MESSAGE_SWIPED, onNewText],
    [event_types.MESSAGE_EDITED, onRewrite],
    [event_types.MESSAGE_UPDATED, onRewrite],
    [event_types.MESSAGE_DELETED, onRewrite],
    [event_types.CHAT_CHANGED, onChatChanged],
];

function attach() {
    if (attached) return;
    for (const [name, fn] of HANDLERS) if (name) eventSource.on(name, fn);
    attached = true;
}

function detach() {
    if (!attached) return;
    for (const [name, fn] of HANDLERS) if (name) eventSource.removeListener(name, fn);
    attached = false;
    clearTimeout(chatTimer);
}

/** The head switch. Off detaches every listener and forgets the scene. */
export function setSceneEnabled(on) {
    const s = sceneSettings();
    s.enabled = !!on;
    saveSceneSettings();
    if (s.enabled) {
        attach();
        refreshScene({ force: true });
    } else {
        detach();
        const before = current;
        current = null;
        lastKey = '';
        setBgStatus('');
        if (before) {
            try { eventSource.emit(SCENE_CHANGED_EVENT, { before, after: null, changed: ['place', 'weather', 'time'] }); } catch { /* nobody listening */ }
        }
        notifyStatus();
    }
}

/** The background switch. */
export function setBackgroundsEnabled(on) {
    const s = sceneSettings();
    s.backgrounds = !!on;
    saveSceneSettings();
    syncBackground();
}

export function initScene() {
    if (!sceneSettings().enabled) return;
    attach();
    // A chat may already be open by the time the module loads.
    refreshScene({ force: true });
}
