/**
 * Knives (fork): short story twists saved on a character card, such as a secret, a debt or an old grudge. A
 * knife waits unused until the story is given one; then it is marked used. The idea comes from the "Knives"
 * of Doom's Enhancement Suite, rebuilt on Worldkit's own result injection (see result-runtime.js).
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 *
 * A knife is { id, text, used, theme? }. They live on the card as `char.knives`.
 */

export const MAX_KNIVES = 60;
export const MAX_KNIFE_TEXT = 400;

let counter = 0;
/** A fresh id, unique among the given knives. */
export function newKnifeId(existing = [], rng = Math.random) {
    const taken = new Set((existing || []).map(k => k?.id));
    for (;;) {
        counter += 1;
        const id = `k${Date.now().toString(36)}${counter.toString(36)}${Math.floor(rng() * 1296).toString(36)}`;
        if (!taken.has(id)) return id;
    }
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** One knife repaired, or null when it has no text. */
export function normalizeKnife(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = clean(raw.text, MAX_KNIFE_TEXT);
    if (!text) return null;
    const knife = { id: typeof raw.id === 'string' && raw.id ? raw.id : '', text, used: raw.used === true };
    const theme = clean(raw.theme, 80);
    if (theme) knife.theme = theme;
    return knife;
}

/** A list of knives repaired: no empties, no duplicate ids, a cap on the count. */
export function normalizeKnives(raw) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const k = normalizeKnife(item);
        if (!k) continue;
        if (!k.id || out.some(o => o.id === k.id)) k.id = newKnifeId(out);
        out.push(k);
        if (out.length >= MAX_KNIVES) break;
    }
    return out;
}

/** The list with one more knife (a copy). Empty text adds nothing. */
export function addKnife(list, text, theme = '') {
    const base = normalizeKnives(list);
    const k = normalizeKnife({ text, theme, used: false });
    if (!k || base.length >= MAX_KNIVES) return base;
    k.id = newKnifeId(base);
    return [...base, k];
}

/** The list with a knife's text changed (kept as typed, only trimmed to the limit). */
export function editKnife(list, id, text) {
    return (Array.isArray(list) ? list : []).map(k => (k?.id === id ? { ...k, text: String(text ?? '').slice(0, MAX_KNIFE_TEXT) } : k));
}

export function removeKnife(list, id) {
    return (Array.isArray(list) ? list : []).filter(k => k?.id !== id);
}

export function setKnifeUsed(list, id, used = true) {
    return (Array.isArray(list) ? list : []).map(k => (k?.id === id ? { ...k, used: Boolean(used) } : k));
}

/** Every knife unused again. */
export function resetKnives(list) {
    return (Array.isArray(list) ? list : []).map(k => ({ ...k, used: false }));
}

export function unusedKnives(list) {
    return (Array.isArray(list) ? list : []).filter(k => k && !k.used && String(k.text || '').trim());
}

/**
 * Picks one random unused knife, from one random character that is in the scene and has any.
 * @param {{ id?: string, name?: string, knives?: object[] }[]} characters every card
 * @param {string[]} names who is in the scene
 * @param {() => number} [rng]
 * @returns {{ charId: string, name: string, knife: object } | null}
 */
export function pickKnife(characters, names, rng = Math.random) {
    const here = new Set((names || []).map(n => String(n).trim().toLowerCase()));
    const cands = (characters || []).filter(c => c && here.has(String(c.name || '').trim().toLowerCase()) && unusedKnives(c.knives).length);
    if (!cands.length) return null;
    const char = cands[Math.min(cands.length - 1, Math.floor(rng() * cands.length))];
    const pool = unusedKnives(char.knives);
    const knife = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    return { charId: char.id || '', name: char.name, knife };
}

/** The report that goes to the story model ahead of the instruction (see resultBlockText). */
export function buildKnifeReport(name, knife) {
    const text = String(knife?.text ?? '').trim();
    if (!text) return '';
    return `A turn the story could take, involving ${name}: ${text}`;
}

export const DEFAULT_KNIVES_INSTRUCTION = 'The line above is a hidden turn the story may take. If it fits the moment, let it come out through the story itself: something said, noticed, found or done, the way it would really surface. Do not announce it, do not explain it, and never mention that it was prepared, suggested or given to you. If it does not fit here, leave it out. <<user>> only learns of it through what happens.';

/** The system prompt of the "Suggest knives" request (the Prompts tab can replace it). */
export const KNIVES_SYSTEM = [
    'You write short story twists for a character in a roleplay: a hidden secret, a debt, an old grudge, a promise, a lost love, a past mistake, a chance meeting, something that could come back at a bad moment.',
    'Each twist is one or two sentences, concrete, specific to this character, and works as something that can surface in a scene. Write it as a plain statement of what the twist is, not as dialogue.',
    'Fit the character as described and the theme if one is given. Do not repeat the ideas already listed. Do not mention game mechanics, numbers or levels.',
    'Reply with the twists only, as a plain numbered list, one per line (1. ..., 2. ...). No introduction and no closing remarks.',
].join('\n');

/**
 * The messages of the "Suggest knives" request.
 * @param {{ name: string, theme?: string, profile?: string, count?: number, existing?: string[], system?: string }} p
 */
export function buildKnivesRequest({ name, theme = '', profile = '', count = 5, existing = [], system = '' }) {
    const n = Math.max(1, Math.min(10, Math.round(Number(count)) || 5));
    const lines = [`Character: ${name}`];
    if (String(theme).trim()) lines.push(`Theme: ${String(theme).trim()}`);
    if (String(profile).trim()) lines.push(`About them:\n${String(profile).trim().slice(0, 4000)}`);
    const have = (existing || []).map(t => String(t).trim()).filter(Boolean).slice(0, 20);
    if (have.length) lines.push(`Already written (do not repeat):\n${have.map(t => `- ${t}`).join('\n')}`);
    lines.push(`Write ${n} twists for ${name}.`);
    return { system: String(system || '').trim() || KNIVES_SYSTEM, user: lines.join('\n\n') };
}

/**
 * Reads a model's reply into knife texts: numbered, bulleted or plain lines. Lines that are an introduction
 * (end with a colon) are skipped; a bullet that wraps onto the next line is joined to it.
 * @returns {string[]}
 */
export function parseKnifeList(reply, max = 10) {
    const out = [];
    const raw = String(reply ?? '').replace(/```[a-z]*\n?|```/gi, '').replace(/\r/g, '');
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const item = /^(?:\d{1,2}[.)]|[-*•])\s+(.*)$/.exec(t);
        if (item) { out.push(item[1].trim()); continue; }
        if (t.endsWith(':')) continue;
        // plain line: a continuation of a numbered item, or a list written without markers
        if (out.length && /^[a-z(]/.test(t)) out[out.length - 1] += ` ${t}`;
        else out.push(t);
    }
    return out
        .map(t => t.replace(/^\*\*(.*?)\*\*\s*[:\-]?\s*/, '$1: ').replace(/\s+/g, ' ').trim().slice(0, MAX_KNIFE_TEXT))
        .filter(t => t.length >= 4)
        .slice(0, max);
}
