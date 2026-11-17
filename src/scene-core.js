import { matchPlace, pathLabel } from './scene-locations.js';

/**
 * The Scene module's rules that need no SillyTavern (fork): what changed between two scenes, which place a scene is
 * in, whether the background may be switched, and the key that tells a real change from a redraw.
 * scene-state.js is the SillyTavern side. Tested in tests/scene-core.test.mjs.
 */

/** Where this chat's scene notes live in chat metadata: { lastPlace }. */
export const SCENE_META_KEY = 'worldkit_scene';
/** The background this module put on the chat, so it can tell its own lock from yours. */
export const BG_MARK_KEY = 'worldkit_scene_bg';
/** Emitted on SillyTavern's eventSource with { before, after, changed } when the scene changes. */
export const SCENE_CHANGED_EVENT = 'worldkit-scene-changed';

/** The CSS value SillyTavern itself uses for a file in its backgrounds folder. */
export const backgroundCss = (file) => `url("backgrounds/${encodeURIComponent(file)}")`;

/**
 * Why the module should leave this chat's background alone, or '' when it may switch it: a background you locked
 * yourself (custom_background set, and not to the one this module put there) is yours.
 * @param {object|null|undefined} meta chat metadata
 */
export function standAside(meta) {
    const lock = meta?.custom_background;
    if (lock && lock !== meta?.[BG_MARK_KEY]) return 'This chat has a background you locked yourself, so it is left alone.';
    return '';
}

/**
 * Which place of the map a scene is in.
 * A tie keeps the previous place (nothing flickers) and lists the places that tied.
 * @param {object[]} list the location map
 * @param {{ place: string }} scene
 * @param {{ id: string }|null} previous the place before, in the same chat
 * @param {{ world?: string }} [options]
 * @returns {{ location: { id: string, name: string, path: string }|null, match: 'empty'|'none'|'match'|'tie', ties: string[] }}
 */
export function resolveLocation(list, scene, previous, { world = '' } = {}) {
    if (!scene?.place) return { location: null, match: 'empty', ties: [] };
    const r = matchPlace(list, scene.place, { world });
    if (r.kind === 'match') {
        return { location: { id: r.entry.id, name: r.entry.name, path: pathLabel(list, r.entry) }, match: 'match', ties: [] };
    }
    if (r.kind === 'tie') {
        const still = previous && list.find(e => e.id === previous.id);
        return {
            location: still ? { id: still.id, name: still.name, path: pathLabel(list, still) } : null,
            match: 'tie',
            ties: r.ties.map(e => pathLabel(list, e)),
        };
    }
    return { location: null, match: r.kind === 'empty' ? 'empty' : 'none', ties: [] };
}

/**
 * What changed between two scenes: 'place', 'weather', 'time'. Another chat (or no scene before) is all three.
 * The device clock ticking is not a change; a header's time is.
 */
export function sceneChanges(before, after) {
    if (!after) return before ? ['place', 'weather', 'time'] : [];
    if (!before || before.chatId !== after.chatId) return ['place', 'weather', 'time'];
    const out = [];
    if ((before.location?.id || '') !== (after.location?.id || '') || before.place !== after.place) out.push('place');
    if (before.weatherKind !== after.weatherKind || before.weatherIntensity !== after.weatherIntensity
        || before.weatherText !== after.weatherText) out.push('weather');
    if (before.source !== after.source
        || (after.source === 'header' && (before.timeText !== after.timeText || before.dateText !== after.dateText))) out.push('time');
    return out;
}

/**
 * A key for "the chat as it stands": the same key means nothing new to read (a redraw), a new one means a reply, a
 * swipe, an edit of the last message or another chat.
 */
export function sceneKey(chatId, chat) {
    if (!chatId || !Array.isArray(chat)) return `none|${chatId || ''}`;
    const last = chat[chat.length - 1];
    const text = String(last?.mes ?? '');
    return `${chatId}|${chat.length}|${last?.swipe_id ?? ''}|${text.length}|${text.slice(-40)}`;
}

/** One line saying where and when the story is, for the status line. */
export function describeScene(scene) {
    if (!scene) return 'No scene yet.';
    const place = scene.location ? scene.location.path : (scene.place || 'unknown');
    const weather = scene.weatherKind && scene.weatherKind !== 'none'
        ? `${scene.weatherKind}${scene.weatherIntensity ? ` (${scene.weatherIntensity})` : ''}`
        : 'unknown';
    const time = [scene.timeText, scene.dateText].filter(Boolean).join(', ') || 'unknown';
    const source = scene.source === 'header'
        ? `scene header${Number.isInteger(scene.messageId) ? ` of message #${scene.messageId}` : ''}`
        : 'device clock (no scene header in this chat)';
    return `Place: ${place} · Weather: ${weather} · Time: ${time} · From: ${source}`;
}
