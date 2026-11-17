import { classifyWeather } from './weather-kind.js';

/**
 * The scene header (fork): the line the story puts at the top of a message,
 *   [ 🕰️ Time 07:24 AM | 🗓️ Friday, February 07, 1182 | 📍 Place - Area | 🌫️ Fog, 34 °F ]
 *
 * Two readers live here:
 * - parseSceneHeader / sceneClockFrom: moved unchanged from modules/shim.js. Phone, Bonds, Games and Combat read the
 *   story's clock through shim.js#sceneClock, and their answers must not change, quirks included. Pinned by
 *   tests/scene-header.test.mjs against a verbatim copy of the old code.
 * - readSceneHeader / sceneFromChat: the Scene module's own reader. It adds the area, the weather kind and the
 *   temperature, finds the bracket group that holds the clock (not an [sfx:...] tag in front of it), takes the weather
 *   from the segment after the place, and falls back to the device clock when the chat has no header at all.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/* ---- the old reader, moved verbatim from modules/shim.js -------------------------------------------------------- */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Reads the header the story puts at the top of a message:
 *   [ 🕰️ Time 07:24 AM | 🗓️ Friday, February 07, 1182 | 📍 Place | 🌫️ Fog, 34 °F ]
 * Null when the text has none.
 */
export function parseSceneHeader(text) {
    const head = String(text ?? '').slice(0, 500);
    const time = /Time\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(head);
    if (!time) return null;
    const date = /([A-Za-z]+),?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{1,4})/.exec(head.slice(time.index));
    if (!date) return null;
    const month = MONTHS.indexOf(date[2].toLowerCase());
    if (month < 0) return null;

    let hour = Number(time[1]) % 12;
    if (/pm/i.test(time[3] || '')) hour += 12;
    if (!time[3]) hour = Number(time[1]);
    const minute = Number(time[2]);
    const day = Number(date[3]);
    const year = Number(date[4]);

    const moment = new Date(2000, month, day, hour, minute);
    moment.setFullYear(year);

    // The segments after the time and date: a place (📍) and, usually, the weather.
    const inner = (/\[([^\]]*)\]/.exec(head) || [, ''])[1].split('|').map(x => x.trim());
    const place = (inner.find(x => x.includes('\u{1F4CD}')) || '').replace(/^\S*\u{1F4CD}️?\s*/u, '').trim();
    const weather = inner.length > 3 ? inner[inner.length - 1].replace(/^[^\p{L}\d]+/u, '').trim() : '';

    return {
        ms: moment.getTime(),
        hour,
        minute,
        weekday: date[1],
        dateText: `${date[1]}, ${date[2]} ${String(day).padStart(2, '0')}, ${year}`,
        timeText: `${time[1].padStart(2, '0')}:${time[2]}${time[3] ? ` ${time[3].toUpperCase()}` : ''}`,
        place,
        weather,
    };
}

/**
 * What time it is in the story: the header of the newest message from you that has one, else
 * of any message that does. Null when nothing in the chat carries a clock, which is the cue
 * for callers to fall back to the real one.
 */
export function sceneClockFrom(chat) {
    if (!Array.isArray(chat)) return null;
    for (const mine of [true, false]) {
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!message || message.is_system) continue;
            if (mine && !message.is_user) continue;
            const clock = parseSceneHeader(message.mes);
            if (clock) return clock;
        }
    }
    return null;
}

/* ---- the Scene module's reader ---------------------------------------------------------------------------------- */

const HEAD_CHARS = 600;
const PIN = '\u{1F4CD}';
const TIME_RE = /\bTime\s*:?\s*(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s?[Mm]\.?)?/;
const DATE_RE = /([A-Za-z]+),?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{1,4})/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = MONTHS.map(m => m[0].toUpperCase() + m.slice(1));

const pad2 = (n) => String(n).padStart(2, '0');

/** "Harbour Inn - Common Room" as its main place and its area. */
export function splitPlace(place) {
    const text = String(place ?? '').trim();
    const parts = text.split(/\s+[-–—]\s+/);
    return { placeMain: (parts[0] || '').trim(), area: parts.slice(1).join(' - ').trim() };
}

/** The bracket group that carries the clock or the place pin, or the line with the clock when there are no brackets. */
function headerBody(head) {
    for (const m of head.matchAll(/\[([^\][]*)\]/g)) {
        if (TIME_RE.test(m[1]) || m[1].includes(PIN)) return m[1];
    }
    const line = head.split('\n').find(l => TIME_RE.test(l));
    return line ?? null;
}

/** The leading emoji and marks of a segment, and the words after them. */
function stripMarks(segment) {
    const m = /^([^\p{L}\d-]*)(.*)$/su.exec(String(segment || '').trim());
    return { marks: (m?.[1] || '').trim(), text: (m?.[2] || '').trim() };
}

/** A blank scene. */
function blankScene(source) {
    return {
        source, ms: null, hour: null, minute: null, weekday: '', dateText: '', timeText: '',
        place: '', placeMain: '', area: '', weatherText: '', weatherKind: 'none', weatherIntensity: '', tempText: '',
        messageId: null,
    };
}

/**
 * The scene header of one message, read for the Scene module. Null when the text has none.
 * A header counts when it has the clock (Time hh:mm) or the place pin (📍); the date is optional.
 *
 * @returns {null|{ source: 'header', ms: number|null, hour: number|null, minute: number|null, weekday: string,
 *   dateText: string, timeText: string, place: string, placeMain: string, area: string, weatherText: string,
 *   weatherKind: string, weatherIntensity: string, tempText: string, messageId: null }}
 */
