/**
 * Weather FX core (fork, Scene module): the pure planning half of the weather effects engine.
 *
 * It turns a scene weather description into a list of canvas layers (which effect, how many particles, how
 * bright, with which options), plans the cross-fade from one weather to the next, schedules lightning and
 * thunder, and applies the density setting, the low-power cap, the mobile cap and the indoor rule.
 * src/weather-fx-canvas.js draws what this file plans; every decision that can be made without a browser is
 * made here so node can test it (tests/weather-fx-core.test.mjs).
 *
 * The effect set extends the weather and sky effects of Doom's Enhancement Suite
 * (Copyright (C) 2026 Jordan (DangerDaza), AGPL-3.0-or-later; itself a fork of RPG Companion by Marysia),
 * modified for Worldkit. See NOTICE.md.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

import { WEATHER_KINDS, WEATHER_INTENSITIES } from './weather-kind.js';

/* ------------------------------------------------------------------------------------------------ */
/* Effect registry                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Every effect the canvas can draw. The canvas file has a drawer with the same key for each.
 * - base: particles at moderate intensity (3) and density 100.
 * - fixed: the count never scales (a sun, a tint, a lightning flash).
 * - scales: the count follows the weather intensity.
 * - outdoor: hidden when the scene is indoors.
 * - still: may be drawn as a single frozen frame under prefers-reduced-motion.
 * - glow: dimmed when the canvas sits in front of the chat.
 * - expensive: dropped in low-power mode.
 * - z: draw order, low first.
 * - origin: 'des' when ported from Doom's Enhancement Suite, 'worldkit' when new.
 */
export const EFFECTS = Object.freeze({
    skyTint: { base: 1, fixed: true, still: true, glow: true, z: 0, origin: 'des' },
    aurora: { base: 1, fixed: true, outdoor: true, still: true, glow: true, expensive: true, z: 1, origin: 'worldkit' },
    stars: { base: 60, outdoor: true, still: true, glow: true, z: 2, origin: 'des' },
    sun: { base: 1, fixed: true, outdoor: true, still: true, glow: true, z: 3, origin: 'des' },
    moon: { base: 1, fixed: true, outdoor: true, still: true, glow: true, z: 3, origin: 'des' },
    shootingStar: { base: 1, fixed: true, outdoor: true, glow: true, z: 4, origin: 'des' },
    clouds: { base: 6, scales: true, outdoor: true, still: true, z: 5, origin: 'worldkit' },
    lightOrbs: { base: 6, outdoor: true, still: true, glow: true, expensive: true, z: 6, origin: 'des' },
    heatHaze: { base: 1, fixed: true, outdoor: true, expensive: true, z: 7, origin: 'worldkit' },
    fogBank: { base: 6, scales: true, outdoor: true, still: true, z: 8, origin: 'worldkit' },
    mist: { base: 5, scales: true, outdoor: true, still: true, z: 9, origin: 'des' },
    rain: { base: 100, scales: true, outdoor: true, z: 10, origin: 'des' },
    sleet: { base: 80, scales: true, outdoor: true, z: 10, origin: 'worldkit' },
    hail: { base: 60, scales: true, outdoor: true, z: 10, origin: 'worldkit' },
    snow: { base: 50, scales: true, outdoor: true, z: 10, origin: 'des' },
    ash: { base: 60, scales: true, outdoor: true, z: 10, origin: 'worldkit' },
    sand: { base: 160, scales: true, outdoor: true, z: 10, origin: 'worldkit' },
    leaves: { base: 20, scales: true, outdoor: true, z: 11, origin: 'worldkit' },
    petals: { base: 24, scales: true, outdoor: true, z: 11, origin: 'worldkit' },
    wind: { base: 30, scales: true, outdoor: true, z: 12, origin: 'des' },
    embers: { base: 40, scales: true, outdoor: true, glow: true, z: 13, origin: 'worldkit' },
    dustMotes: { base: 25, still: true, glow: true, z: 13, origin: 'des' },
    fireflies: { base: 15, outdoor: true, glow: true, z: 13, origin: 'des' },
    lightning: { base: 1, fixed: true, z: 14, origin: 'des' },
    lensFlare: { base: 1, fixed: true, outdoor: true, still: true, glow: true, expensive: true, z: 15, origin: 'des' },
    windowRain: { base: 40, scales: true, still: true, z: 16, origin: 'worldkit' },
});

export const EFFECT_NAMES = Object.freeze(Object.keys(EFFECTS));

/* ------------------------------------------------------------------------------------------------ */
/* Kinds, intensity, time of day, season                                                             */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The weather kinds this engine draws. The first nine are the kinds of src/weather-kind.js (the scene
 * header detector); the rest are extra kinds the scene module or a manual pick may ask for.
 */
export const FX_KINDS = Object.freeze([
    ...WEATHER_KINDS,
    'drizzle', 'downpour', 'sleet', 'hail', 'fog', 'sandstorm', 'duststorm', 'heat', 'ash', 'embers',
    'aurora', 'leaves', 'petals',
].filter((k, i, all) => all.indexOf(k) === i));

