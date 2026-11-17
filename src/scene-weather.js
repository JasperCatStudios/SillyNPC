import { eventSource, event_types } from '../../../../events.js';
import { LOG_PREFIX } from './constants.js';
import { createWeatherFx } from './weather-fx-canvas.js';
import { sceneSettings, getScene, SCENE_CHANGED_EVENT } from './scene-state.js';
import { disabledEffects, sceneToWeatherDesc, describeShowing, isEffectEnabled, shownKind } from './weather-settings.js';
import { weatherEffect } from './weather-fx-core.js';

/**
 * Weather effects, SillyTavern side (fork, Scene module): draws the scene's weather with the canvas engine
 * (src/weather-fx-canvas.js) while both the Scene module and its Weather switch are on.
 *
 * On: one engine, one listener for SCENE_CHANGED_EVENT and one for CHAT_CHANGED. Off (either switch): the engine is
 * destroyed (its canvas, loop, timers and listeners go with it) and both listeners are removed. Nothing here throws
 * into SillyTavern; a failure is logged with console.warn.
 *
 * A future sound module hears thunder with onWeatherThunder(cb), which works whether or not the engine exists yet.
 */

let fx = null;
let attached = false;
let offThunder = null;
const thunderListeners = new Set();
const statusListeners = new Set();

function warn(what, err) {
    try { console.warn(LOG_PREFIX, `Weather: ${what}`, err); } catch { /* no console */ }
}

function notify() {
    for (const fn of [...statusListeners]) {
        try { fn(); } catch (err) { warn('status listener failed', err); }
    }
}

function forwardThunder(payload) {
    for (const cb of [...thunderListeners]) {
        try { cb(payload); } catch (err) { warn('thunder listener failed', err); }
    }
}

/** The engine's description of a scene (see sceneToWeatherDesc). */
export function descForScene(scene, locations) {
    return sceneToWeatherDesc(scene, locations);
}

// A manual preview from the Weather section: forced on the engine until stopped. Never saved.
let preview = null;

/** Push the current scene (or the preview, while there is one) into the engine. */
function pushScene() {
    if (!fx) return;
    try {
        const s = sceneSettings();
        fx.setWeather(preview ? { ...preview } : descForScene(getScene(), s.locations));
    } catch (err) {
        warn('could not read the scene', err);
    }
    notify();
}

/**
 * Forces a weather on the engine now, even when the scene has none, until stopPreview().
 * @param {{ kind: string, intensity?: string, timeOfDay?: string, windSpeed?: string, windDirection?: string, word?: string }} desc
 * @returns {{ ok: boolean, reason: string }}
 */
export function previewWeather(desc) {
    if (!weatherActive()) {
        const s = sceneSettings();
        return { ok: false, reason: !s.enabled ? 'The Scene module is off, so nothing can be drawn.' : 'The "Show weather effects" switch is off, so nothing can be drawn.' };
    }
    if (!fx) syncSceneWeather();
    if (!fx) return { ok: false, reason: 'The weather engine could not start.' };
    preview = {
        kind: desc?.kind || 'none',
        intensity: desc?.intensity || 'moderate',
        timeOfDay: desc?.timeOfDay || 'day',
        indoor: false,
        ...(desc?.word ? { word: desc.word } : {}),
        ...(desc?.windSpeed ? { windSpeed: desc.windSpeed } : {}),
        ...(desc?.windDirection ? { windDirection: desc.windDirection } : {}),
    };
    pushScene();
    return { ok: true, reason: '' };
}

/** Gives the engine back to the scene. */
export function stopPreview() {
    if (!preview) return;
    preview = null;
    pushScene();
}

export function isPreviewing() {
    return !!preview;
}

/**
 * What the owner needs to see why nothing is drawn: the weather text the scene has, what it became, and what is drawn.
 * @returns {string[]} lines
 */