export function readSceneHeader(text) {
    // A weather emoji written in its own brackets ("| [🌧️] Heavy rain") must not end the header early.
    const head = String(text ?? '').slice(0, HEAD_CHARS).replace(/\[\s*([^\p{L}\d\s[\]|]{1,8})\s*\]/gu, '$1');
    if (!head.trim()) return null;
    const body = headerBody(head);
    if (body === null) return null;
    const segments = body.split('|').map(s => s.trim()).filter(Boolean);
    const out = blankScene('header');

    let timeSeg = -1;
    const time = TIME_RE.exec(body);
    if (time) {
        const half = (time[3] || '').toUpperCase();
        let hour = Number(time[1]);
        if (half) hour = (hour % 12) + (half === 'P' ? 12 : 0);
        out.hour = hour;
        out.minute = Number(time[2]);
        out.timeText = `${pad2(time[1])}:${time[2]}${half ? ` ${half}M` : ''}`;
        timeSeg = segments.findIndex(s => TIME_RE.test(s));
    }

    let dateSeg = -1;
    const from = time ? body.slice(time.index) : body;
    const date = DATE_RE.exec(from);
    const month = date ? MONTHS.indexOf(date[2].toLowerCase()) : -1;
    if (date && month >= 0) {
        const day = Number(date[3]);
        const year = Number(date[4]);
        out.weekday = date[1];
        out.dateText = `${date[1]}, ${date[2]} ${pad2(day)}, ${year}`;
        dateSeg = segments.findIndex(s => DATE_RE.test(s) && s.includes(date[2]));
        if (out.hour !== null) {
            const moment = new Date(2000, month, day, out.hour, out.minute);
            moment.setFullYear(year);
            out.ms = moment.getTime();
        }
    }

    let placeSeg = segments.findIndex(s => s.includes(PIN));
    if (placeSeg < 0) placeSeg = segments.findIndex(s => /^(?:location|place)\s*:/i.test(s));
    if (placeSeg >= 0) {
        out.place = segments[placeSeg]
            .replace(new RegExp(`^[^\\p{L}\\d]*${PIN}\\uFE0F?\\s*`, 'u'), '')
            .replace(/^(?:location|place)\s*:\s*/i, '')
            .trim();
        Object.assign(out, splitPlace(out.place));
    }

    // The weather is the segment after the place; failing that, the last of four or more.
    const taken = new Set([timeSeg, dateSeg, placeSeg]);
    let weatherSeg = -1;
    if (placeSeg >= 0 && placeSeg + 1 < segments.length && !taken.has(placeSeg + 1)) weatherSeg = placeSeg + 1;
    else if (segments.length > 3 && !taken.has(segments.length - 1)) weatherSeg = segments.length - 1;
    if (weatherSeg >= 0) {
        const { marks, text: words } = stripMarks(segments[weatherSeg]);
        out.weatherText = words;
        const temp = /-?\d+(?:[.,]\d+)?\s*°\s*[CF]?/i.exec(words);
        out.tempText = temp ? temp[0].trim() : '';
        const kind = classifyWeather(words, marks);
        out.weatherKind = kind.kind;
        out.weatherIntensity = kind.intensity;
    }

    if (out.hour === null && !out.place && !out.dateText) return null;
    return out;
}

/** The device's own clock, as a scene with no place and no weather. */
export function deviceScene(now = new Date()) {
    const out = blankScene('device');
    const d = now instanceof Date ? now : new Date(now);
    const hour = d.getHours();
    out.ms = d.getTime();
    out.hour = hour;
    out.minute = d.getMinutes();
    out.weekday = WEEKDAYS[d.getDay()];
    out.dateText = `${out.weekday}, ${MONTH_NAMES[d.getMonth()]} ${pad2(d.getDate())}, ${d.getFullYear()}`;
    out.timeText = `${pad2(hour % 12 === 0 ? 12 : hour % 12)}:${pad2(out.minute)} ${hour < 12 ? 'AM' : 'PM'}`;
    return out;
}

/**
 * Where and when the story is, from a chat: the header of the newest message (either side) that has one. A newest
 * header without a place keeps the place of an earlier header. No header anywhere: the device clock, and the last
 * place known for this chat (`lastPlace`, kept by the caller), or none.
 *
 * @param {Array<{ mes?: string, is_user?: boolean, is_system?: boolean }>|null} chat
 * @param {{ now?: Date, lastPlace?: string }} [options]
 */
export function sceneFromChat(chat, { now = new Date(), lastPlace = '' } = {}) {
    let head = null;
    let headId = null;
    let placed = null;
    if (Array.isArray(chat)) {
        for (let i = chat.length - 1; i >= 0; i--) {
            const message = chat[i];
            if (!message || message.is_system) continue;
            const h = readSceneHeader(message.mes);
            if (!h) continue;
            if (!head) { head = h; headId = i; }
            if (h.place) { placed = h; break; }
        }
    }
    const keep = String(lastPlace || '').trim();
    if (!head) {
        const out = deviceScene(now);
        if (keep) Object.assign(out, { place: keep }, splitPlace(keep));
        return out;
    }
    const out = { ...head, messageId: headId };
    if (!out.place) {
        if (placed) Object.assign(out, { place: placed.place, placeMain: placed.placeMain, area: placed.area });
        else if (keep) Object.assign(out, { place: keep }, splitPlace(keep));
    }
    return out;
}
