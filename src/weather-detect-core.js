import { classifyWeather, WEATHER_KINDS, WEATHER_INTENSITIES } from './weather-kind.js';
import { FX_KINDS, normalizeTimeOfDay } from './weather-fx-core.js';

/**
 * Weather detection (fork, Scene module): where the scene's weather can come from besides the scene header.
 *
 *   header   - the weather segment of the scene header (scene-header.js); the default.
 *   internal - the Weather line (or the Env line) of the Internal States report of the newest message.
 *   model    - a small separate request after each reply, on the Weather connection.
 *
 * This file is the pure part: reading a report, reading a model's reply, writing the request, deciding whether to ask
 * again, and merging an answer into a scene. The SillyTavern side is src/weather-detect.js. Tested in
 * tests/weather-detect-core.test.mjs.
 */

export const WEATHER_SOURCES = Object.freeze(['header', 'internal', 'model']);
export const WEATHER_SOURCE_LABELS = Object.freeze({
    header: 'the scene header',
    internal: 'the Internal States report',
    model: 'a model',
});

/** The key on a message's extra where the model's answer is remembered, per swipe. */
export const WEATHER_EXTRA_KEY = 'worldkit_weather';
/** Where the Internal States module keeps its block (src/internal-states.js EXTRA_KEY). */
export const INTERNAL_STATES_EXTRA_KEY = 'sillynpc_internal_states';

export const DEFAULT_WEATHER_SYSTEM = [
    'You read a roleplay and report the CURRENT OUTDOOR WEATHER where the latest message takes place.',
    'Reply with ONE short JSON object and nothing else: no commentary, no code fences.',
    '{"weather": "<sky and precipitation in plain words, e.g. light rain, hazy sun, heavy snow, thick fog, overcast>", '
        + '"intensity": "light|moderate|heavy", "wind": "<calm, light breeze, strong wind, gale... and left or right if said>", '
        + '"time": "dawn|day|dusk|night", "indoors": true|false}',
    'Rules: describe the weather outside only, never the mood or a room. Use only what the messages say or clearly imply; '
        + 'do not invent a storm. Leave out a field you cannot tell. If the weather has not changed from the PREVIOUS WEATHER, '
        + 'reply exactly {"weather": "unchanged"}. If the scene has no weather at all (a windowless place, the story does not say), '
        + 'reply {"weather": "none"}.',
].join('\n');

/** The one line added to the Internal States instructions at request time when the weather source is the report. */
export const WEATHER_LINE_INSTRUCTION = 'Also add one line to the PHYSICS, ENGINE & WORLD section, right before Env: '
    + '"- <b>Weather:</b> [sky and precipitation with intensity, wind, time of day]" '
    + '(for example "light rain, light wind, dusk"). It is the current outdoor weather only; write "None" when the scene has none, '
    + 'and carry the previous weather forward when nothing changed.';

/* ---- reading text -------------------------------------------------------------------------------------------------- */

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/** Plain text from a block of HTML or text: line breaks kept, tags and entities gone. */
export function plainText(input) {
    return String(input ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(summary|details|div|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

const NOTHING = /^(?:none|n\/a|na|nil|-|unknown|unchanged|no weather|\[.*\])\.?$/i;

/**
 * The weather words in an Internal States block: its `Weather:` field (plain or in <b> tags, any case), else the part
 * of the `Env:` field (hazards / magic / weather) that names a weather. '' when there is none.
 * @param {string} textOrHtml
 */
export function parseWeatherFromReport(textOrHtml) {
    const text = plainText(textOrHtml);
    if (!text) return '';
    for (const line of text.split('\n')) {
        const m = /^[\s\-*•]*weather\s*:\s*(.*)$/i.exec(line);
        if (!m) continue;
        const value = m[1].trim().replace(/\s*\|\s*$/, '');
        if (value && !NOTHING.test(value)) return value;
    }
    for (const line of text.split('\n')) {
        const m = /^[\s\-*•]*env(?:ironment)?\s*:\s*(.*)$/i.exec(line);
        if (!m) continue;
        const pieces = m[1].split(/\s*[;,/|]\s*|\s+(?:and|with)\s+/i).map(p => p.replace(/^\[|\]$/g, '').trim()).filter(Boolean);
        const hits = pieces.filter(p => !NOTHING.test(p) && classifyWeather(p).kind !== 'none');
        if (hits.length) return hits.join(', ');
    }
    return '';
}

/* ---- reading a model's reply --------------------------------------------------------------------------------------- */

const asText = (v) => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));

/** The first balanced {...} in the text, or ''. */
function firstJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0) return '';
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return '';
}

const DIRECTION = /\b(left|right|north(?:-?east|-?west)?|south(?:-?east|-?west)?|east|west)\b|\b(NE|NW|SE|SW)\b/;

