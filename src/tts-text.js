/**
 * What is said to a TTS engine, prepared (fork): delivery tags and phonetic names.
 *
 * Pure text in, text out, so it can be tested without a browser.
 *
 * Delivery tags are how the story model marks HOW a line is said: [whisper]I know.[/whisper].
 * Each has an ElevenLabs audio tag it maps to (whisper -> [whispers]). Only the speech style is
 * ever sent, never a description of the sound. The closing tag is always removed before speech;
 * the opening one is turned into the ElevenLabs tag for models that understand them (Eleven v3)
 * and removed for every other model, which would read it aloud.
 */

/** Delivery tag to ElevenLabs audio tag. Editable in the settings; this is the starting table. */
export const DEFAULT_TONE_TAGS = Object.freeze({
    whisper: 'whispers',
    shout: 'shouts',
    sigh: 'sighs',
    laugh: 'laughs',
    cry: 'crying',
    excited: 'excited',
    playful: 'playful',
    curious: 'curious',
    nervous: 'anxious',
    scared: 'scared',
    angry: 'mad',
    tired: 'tired',
});

/**
 * ElevenLabs models that read audio tags as direction rather than as words. Per ElevenLabs'
 * audio tags page: Eleven v4, v4 Turbo and v3. Any other model says the tag out loud.
 */
export const TAG_MODELS = Object.freeze(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_ttv_v3']);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The table with only well-formed entries (lowercase letters and digits, non-empty values). */
export function cleanToneTable(table) {
    const out = {};
    for (const [key, value] of Object.entries(table && typeof table === 'object' ? table : {})) {
        const name = String(key).trim().toLowerCase();
        const audio = String(value ?? '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (/^[a-z][a-z0-9_-]{0,24}$/.test(name) && /^[a-z][a-z0-9 _-]{0,40}$/.test(audio)) out[name] = audio;
    }
    return out;
}

function tagRegex(table, flags = 'gi') {
    const names = Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRe);
    if (!names.length) return null;
    // An opening tag may carry extra words ([whisper, soft]); they count as the same tag and are dropped.
    return new RegExp(`\\[(\\/?)(${names.join('|')})(?:\\s*,[^\\]\\[]{0,40})?\\]`, flags);
}

/** Removes every delivery tag, opening and closing. */
export function stripToneTags(text, table = DEFAULT_TONE_TAGS) {
    const re = tagRegex(table);
    return re ? String(text ?? '').replace(re, '') : String(text ?? '');
}

/**
 * The delivery in force at a position: the innermost tag opened before it and not yet closed.
 *
 * @returns {string} The tag name, or '' for none.
 */
export function toneAt(text, index, table = DEFAULT_TONE_TAGS) {
    const re = tagRegex(table);
    if (!re) return '';
    const stack = [];
    const head = String(text ?? '').slice(0, Math.max(0, index));
    for (const m of head.matchAll(re)) {
        const name = m[2].toLowerCase();
        if (m[1]) {
            const at = stack.lastIndexOf(name);
            if (at >= 0) stack.splice(at, 1);
        } else {
            stack.push(name);
        }
    }
    return stack.length ? stack[stack.length - 1] : '';
}

/**
 * One piece of speech as it goes to the engine.
 *
 * @param {string} text The words, possibly with tags still in them.
 * @param {{ tone?: string, table?: Record<string,string>, audioTags?: boolean }} [options]
 *   tone: the delivery this piece is said in (from toneAt); audioTags: whether the model reads them.
 */
export function speechFor(text, { tone = '', table = DEFAULT_TONE_TAGS, audioTags = false } = {}) {
    const words = stripToneTags(text, table).replace(/\s+/g, ' ').trim();
    const audio = tone ? table[String(tone).toLowerCase()] : '';
    return audioTags && audio && words ? `[${audio}] ${words}` : words;
}

/**
 * Replaces each name with how it is said.
 *
 * @param {string} text
 * @param {{ name: string, phonetic?: string }[]} people
 * @returns {string}
 */
export function applyPhonetics(text, people) {
    const rules = [];
    for (const person of Array.isArray(people) ? people : []) {
        const name = String(person?.name ?? '').trim();
        const said = String(person?.phonetic ?? '').trim();
        if (!name || !said || name === said) continue;
        rules.push([name, said]);
        // "Anna Marie" said "AH-nah mah-REE": each part of a full name is also said that way alone.
        const parts = name.split(/\s+/);
        const spoken = said.split(/\s+/);
        if (parts.length > 1 && parts.length === spoken.length) {
            parts.forEach((part, i) => { if (part.length >= 3) rules.push([part, spoken[i]]); });
        }
    }
    rules.sort((a, b) => b[0].length - a[0].length);
    let out = String(text ?? '');
    const done = new Set();
    for (const [name, said] of rules) {
        const key = name.toLowerCase();
        if (done.has(key)) continue;
        done.add(key);
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])`, 'giu');
        out = out.replace(re, () => said);
    }
    return out;
}
