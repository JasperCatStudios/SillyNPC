import { getSettings, saveSettings } from '../src/settings.js';
import { getActiveCharacters, getAllCategories } from '../src/characters.js';
import { charactersMentionedIn } from '../src/mentions.js';
import { parseMarkedLines } from '../src/speaker-marker.js';
import { primeLore, profileText } from '../src/profile-text.js';
import { sceneSet } from '../src/scene-cast.js';
import { getContext } from '../../../../st-context.js';
import { world_names, loadWorldInfo } from '../../../../world-info.js';

/**
 * Presents Worldkit's characters as the character cards the phone was written against, and
 * gives the phone the few things it needs to know about the story that cards never held.
 *
 * The phone reads `characters` - a list of cards with a name, an avatar file, and a
 * description, personality and scenario. Here those come from Worldkit instead: the
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

/* Who somebody is, as text, is Worldkit's own business: see src/profile-text.js. */
export { primeLore };

/** One Worldkit character, in the shape of a card. */
function asCard(char) {
    return {
        id: char.id,
        name: String(char.name || ''),
        avatar: portraitUrl(char.imageUrl),
        description: profileText(char),
        personality: '',
        scenario: '',
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

/** The faction (category) a character belongs to, or an empty string. */
export function factionOf(name) {
    const c = (getSettings().characters || []).find(x => x && x.name === name);
    return String(c?.category || '');
}

/** The factions in the order the Characters menu lists them, uncategorised first. */
export function factionOrder() {
    return ['', ...getAllCategories()];
}

/** The player. Never a contact: the phone is how everyone else reaches them. */
export function isUserName(name) {
    const user = String(getContext().name1 || '').trim().toLowerCase();
    return !!user && String(name || '').trim().toLowerCase() === user;
}

/**
 * Who is in the scene right now (src/scene-cast.js). Empty when there is no chat or nothing yet - which makes everybody "away", the only answer that is not a guess.
 *
 * @returns {Set<string>} Lowercased names.
 */
export function sceneNames() {
    return sceneSet();
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
 * that has one naming somebody Worldkit knows. Null when nobody can be told.
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

/* ---- the scene's clock ---------------------------------------------------------------- */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Reads the header the story puts at the top of a message:
 *   [ 🕰️ Time 07:24 AM | 🗓️ Friday, February 07, 1182 | 📍 Place | 🌫️ Fog, 34 °F ]
 * Null when the text has none.
 */
function parseSceneHeader(text) {
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
    const place = (inner.find(x => x.includes('\u{1F4CD}')) || '').replace(/^\S*\u{1F4CD}\uFE0F?\s*/u, '').trim();
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
export function sceneClock(chat = getContext()?.chat) {
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
