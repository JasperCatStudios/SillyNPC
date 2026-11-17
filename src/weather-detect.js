import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { saveChatDebounced } from '../../../../../script.js';
import { getSettings } from './settings.js';
import { LOG_PREFIX, PRODUCT_NAME } from './constants.js';
import { sceneSettings, rematchScene } from './scene-state.js';
import { requestOnConnection } from './connections.js';
import {
    WEATHER_EXTRA_KEY, DEFAULT_WEATHER_SYSTEM, buildWeatherRequest, parseWeatherReply, shouldAskWeather, hashText,
    storedWeather, internalStatesOf, parseWeatherFromReport, latestWeatherAnswer,
} from './weather-detect-core.js';

/**
 * Weather detection, SillyTavern side (fork, Scene module). Two sources besides the scene header:
 *
 *   internal - the newest message's Internal States report (kept outside the text by the "after" mode, or written in the
 *              text by the preset) has a Weather line. Nothing is asked: this only waits for the report to appear and then
 *              has the scene read again. (In "after" mode the report's instructions also ask for the line; that is
 *              src/internal-states.js.)
 *   model    - after each new character reply, one small request on the Weather connection asks for the weather. The
 *              answer is kept on the message (message.extra.worldkit_weather, per swipe), so a swipe, a reload or a redraw
 *              never asks twice for the same text.
 *
 * Off unless the Scene module, the Weather switch and one of these sources are on: then no listener is attached.
 * Errors are logged with console.warn and shown as a status line; at most one toast per session.
 */

const SPEAK = 'Weather detection';
let attached = false;
let status = '';
let lastAt = 0;
let toasted = false;
let pollToken = 0;
const inFlight = new Set();
const statusListeners = new Set();

function warn(what, err) {
    try { console.warn(LOG_PREFIX, `${SPEAK}: ${what}`, err ?? ''); } catch { /* no console */ }
}

function setStatus(text) {
    status = text;
    for (const fn of [...statusListeners]) {
        try { fn(); } catch (err) { warn('status listener failed', err); }
    }
}

/** The inline status for the Weather section ('' when there is nothing to say). */
export function weatherDetectStatus() {
    return status;
}

/** Called when the status changes. Returns an unsubscribe. */
export function onWeatherDetectStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

function fail(message, err) {
    warn(message, err);
    setStatus(`Failed: ${message}`);
    if (!toasted) {
        toasted = true;
        try { toastr.warning(`Weather detection: ${message}`, PRODUCT_NAME); } catch { /* no toastr */ }
    }
}

