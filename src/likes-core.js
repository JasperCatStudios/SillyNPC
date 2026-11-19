/**
 * Likes and dislikes on a character card (fork): the data, without the I/O.
 *
 * Shape, on the card as `prefs`:
 *   { version: 1,
 *     likes:    { tea:[], food:[], activity:[], gift:[], topic:[] },
 *     dislikes: { tea:[], food:[], activity:[], gift:[], topic:[] },
 *     note: '' }
 * Values are short strings (PREF_MAX_CHARS), at most PREF_MAX_PER_LIST per list, compared without
 * regard to case, spaces or dashes. A card with no `prefs` field means "nothing set"; nothing here
 * adds the field to a card just by reading it. See docs/ACTIVITIES-PLAN.md section 5.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const PREF_CATEGORIES = Object.freeze(['tea', 'food', 'activity', 'gift', 'topic']);
export const PREF_LABELS = Object.freeze({ tea: 'Teas', food: 'Foods', activity: 'Activities', gift: 'Gifts', topic: 'Topics' });
export const PREF_SIDES = Object.freeze(['likes', 'dislikes']);
export const PREF_MAX_CHARS = 40;
export const PREF_MAX_PER_LIST = 40;
export const PREF_NOTE_MAX = 300;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, PREF_MAX_CHARS);

/** The key two spellings of one thing share: lower case, no punctuation or spaces. */
export const normKey = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const emptySide = () => Object.fromEntries(PREF_CATEGORIES.map(c => [c, []]));

export function emptyPrefs() {
    return { version: 1, likes: emptySide(), dislikes: emptySide(), favoriteMeal: '', note: '' };
}

function normalizeSide(raw) {
    const r = obj(raw);
    const out = emptySide();
    for (const c of PREF_CATEGORIES) {
        const seen = new Set();
        for (const v of Array.isArray(r[c]) ? r[c] : []) {
            const s = clean(v);
            const k = normKey(s);
            if (!s || !k || seen.has(k)) continue;
            seen.add(k);
            out[c].push(s);
            if (out[c].length >= PREF_MAX_PER_LIST) break;
        }
    }
    return out;
}

/**
 * Repairs whatever is there. A value that is in both a like list and a dislike list stays a like:
 * a character cannot both love and hate the same thing, and the like was the one written to be kept.
 */
export function normalizePrefs(raw) {
    const r = obj(raw);
    const likes = normalizeSide(r.likes);
    const dislikes = normalizeSide(r.dislikes);
    for (const c of PREF_CATEGORIES) {
        const liked = new Set(likes[c].map(normKey));
        dislikes[c] = dislikes[c].filter(v => !liked.has(normKey(v)));
    }
    return { version: 1, likes, dislikes, favoriteMeal: clean(r.favoriteMeal), note: String(r.note ?? '').replace(/\s+/g, ' ').trim().slice(0, PREF_NOTE_MAX) };
}

/** Whether there is anything worth keeping or sending. */
export function hasPrefs(raw) {
    const p = normalizePrefs(raw);
    return Boolean(p.note) || Boolean(p.favoriteMeal) || PREF_CATEGORIES.some(c => p.likes[c].length || p.dislikes[c].length);
}

/**
 * Adds one value. Returns the new prefs, and whether it changed. A value already on the other
 * side moves over (so saying "likes jasmine" after "dislikes jasmine" is a change of mind).
 * @returns {{ prefs: object, changed: boolean, reason?: string }}
 */
export function addPref(raw, side, category, value) {
    const prefs = normalizePrefs(raw);
    if (!PREF_SIDES.includes(side) || !PREF_CATEGORIES.includes(category)) return { prefs, changed: false, reason: 'Unknown list.' };
    const text = clean(value);
    const key = normKey(text);
    if (!text || !key) return { prefs, changed: false, reason: 'Nothing to add.' };
    const other = side === 'likes' ? 'dislikes' : 'likes';
    const had = prefs[other][category].length;
    prefs[other][category] = prefs[other][category].filter(v => normKey(v) !== key);
    const moved = prefs[other][category].length !== had;
    if (prefs[side][category].some(v => normKey(v) === key)) return { prefs, changed: moved };
    if (prefs[side][category].length >= PREF_MAX_PER_LIST) return { prefs, changed: moved, reason: `At most ${PREF_MAX_PER_LIST} per list.` };
    prefs[side][category].push(text);
    return { prefs, changed: true };
}

