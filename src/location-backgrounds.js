import { eventSource, event_types, getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { extension_settings } from '../../../../extensions.js';
import { getSettings, saveSettings } from './settings.js';
import { loadStateFromMetadata } from './status-logic.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import { normalizeLocations, matchLocation } from './location-core.js';

/**
 * Location backgrounds, SillyTavern side (fork). When the tracker's Location changes, the chat's background becomes
 * the picture set for that place in the table (location-core.js). The background is kept the way SillyTavern keeps a
 * locked chat background (chat_metadata.custom_background), so it is still there when the chat is opened again.
 *
 * Off by default. It steps aside when Vistalyze has set the background for this chat, and when you have locked a
 * different background yourself.
 */

const OURS_KEY = 'worldkit_location_bg';

/** The table's settings, repaired in place (so a reference taken earlier is still the live one). */
export function locationSettings() {
    const settings = getSettings();
    const fixed = normalizeLocations(settings.locationBackgrounds);
    if (settings.locationBackgrounds && typeof settings.locationBackgrounds === 'object') {
        for (const key of Object.keys(settings.locationBackgrounds)) delete settings.locationBackgrounds[key];
        Object.assign(settings.locationBackgrounds, fixed);
    } else settings.locationBackgrounds = fixed;
    return settings.locationBackgrounds;
}

export function saveLocationSettings() {
    locationSettings();
    saveSettings();
}

/** Where the story is, according to the tracker. */
export function currentPlace() {
    try {
        const state = loadStateFromMetadata();
        const hit = state?.global && Object.entries(state.global).find(([k]) => k.toLowerCase() === 'location');
        return hit ? String(hit[1] ?? '').trim() : '';
    } catch { return ''; }
}

/** The backgrounds SillyTavern has, by file name. */
export async function listBackgrounds() {
    const response = await fetch('/api/backgrounds/all', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({}) });
    if (!response.ok) throw new Error(`SillyTavern could not list the backgrounds (HTTP ${response.status}).`);
    const data = await response.json();
    // Each entry is { filename, isAnimated } in current versions, a bare name in older ones.
    return (Array.isArray(data?.images) ? data.images : []).map(i => String(typeof i === 'string' ? i : i?.filename || '')).filter(Boolean);
}

/** The CSS value SillyTavern uses for a background file. */
export const backgroundCss = (file) => `url("backgrounds/${encodeURIComponent(file)}")`;

/** Why the table should leave this chat's background alone right now, or '' when it may change it. */
function standAside(meta) {
    if (meta?.vistalyze_managed) return 'Vistalyze is managing this chat\'s background.';
    const lock = meta?.custom_background;
    if (lock && lock !== meta?.[OURS_KEY]) return 'This chat has a background you locked yourself.';
    return '';
}

/**
 * Puts a background file on the chat and remembers it for next time.
 * @returns {boolean} whether it was applied
 */
export function applyBackgroundFile(file) {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !file) return false;
    const css = backgroundCss(file);
    if (meta.custom_background === css) return false;
    meta.custom_background = css;
    meta[OURS_KEY] = css;
    context.saveMetadataDebounced?.();
    const bg = document.getElementById('bg1');
    if (bg) bg.style.backgroundImage = css;
    return true;
}

let lastPlace = null;

/**
 * Looks at the tracker's Location and, when it has a place in the table, switches the background to it.
 * @param {{ force?: boolean }} [options] force: apply even if the place has not changed (the Apply now button)
 * @returns {{ place: string, entry: object|null, applied: boolean, why: string }}
 */
export function syncLocationBackground({ force = false } = {}) {
    const settings = locationSettings();
    const place = currentPlace();
    const result = { place, entry: null, applied: false, why: '' };
    if (!settings.enabled && !force) { result.why = 'Location backgrounds are off.'; return result; }
    if (!place) { result.why = 'The tracker has no Location.'; return result; }
    if (!force && place === lastPlace) return result;
    lastPlace = place;
    const entry = matchLocation(settings.entries, place);
    result.entry = entry;
    if (!entry || !entry.file) { result.why = entry ? 'That place has no background chosen.' : `No entry for "${place}".`; return result; }
    const meta = getContext()?.chatMetadata;
    const aside = standAside(meta);
    if (aside) { result.why = aside; return result; }
    result.applied = applyBackgroundFile(entry.file);
    if (result.applied) debugLog(`Background for "${place}": ${entry.file}`);
    return result;
}

/** Whether Vistalyze is installed and switched on, so the settings screen can say the two should not both run. */
export function vistalyzeActive() {
    try { return Boolean(extension_settings.vistalyze?.enabled); } catch { return false; }
}

export function initLocationBackgrounds() {
    // The tracker says the story has moved on.
    eventSource.on('sillynpc-status-updated', () => {
        try { syncLocationBackground(); } catch (err) { console.warn(LOG_PREFIX, 'Location background failed', err); }
    });
    // A chat was opened: SillyTavern puts its own background on first, so this waits a moment.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        lastPlace = null;
        setTimeout(() => { try { syncLocationBackground(); } catch (err) { console.warn(LOG_PREFIX, 'Location background failed', err); } }, 700);
    });
}
