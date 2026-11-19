/**
 * A delivery tag at the start of a spoken line (fork): the rules, without the I/O.
 *
 * In Combat, Games and Activities a character's line is plain speech. When the voice is ElevenLabs with audio tags, the model may also
 * start a line with ONE delivery tag from the owner's own list, such as "[softly] Nice catch." The tag is taken off the words (so it is
 * never shown or logged as text) and handed to the voice as the way the line is said. This file finds the tag, writes the instruction
 * that tells the model about it, and remembers the tone between cleaning a line and speaking it.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

const LEAD = /^\s*\[\s*([A-Za-z][A-Za-z -]{0,24}?)\s*\]\s*/;

/** The tag names the model may use, from a tone table (name to audio word): clean, lower case, in the table's order. */
export function allowedTones(table) {
    return Object.keys(table && typeof table === 'object' ? table : {})
        .map(n => String(n).trim().toLowerCase())
        .filter(n => /^[a-z][a-z -]{0,24}$/.test(n));
}

/**
 * Takes a leading delivery tag off a line. Only a tag from `allowed` counts; anything else is left for the caller's cleaning to
 * remove. A closing tag for the same word ("[/whisper]") is removed too.
 * @param {string} raw
 * @param {string[]} allowed
 * @returns {{ text: string, tone: string }} tone is '' when there was none
 */
export function splitLeadingTone(raw, allowed) {
    const text = String(raw ?? '');
    const m = LEAD.exec(text);
    if (!m) return { text, tone: '' };
    const name = m[1].trim().toLowerCase();
    if (!(allowed || []).includes(name)) return { text, tone: '' };
    let rest = text.slice(m[0].length);
    rest = rest.replace(new RegExp(`\\[\\s*/\\s*${name.replace(/[^a-z -]/g, '')}\\s*\\]`, 'gi'), '');
    return { text: rest, tone: name };
}

/** The instruction added to the model's rules when tones are on, or '' when there is nothing to choose from. */
export function toneRule(allowed) {
    const list = (allowed || []).map(n => `[${n}]`);
    if (!list.length) return '';
    return 'You may start your line with ONE delivery tag in square brackets to say how it is spoken, chosen only from this list: '
        + `${list.join(', ')}. For example "[softly] That was close." Use a tag only when it clearly fits, never more than one, and never describe the sound. `
        + 'The tag is the one thing allowed in brackets.';
}

/* ---- the Phone: a voice message's tone caption ---- */

// Everyday tone words to the tags they most likely mean, best first. A tag is used only when it is on the owner's list.
const CAPTION_ALIASES = [
    [/\b(whisper|whispers|whispering|whispered)\b/, ['whisper']],
    [/\b(soft|softly|gentle|gently|tender|sweet|low)\b/, ['murmur', 'hushed', 'intimate']],
    [/\b(quiet|quietly|hushed|muted)\b/, ['hushed', 'murmur']],
    [/\b(shout|shouts|shouting|yell|yelling|scream|screaming|loud|loudly)\b/, ['shout', 'command']],
    [/\b(cry|crying|tearful|weeping|sob|sobbing)\b/, ['cry', 'sobbing']],
    [/\b(sigh|sighs|sighing|weary)\b/, ['sigh', 'tired', 'resigned']],
    [/\b(laugh|laughs|laughing|laughter|giggle|giggling|chuckle|chuckling|snicker)\b/, ['laugh', 'amused', 'playful']],
    [/\b(excited|thrilled|eager|bubbly|cheerful|happy|bright)\b/, ['excited', 'playful']],
    [/\b(angry|furious|mad|irritated|annoyed|snapping)\b/, ['angry', 'seething', 'snarl']],
    [/\b(nervous|anxious|shaky|shaking|worried|trembling)\b/, ['nervous', 'trembling', 'uncertain']],
    [/\b(scared|afraid|frightened|terrified)\b/, ['scared', 'trembling']],
    [/\b(tired|sleepy|drowsy|yawning|groggy|exhausted)\b/, ['tired', 'sigh']],
    [/\b(flirty|flirtatious|seductive|sultry|husky)\b/, ['flirtatious', 'intimate', 'breathy']],
    [/\b(teasing|playful|smug|cheeky|mischievous)\b/, ['teasing', 'playful']],
    [/\b(sarcastic|dry|mocking|sneering|deadpan)\b/, ['sneer', 'deadpan']],
    [/\b(calm|steady|even|composed|level)\b/, ['steady']],
    [/\b(sad|sorrowful|mournful|wistful|melancholy)\b/, ['wistful', 'cry']],
    [/\b(breathless|breathy|panting)\b/, ['breathy']],
    [/\b(pleading|begging|desperate)\b/, ['pleading']],
    [/\b(firm|stern|commanding|authoritative)\b/, ['command']],
];

/**
 * The delivery tag a voice message's tone caption means ("soft", "a quiet laugh", "whispering"), or '' when none fits. A tag on the list
 * named in the caption wins; otherwise everyday tone words are mapped to the nearest tag that is on the list.
 * @param {string} caption
 * @param {string[]} allowed
 */
export function toneFromCaption(caption, allowed) {
    const text = String(caption ?? '').toLowerCase();
    const have = new Set(allowed || []);
    if (!text.trim() || !have.size) return '';
    const words = text.split(/[^a-z-]+/).filter(Boolean);
    for (const w of words) {
        if (have.has(w)) return w;
        const stem = w.replace(/(ing|ed|es|s)$/, '');
        if (stem.length >= 3 && have.has(stem)) return stem;
    }
    for (const [re, tags] of CAPTION_ALIASES) {
        if (!re.test(text)) continue;
        const hit = tags.find(t => have.has(t));
        if (hit) return hit;
    }
    return '';
}

/** The instruction for the Phone's voice messages, or '' when there is nothing to choose from. */
export function phoneToneRule(allowed) {
    const list = (allowed || []).map(n => `[${n}]`);
    if (!list.length) return '';
    return 'For a voice message, make its tone ONE word from this list when one fits: '
        + `${list.join(', ')}, written like [voice message: whisper] "what you say". If none fits, describe the tone in a few words as usual.`;
}

/* ---- remembering a tone between cleaning a line and speaking it ---- */

const MAX_PENDING = 40;
const pending = new Map();

const keyOf = (name, text) => `${String(name ?? '').trim().toLowerCase()}\u0001${String(text ?? '').trim()}`;

/** Remembers the tone a cleaned line came with, so speaking that exact line later uses it. Old entries are dropped. */
export function rememberTone(name, text, tone) {
    if (!tone || !String(text ?? '').trim()) return;
    const key = keyOf(name, text);
    pending.delete(key);
    pending.set(key, tone);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
}

/** The tone remembered for this exact line, once ('' when none). */
export function takeTone(name, text) {
    const key = keyOf(name, text);
    const tone = pending.get(key) || '';
    pending.delete(key);
    return tone;
}

/** Forgets everything remembered (for tests, or when voices are switched off). */
export function clearTones() {
    pending.clear();
}