/** The source in use, or '' when detection should be off. */
function activeSource() {
    try {
        const s = sceneSettings();
        if (!s.enabled || !s.weather.enabled) return '';
        return s.weather.source === 'internal' || s.weather.source === 'model' ? s.weather.source : '';
    } catch {
        return '';
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits until a running generation has finished (the stop button is shown for exactly that long). */
async function waitUntilIdle() {
    await sleep(600);
    for (let i = 0; i < 180; i++) {
        const stop = document.getElementById('mes_stop');
        if (!stop || getComputedStyle(stop).display === 'none') return;
        await sleep(500);
    }
}

function remember(message, record) {
    message.extra = message.extra || {};
    message.extra[WEATHER_EXTRA_KEY] = message.extra[WEATHER_EXTRA_KEY] || {};
    message.extra[WEATHER_EXTRA_KEY][String(message.swipe_id ?? 0)] = record;
    try { saveChatDebounced(); } catch { /* not saved this time */ }
}

/** The weather before a message, for the request: the scene's, so the model can say "unchanged". */
function previousWeatherText(chat, messageId) {
    const before = chat.slice(0, messageId);
    const hit = latestWeatherAnswer(before, 'model');
    return hit?.answer?.text || '';
}

/**
 * Asks the model about one message (model source). Skips what the rules say to skip unless forced.
 * @param {number} messageId
 * @param {{ force?: boolean }} [options]
 */
export async function askWeather(messageId, { force = false } = {}) {
    if (activeSource() !== 'model') return;
    const context = getContext();
    const chat = context.chat;
    const message = chat?.[messageId];
    if (!message) return;
    const text = String(message.mes ?? '');
    const record = storedWeather(message);
    const verdict = shouldAskWeather({
        now: Date.now(), lastAt: force ? 0 : lastAt, text,
        answeredHash: force ? '' : (record?.hash || ''),
        isUser: !!message.is_user, isSystem: !!message.is_system,
    });
    if (!verdict.ask) return;
    const key = `${context.chatId}:${messageId}:${message.swipe_id ?? 0}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    lastAt = Date.now();
    setStatus('Asking the model about the weather...');
    try {
        await waitUntilIdle();
        if (activeSource() !== 'model') return;
        const depth = Math.max(0, Number(getSettings().internalStatesContextMessages ?? 2));
        const recent = chat.slice(Math.max(0, messageId - depth), messageId).map(m => `${m.name}: ${String(m.mes ?? '')}`);
        const { system, user } = buildWeatherRequest({
            recent, latest: text, previousWeather: previousWeatherText(chat, messageId),
            system: String(getSettings().weatherPrompt || '').trim() || DEFAULT_WEATHER_SYSTEM,
        });
        const raw = await requestOnConnection('weatherProfileId', system, user, 300);
        const answer = parseWeatherReply(raw);
        if (!answer) {
            console.warn(LOG_PREFIX, `${SPEAK}: unreadable reply:`, String(raw ?? '').slice(0, 400));
            fail(String(raw ?? '').trim() ? 'the model\'s answer could not be read as a weather' : 'the model returned nothing');
            return;
        }
        // The text changed while the model was thinking (an edit, a new swipe): do not keep an answer for the old one.
        if (chat[messageId] !== message || hashText(message.mes) !== hashText(text)) return;
        remember(message, { ...answer, hash: hashText(text), at: Date.now() });
        setStatus(answer.unchanged ? 'The model says the weather has not changed.'
            : `The model says: ${answer.text || 'no weather'}${answer.intensity ? ` (${answer.intensity})` : ''}.`);
        rematchScene();
    } catch (err) {
        fail(`the request failed (${err?.message || err})`, err);
    } finally {
        inFlight.delete(key);
    }
}

/** Asks again for the newest message now, ignoring the throttle and any remembered answer. */
export function askWeatherNow() {
    const chat = getContext().chat || [];
    let i = chat.length - 1;
    while (i >= 0 && (chat[i]?.is_user || chat[i]?.is_system)) i--;
    if (i < 0) { setStatus('There is no character message to read yet.'); return Promise.resolve(); }
    return askWeather(i, { force: true });
}

/**
 * Internal source: the report of a message may arrive a moment after the reply (a separate request), so look now and
 * then for a little while and have the scene read again when it shows up.
 */
async function watchReport(messageId) {
    const token = ++pollToken;
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    const chatId = context.chatId;
    const swipe = message.swipe_id ?? 0;
    const mode = getSettings().internalStatesMode;
    const tries = mode === 'inline' || mode === 'off' ? 1 : 60;
    for (let i = 0; i < tries; i++) {
        if (token !== pollToken || activeSource() !== 'internal') return;
        const now = getContext();
        if (now.chatId !== chatId || now.chat?.[messageId] !== message || (message.swipe_id ?? 0) !== swipe) return;
        const words = parseWeatherFromReport(internalStatesOf(message));
        if (words) {
            setStatus(`The Internal States report says: ${words}.`);
            rematchScene();
            return;
        }
        if (i === 0) setStatus('Waiting for the Internal States report to give a weather...');
        await sleep(2000);
    }
    if (token === pollToken) setStatus('The newest Internal States report has no Weather line' + (mode === 'inline' ? ' (the preset writes it inline; ask it for a Weather line, or use "a model").' : '.'));
}

const onMessage = (messageId) => {
    try {
        const source = activeSource();
        const id = Number(messageId);
        if (!Number.isInteger(id)) return;
        if (source === 'model') askWeather(id).catch(err => warn('request failed', err));
        else if (source === 'internal') watchReport(id).catch(err => warn('report watch failed', err));
    } catch (err) {
        warn('could not handle a message', err);
    }
};

const onChatChanged = () => {
    pollToken++;
    lastAt = 0;
    setStatus('');
};

const HANDLERS = [
    [event_types.CHARACTER_MESSAGE_RENDERED, onMessage],
    [event_types.MESSAGE_SWIPED, onMessage],
    [event_types.CHAT_CHANGED, onChatChanged],
];

function attach() {
    if (attached) return;
    for (const [name, fn] of HANDLERS) if (name) eventSource.on(name, fn);
    attached = true;
}

function detach() {
    pollToken++;
    if (!attached) return;
    for (const [name, fn] of HANDLERS) if (name) eventSource.removeListener(name, fn);
    attached = false;
}

/**
 * Starts or stops detection to match the switches. Call after the source, the Weather switch or the Scene switch
 * changes; safe at any time and as often as wanted. Off means no listener.
 */
export function syncWeatherDetect() {
    try {
        if (activeSource()) attach();
        else { detach(); if (status) setStatus(''); }
    } catch (err) {
        warn('could not start or stop', err);
    }
}