function windFrom(value) {
    const text = asText(value);
    if (!text) return { windSpeed: '', windDirection: '' };
    const dir = DIRECTION.exec(text);
    const windDirection = dir ? (dir[1] || dir[2]).toLowerCase().replace('-', '') : '';
    let windSpeed = '';
    if (/\b(calm|still|none|no wind)\b/i.test(text)) windSpeed = 'calm';
    else {
        const c = classifyWeather(/wind|breez|gust|gale|blust/i.test(text) ? text : `${text} wind`);
        windSpeed = c.windSpeed || '';
    }
    return { windSpeed, windDirection };
}

function intensityFrom(value) {
    const t = asText(value).toLowerCase();
    if (WEATHER_INTENSITIES.includes(t)) return t;
    if (/^(faint|slight|drizzly|gentle)$/.test(t)) return 'light';
    if (/^(severe|extreme|violent|intense)$/.test(t)) return 'heavy';
    if (/^(medium|normal|steady)$/.test(t)) return 'moderate';
    return '';
}

function timeFrom(value) {
    const t = asText(value).toLowerCase();
    if (!t || !/dawn|sunrise|daybreak|morning|\bday|noon|afternoon|dusk|evening|sunset|twilight|night|midnight/.test(t)) return '';
    return normalizeTimeOfDay(t);
}

function boolFrom(value) {
    if (typeof value === 'boolean') return value;
    const t = asText(value).toLowerCase();
    if (/^(true|yes|indoors?|inside)$/.test(t)) return true;
    if (/^(false|no|outdoors?|outside)$/.test(t)) return false;
    return undefined;
}

/**
 * A model's reply about the weather, as an answer. Accepts a JSON object (in code fences, or with chatter around it)
 * or plain words ("light rain, windy, dusk"). `{ weather: "unchanged" }` gives { unchanged: true }; "none" gives an
 * answer with no weather text (the scene is indoors or has none).
 *
 * @param {string} raw
 * @returns {null|{ unchanged?: true, text: string, kind: string, intensity: string, word: string, windSpeed: string,
 *   windDirection: string, timeOfDay: string, indoor: boolean|undefined, haze?: boolean }}
 */
