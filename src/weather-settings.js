/**
 * Weather effects settings (fork, Scene module): the shape of settings.scene.weather, its repair, which weathers are
 * switched on, and what a finished performance test changes. Pure, so node can test it
 * (tests/weather-settings.test.mjs); the SillyTavern side is src/scene-weather.js, the pane src/ui-scene-weather.js.
 *
 *   scene.weather = {
 *       enabled: false,              // the master switch; off means no engine, no listener, no canvas
 *       density: 60,                 // 0-100 (40 on touch devices)
 *       lowPower: false,             // manual low-power mode
 *       autoLowPower: true,          // battery saver / data saver turn low power on by themselves
 *       disabled: { rain: true },    // per weather: true off, false on; missing = the default (heavy ones off)
 *       caps: { snow: 60 },          // per weather: the highest density it is drawn at
 *       lastTest: { at, device, stoppedBecause, results: [{ kind, density, summary }] } | null,
 *   }
 */

import { WEATHER_EFFECTS, weatherEffect, effectFallback, refineWord, timeOfDayFromHour } from './weather-fx-core.js';
import { bestDensities, verdictFor, baselineFpsOf } from './weather-perf-core.js';

export const WEATHER_DEFAULTS = Object.freeze({ density: 60, touchDensity: 40, lowPower: false, autoLowPower: true });
export const MAX_SAVED_RESULTS = 200;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether this looks like a touch device (phone or tablet). */
export function isTouchDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
    return Number(nav?.maxTouchPoints) > 0;
}

function cleanSummary(s) {
    const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);
    const o = isObj(s) ? s : {};
    return { frames: n(o.frames), avgFps: n(o.avgFps), lowFps: n(o.lowFps), worstMs: n(o.worstMs), slowShare: n(o.slowShare) };
}

/** A performance test result made safe to keep in settings: known fields only, at most MAX_SAVED_RESULTS steps. */
export function trimTestResult(raw) {
    if (!isObj(raw) || !Array.isArray(raw.results)) return null;
    const results = raw.results
        .filter(r => isObj(r) && typeof r.kind === 'string' && r.kind)
        .slice(0, MAX_SAVED_RESULTS)
        .map(r => ({
            kind: r.kind.slice(0, 40),
            density: clamp(Math.round(Number(r.density) || 0), 0, 100),
            summary: cleanSummary(r.summary),
            ...(r.partial ? { partial: true } : {}),
        }));
    return {
        at: Number(raw.at) || 0,
        device: String(raw.device || '').slice(0, 200),
        stoppedBecause: String(raw.stoppedBecause || '').slice(0, 200),
        results,
    };
}

/**
 * Repairs settings.scene.weather IN PLACE (a pane holding the object keeps editing the saved one) and returns it.
 * @param {object} raw
 * @param {{ touch?: boolean }} [env] touch: the defaults for a phone (lower density)
 */
export function repairWeatherSettings(raw, { touch = false } = {}) {
    const s = isObj(raw) ? raw : {};
    s.enabled = s.enabled === true;
    const dflt = touch ? WEATHER_DEFAULTS.touchDensity : WEATHER_DEFAULTS.density;
    s.density = Number.isFinite(Number(s.density)) && s.density !== null && s.density !== ''
        ? clamp(Math.round(Number(s.density)), 0, 100) : dflt;
    s.lowPower = s.lowPower === true;
    s.autoLowPower = s.autoLowPower === undefined ? WEATHER_DEFAULTS.autoLowPower : s.autoLowPower !== false;
    if (!isObj(s.disabled)) s.disabled = {};
    for (const k of Object.keys(s.disabled)) if (typeof s.disabled[k] !== 'boolean') delete s.disabled[k];
    if (!isObj(s.caps)) s.caps = {};
    for (const k of Object.keys(s.caps)) {
        const n = Number(s.caps[k]);
        if (!Number.isFinite(n) || n <= 0) delete s.caps[k];
        else s.caps[k] = clamp(Math.round(n), 5, 100);
    }
    s.lastTest = trimTestResult(s.lastTest);
    // An old saved "source" (header / internal / model) is no longer used: the weather always comes from the scene header.
    delete s.source;
    return s;
}

/** A fresh repaired copy (for tests and reading without touching). */
export function normalizeWeatherSettings(raw, env) {
    return repairWeatherSettings(isObj(raw) ? JSON.parse(JSON.stringify(raw)) : {}, env);
}

/** Whether one weather is switched on: the owner's choice, else on unless it is heavy. */
export function isEffectEnabled(settings, id) {
    const v = settings?.disabled?.[id];
    if (typeof v === 'boolean') return !v;
    return weatherEffect(id)?.cost !== 'heavy';
}

/** The weathers that are on, from a list of effects (default: every one the engine draws). */
export function enabledEffects(settings, effects = WEATHER_EFFECTS) {
    return effects.map(e => (typeof e === 'string' ? e : e.id)).filter(id => isEffectEnabled(settings, id));
}

/** The weathers that are off. */
export function disabledEffects(settings, effects = WEATHER_EFFECTS) {
    return effects.map(e => (typeof e === 'string' ? e : e.id)).filter(id => !isEffectEnabled(settings, id));
}

/** Switch one weather on or off. */
export function setEffectEnabled(settings, id, on) {
    if (!isObj(settings.disabled)) settings.disabled = {};
    settings.disabled[id] = !on;
}

/** The weather drawn for `kind` with these settings (its nearest switched-on fallback). */
export function shownKind(settings, kind) {
    return effectFallback(kind, disabledEffects(settings));
}

