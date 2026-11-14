import { getSettings, saveSettings } from '../src/settings.js';
import { getActiveCharacters } from '../src/characters.js';
import { PROFILE_FIELDS } from '../src/constants.js';
import { charactersMentionedIn } from '../src/mentions.js';
import { parseMarkedLines } from '../src/speaker-marker.js';
import { readLoreEntry } from '../src/character-fill.js';
import { loadStateFromMetadata } from '../src/status-logic.js';
import { getContext } from '../../../../st-context.js';
import { world_names, loadWorldInfo } from '../../../../world-info.js';

/**
 * Presents SillyNPC's characters as the character cards the phone was written against, and
 * gives the phone the few things it needs to know about the story that cards never held.
 *
 * The phone reads `characters` - a list of cards with a name, an avatar file, and a
 * description, personality and scenario. Here those come from SillyNPC instead: the
 * people who exist in this story, with their portrait and their profile, rather than
 * whichever single card SillyTavern happens to have open.
 *
 * Rebuilt on every access, so a character created or renamed a moment ago is there
 * without anything having to tell the phone.
 */

/* ---- who somebody is ----------------------------------------------------------- */

/** A portrait path as something a browser can load. */
function portraitUrl(path) {
    const p = String(path || '').trim();
    if (!p) return '';
    if (/^(data:|https?:|\/)/i.test(p)) return p;
    return `/${p}`;
}

/** Linked lorebook entries, read ahead of time because the phone asks for text synchronously. */
const loreText = new Map();
const loreKey = (link) => `${link.world}\u0000${link.uid}`;

/**
 * Reads every linked lorebook entry into memory. Call at start-up, on a chat change, and
 * after a link is edited; the phone then sees the entry as the character's profile.
 */
export async function primeLore() {
    const next = new Map();
    for (const char of getSettings().characters || []) {
        const link = char?.lorebook;
        if (!link?.world) continue;
        try {
            next.set(loreKey(link), String(await readLoreEntry(char) || '').trim());
        } catch { /* a missing entry simply leaves the profile fields in charge */ }
    }
    loreText.clear();
    for (const [k, v] of next) loreText.set(k, v);
}

/**
 * What the phone knows of somebody's personality and history, in order of say:
 * text written for the phone, then their linked lorebook entry, then their profile fields.
 */
function profileText(char) {
    const own = String(char.phoneProfile || '').trim();
    if (own) return own;
    if (char.lorebook?.world) {
        const entry = loreText.get(loreKey(char.lorebook));
        if (entry) return entry;
    }
    const profile = char.profile || {};
    return PROFILE_FIELDS
        .map(field => [field.label, String(profile[field.id] ?? '').trim()])
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n');
}

/** One SillyNPC character, in the shape of a card. */
function asCard(char) {
    return {
        id: char.id,
        name: String(char.name || ''),
        avatar: portraitUrl(char.imageUrl),
        description: profileText(char),
        personality: '',
        scenario: '',
        skin: String(char.phoneSkin || ''),
        color: String(char.color || ''),
        imagePrompt: String(char.imagePrompt || ''),
        imageNegative: String(char.imageNegative || ''),
        _char: char,
    };
}

/** Everyone, in this chat's characters first. */
function allCards() {
    const active = getActiveCharacters();
    const seen = new Set(active.map(c => c.id));
    const rest = (getSettings().characters || []).filter(c => c && !seen.has(c.id));
    return [...active, ...rest].filter(c => c.name).map(asCard);
}

/** An array that is always current. Anything an Array has, it answers from a fresh copy. */
export const phoneCharacters = new Proxy([], {
    get(_target, prop) {
        const cards = allCards();
        const value = cards[prop];
        return typeof value === 'function' ? value.bind(cards) : value;
    },
    has(_target, prop) {
        return prop in allCards();
    },
});

/* ---- the story ------------------------------------------------------------------ */

/** Whether somebody is one of the characters in the open chat. */
export function isInChat(name) {
    return getActiveCharacters().some(c => c.name === name);
}

/** The player. Never a contact: the phone is how everyone else reaches them. */
export function isUserName(name) {
    const user = String(getContext().name1 || '').trim().toLowerCase();
    return !!user && String(name || '').trim().toLowerCase() === user;
}

/**
 * Who is in the scene right now, according to the tracker. Empty when it is off or has
 * nothing yet - which makes everybody "away", the only answer that is not a guess.
 *
 * @returns {Set<string>} Lowercased names.
 */
export function sceneNames() {
    try {
        const state = loadStateFromMetadata();
        return new Set((state?.characters || []).map(c => String(c?.name || '').trim().toLowerCase()).filter(Boolean));
    } catch {
        return new Set();
    }
}

/** Whether a line of the main story names this person, by name or alias. */
export function messageInvolves(name, text) {
    const char = (getSettings().characters || []).find(c => c.name === name);
    return !!char && charactersMentionedIn(String(text || ''), [char]).length > 0;
}

/* ---- what the phone's editor changes ------------------------------------------------ */

/** The real record behind a contact, to be edited. */
export function recordOf(name) {
    return (getSettings().characters || []).find(c => c.name === name) || null;
}

export function save() {
    saveSettings();
}

/** Lorebook names, for the picker. */
export function worldList() {
    return Array.isArray(world_names) ? [...world_names] : [];
}

/** The entries of one lorebook, as { uid, label }. */
export async function worldEntries(world) {
    try {
        const data = await loadWorldInfo(world);
        const entries = Array.isArray(data?.entries) ? data.entries : Object.values(data?.entries || {});
        return entries.map(e => ({
            uid: e.uid,
            label: String(e.comment || (Array.isArray(e.key) ? e.key.join(', ') : '') || `Entry ${e.uid}`).slice(0, 80),
        }));
    } catch {
        return [];
    }
}

/* ---- helpers for the games ---------------------------------------------------------- */

/** The characters in this chat, never the player. */
export function activeCharacterNames() {
    return getActiveCharacters().map(c => c.name).filter(n => n && !isUserName(n));
}

/**
 * Who spoke last in the main story, as a card: the last speaker tag in the newest message
 * that has one naming somebody SillyNPC knows. Null when nobody can be told.
 */
export function lastTaggedSpeaker(chat) {
    const cards = allCards();
    for (let i = (chat?.length || 0) - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;
        const lines = parseMarkedLines(message.mes);
        for (let k = lines.length - 1; k >= 0; k--) {
            const hit = cards.find(c => c.name.toLowerCase() === lines[k].speaker.toLowerCase());
            if (hit && !isUserName(hit.name)) return hit;
        }
    }
    return null;
}
