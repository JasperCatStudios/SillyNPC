/**
 * Sound effects, the rules (fork). Pure, so node can test it; the runtime is sound-runtime.js, the settings page ui-sound.js.
 *
 * A sound map is a JSON file { format: 'worldkit-sounds', name, sounds: { name: { files: [...], volume, loop, fadeMs, group,
 * description } } } with its audio files beside it (file paths are relative to the map). The story model may write
 * [sfx:name] in a reply; that shows as a small tappable chip that plays the sound. Only names in the map become chips.
 */

export const SOUND_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });

export const SOUND_DEFAULTS = Object.freeze({
    enabled: false,
    mapUrl: '',          // empty: the sound pack of the installed Content Kit
    volume: 0.8,
    auto: false,         // play a new reply's sounds by themselves (the browser may refuse until you have tapped the page)
    promptOn: true,      // tell the story model which sounds it may use
    depth: 0,
    role: 'system',
    text: '',
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function normalizeSoundSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = SOUND_DEFAULTS;
    return {
        enabled: r.enabled === true,
        mapUrl: typeof r.mapUrl === 'string' ? r.mapUrl.trim().slice(0, 500) : d.mapUrl,
        volume: Math.round(clamp(r.volume, 0, 1, d.volume) * 100) / 100,
        auto: r.auto === true,
        promptOn: r.promptOn !== false,
        depth: Math.round(clamp(r.depth, 0, 100, d.depth)),
        role: Object.prototype.hasOwnProperty.call(SOUND_ROLES, r.role) ? r.role : d.role,
        text: typeof r.text === 'string' ? r.text.slice(0, 4000) : d.text,
    };
}

/** A sound name as it is compared: lower case, spaces and dashes as underscores. */
export function soundKey(name) {
    return String(name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Reads a map file. Returns { name, sounds: Map(key -> sound) } or null when it is not one. */
export function parseSoundMap(raw) {
    const data = typeof raw === 'string' ? safeJson(raw) : raw;
    if (!data || typeof data !== 'object' || !data.sounds || typeof data.sounds !== 'object' || Array.isArray(data.sounds)) return null;
    const sounds = new Map();
    for (const [name, s] of Object.entries(data.sounds)) {
        const key = soundKey(name);
        const files = (Array.isArray(s?.files) ? s.files : (typeof s?.file === 'string' ? [s.file] : []))
            .filter(f => typeof f === 'string' && f && !f.includes('\\') && !f.startsWith('/') && !f.split('/').includes('..'));
        if (!key || !files.length) continue;
        sounds.set(key, {
            key,
            files,
            volume: clamp(s.volume, 0, 1, 1),
            loop: s.loop === true,
            fadeMs: Math.round(clamp(s.fadeMs, 0, 20000, 0)),
            group: typeof s.group === 'string' ? s.group : '',
            description: typeof s.description === 'string' ? s.description.slice(0, 200) : '',
        });
    }
    if (!sounds.size) return null;
    return { name: String(data.name || 'Sounds').slice(0, 120), sounds };
}

function safeJson(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/** Where a sound's file is: its path beside the map. */
export function soundFileUrl(mapUrl, file) {
    const base = new URL(String(mapUrl), 'http://worldkit.invalid/');
    const url = new URL(file.split('/').map(encodeURIComponent).join('/'), base);
    // A map on this site stays a path on this site.
    return base.hostname === 'worldkit.invalid' ? url.pathname : url.href;
}

/** One file of a sound at random (the last one played is avoided when there is a choice). */
export function pickFile(sound, last = '') {
    const files = sound.files.length > 1 ? sound.files.filter(f => f !== last) : sound.files;
    return files[Math.floor(Math.random() * files.length)];
}

const TAG = /\[\s*sfx\s*:\s*([A-Za-z0-9_ -]{1,60}?)\s*\]/gi;

/** The [sfx:name] tags in a piece of text: { start, end, name } in reading order. */
export function findSfxTags(text) {
    const out = [];
    for (const m of String(text ?? '').matchAll(TAG)) out.push({ start: m.index, end: m.index + m[0].length, name: soundKey(m[1]) });
    return out;
}

/** A name for a chip: "door_creak" is "door creak". */
export function chipLabel(key) {
    return String(key).replace(/_/g, ' ');
}

export const DEFAULT_SFX_PROMPT = `Sound effects are available. When a sound would really happen at that moment in the scene, you may write it on its own as [sfx:name], using only a name from the list below. Use them sparingly (none or one or two in a reply), put each right where it happens, and never describe the sound in the tag.

Sounds: {{sounds}}`;

/** The list of one-shot sounds (not loops) for the instruction: "name (what it is), name, ..." */
export function soundList(map) {
    if (!map) return '';
    return [...map.sounds.values()].filter(s => !s.loop)
        .map(s => (s.description ? `${s.key} (${s.description})` : s.key)).join(', ');
}

/** What is sent to the story model; empty while off, while no map is loaded, or when the sound list is empty. */
export function sfxPromptText(settings, map) {
    const s = normalizeSoundSettings(settings);
    if (!s.enabled || !s.promptOn || !map) return '';
    const list = soundList(map);
    if (!list) return '';
    const template = s.text.trim() || DEFAULT_SFX_PROMPT;
    return template.includes('{{sounds}}') ? template.replace('{{sounds}}', list) : `${template}\n\nSounds: ${list}`;
}

/** A rough count of the tokens the instruction costs (about four characters each). */
export function roughTokens(text) {
    return Math.ceil(String(text ?? '').length / 4);
}