export function parseWeatherReply(raw) {
    let text = String(raw ?? '')
        .replace(/<(think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/```(?:json|javascript|js)?/gi, '')
        .trim();
    if (!text) return null;

    let obj = null;
    const json = firstJsonObject(text);
    if (json) {
        try { obj = JSON.parse(json); } catch { obj = null; }
    }
    let weather;
    let kindWord = '';
    let rest = {};
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        weather = asText(obj.weather ?? obj.sky ?? obj.condition ?? obj.text);
        kindWord = asText(obj.kind).toLowerCase();
        rest = obj;
    } else {
        // Plain words: the first line that is not empty, minus a "Weather:" label and quotes.
        const line = text.split('\n').map(l => l.trim()).find(Boolean) || '';
        weather = line.replace(/^[\s\-*•]*weather\s*:\s*/i, '').replace(/^["'`]+|["'`.]+$/g, '').trim();
    }

    if (/^(unchanged|same|no change|not changed|no changes?)\b/i.test(weather)) {
        return { unchanged: true, text: '', kind: 'none', intensity: '', word: '', windSpeed: '', windDirection: '', timeOfDay: '', indoor: undefined };
    }
    const none = !weather || /^(none|n\/a|unknown|not stated|no weather)\.?$/i.test(weather);
    const classified = none ? { kind: 'none', intensity: '', word: '' } : classifyWeather(weather);
    let kind = classified.kind;
    if (kind === 'none' && !none && kindWord && (FX_KINDS.includes(kindWord) || WEATHER_KINDS.includes(kindWord))) kind = kindWord;
    const wind = windFrom(rest.wind);
    const out = {
        text: none ? '' : weather,
        kind,
        intensity: intensityFrom(rest.intensity) || classified.intensity || '',
        word: classified.word || '',
        windSpeed: wind.windSpeed || classified.windSpeed || '',
        windDirection: wind.windDirection,
        timeOfDay: timeFrom(rest.time ?? rest.timeOfDay ?? rest.time_of_day),
        indoor: boolFrom(rest.indoors ?? rest.indoor),
    };
    if (classified.haze) out.haze = true;
    if (!out.text && !none) return null;
    return out;
}

/* ---- the request -------------------------------------------------------------------------------------------------- */

const MAX_MESSAGE_CHARS = 4000;

/**
 * The request for one reply.
 * @param {{ recent?: string|string[], latest: string, previousWeather?: string, system?: string }} input
 * @returns {{ system: string, user: string }}
 */
export function buildWeatherRequest({ recent = '', latest = '', previousWeather = '', system = '' } = {}) {
    const recentText = (Array.isArray(recent) ? recent.join('\n\n') : String(recent || '')).slice(-MAX_MESSAGE_CHARS);
    const user = [
        `PREVIOUS WEATHER: ${String(previousWeather || '').trim() || '(none known yet)'}`,
        '',
        recentText ? `RECENT MESSAGES:\n${recentText}\n` : '',
        'LATEST MESSAGE:',
        String(latest || '').slice(0, MAX_MESSAGE_CHARS),
    ].join('\n');
    return { system: String(system || '').trim() || DEFAULT_WEATHER_SYSTEM, user };
}

/** A short stable hash of a text, to tell whether a message changed. */
export function hashText(text) {
    const s = String(text ?? '');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return `${s.length}:${h.toString(36)}`;
}

export const WEATHER_MIN_SECONDS = 20;

/**
 * Whether to ask the model about a message now: not for the user's own or a system message, not for text already
 * answered (same hash), and not more than once per `minSeconds`.
 * @returns {{ ask: boolean, reason: string }}
 */
export function shouldAskWeather({ now = Date.now(), lastAt = 0, minSeconds = WEATHER_MIN_SECONDS, text = '', answeredHash = '', isUser = false, isSystem = false } = {}) {
    if (isUser) return { ask: false, reason: 'your own message' };
    if (isSystem) return { ask: false, reason: 'a system message' };
    if (!String(text ?? '').trim()) return { ask: false, reason: 'no text yet' };
    if (answeredHash && answeredHash === hashText(text)) return { ask: false, reason: 'already answered for this text' };
    if (lastAt && now - lastAt < minSeconds * 1000) return { ask: false, reason: `asked less than ${minSeconds} seconds ago` };
    return { ask: true, reason: '' };
}

/* ---- finding an answer in a chat ----------------------------------------------------------------------------------- */

/** What a message has stored for its current swipe under the weather key, or null. */
export function storedWeather(message) {
    const bag = message?.extra?.[WEATHER_EXTRA_KEY];
    return bag && typeof bag === 'object' ? (bag[String(message.swipe_id ?? 0)] ?? null) : null;
}

/** The Internal States block of a message: kept outside the text ('after' mode), else in the text. */
export function internalStatesOf(message) {
    const bag = message?.extra?.[INTERNAL_STATES_EXTRA_KEY];
    const record = bag && typeof bag === 'object' ? bag[String(message.swipe_id ?? 0)] : null;
    if (record?.html) return String(record.html);
    const mes = String(message?.mes ?? '');
    const at = mes.search(/<internal_states>|INTERNAL STATES/i);
    return at >= 0 ? mes.slice(at) : '';
}

/** A scene answer from the words of a report. */
function answerFromWords(words) {
    const c = classifyWeather(words);
    const wind = windFrom(words);
    return {
        text: words, kind: c.kind, intensity: c.intensity, word: c.word,
        windSpeed: c.windSpeed || wind.windSpeed || '', windDirection: wind.windDirection,
        timeOfDay: timeFrom(words), indoor: undefined, ...(c.haze ? { haze: true } : {}),
    };
}

/**
 * The newest usable answer for a source, looking back from the newest message (at most `lookBack` of them).
 * 'internal': the Weather (or Env) words of the newest report that has some. 'model': the newest stored answer that is
 * not "unchanged". An answer with no text (the model said "none") counts and stops the search.
 * @returns {null|{ answer: object, messageId: number }}
 */
export function latestWeatherAnswer(chat, source, lookBack = 30) {
    if (!Array.isArray(chat) || (source !== 'internal' && source !== 'model')) return null;
    const stop = Math.max(0, chat.length - lookBack);
    for (let i = chat.length - 1; i >= stop; i--) {
        const message = chat[i];
        if (!message || message.is_system || message.is_user) continue;
        if (source === 'model') {
            const record = storedWeather(message);
            if (record && !record.unchanged) return { answer: record, messageId: i };
        } else {
            const words = parseWeatherFromReport(internalStatesOf(message));
            if (words) return { answer: answerFromWords(words), messageId: i };
        }
    }
    return null;
}

/**
 * A scene with a weather answer laid over it: the weather text, kind and intensity are the answer's; wind, time of day
 * and indoor only where the answer has them. `weatherSource` says where the weather came from.
 */
export function mergeWeatherAnswer(scene, answer, source) {
    const out = { ...scene };
    if (!answer) { out.weatherSource = scene.weatherText ? 'header' : ''; return out; }
    out.weatherText = answer.text || '';
    out.weatherKind = answer.kind || 'none';
    out.weatherIntensity = answer.intensity || '';
    if (answer.windSpeed) out.windSpeed = answer.windSpeed;
    if (answer.windDirection) out.windDirection = answer.windDirection;
    if (answer.timeOfDay) out.timeOfDay = answer.timeOfDay;
    if (typeof answer.indoor === 'boolean') out.weatherIndoor = answer.indoor;
    out.weatherSource = source;
    return out;
}

/** Plain words for where a scene's weather came from, for the status lines. */
export function describeWeatherSource(sourceId) {
    return sourceId === 'internal' ? 'Internal States report' : sourceId === 'model' ? 'model' : sourceId === 'header' ? 'header' : 'nothing';
}