/**
 * What a finished performance test changes, applied IN PLACE:
 * - a weather whose every measured step was poor is switched off (its cap is cleared);
 * - a weather that was smooth at 100% loses any cap;
 * - otherwise the cap is the highest density that was smooth ('good'); with no smooth step it is the highest that
 *   was not poor (bestDensities) when that is under 100, else the lightest step tried.
 * Weathers the test did not reach are left as they are.
 * @returns {{ disabled: string[], capped: Record<string, number>, cleared: string[] }}
 */
export function applyPerfResults(settings, results) {
    const out = { disabled: [], capped: {}, cleared: [] };
    if (!isObj(settings.disabled)) settings.disabled = {};
    if (!isObj(settings.caps)) settings.caps = {};
    const base = baselineFpsOf(results);   // judged against the baseline step when the run has one
    const list = (Array.isArray(results) ? results : []).filter(r => r && r.kind && r.kind !== 'baseline' && r.summary?.frames > 0);
    const best = bestDensities(Array.isArray(results) ? results.filter(r => r && r.kind && r.summary?.frames > 0) : []);
    const kinds = [...new Set(list.map(r => r.kind))];
    for (const kind of kinds) {
        const steps = list.filter(r => r.kind === kind).sort((a, b) => a.density - b.density);
        const verdicts = steps.map(r => verdictFor(r.summary, base));
        if (verdicts.every(v => v === 'poor')) {
            settings.disabled[kind] = true;
            delete settings.caps[kind];
            out.disabled.push(kind);
            continue;
        }
        const full = steps.find(r => r.density >= 100);
        if (full && verdictFor(full.summary, base) === 'good') {
            if (kind in settings.caps) { delete settings.caps[kind]; out.cleared.push(kind); }
            continue;
        }
        const good = steps.filter(r => verdictFor(r.summary, base) === 'good').map(r => r.density);
        let cap = good.length ? Math.max(...good) : (best[kind] < 100 ? best[kind] : steps[0].density);
        cap = clamp(Math.round(cap), 5, 100);
        if (cap >= 100) continue;
        settings.caps[kind] = cap;
        out.capped[kind] = cap;
    }
    return out;
}

/** "Disabled 2 and capped 3" style summary of applyPerfResults, for the inline status. */
export function describePerfChanges(changes) {
    const label = (id) => weatherEffect(id)?.label || id;
    const parts = [];
    if (changes.disabled.length) parts.push(`switched off ${changes.disabled.map(label).join(', ')}`);
    const capped = Object.entries(changes.capped);
    if (capped.length) parts.push(`capped ${capped.map(([k, v]) => `${label(k)} at ${v}%`).join(', ')}`);
    if (changes.cleared.length) parts.push(`removed the cap on ${changes.cleared.map(label).join(', ')}`);
    return parts.length ? `${parts.join('; ')}.` : 'Nothing to change: every weather the test measured ran well enough.';
}

const INTENSITY_WORD = ['', 'very light', 'light', '', 'heavy', 'severe'];

/**
 * The one-line status: 'Showing: heavy rain, night', with the stand-in named when a weather is switched off,
 * or why nothing is shown.
 * @param {{ enabled:boolean, kind:string, from:string, intensity:number, timeOfDay:string, indoor:boolean, lowPower:boolean }|null} state
 */
export function describeShowing(state, { sceneOn = true, weatherOn = true } = {}) {
    if (!weatherOn) return 'Off';
    if (!sceneOn) return 'Off (the Scene module is off)';
    if (!state || !state.enabled) return 'Off';
    if (!state.kind || state.kind === 'none') return state.from ? `Nothing: ${labelOf(state.from)} is switched off` : 'Showing: nothing (no weather in the scene)';
    const word = INTENSITY_WORD[state.intensity] || '';
    const what = `${word ? `${word} ` : ''}${labelOf(state.kind).toLowerCase()}`;
    const bits = [what];
    if (state.timeOfDay) bits.push(state.timeOfDay);
    if (state.indoor) bits.push('indoors');
    let line = `Showing: ${bits.join(', ')}`;
    if (state.from) line += ` (instead of ${labelOf(state.from).toLowerCase()}, which is off)`;
    if (state.lowPower) line += ' · low power';
    return line;
}

function labelOf(id) {
    return weatherEffect(id)?.label || id;
}

/**
 * The engine's weather description from a getScene() scene (null: draw nothing). The time of day comes from the
 * scene's hour; wind, season and moon phase only when the scene has them; indoor from indoorFor.
 */
export function sceneToWeatherDesc(scene, locations) {
    if (!scene) return null;
    const hour = Number.isFinite(scene.hour) ? scene.hour + (Number.isFinite(scene.minute) ? scene.minute / 60 : 0) : undefined;
    const desc = {
        kind: scene.weatherKind || 'none',
        word: refineWord(scene.weatherText),
        intensity: scene.weatherIntensity || undefined,
        timeOfDay: hour !== undefined ? timeOfDayFromHour(hour) : (scene.timeOfDay || undefined),
        hour,
        indoor: indoorFor(locations, scene.location?.id, scene.weatherText),
    };
    for (const key of ['windSpeed', 'windDirection', 'season', 'moonPhase']) {
        if (scene[key] !== undefined && scene[key] !== null && scene[key] !== '') desc[key] = scene[key];
    }
    return desc;
}

/** Whether the scene's place is indoors: the matched place's (or its nearest parent's) indoor flag, else the weather text. */
export function indoorFor(locations, locationId, weatherText = '') {
    const list = Array.isArray(locations) ? locations : [];
    const byId = new Map(list.map(e => [e?.id, e]));
    let entry = byId.get(locationId);
    const seen = new Set();
    while (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        if (typeof entry.indoor === 'boolean') return entry.indoor;
        entry = entry.parentId ? byId.get(entry.parentId) : null;
    }
    return /\b(indoors?|inside)\b/i.test(String(weatherText || ''));
}
