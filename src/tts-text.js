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
    // the first set
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
    // quiet and intimate
    murmur: 'softly',
    hushed: 'quietly',
    breathy: 'breathlessly',
    intimate: 'intimate',
    // forceful
    snarl: 'growling',
    command: 'firmly',
    seething: 'seething',
    sneer: 'sarcastic',
    defiant: 'defiant',
    bite: 'sharply',
    // vulnerable
    pleading: 'pleading',
    sobbing: 'sobbing',
    wistful: 'wistful',
    uncertain: 'hesitant',
    resigned: 'resigned',
    trembling: 'trembling',
    // expressive
    teasing: 'teasing',
    flirtatious: 'flirty',
    amused: 'amused',
    dreamy: 'dreamy',
    // specialised
    deadpan: 'deadpan',
    reverent: 'reverent',
    ominous: 'ominous',
    steady: 'calm',
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

/**
 * Tags come in two kinds. A WRAPPER is written around the words it affects ([whisper]"I know."[/whisper]).
 * An INLINE tag stands alone, with no closing tag, right before the words it affects ([pause], [sighs]); it is
 * ElevenLabs' own way of writing pacing and reactions. These are the names that are inline unless the owner says
 * otherwise (settings.deliveryInline).
 */
export const DEFAULT_INLINE_TAGS = Object.freeze([
    // pacing
    'slowly', 'rushed', 'pause', 'drawnout', 'snappy', 'speedy', 'longpause',
    // reactions
    'laughs', 'sighs', 'gasps', 'clearthroat', 'gulp',
]);

/**
 * The inline tag names in force: names in the table that are inline by default and not overridden to false, plus
 * names overridden to true. Names that are not in the table are ignored.
 *
 * @param {Record<string,string>} table
 * @param {Record<string,boolean>} [overrides] settings.deliveryInline
 * @returns {Set<string>}
 */
export function inlineNames(table, overrides) {
    const own = overrides && typeof overrides === 'object' ? overrides : {};
    const out = new Set();
    for (const name of Object.keys(table && typeof table === 'object' ? table : {})) {
        const key = name.toLowerCase();
        const set = Object.prototype.hasOwnProperty.call(own, key) ? own[key] : undefined;
        if (set === true || (set !== false && DEFAULT_INLINE_TAGS.includes(key))) out.add(key);
    }
    return out;
}

const asSet = (inline) => (inline instanceof Set ? inline : new Set(Array.isArray(inline) ? inline : []));
const byLength = (names) => [...names].sort((a, b) => b.length - a.length).map(escapeRe);

/** Opening and closing tags of the WRAPPER names (those not in `inline`). */
function tagRegex(table, flags = 'gi', inline = new Set()) {
    const skip = asSet(inline);
    const names = byLength(Object.keys(table).filter(n => !skip.has(n)));
    if (!names.length) return null;
    // An opening tag may carry extra words ([whisper, soft]); they count as the same tag and are dropped.
    return new RegExp(`\\[(\\/?)(${names.join('|')})(?:\\s*,[^\\]\\[]{0,40})?\\]`, flags);
}

/** Standalone tags of the INLINE names: [pause], [sighs, soft]. No closing form. */
function inlineRegex(table, flags = 'gi', inline = new Set()) {
    const names = byLength(Object.keys(table).filter(n => asSet(inline).has(n)));
    if (!names.length) return null;
    return new RegExp(`\\[(${names.join('|')})(?:\\s*,[^\\]\\[]{0,40})?\\]`, flags);
}

/** Removes every delivery tag: wrappers (opening and closing) and inline ones. */
export function stripToneTags(text, table = DEFAULT_TONE_TAGS, inline = new Set()) {
    let out = String(text ?? '');
    const wrap = tagRegex(table, 'gi', inline);
    if (wrap) out = out.replace(wrap, '');
    const solo = inlineRegex(table, 'gi', inline);
    if (solo) out = out.replace(solo, '');
    return out;
}

/**
 * The delivery in force at a position: the innermost tag opened before it and not yet closed.
 *
 * @returns {string} The tag name, or '' for none.
 */
export function toneAt(text, index, table = DEFAULT_TONE_TAGS, inline = new Set()) {
    // Inline tags are never pushed: a standalone [sighs] does not make the rest of the text "sighing".
    const re = tagRegex(table, 'gi', inline);
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
 *   tone: the delivery this piece is said in (from toneAt); audioTags: whether the model reads them;
 *   inline: the names of the standalone tags (inlineNames), each turned into [<ElevenLabs word>] in place
 *   when audioTags is on, removed otherwise.
 */
export function speechFor(text, { tone = '', table = DEFAULT_TONE_TAGS, audioTags = false, inline = new Set() } = {}) {
    // Wrappers first (opening and closing); then the inline ones become [word] in place. In that order, so a
    // freshly written [word] is never stripped again.
    let words = String(text ?? '');
    const wrap = tagRegex(table, 'gi', inline);
    if (wrap) words = words.replace(wrap, '');
    const solo = inlineRegex(table, 'gi', inline);
    if (solo) {
        let removed = false;
        words = words.replace(solo, (_all, name) => {
            const audio = table[String(name).toLowerCase()];
            if (audioTags && audio) return `[${audio}]`;
            removed = true;
            return '';
        });
        // A removed tag leaves a gap before punctuation ("Yes [sighs]." -> "Yes .").
        if (removed) words = words.replace(/\s+([,.!?;:])/g, '$1');
    }
    words = words.replace(/\s+/g, ' ').trim();
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