/** Removes one value from a list. */
export function removePref(raw, side, category, value) {
    const prefs = normalizePrefs(raw);
    if (!PREF_SIDES.includes(side) || !PREF_CATEGORIES.includes(category)) return { prefs, changed: false };
    const key = normKey(value);
    const before = prefs[side][category].length;
    prefs[side][category] = prefs[side][category].filter(v => normKey(v) !== key);
    return { prefs, changed: prefs[side][category].length !== before };
}

/** The character's favourite meal (one dish name; empty clears it). */
export function setFavoriteMeal(raw, text) {
    const prefs = normalizePrefs(raw);
    prefs.favoriteMeal = clean(text);
    return prefs;
}

/** Whether a dish is this character's favourite meal: the same name, or one containing the other as whole words. */
export function isFavoriteMeal(raw, dish) {
    const fav = normalizePrefs(raw).favoriteMeal;
    const key = normKey(dish);
    if (!fav || !key) return false;
    if (normKey(fav) === key) return true;
    const words = (v) => ` ${String(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    return words(dish).includes(words(fav)) || words(fav).includes(words(dish));
}

/** The free-text note. */
export function setNote(raw, text) {
    const prefs = normalizePrefs(raw);
    prefs.note = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, PREF_NOTE_MAX);
    return prefs;
}

/**
 * Whether a value is liked, disliked, or neither, in one category. Whole values match without
 * regard to case or spacing; a value also matches when it contains a listed one as whole words
 * ("iced jasmine tea" matches the like "jasmine").
 * @returns {'like'|'dislike'|null}
 */
export function matchPref(raw, category, value) {
    const prefs = normalizePrefs(raw);
    if (!PREF_CATEGORIES.includes(category)) return null;
    const key = normKey(value);
    if (!key) return null;
    const words = ` ${String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    const hit = (list) => list.some(v => {
        const k = normKey(v);
        if (k === key) return true;
        const w = ` ${String(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
        return w.trim() !== '' && words.includes(w);
    });
    // The like wins a tie, as in normalizePrefs.
    if (hit(prefs.likes[category])) return 'like';
    if (hit(prefs.dislikes[category])) return 'dislike';
    return null;
}

const join = (list) => list.join(', ');

/**
 * The prompt line: "Likes: jasmine tea, fishing. Dislikes: bitter tea, crowds. Note: ...". Empty
 * when there is nothing. Categories are not named: the values say what they are.
 */
export function likesPromptText(raw) {
    const p = normalizePrefs(raw);
    const flat = (side) => PREF_CATEGORIES.flatMap(c => p[side][c]);
    const parts = [];
    const likes = flat('likes');
    const dislikes = flat('dislikes');
    if (likes.length) parts.push(`Likes: ${join(likes)}.`);
    if (dislikes.length) parts.push(`Dislikes: ${join(dislikes)}.`);
    if (p.favoriteMeal) parts.push(`Favourite meal: ${p.favoriteMeal}.`);
    if (p.note) parts.push(`Note: ${p.note}`);
    return parts.join(' ');
}

/* ------------------------------------------------------------------ suggestions */

/** A few generic ideas for the editor's pick lists. A world preset can supply its own. */
export const GENERIC_SUGGESTIONS = Object.freeze({
    tea: ['Jasmine', 'Mint', 'Chamomile', 'Black tea', 'Green tea', 'Spiced chai', 'Berry blend', 'Bitter tea'],
    food: ['Honey cakes', 'Roast fish', 'Fresh bread', 'Stew', 'Sweets', 'Fruit', 'Spicy food', 'Cheese'],
    activity: ['Fishing', 'Gardening', 'Cooking', 'Reading', 'Sparring', 'Riding', 'Singing', 'Napping'],
    gift: ['Flowers', 'Books', 'Sweets', 'Tea leaves', 'Jewellery', 'Weapons', 'Handmade things'],
    topic: ['Training', 'Home', 'Old stories', 'Music', 'Food', 'The weather', 'Politics', 'Crowds'],
});

export const PREFS_SYSTEM = 'You read a character description and list what the character likes and dislikes. Answer with one JSON object and nothing else.';

/**
 * The request for "suggest from lore". The reply is read by parsePrefSuggestion and shown as chips
 * for the user to keep or drop; nothing is applied silently.
 * @returns {{ system: string, user: string }}
 */
export function buildPrefsRequest({ name, profile, existing, system } = {}) {
    const have = likesPromptText(existing);
    const lines = [
        `Character: ${name || 'Unknown'}`,
        '',
        profile ? `Description:\n${profile}` : 'Description: (none given; suggest only what a typical person of that name and manner might like.)',
        '',
        have ? `Already noted (do not repeat): ${have}` : '',
        '',
        `Suggest what ${name || 'this character'} likes and dislikes. Use these keys for each side: ${PREF_CATEGORIES.join(', ')}.`,
        `Each value is a short word or phrase (at most ${PREF_MAX_CHARS} characters). At most 5 per key; leave a key empty when the description gives no hint.`,
        'Also name their single favourite meal (one dish) as "favoriteMeal", or leave it empty.',
        'Answer only with JSON of this shape: {"likes":{"tea":[],"food":[],"activity":[],"gift":[],"topic":[]},"dislikes":{"tea":[],"food":[],"activity":[],"gift":[],"topic":[]},"favoriteMeal":""}',
    ];
    return { system: system || PREFS_SYSTEM, user: lines.filter((l, i) => l || lines[i - 1]).join('\n') };
}

/**
 * Reads a reply into prefs (without a note). Tolerates a code fence or words around the JSON.
 * Returns null when no object could be read.
 */
export function parsePrefSuggestion(reply) {
    const text = String(reply ?? '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (!parsed || typeof parsed !== 'object') return null;
        const p = normalizePrefs({ likes: parsed.likes, dislikes: parsed.dislikes, favoriteMeal: parsed.favoriteMeal });
        return hasPrefs(p) ? p : null;
    } catch {
        return null;
    }
}

/**
 * Adds every value of `suggested` that is not already there, keeping what is. Used for "keep all";
 * the editor adds single chips through addPref.
 */
export function mergePrefs(raw, suggested) {
    let prefs = normalizePrefs(raw);
    const s = normalizePrefs(suggested);
    if (!prefs.favoriteMeal && s.favoriteMeal) prefs.favoriteMeal = s.favoriteMeal;
    for (const side of PREF_SIDES) {
        for (const c of PREF_CATEGORIES) {
            for (const v of s[side][c]) {
                // Never flip something the user already set: a suggestion fills gaps, it does not overrule.
                const set = prefs.likes[c].concat(prefs.dislikes[c]).some(x => normKey(x) === normKey(v));
                if (!set) prefs = addPref(prefs, side, c, v).prefs;
            }
        }
    }
    return prefs;
}

/* ------------------------------------------------------------------ character files */

/** The field a character file carries: `{ prefs }` when there is something, else `{}` (no field at all). */
export function prefsForExport(raw) {
    return hasPrefs(raw) ? { prefs: normalizePrefs(raw) } : {};
}

/**
 * What an imported record does to a card's prefs.
 * No `prefs` in the record: 'keep' (the card's own stay). A record with prefs: 'set' with the repaired value,
 * or 'clear' when the record's prefs hold nothing.
 * @returns {{ action: 'keep' } | { action: 'set', prefs: object } | { action: 'clear' }}
 */
export function prefsFromRecord(record) {
    const raw = record && typeof record === 'object' ? record.prefs : undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { action: 'keep' };
    const prefs = normalizePrefs(raw);
    return hasPrefs(prefs) ? { action: 'set', prefs } : { action: 'clear' };
}
