/**
 * Hidden identities (fork): two characters linked as one secret person. A character can say "I am secretly
 * <other>" and carry a prompt of their own: how this identity behaves, what it is for. Whenever either of the pair
 * is in the scene, the story model is told, with that prompt, that it must never reveal or hint at the link.
 *
 * The two cards stay two cards (each has its own image, lore entry and sheet), so there is no state to switch:
 * who is in the scene decides what is sent. Each side has its own prompt, so an alter ego and the person
 * behind it can be written differently.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const IDENTITY_MODES = Object.freeze({ off: 'Off', always: 'Always, while one of them is in the scene', random: 'Random (a chance each reply)' });
export const IDENTITY_POSITIONS = Object.freeze({ before: 'Before the story prompt', prompt: 'In the prompt', chat: 'In the chat, this many messages back' });
export const IDENTITY_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });

/** Said before the character's own prompt. <<name>> is the one in the scene, <<other>> the one they secretly are. */
export const DEFAULT_IDENTITY_INSTRUCTION = '<<name>> and <<other>> are secretly the same person. Unless it says otherwise below, no one in the story knows it. '
    + 'Never reveal it, confirm it, name the connection or hint at it, and never let <<name>> slip, unless the story has already revealed it. '
    + 'Write <<name>> only as the identity they are showing now, and treat <<other>> as someone else. '
    + 'Use the details below for how <<name>> carries this identity.';

export const IDENTITY_DEFAULTS = Object.freeze({
    mode: 'off',
    chance: 100,
    cooldown: 0,
    position: 'chat',
    depth: 1,
    role: 'system',
    order: 520,
    inList: false,
    instruction: '',
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const line = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

/** The global settings with every field in range. */
export function normalizeIdentitySettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = IDENTITY_DEFAULTS;
    return {
        mode: pick(r.mode, IDENTITY_MODES, d.mode),
        chance: clamp(r.chance, 0, 100, d.chance),
        cooldown: clamp(r.cooldown, 0, 50, d.cooldown),
        position: pick(r.position, IDENTITY_POSITIONS, d.position),
        depth: clamp(r.depth, 0, 100, d.depth),
        role: pick(r.role, IDENTITY_ROLES, d.role),
        order: clamp(r.order, 0, 1000, d.order),
        inList: r.inList === true,
        instruction: typeof r.instruction === 'string' ? r.instruction.slice(0, 1200) : d.instruction,
    };
}

/** Who knows the secret: a list of { id, name } (card id and name), without repeats. */
function normalizeKnownBy(raw) {
    const out = [];
    for (const k of Array.isArray(raw) ? raw : []) {
        const id = line(k?.id, 80);
        const name = line(k?.name, 80);
        if (!id && !name) continue;
        if (out.some(o => (id && o.id === id) || (name && same(o.name, name)))) continue;
        out.push({ id, name });
        if (out.length >= 30) break;
    }
    return out;
}

/** A character's link: who they secretly are (by card id and name), the prompt for this identity, and who knows. Null for none. */
export function normalizeLink(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const withName = line(raw.withName, 80);
    const withId = line(raw.withId, 80);
    const prompt = line(raw.prompt, 2000);
    const knownBy = normalizeKnownBy(raw.knownBy);
    if (!withName && !withId) return prompt || knownBy.length ? { withId: '', withName: '', prompt, knownBy } : null;
    return { withId, withName, prompt, knownBy };
}

/** The card a link points at: by id first, else by name. Never the character themselves. */
export function linkedCard(char, characters) {
    const link = normalizeLink(char?.identity);
    if (!link) return null;
    const others = (characters || []).filter(c => c && c !== char && c.id !== char.id);
    return (link.withId && others.find(c => c.id === link.withId)) || (link.withName && others.find(c => same(c.name, link.withName))) || null;
}

/**
 * The names of the characters who know the secret: the ones listed on either card of the pair (it is one secret),
 * by card where the card still exists, never the two of them, without repeats.
 */
export function whoKnows(char, other, characters) {
    const cards = characters || [];
    const skip = (c) => c && (c === char || c === other || c.id === char?.id || c.id === other?.id);
    const names = [];
    for (const k of [...(normalizeLink(char?.identity)?.knownBy || []), ...(normalizeLink(other?.identity)?.knownBy || [])]) {
        const card = (k.id && cards.find(c => c.id === k.id)) || (k.name && cards.find(c => same(c.name, k.name))) || null;
        if (skip(card)) continue;
        const name = card?.name || k.name;
        if (name && !same(name, char?.name) && !same(name, other?.name) && !names.some(n => same(n, name))) names.push(name);
    }
    return names;
}

const fill = (text, name, other) => String(text).replace(/<<name>>/gi, name).replace(/<<other>>/gi, other);

/**
 * The text sent for everyone in the scene who carries a link to a real card. Empty when nobody does.
 *
 * @param {object[]} characters every character card
 * @param {Iterable<string>} present lower-case names in the scene now
 * @param {{ instruction?: string }} [settings]
 */
export function buildIdentityBlock(characters, present, settings = {}) {
    const inScene = new Set([...(present || [])].map(n => String(n).trim().toLowerCase()));
    const how = String(settings.instruction || '').trim() || DEFAULT_IDENTITY_INSTRUCTION;
    const parts = [];
    for (const char of characters || []) {
        if (!char?.name || !inScene.has(String(char.name).trim().toLowerCase())) continue;
        const other = linkedCard(char, characters);
        if (!other?.name) continue;
        const own = normalizeLink(char.identity)?.prompt || '';
        const knowers = whoKnows(char, other, characters);
        const knownLine = knowers.length
            ? `\nThese characters do know the truth about ${char.name}: ${knowers.join(', ')}. They keep it secret from everyone else, and speak of it only privately or among themselves.`
            : '';
        parts.push(`${fill(how, char.name, other.name)}${knownLine}${own ? `\n${fill(own, char.name, other.name)}` : ''}`);
    }
    return parts.join('\n\n');
}

/**
 * Whether this reply carries the block.
 * @param {{ cfg: object, since?: number, rng?: () => number }} p since: replies since it last went (random mode)
 * @returns {{ fire: boolean, reason: string }}
 */
export function chooseIdentity({ cfg, since = Infinity, rng = Math.random }) {
    const c = normalizeIdentitySettings(cfg);
    if (c.mode === 'off') return { fire: false, reason: 'off' };
    if (c.mode === 'always') return { fire: true, reason: 'always' };
    if (c.chance < 100 && since < c.cooldown) return { fire: false, reason: 'cooling down' };
    if (!(rng() * 100 < c.chance)) return { fire: false, reason: 'not this time' };
    return { fire: true, reason: 'random' };
}

/** Links must be mutual to read well: this lists the cards a given card is linked to or from, for the editor. */
export function linkedFrom(char, characters) {
    return (characters || []).filter(c => c && c !== char && c.id !== char.id && linkedCard(c, characters)?.id === char.id);
}
