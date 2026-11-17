import { eventSource, event_types } from '../../../../events.js';
import { LOG_PREFIX } from './constants.js';
import { createWeatherFx } from './weather-fx-canvas.js';
import { sceneSettings, getScene, SCENE_CHANGED_EVENT } from './scene-state.js';
import { disabledEffects, sceneToWeatherDesc, describeShowing } from './weather-settings.js';

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

/** Push the current scene into the engine. */
function pushScene() {
    if (!fx) return;
    try {
        const s = sceneSettings();
        fx.setWeather(sceneToWeatherDesc(getScene(), s.locations));
    } catch (err) {
        warn('could not read the scene', err);
    }
    notify();
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