/** Other names for a kind. */
const KIND_ALIASES = {
    sunny: 'clear', fair: 'clear', overcast: 'cloudy', clouds: 'cloudy', thunderstorm: 'storm', thunder: 'storm',
    lightning: 'storm', haze: 'mist', smog: 'mist', foggy: 'fog', snowstorm: 'blizzard', whiteout: 'blizzard',
    hailstorm: 'hail', dust: 'duststorm', 'dust storm': 'duststorm', 'sand storm': 'sandstorm', heatwave: 'heat',
    'heat wave': 'heat', volcanic: 'ash', ashfall: 'ash', wildfire: 'embers', fire: 'embers', 'northern lights': 'aurora',
    'falling leaves': 'leaves', blossom: 'petals', blossoms: 'petals', 'cherry blossoms': 'petals',
};

/**
 * The detector folds some words into a broader kind ("sleet" is snow, "hail" is storm). The word it matched
 * lets the engine draw the finer kind.
 */
const WORD_KINDS = {
    sleet: 'sleet', hail: 'hail', hailstorm: 'hail', fog: 'fog', foggy: 'fog', murk: 'fog',
    drizzle: 'drizzle', drizzling: 'drizzle', mizzle: 'drizzle', sprinkle: 'drizzle', sprinkling: 'drizzle',
    downpour: 'downpour', pouring: 'downpour', deluge: 'downpour', torrential: 'downpour', monsoon: 'downpour',
    whiteout: 'blizzard', hot: 'heat', sweltering: 'heat', scorching: 'heat',
};

/** Intensity words to the 1-5 scale. The three words of src/weather-kind.js are 2, 3 and 4. */
const INTENSITY_WORDS = { faint: 1, 'very light': 1, light: 2, moderate: 3, heavy: 4, severe: 5, extreme: 5, violent: 5 };
for (const word of WEATHER_INTENSITIES) if (!(word in INTENSITY_WORDS)) INTENSITY_WORDS[word] = 3;

/** How much each intensity step multiplies an intensity-scaled particle count (index = intensity). */
export const INTENSITY_FACTOR = Object.freeze([0, 0.35, 0.6, 1, 1.5, 2.1]);

export const TIMES_OF_DAY = Object.freeze(['dawn', 'day', 'dusk', 'night']);
const TIME_ALIASES = {
    sunrise: 'dawn', daybreak: 'dawn', morning: 'day', noon: 'day', midday: 'day', afternoon: 'day', daytime: 'day',
    evening: 'dusk', sunset: 'dusk', twilight: 'dusk', midnight: 'night', nighttime: 'night', 'late night': 'night',
};
/** The hour the sun or moon is drawn at when only a time of day is known. */
const TIME_HOUR = { dawn: 6, day: 12, dusk: 19, night: 0 };

