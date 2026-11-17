/**
 * The scene header instruction (fork): the text that asks the story model to begin every reply with the scene header,
 * and where it is placed. The Scene module reads the date, time, place and weather from that header, so they come with the
 * main API call itself and nothing has to be typed in. A preset that already asks for the header does not need this:
 * it is off until you switch it on. Pure, so node can test it; the runtime is scene-header-inject.js.
 */

/** The instruction, as written in the owner's preset. {{user}} is filled in by SillyTavern's own macro handling. */
export const DEFAULT_SCENE_HEADER_PROMPT = `You MUST start every response with this exact header format. Do not skip.

[ 🕰️ Time HH:MM AM/PM | 🗓️ DayOfWeek, Month DD, YYYY | 📍 Location - Specific Area | [WeatherEmoji] Weather, Temp °F ]

- Location: Format as "General Area - Specific Room". Update immediately if {{user}} moves.
- Weather: Replace [WeatherEmoji] with an emoji matching the current atmosphere (☀️, 🌧️, 🌫️, 🌩️). Include how the temperature physically feels.
- Progression: Update time and date logically.`;

export const SCENE_HEADER_POSITIONS = Object.freeze({ before: 'Before the story prompt', prompt: 'In the prompt', chat: 'In the chat, this many messages back' });
export const SCENE_HEADER_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });

export const SCENE_HEADER_DEFAULTS = Object.freeze({
    enabled: false,
    position: 'chat',
    depth: 0,
    role: 'system',
    order: 105,
    inList: false,
    text: '',
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);

/** The settings with every field in range. */
export function normalizeSceneHeaderSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = SCENE_HEADER_DEFAULTS;
    return {
        enabled: r.enabled === true,
        position: pick(r.position, SCENE_HEADER_POSITIONS, d.position),
        depth: clamp(r.depth, 0, 100, d.depth),
        role: pick(r.role, SCENE_HEADER_ROLES, d.role),
        order: clamp(r.order, 0, 1000, d.order),
        inList: r.inList === true,
        text: typeof r.text === 'string' ? r.text.slice(0, 4000) : d.text,
    };
}

/** What is sent: the owner's own wording if they wrote one, else the default. Empty when it is switched off. */
export function sceneHeaderText(settings) {
    const s = normalizeSceneHeaderSettings(settings);
    if (!s.enabled) return '';
    return s.text.trim() || DEFAULT_SCENE_HEADER_PROMPT;
}

/** One sentence saying where it goes, for the settings page. */
export function describeSceneHeaderPlacement(settings) {
    const s = normalizeSceneHeaderSettings(settings);
    if (s.inList) return `In SillyTavern's prompt list (entry "Worldkit - Scene Header"); its position, depth, role and order are set there.`;
    const role = SCENE_HEADER_ROLES[s.role].toLowerCase();
    if (s.position === 'before') return `As a ${role} message before the story prompt.`;
    if (s.position === 'prompt') return `As a ${role} message in the prompt.`;
    return `As a ${role} message ${s.depth === 0 ? 'right after the newest message' : `${s.depth} message${s.depth === 1 ? '' : 's'} back`}.`;
}