export function weatherDiagnostics() {
    try {
        const s = sceneSettings();
        const w = s.weather;
        const lines = [];
        if (preview) lines.push(`Previewing ${preview.kind}${preview.intensity ? ` (${preview.intensity})` : ''}, not the scene. Press "Stop previewing" to go back.`);
        const scene = getScene();
        if (!s.enabled) { lines.push('The Scene module is off, so there is no scene weather.'); return lines; }
        if (!scene || !scene.weatherText) {
            lines.push('Scene weather text: none (the weather comes from the header the story model writes, and it has no weather in it).');
        } else {
            lines.push(`Scene weather text: "${scene.weatherText}" (from the header the story model writes).`);
            lines.push(`Read as: ${scene.weatherKind || 'none'}${scene.weatherIntensity ? `, ${scene.weatherIntensity}` : ''}${scene.windSpeed ? `, wind ${scene.windSpeed}` : ''}.`);
        }
        const kind = scene?.weatherKind || 'none';
        if (!w.enabled) { lines.push('Drawn: nothing, because "Show weather effects" is off.'); return lines; }
        if (kind !== 'none' && !isEffectEnabled(w, kind)) {
            const shown = shownKind(w, kind);
            lines.push(`${weatherEffect(kind)?.label || kind} is switched off in the list below, so ${shown === 'none' ? 'nothing is drawn' : `${weatherEffect(shown)?.label || shown} is drawn instead`}.`);
        }
        const state = fx ? fx.getState() : null;
        if (!state) lines.push('Drawn: nothing (the weather engine is not running).');
        else if (!state.kind || state.kind === 'none') lines.push(`Drawn: nothing${kind === 'none' && !preview ? ' (the scene has no weather to draw)' : ''}.`);
        else lines.push(`Drawn: ${weatherEffect(state.kind)?.label || state.kind}${state.timeOfDay ? `, ${state.timeOfDay}` : ''}${state.indoor ? ', indoors' : ''}${state.from ? ` (instead of ${weatherEffect(state.from)?.label || state.from})` : ''}.`);
        return lines;
    } catch {
        return [];
    }
}

/** Push the settings (density, low power, switched-off weathers, caps) into the engine. */
function pushSettings() {
    if (!fx) return;
    try {
        const w = sceneSettings().weather;
        fx.setAutoLowPower(w.autoLowPower);
        fx.setLowPower(w.lowPower);
        fx.setDisabledEffects(disabledEffects(w));
        fx.setDensityCaps(w.caps);
        fx.setDensity(w.density);
    } catch (err) {
        warn('could not apply the settings', err);
    }
    notify();
}

const onSceneChanged = () => pushScene();
// The scene module re-reads a new chat a moment later and announces it; this clears the old chat's weather now.
const onChatChanged = () => pushScene();

// With no scene header the time is the device clock, which moves without an event: look again every few minutes.
let clockTimer = 0;
const onClock = () => {
    try { if (getScene()?.source === 'device') pushScene(); } catch (err) { warn('clock check failed', err); }
};

function attach() {
    if (attached) return;
    eventSource.on(SCENE_CHANGED_EVENT, onSceneChanged);
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    clockTimer = setInterval(onClock, 5 * 60 * 1000);
    attached = true;
}

function detach() {
    clearInterval(clockTimer);
    clockTimer = 0;
    if (!attached) return;
    try {
        eventSource.removeListener(SCENE_CHANGED_EVENT, onSceneChanged);
        if (event_types.CHAT_CHANGED) eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
    } catch (err) {
        warn('could not remove a listener', err);
    }
    attached = false;
}

function stop() {
    preview = null;
    detach();
    try { offThunder?.(); } catch { /* gone */ }
    offThunder = null;
    if (fx) {
        try { fx.destroy(); } catch (err) { warn('could not stop the engine', err); }
    }
    fx = null;
}

/** Whether weather effects should run now: the Scene module and the Weather switch both on. */
export function weatherActive() {
    try {
        const s = sceneSettings();
        return !!(s.enabled && s.weather.enabled);
    } catch {
        return false;
    }
}

/**
 * Starts or stops everything to match the switches, and applies the settings. Call after any weather setting or
 * either switch changes. Safe to call at any time and as often as wanted.
 */
export function syncSceneWeather() {
    try {
        if (!weatherActive()) {
            stop();
            notify();
            return;
        }
        if (!fx) {
            fx = createWeatherFx();
            offThunder = fx.onThunder(forwardThunder);
            pushSettings();
            fx.setEnabled(true);
            attach();
            pushScene();
            return;
        }
        pushSettings();
    } catch (err) {
        warn('could not start or stop', err);
        stop();
        notify();
    }
}

/** At load: starts only when both switches are on; otherwise nothing is attached. */
export function initSceneWeather() {
    syncSceneWeather();
}

/** The one-line status: 'Showing: heavy rain, night', or 'Off'. */
export function weatherStatusText() {
    try {
        const s = sceneSettings();
        return describeShowing(fx ? fx.getState() : null, { sceneOn: s.enabled, weatherOn: s.weather.enabled });
    } catch {
        return 'Off';
    }
}

/** Called whenever what is shown may have changed. Returns an unsubscribe. */
export function onWeatherStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

/**
 * For the sound module: called on every lightning strike while weather effects run, with the engine's thunder
 * payload ({ type:'thunder', flashAt, thunderAt, thunderDelayMs, distanceKm, strength, flashes, indoor, flash }).
 * Returns an unsubscribe.
 */
export function onWeatherThunder(cb) {
    if (typeof cb !== 'function') return () => {};
    thunderListeners.add(cb);
    return () => thunderListeners.delete(cb);
}