export const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
const SEASON_ALIASES = { fall: 'autumn' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fold = (v) => String(v ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/** A kind name made safe: aliases resolved, the matched word honoured, unknown kinds become 'none'. */
export function normalizeKind(kind, word = '') {
    let k = fold(kind);
    k = KIND_ALIASES[k] || k;
    const w = WORD_KINDS[fold(word)];
    // A finer word only refines a kind it belongs to ("sleet" refines snow, not clear).
    if (w && (k === '' || k === 'none' || FAMILY[w]?.includes(k))) k = w;
    return FX_KINDS.includes(k) ? k : 'none';
}

/** Which broad kinds a finer word may refine. */
const FAMILY = {
    sleet: ['snow', 'rain'], hail: ['storm', 'rain', 'snow'], fog: ['mist'], drizzle: ['rain'], downpour: ['rain'],
    blizzard: ['snow'], heat: ['clear'],
};

/** Intensity as 1-5 from a number or a word; empty gives 3. */
export function normalizeIntensity(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return clamp(Math.round(value), 1, 5);
    const n = Number(value);
    if (String(value ?? '').trim() !== '' && Number.isFinite(n)) return clamp(Math.round(n), 1, 5);
    return INTENSITY_WORDS[fold(value)] || 3;
}

/** Time of day from the hour, using the bands of Doom's Enhancement Suite. */
export function timeOfDayFromHour(hour) {
    const h = ((Number(hour) % 24) + 24) % 24;
    if (h >= 20 || h < 5) return 'night';
    if (h < 7) return 'dawn';
    if (h >= 18) return 'dusk';
    return 'day';
}

/** One of dawn, day, dusk, night; a known hour wins over a missing word. */
export function normalizeTimeOfDay(value, hour) {
    const t = fold(value);
    if (TIMES_OF_DAY.includes(t)) return t;
    if (TIME_ALIASES[t]) return TIME_ALIASES[t];
    if (hour !== undefined && hour !== null && Number.isFinite(Number(hour))) return timeOfDayFromHour(hour);
    return 'day';
}

/** One of the four seasons, or '' when unknown. */
export function normalizeSeason(value) {
    const s = fold(value);
    const k = SEASON_ALIASES[s] || s;
    return SEASONS.includes(k) ? k : '';
}

/** The first word of a weather text that names a finer kind ("Light drizzle" -> "drizzle"), or ''. */
export function refineWord(text) {
    for (const token of fold(text).split(/[^a-z]+/)) if (token && WORD_KINDS[token]) return token;
    return '';
}

/* ------------------------------------------------------------------------------------------------ */
/* The weathers the owner can switch on and off                                                      */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Every weather the engine draws, as the settings list shows it: a label, how hard it is on the device
 * ('light' | 'medium' | 'heavy', from what its layers draw: particle counts, full-screen gradients, glows),
 * and the weather drawn instead when it is switched off. Heavy ones start switched off.
 */
export const WEATHER_EFFECTS = Object.freeze([
    { id: 'clear', label: 'Clear sky (sun, moon, stars)', cost: 'medium', fallback: 'none' },
    { id: 'cloudy', label: 'Clouds', cost: 'light', fallback: 'none' },
    { id: 'drizzle', label: 'Drizzle', cost: 'light', fallback: 'cloudy' },
    { id: 'rain', label: 'Rain', cost: 'medium', fallback: 'drizzle' },
    { id: 'downpour', label: 'Downpour', cost: 'heavy', fallback: 'rain' },
    { id: 'storm', label: 'Thunderstorm', cost: 'medium', fallback: 'rain' },
    { id: 'hail', label: 'Hail', cost: 'medium', fallback: 'rain' },
    { id: 'sleet', label: 'Sleet', cost: 'medium', fallback: 'drizzle' },
    { id: 'snow', label: 'Snow', cost: 'medium', fallback: 'cloudy' },
    { id: 'blizzard', label: 'Blizzard', cost: 'heavy', fallback: 'snow' },
    { id: 'mist', label: 'Mist', cost: 'medium', fallback: 'cloudy' },
    { id: 'fog', label: 'Fog', cost: 'heavy', fallback: 'mist' },
    { id: 'wind', label: 'Wind', cost: 'light', fallback: 'none' },
    { id: 'leaves', label: 'Falling leaves', cost: 'light', fallback: 'wind' },
    { id: 'petals', label: 'Falling petals', cost: 'light', fallback: 'wind' },
    { id: 'duststorm', label: 'Dust storm', cost: 'heavy', fallback: 'wind' },
    { id: 'sandstorm', label: 'Sandstorm', cost: 'heavy', fallback: 'duststorm' },
    { id: 'heat', label: 'Heat haze', cost: 'heavy', fallback: 'clear' },
    { id: 'ash', label: 'Falling ash', cost: 'medium', fallback: 'cloudy' },
    { id: 'embers', label: 'Embers', cost: 'medium', fallback: 'ash' },
    { id: 'aurora', label: 'Aurora', cost: 'heavy', fallback: 'clear' },
].map(Object.freeze));

const EFFECT_BY_ID = new Map(WEATHER_EFFECTS.map(e => [e.id, e]));

/** The registry entry of a weather, or null. */
export function weatherEffect(id) {
    return EFFECT_BY_ID.get(id) || null;
}

/**
 * The weather actually drawn for `kind` when the weathers in `disabled` are switched off: the kind itself, or the
 * nearest one down its fallback chain that is on (storm -> rain -> drizzle -> cloudy -> none). Never loops.
 */
export function effectFallback(kind, disabled) {
    const off = disabled instanceof Set ? disabled : new Set(disabled || []);
    const seen = new Set();
    let k = kind;
    while (k && k !== 'none' && off.has(k) && !seen.has(k)) {
        seen.add(k);
        k = EFFECT_BY_ID.get(k)?.fallback || 'none';
    }
    return k && !seen.has(k) ? k : 'none';
}

/**
 * The owner's choices applied to a weather description: a switched-off kind becomes its fallback (no heavier than
 * moderate, since the fallback stands in for something the device could not draw), and the density is held under
 * the kind's cap. `from` is the kind asked for when a fallback was used, else ''.
 * @returns {{ desc: object|null, kind: string, from: string, density: number }}
 */
export function applyEffectChoices(desc, { density = 100, disabled = [], caps = {} } = {}) {
    const d = Number.isFinite(Number(density)) ? clamp(Number(density), 0, 100) : 100;
    if (!desc || typeof desc !== 'object') return { desc: null, kind: 'none', from: '', density: d };
    const asked = normalizeKind(desc.kind, desc.word);
    const kind = effectFallback(asked, disabled);
    const out = { ...desc, kind, word: '' };
    if (kind !== asked) out.intensity = Math.min(normalizeDesc(desc).intensity, 3);
    const cap = Number(caps?.[kind]);
    return { desc: out, kind, from: kind !== asked ? asked : '', density: Number.isFinite(cap) && cap > 0 ? Math.min(d, cap) : d };
}

/* ------------------------------------------------------------------------------------------------ */
/* Wind                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

const WIND_WORDS = {
    calm: 0, still: 0, none: 0, light: 12, breeze: 15, breezy: 18, gentle: 10, moderate: 30, windy: 35, gusty: 40,
    strong: 50, heavy: 60, gale: 75, storm: 95, hurricane: 120,
};

/** Wind speeds a kind brings when the description gives none (km/h, by intensity 1-5). */
const KIND_WIND = {
    wind: [0, 15, 25, 40, 60, 85], blizzard: [0, 35, 45, 60, 75, 95], storm: [0, 15, 20, 30, 45, 60],
    sandstorm: [0, 35, 45, 60, 75, 95], duststorm: [0, 25, 35, 50, 65, 80], downpour: [0, 8, 10, 15, 20, 25],
    rain: [0, 0, 4, 8, 14, 20], sleet: [0, 8, 12, 18, 24, 30], hail: [0, 8, 12, 18, 24, 30], snow: [0, 0, 3, 6, 10, 15],
    leaves: [0, 8, 12, 18, 25, 35], petals: [0, 6, 10, 14, 20, 28],
};

const COMPASS = ['n', 'nne', 'ne', 'ene', 'e', 'ese', 'se', 'sse', 's', 'ssw', 'sw', 'wsw', 'w', 'wnw', 'nw', 'nnw'];
const COMPASS_WORDS = { north: 'n', northerly: 'n', south: 's', southerly: 's', east: 'e', easterly: 'e', west: 'w', westerly: 'w',
    northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', 'north east': 'ne', 'north west': 'nw',
    'south east': 'se', 'south west': 'sw' };

/** Pixels per second of sideways push at full wind strength (for a 900 px tall screen). */
export const WIND_MAX_PUSH = 520;
/** The fall speed the rain slant is measured against (px/s on a 900 px tall screen). */
export const RAIN_REF_SPEED = 1100;

/**
 * The horizontal direction the wind blows on screen: +1 left to right, -1 right to left.
 * A number or a compass word is the direction the wind comes FROM (a west wind blows to the right).
 * 'left' and 'right' (or 'to the left') name where it blows TO. A pure north or south wind still leans a little.
 */
export function windSide(direction) {
    if (direction === undefined || direction === null || direction === '') return 1;
    const d = fold(direction).replace(/^(from|to) the /, '').replace(/^from /, '');
    if (d === 'right' || d === 'rightward' || d === 'left to right') return 1;
    if (d === 'left' || d === 'leftward' || d === 'right to left') return -1;
    let deg = Number(direction);
    if (!Number.isFinite(deg)) {
        const c = COMPASS_WORDS[d] || d;
        const i = COMPASS.indexOf(c);
        if (i < 0) return 1;
        deg = i * 22.5;
    }
    const toward = ((deg + 180) % 360) * Math.PI / 180;
    const x = Math.sin(toward);
    if (Math.abs(x) < 0.4) return x < 0 ? -0.4 : 0.4;
    return Math.round(x * 1000) / 1000;
}

/** Wind speed in km/h from a number or a word; undefined when nothing usable was given. */
export function windSpeedKmh(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return clamp(value, 0, 200);
    const n = Number(value);
    if (String(value ?? '').trim() !== '' && Number.isFinite(n)) return clamp(n, 0, 200);
    const w = fold(value);
    return w in WIND_WORDS ? WIND_WORDS[w] : undefined;
}

/**
 * The wind of a weather: speed, strength 0-1, side (+1 right, -1 left), sideways push in px/s, the slant of
 * falling rain in degrees from vertical (positive leans right), and how gusty it is (0-1).
 */
export function planWind(kind, intensity, speed, direction) {
    let kmh = windSpeedKmh(speed);
    if (kmh === undefined) kmh = (KIND_WIND[kind] || [])[intensity] || 0;
    const strength = clamp(kmh / 80, 0, 1);
    const side = windSide(direction);
    const push = Math.round(strength * side * WIND_MAX_PUSH);
    const rainAngleDeg = Math.round(clamp(Math.atan2(push, RAIN_REF_SPEED) * 180 / Math.PI, -60, 60) * 10) / 10;
    return { kmh, strength, side, push, rainAngleDeg, gust: Math.round(strength * 0.35 * 100) / 100 };
}

/* ------------------------------------------------------------------------------------------------ */
/* Sky: tint, sun, moon                                                                              */
/* ------------------------------------------------------------------------------------------------ */

/** Sun position as fractions of the screen, on an arc from 05:00 (left, low) to 20:00 (right, low). */
export function sunPosition(hour = 12) {
    const progress = (clamp(Number.isFinite(Number(hour)) ? Number(hour) : 12, 5, 20) - 5) / 15;
    const n = (progress - 0.5) * 2;
    return { x: 0.03 + progress * 0.89, y: 0.08 + 0.32 * n * n };
}

/** Moon position as fractions of the screen, on an arc from 20:00 to 05:00, highest at about 00:30. */
export function moonPosition(hour = 0) {
    let h = Number.isFinite(Number(hour)) ? ((Number(hour) % 24) + 24) % 24 : 0;
    if (h > 5 && h < 20) h = h < 12 ? 5 : 20;
    const progress = h >= 20 ? (h - 20) / 9 : (h + 4) / 9;
    const n = (progress - 0.5) * 2;
    return { x: 0.1 + progress * 0.7, y: 0.08 + 0.25 * n * n };
}

const TIME_TINT = {
    day: null,
    dawn: { top: [255, 170, 130, 0.12], bottom: [255, 120, 150, 0.16] },
    dusk: { top: [150, 80, 150, 0.14], bottom: [255, 110, 70, 0.18] },
    night: { top: [8, 12, 40, 0.34], bottom: [4, 8, 28, 0.42] },
};

/** Kinds that grey the sky, with the grey at intensity 3. */
const OVERCAST = { cloudy: 0.1, rain: 0.14, drizzle: 0.08, downpour: 0.2, storm: 0.24, snow: 0.08, blizzard: 0.18,
    sleet: 0.14, hail: 0.18, fog: 0.12, mist: 0.06 };
const KIND_TINT = {
    sandstorm: [190, 150, 90, 0.22], duststorm: [150, 135, 110, 0.2], ash: [90, 82, 80, 0.24],
    embers: [120, 50, 20, 0.12], heat: [255, 200, 120, 0.07], fog: [200, 205, 215, 0.14],
};

function mix(a, b) {
    if (!a) return b;
    if (!b) return a;
    const alpha = 1 - (1 - a[3]) * (1 - b[3]);
    const wa = a[3] / (a[3] + b[3] || 1);
    return [0, 1, 2].map(i => Math.round(a[i] * wa + b[i] * (1 - wa))).concat(Math.round(alpha * 1000) / 1000);
}

/**
 * The full-screen tint of a scene: time of day first (dawn warm, dusk red, night dark blue), then the weather
 * on top (grey for overcast kinds, brown for sand, grey-brown for ash). Applies to every kind, not only clear
 * skies. Indoors it is half as strong. Null when there is nothing to tint.
 */
export function skyTint(kind, intensity, timeOfDay, indoor = false) {
    if (kind === 'none') return null;
    const time = TIME_TINT[timeOfDay];
    let top = time ? time.top : null;
    let bottom = time ? time.bottom : null;
    const scale = intensity / 3;
    if (OVERCAST[kind]) {
        const night = timeOfDay === 'night';
        const a = OVERCAST[kind] * scale * (night ? 1.4 : 1);
        const grey = night ? [10, 12, 20, a] : [90, 95, 105, a];
        top = mix(top, grey);
        bottom = mix(bottom, grey);
    }
    if (KIND_TINT[kind]) {
        const [r, g, b, a] = KIND_TINT[kind];
        const t = [r, g, b, clamp(a * scale, 0, 0.6)];
        top = mix(top, t);
        bottom = mix(bottom, t);
    }
    if (!top) return null;
    const k = indoor ? 0.5 : 1;
    const out = (c) => [c[0], c[1], c[2], Math.round(clamp(c[3] * k, 0, 0.75) * 1000) / 1000];
    return { top: out(top), bottom: out(bottom) };
}

/* ------------------------------------------------------------------------------------------------ */
/* Layers per kind                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

const WET = ['rain', 'drizzle', 'downpour', 'storm', 'sleet', 'hail'];

/** Rain drawing style from intensity: drizzle (1-2), rain (3), downpour (4-5). */
export function rainStyle(intensity) {
    return intensity <= 2 ? 'drizzle' : intensity >= 4 ? 'downpour' : 'rain';
}

/** The sky layers of clear weather at a time of day (the DES "sunny" plan). */
function clearSky(time, hour, season, add) {
    if (time === 'day') {
        add('sun', { pos: sunPosition(hour), hue: 'day' });
        add('lensFlare', { pos: sunPosition(hour) });
        add('dustMotes', {}, 25);
        add('lightOrbs', {}, 6);
    } else if (time === 'dawn') {
        add('sun', { pos: sunPosition(hour), hue: 'dawn' });
        add('stars', { band: 0.4, maxOpacity: 0.45 }, 15);
        add('dustMotes', {}, 12);
    } else if (time === 'dusk') {
        add('sun', { pos: sunPosition(hour), hue: 'dusk' });
        add('stars', { band: 0.6, maxOpacity: 0.6 }, 20);
        add('dustMotes', {}, 12);
    } else {
        add('moon', { pos: moonPosition(hour) });
        add('stars', { band: 0.6, maxOpacity: 1 }, 68);
        if (season !== 'winter') add('fireflies', {}, season === 'summer' ? 20 : 15);
        add('shootingStar', { everyS: 12 });
    }
}

/** The raw layers of a kind before scaling, as [effect, opts, base?] entries. */
function kindLayers(w) {
    const { kind, intensity: i, timeOfDay: time, hour, season, wind } = w;
    const list = [];
    const add = (effect, opts = {}, base) => list.push({ effect, opts, base });
    const night = time === 'night';
    const thick = Math.round((i / 3) * 100) / 100;
    switch (kind) {
        case 'clear':
            clearSky(time, hour, season, add);
            break;
        case 'cloudy':
            add('clouds', { shade: 0.25 + i * 0.1, thick });
            if (i <= 2) {
                if (night) {
                    add('moon', { pos: moonPosition(hour) });
                    add('stars', { band: 0.6, maxOpacity: 0.5 }, 20);
                } else {
                    add('sun', { pos: sunPosition(hour), hue: time === 'day' ? 'day' : time, veiled: true });
                }
            }
            break;
        case 'rain': case 'drizzle': case 'downpour':
            add('rain', { style: rainStyle(i) });
            add('clouds', { shade: 0.45 + i * 0.08, thick }, 5);
            if (i >= 4) add('mist', { thick }, 4);
            break;
        case 'storm':
            add('rain', { style: i >= 4 ? 'downpour' : 'rain' });
            add('clouds', { shade: 0.75, thick }, 6);
            add('lightning', {});
            if (wind.strength > 0.25) add('wind', {}, 15);
            break;
        case 'snow':
            add('snow', { style: i >= 4 ? 'dense' : 'flakes' });
            if (i >= 3) add('clouds', { shade: 0.2, thick }, 4);
            break;
        case 'blizzard':
            add('snow', { style: 'dense' }, 70);
            add('wind', {});
            add('mist', { thick }, 3);
            break;
        case 'sleet':
            add('sleet', {});
            add('rain', { style: 'drizzle' }, 30);
            add('clouds', { shade: 0.5, thick }, 5);
            break;
        case 'hail':
            add('hail', {});
            add('rain', { style: 'rain' }, 40);
            add('clouds', { shade: 0.65, thick }, 5);
            break;
        case 'mist':
            add('mist', { thick });
            break;
        case 'fog':
            add('fogBank', { thick });
            add('mist', { thick }, 4);
            break;
        case 'wind':
            add('wind', {});
            break;
        case 'sandstorm': case 'duststorm':
            add('sand', { hue: kind === 'sandstorm' ? 'sand' : 'dust' });
            add('wind', {}, 20);
            add('fogBank', { thick, hue: kind === 'sandstorm' ? 'sand' : 'dust' }, 3);
            break;
        case 'heat':
            add('heatHaze', { strength: thick });
            if (time === 'day') add('sun', { pos: sunPosition(hour), hue: 'day' });
            add('dustMotes', {}, 10);
            break;
        case 'ash':
            add('ash', {});
            add('embers', {}, 10);
            break;
        case 'embers':
            add('embers', {});
            add('ash', {}, 15);
            break;
        case 'aurora':
            add('aurora', { strength: night ? 1 : 0.35 });
            add('stars', { band: 0.6, maxOpacity: night ? 1 : 0.3 }, night ? 68 : 15);
            break;
        case 'leaves':
            add('leaves', { season: season || 'autumn' });
            break;
        case 'petals':
            add('petals', {});
            break;
        default:
            break;
    }
    // Seasonal extras on calm, open weather.
    if (['clear', 'cloudy', 'wind', 'mist'].includes(kind)) {
        if (season === 'autumn') add('leaves', { season }, kind === 'wind' ? 20 : 10);
        if (season === 'spring' && kind !== 'mist') add('petals', {}, kind === 'wind' ? 18 : 12);
    }
    // A strong wind shows itself on any weather that does not already draw it.
    if (wind.strength >= 0.5 && kind !== 'none' && !list.some(l => l.effect === 'wind')) add('wind', {}, 12);
    if (kind !== 'none') {
        const tint = skyTint(kind, i, time, false);
        if (tint) add('skyTint', tint);
    }
    return list;
}

/* ------------------------------------------------------------------------------------------------ */
/* Settings, caps                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

/** Caps on particles per layer and in total. */
export const CAPS = Object.freeze({
    normal: { perLayer: 400, total: 700 },
    mobile: { perLayer: 160, total: 280 },
    lowPower: { perLayer: 40, total: 160 },
});

/** Port of the DES device budget: smaller budgets on small screens and few-core devices. */
export function deviceScale({ width = 1920, height = 1080, cores = 8 } = {}) {
    const small = Math.min(width, height) < 700;
    const lowCore = (cores || 4) <= 4;
    if (small && lowCore) return 0.3;
    if (small || lowCore) return 0.5;
    return 1;
}

/**
 * Settings with defaults: density 0-100 (100 = full), lowPower, deviceScale (from deviceScale()),
 * reducedMotion, layer ('behind' the chat or in 'front' of it, where glows are dimmed).
 */
export function normalizeSettings(s = {}) {
    const density = Number.isFinite(Number(s.density)) ? clamp(Number(s.density), 0, 100) : 100;
    const scale = Number.isFinite(Number(s.deviceScale)) ? clamp(Number(s.deviceScale), 0.05, 1) : 1;
    return {
        density,
        lowPower: !!s.lowPower,
        deviceScale: scale,
        mobile: scale < 1,
        reducedMotion: !!s.reducedMotion,
        layer: s.layer === 'front' ? 'front' : 'behind',
    };
}

/** Frame interval the loop should keep: 60 fps normally, 30 in low-power mode. */
export function frameIntervalMs(settings = {}) {
    return settings.lowPower ? 33 : 0;
}

/** The cap that applies for these settings. */
export function capFor(settings) {
    if (settings.lowPower) return CAPS.lowPower;
    if (settings.mobile) return CAPS.mobile;
    return CAPS.normal;
}

/** Clamp each layer to the per-layer cap, then scale all particle layers down together to fit the total. */
export function applyCaps(layers, settings) {
    const cap = capFor(settings);
    const out = layers.map(l => (EFFECTS[l.effect].fixed ? { ...l } : { ...l, count: Math.min(l.count, cap.perLayer) }));
    const scaled = out.filter(l => !EFFECTS[l.effect].fixed);
    const total = scaled.reduce((n, l) => n + l.count, 0);
    if (total > cap.total) {
        const k = cap.total / total;
        for (const l of scaled) l.count = Math.max(1, Math.floor(l.count * k));
    }
    return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Planning                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The weather description as the engine reads it.
 * @param {object} desc { kind, intensity, windSpeed, windDirection, timeOfDay, hour?, season?, indoor?, word?, moonPhase? }
 */
export function normalizeDesc(desc = {}) {
    const d = desc && typeof desc === 'object' ? desc : {};
    const kind = normalizeKind(d.kind, d.word);
    let intensity = normalizeIntensity(d.intensity);
    const given = d.intensity !== undefined && d.intensity !== null && d.intensity !== '';
    if (kind === 'drizzle') intensity = given ? Math.min(intensity, 2) : 1;
    if (kind === 'downpour') intensity = given ? Math.max(intensity, 4) : 5;
    if (kind === 'blizzard' && !given) intensity = 4;
    const hourNum = Number(d.hour);
    const hasHour = d.hour !== undefined && d.hour !== null && d.hour !== '' && Number.isFinite(hourNum);
    const timeOfDay = normalizeTimeOfDay(d.timeOfDay, hasHour ? hourNum : undefined);
    const hour = hasHour ? hourNum : TIME_HOUR[timeOfDay];
    const season = normalizeSeason(d.season);
    const wind = planWind(kind, intensity, d.windSpeed, d.windDirection);
    const moonPhase = Number.isFinite(Number(d.moonPhase)) && d.moonPhase !== '' && d.moonPhase !== null
        ? clamp(Number(d.moonPhase), 0, 1) : 0.5;
    return { kind, intensity, timeOfDay, hour, season, indoor: !!d.indoor, wind, moonPhase };
}

/**
 * The indoor rule: outdoor layers (sky, precipitation, wind, leaves) go; rain-type weather shows rain running
 * down a window instead; a storm keeps a dimmer lightning flash (seen through the window); the tint halves.
 */
export function applyIndoor(layers, w) {
    const out = layers.filter(l => !EFFECTS[l.effect].outdoor).map((l) => {
        if (l.effect === 'skyTint') return { ...l, opts: skyTint(w.kind, w.intensity, w.timeOfDay, true) };
        if (l.effect === 'lightning') return { ...l, opts: { ...l.opts, indoor: true } };
        return l;
    });
    if (WET.includes(w.kind)) {
        out.push({ effect: 'windowRain', opts: { style: w.kind === 'sleet' || w.kind === 'hail' ? 'icy' : rainStyle(w.intensity) } });
    }
    return out;
}

/**
 * Plan the canvas for a weather description.
 * @param {object} desc see normalizeDesc
 * @param {object} [settings] see normalizeSettings
 * @returns {{ kind:string, intensity:number, timeOfDay:string, hour:number, season:string, indoor:boolean,
 *   wind:object, moonPhase:number, thunder:{enabled:boolean, intensity:number}, frameMs:number,
 *   layers:Array<{id:string, effect:string, count:number, alpha:number, opts:object, z:number, still:boolean}>}}
 */
export function planWeather(desc = {}, settings = {}) {
    const s = normalizeSettings(settings);
    const w = normalizeDesc(desc);
    let raw = kindLayers(w);
    if (w.indoor) raw = applyIndoor(raw, w);
    const seen = new Set();
    let layers = [];
    for (const l of raw) {
        if (seen.has(l.effect) || !l.opts) continue;
        seen.add(l.effect);
        const info = EFFECTS[l.effect];
        const base = l.base ?? info.base;
        let count = base;
        if (!info.fixed) {
            const f = (info.scales ? INTENSITY_FACTOR[w.intensity] : 1) * (s.density / 100) * s.deviceScale;
            count = f > 0 ? Math.max(1, Math.round(base * f)) : 0;
        }
        if (count <= 0) continue;
        if (s.lowPower && info.expensive) continue;
        if (s.reducedMotion && !info.still) continue;
        let alpha = 1;
        if (s.layer === 'front' && info.glow) alpha = l.effect === 'skyTint' ? 0.4 : 0.5;
        const opts = { ...l.opts };
        if (['rain', 'snow', 'sleet', 'hail', 'leaves', 'petals', 'ash', 'sand', 'wind', 'clouds', 'fogBank', 'mist', 'embers', 'windowRain']
            .includes(l.effect)) {
            opts.windPush = w.wind.push;
            opts.gust = w.wind.gust;
        }
        if (l.effect === 'moon') opts.phase = w.moonPhase;
        layers.push({ id: l.effect, effect: l.effect, count, alpha, opts, z: info.z, still: !!info.still });
    }
    layers = applyCaps(layers, s).sort((a, b) => a.z - b.z);
    const lightning = layers.some(l => l.effect === 'lightning');
    return {
        kind: w.kind,
        intensity: w.intensity,
        timeOfDay: w.timeOfDay,
        hour: w.hour,
        season: w.season,
        indoor: w.indoor,
        wind: w.wind,
        moonPhase: w.moonPhase,
        // Thunder keeps sounding under reduced motion; only the flash is left out.
        thunder: { enabled: lightning || (w.kind === 'storm' && s.reducedMotion), intensity: w.intensity, indoor: w.indoor },
        frameMs: frameIntervalMs(s),
        layers,
    };
}

/* ------------------------------------------------------------------------------------------------ */
/* Transitions                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export const DEFAULT_FADE_MS = 2000;

/**
 * The cross-fade from one plan's layers to the next: layers only in the old plan fade out, layers only in the
 * new plan fade in, layers in both are retuned (count, brightness and options move to the new values while
 * they stay on screen). A zero duration is a hard cut.
 * @returns {{ durationMs:number, fadeOut:string[], fadeIn:string[], retune:Array<{id:string, from:object, to:object}>,
 *   unchanged:string[] }}
 */
export function planTransition(prevLayers = [], nextLayers = [], durationMs = DEFAULT_FADE_MS) {
    const prev = new Map((prevLayers || []).map(l => [l.id, l]));
    const next = new Map((nextLayers || []).map(l => [l.id, l]));
    const fadeOut = [...prev.keys()].filter(id => !next.has(id));
    const fadeIn = [...next.keys()].filter(id => !prev.has(id));
    const retune = [];
    const unchanged = [];
    for (const [id, n] of next) {
        const p = prev.get(id);
        if (!p) continue;
        const same = p.count === n.count && p.alpha === n.alpha && JSON.stringify(p.opts) === JSON.stringify(n.opts);
        if (same) unchanged.push(id);
        else retune.push({ id, from: { count: p.count, alpha: p.alpha, opts: p.opts }, to: { count: n.count, alpha: n.alpha, opts: n.opts } });
    }
    return { durationMs: Math.max(0, Number(durationMs) || 0), fadeOut, fadeIn, retune, unchanged };
}

/** Smooth 0-1 easing for a fade at elapsed / duration. */
export function fadeProgress(elapsedMs, durationMs) {
    if (!(durationMs > 0)) return 1;
    const t = clamp(elapsedMs / durationMs, 0, 1);
    return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------------------------------------ */
/* Lightning and thunder                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/** A small seeded random generator (mulberry32), for tests and for repeatable bolts. */
export function makeRng(seed = 1) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Average time between strikes, by intensity 1-5. */
export const THUNDER_MEAN_MS = Object.freeze([0, 22000, 15000, 10000, 7000, 4500]);
export const THUNDER_MIN_GAP_MS = 2500;
/** Speed of sound: about 2.9 s per km between the flash and the thunder. */
export const SOUND_MS_PER_KM = 2915;

/**
 * The next lightning strike after `afterMs`: when it happens, its flashes (offsets from the strike and their
 * brightness), how far away it is and how long after the flash its thunder arrives, and a seed for the bolt.
 * Strong storms strike more often and closer.
 */
export function nextThunder(rng, intensity = 3, afterMs = 0) {
    const i = normalizeIntensity(intensity);
    const mean = THUNDER_MEAN_MS[i];
    const gap = Math.max(THUNDER_MIN_GAP_MS, Math.round(-Math.log(1 - rng()) * mean));
    const distanceKm = Math.round((0.3 + rng() * (7 - i)) * 10) / 10;
    const strength = Math.round(clamp(1.1 - distanceKm / 8 + (rng() - 0.5) * 0.2, 0.15, 1) * 100) / 100;
    const n = 1 + Math.floor(rng() * 3);
    const flashes = [];
    let offset = 0;
    for (let k = 0; k < n; k++) {
        flashes.push({ offsetMs: offset, peak: Math.round(clamp(strength * (k === 0 ? 1 : 0.6 + rng() * 0.4), 0.1, 1) * 100) / 100 });
        offset += 60 + Math.round(rng() * 140);
    }
    return {
        atMs: afterMs + gap,
        flashes,
        strength,
        distanceKm,
        thunderDelayMs: Math.round(distanceKm * SOUND_MS_PER_KM),
        bolt: strength >= 0.55,
        boltSeed: Math.floor(rng() * 2147483647),
    };
}

/** Every strike from `startMs` within `spanMs`, for planning or tests. */
export function thunderSchedule({ rng = Math.random, intensity = 3, startMs = 0, spanMs = 60000 } = {}) {
    const out = [];
    let t = startMs;
    for (;;) {
        const ev = nextThunder(rng, intensity, t);
        if (ev.atMs > startMs + spanMs) break;
        out.push(ev);
        t = ev.atMs;
    }
    return out;
}

/**
 * What onThunder listeners receive. A sound module plays thunder `thunderDelayMs` after `flashAt`
 * (a performance.now() time), at a loudness that follows `strength` (muffled when `indoor`).
 */
export function thunderPayload(ev, flashAt, { indoor = false, flash = true } = {}) {
    return {
        type: 'thunder',
        flashAt,
        thunderAt: flashAt + ev.thunderDelayMs,
        thunderDelayMs: ev.thunderDelayMs,
        distanceKm: ev.distanceKm,
        strength: ev.strength,
        flashes: ev.flashes.map(f => ({ ...f })),
        indoor: !!indoor,
        flash: !!flash,
    };
}

/**
 * The jagged path of a lightning bolt, top of the screen to about two thirds down, with a few short branches.
 * Coordinates are in pixels for a screen of w x h.
 */
export function boltPath(seed, w, h) {
    const rng = makeRng(seed);
    const main = [];
    let x = w * (0.15 + rng() * 0.7);
    let y = 0;
    const end = h * (0.45 + rng() * 0.3);
    main.push([x, y]);
    while (y < end) {
        y += h * (0.03 + rng() * 0.05);
        x += (rng() - 0.5) * w * 0.06;
        main.push([Math.round(x), Math.round(Math.min(y, end))]);
    }
    const branches = [];
    for (let b = 0; b < 3; b++) {
        if (rng() < 0.4) continue;
        const from = main[1 + Math.floor(rng() * (main.length - 2))];
        const dir = rng() < 0.5 ? -1 : 1;
        const path = [from.slice()];
        let [bx, by] = from;
        const steps = 2 + Math.floor(rng() * 3);
        for (let s = 0; s < steps; s++) {
            bx += dir * w * (0.01 + rng() * 0.03);
            by += h * (0.02 + rng() * 0.03);
            path.push([Math.round(bx), Math.round(by)]);
        }
        branches.push(path);
    }
    return { main, branches };
}
