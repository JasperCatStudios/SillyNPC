import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../script.js';
import { 
    eventSource, 
    event_types, 
} from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { power_user } from '../../../../power-user.js';
import { setUserAvatar, getUserAvatar } from '../../../../personas.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from './settings.js';
import { LOG_PREFIX, PRODUCT_NAME, debugLog, isStaticField } from './constants.js';
import { splitValue, ceilingFromValue } from './utils.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from './speaker-labels.js';
import { charactersFromActivatedLore } from './activated-lore.js';

/**
 * Merges old and new stat values.
 *
 * A reported value keeps the ceiling the actor already carries: "50/100" updated with a
 * bare 40 is "40/100". A value written by hand does not, because it is the whole value.
 *
 * @param {*} oldVal
 * @param {*} newVal
 * @param {{ verbatim?: boolean }} [options] verbatim means the new value is the whole
 *   value, not a reading of part of one - see rule 2 below.
 */
export function mergeStatValue(oldVal, newVal, options = {}) {
    const { verbatim = false } = options;
    if (newVal === undefined || newVal === null) return newVal;
    const strOld = oldVal !== undefined && oldVal !== null ? String(oldVal) : '';
    const strNew = String(newVal);
    
    /* Two ceilings can apply, and this is the order of precedence.
     *
     * It used to be expressed as an early return - "no configured maximum, so send the new
     * value as it stands" - which put the second rule below a branch that could never reach
     * it. So a stat with no maxStatValue lost the actor's own ceiling the moment the model
     * reported a bare number, which is the usual shape for a model reporting a stat. That is
     * the same failure clampToCeiling's own note describes: a character given a ceiling of
     * 350 lost it silently a few messages later, and with nothing left to cap them their
     * Energy climbed past 350 unopposed.
     */

    // 1. The incoming value brought its own. "280/350" states a ceiling outright.
    if (strNew.includes('/')) return clampToCeiling(strNew.trim());

    /* 2. The actor's own, which the stat definition may know nothing about: one character's
     *    Energy caps at 350 while another's caps at 40, with nothing configured globally.
     *
     *    Only for a value being reported rather than written. A model answering "Energy: 80"
     *    is reading the current half of 280/350 and says nothing about the ceiling, so
     *    keeping it is the only honest reading. Somebody typing 80 into the field has
     *    written the whole value, and a rule that helpfully appends "/350" to it means the
     *    ceiling can be changed but never removed - which is exactly what it meant.
     */
    const parts = strOld.split('/');
    if (!verbatim && strOld.includes('/') && parts.length === 2 && parts[1].trim()) {
        return clampToCeiling(`${strNew.trim()}/${parts[1].trim()}`);
    }

    /* And deliberately no third. The configured maximum is a *starting* maximum: it seeds a
       stat the first time an actor is given one, and from then on the value is the only
       thing that says whether there is a ceiling at all. Appending it here put a ceiling
       back on any bare number, so a stat with a configured max could never lose one either. */
    return clampToCeiling(strNew.trim());
}

/**
 * A stat's *starting* maximum - the one a new actor is seeded with.
 *
 * Not the ceiling in play. That is read from the value itself, which is the only place it
 * can honestly live: one character's Energy caps at 350 while another's caps at 40, and
 * play raises a ceiling far more often than a setting does. This supplies the first one
 * and is not consulted again, which is what the System Builder box has said all along -
 * "Starting maximum only. The ceiling actually in play is read from the stat's own value."
 *
 * A default written as "10/10" supplies the max when none is set explicitly, so a system
 * configured that way seeds correctly without anyone having to fill in a second box.
 *
 * @param {{maxStatValue?: string, defaultValue?: string}} statDef
 * @returns {string} The starting max, or '' when the stat has none.
 */
export function resolveMaxValue(statDef) {
    if (!statDef) return '';
    const explicit = statDef.maxStatValue;
    if (explicit !== undefined && String(explicit).trim() !== '') return String(explicit).trim();
    const fallback = statDef.defaultValue;
    if (typeof fallback === 'string' && fallback.includes('/')) {
        const denominator = fallback.split('/')[1]?.trim();
        if (denominator) return denominator;
    }
    return '';
}


/**
 * The ceiling a value carries, if it carries one - regardless of what it is for.
 *
 * @param {{maxStatValue?: string, defaultValue?: string}} statDef Unused for the ceiling
 *   itself; kept so callers read as "this stat, this value".
 * @param {string|number} rawValue
 */
export function meterHasCeiling(statDef, rawValue) {
    // Through the shared reader rather than a parseFloat of its own, or this says yes to a
    // date: "14/01/2012" splits to a denominator of "01/2012", which parseFloat reads as 1.
    return ceilingFromValue(rawValue) !== null;
}


/**
 * Holds a value at its own ceiling.
 *
 * A value written as "cur/max" carries its ceiling with it, and that ceiling belongs to
 * the actor rather than to the stat definition: one character's Energy caps at 350 while
 * another's caps at 40, with nothing configured globally.
 *
 * This replaces a rule that did the opposite. When a stat had no configured maximum, the
 * "/max" was deleted from every value on load - so a character given a ceiling of 350 lost
 * it silently a few messages later, and with nothing left to cap them their Energy
 * climbed past 350 unopposed. Only characters who had been on stage were affected, which
 * is why some cards kept "150/150" while others had been flattened to a bare number.
 *
 * Non-numeric values are left alone: "???" and "Healthy" have no arithmetic to do.
 *
 * @param {string|number} value
 * @returns {string|number} The value, with its current half held at its maximum.
 */
export function clampToCeiling(value) {
    if (value === undefined || value === null) return value;
    const text = String(value);
    if (!text.includes('/')) return value;

    const { current, max } = splitValue(text);
    const currentNum = Number(current);
    const maxNum = Number(max);
    if (!Number.isFinite(currentNum) || !Number.isFinite(maxNum)) return value;
    if (currentNum <= maxNum) return value;
    return `${max}/${max}`;
}

export function getInitialStatValue(defaultValue, maxStatValue) {
    let value = defaultValue || '';
    if (maxStatValue && value && !String(value).includes('/')) {
        value = `${value}/${maxStatValue}`;
    }
    return value;
}

/**
 * Gets the name of the currently selected user persona.
 */
function getCurrentPersonaName() {
    return resolvePersonaAvatarAndName().name;
}

/**
 * How a persona is identified in storage: the avatar file.
 *
 * The display name used to be the key, which meant two personas called the same thing
 * shared one record and renaming a persona orphaned theirs. SillyTavern identifies a
 * persona by its avatar filename and so does the chat's own persona record, so this
 * matches what the rest of the application already believes.
 */
export function getCurrentPersonaKey() {
    return resolvePersonaAvatarAndName().avatar;
}

/**
 * Finds a persona's record, accepting the display-name key written before this.
 *
 * Moves what it finds rather than copying it, so the old key stops existing and the
 * migration happens once, on the first read, without a pass over anybody's settings.
 *
 * Two personas sharing a display name means one arbitrary record to inherit and whoever
 * loads first takes it. That ambiguity is what the avatar key removes going forward; it
 * cannot be undone for data already written under it.
 *
 * @param {object} store personaData, or a chat's players map.
 * @param {string} key The avatar filename.
 * @param {string} name The display name, as the record may still be filed under it.
 */
function takePersonaRecord(store, key, name) {
    if (!store || !key) return undefined;
    if (store[key]) return store[key];
    if (name && name !== key && store[name]) {
        store[key] = store[name];
        delete store[name];
        debugLog(`Persona record re-keyed from "${name}" to "${key}"`);
        return store[key];
    }
    return undefined;
}

/**
 * Single source of truth for "which persona is active, and what is it called".
 * @returns {{ avatar: string, name: string }}
 */
function resolvePersonaAvatarAndName() {
    const context = getContext();
    // context has no user_avatar key; the module-level export from script.js is the
    // authoritative value. Keep the context read first in case a future ST adds it.
    const avatar = context?.user_avatar || user_avatar || 'default_user.png';
    const powerUser = power_user || {};
    const name = powerUser.personas?.[avatar] || context?.name1 || 'Player';
    return { avatar, name };
}

/**
 * Initializes persona data in master storage with default values.
 */
function initPersonaData(key, name = key) {
    const settings = getSettings();
    const trackerSettings = settings.statusTracker;
    
    if (!settings.personaData) settings.personaData = {};
    
    const personaData = {
        stats: {},
        collections: {},
        lastUpdated: Date.now()
    };
    
    (trackerSettings.playerStats || []).forEach(stat => {
        if (stat && stat.name) {
            personaData.stats[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
        }
    });
    
    (trackerSettings.collections || []).forEach(col => {
        if (col && col.id && (col.target === 'player' || col.target === 'all')) {
            personaData.collections[col.id] = [];
        }
    });
    
    personaData.name = name;
    settings.personaData[key] = personaData;
    saveSettings();
    return personaData;
}

/** What SillyTavern was told about a persona, however that field is shaped. */
function personaDescription(avatarFilename) {
    const raw = (power_user || {}).persona_descriptions?.[avatarFilename];
    return (typeof raw === 'object' ? raw?.description : raw) || '';
}

/**
 * The player's own character card: their portrait, their description, their lore entry.
 *
 * The fields carry the names a character card uses, so everything built for a character -
 * the portrait block, the lorebook section, the image generator - works on the player
 * without being told who they are. isPlayer is the one thing that has to be said out
 * loud, because the player's facts live at state.player rather than in the scene cast.
 *
 * Kept in the same record as their stats, which means it follows the persona rather than
 * the chat and travels with the world when a system is switched. syncPlayerToMaster
 * rewrites that record on every message, so it carries these across explicitly - a
 * portrait that lasted until the next reply is the failure this has to avoid.
 *
 * @returns {object} The stored record, live: mutate it and call saveSettings().
 */
export function getPlayerCard() {
    const { avatar: key, name } = resolvePersonaAvatarAndName();
    const settings = getSettings();
    if (!settings.personaData) settings.personaData = {};

    const record = takePersonaRecord(settings.personaData, key, name) || initPersonaData(key, name);

    record.isPlayer = true;
    record.name = name;
    // No description: the sheet had a box for one and it only ever restated the persona
    // prompt, which the model is already given. The lore entry is where the player is
    // described, exactly as a character is.
    //
    // The portrait is deliberately not seeded from the persona picture either. Separating
    // the two is the point, and a copy would leave them looking joined.
    if (typeof record.imageUrl !== 'string') record.imageUrl = '';
    if (!Array.isArray(record.images)) record.images = [];
    if (record.lorebook === undefined) record.lorebook = null;
    return record;
}

/** The picture to show the player with, or '' when they have not made one. */
export function getPlayerImageUrl() {
    try {
        return getPlayerCard().imageUrl || '';
    } catch {
        return '';
    }
}

/** The field that identifies an item within a collection. */
function primaryFieldNameFor(colId) {
    const colDef = (getSettings().statusTracker.collections || []).find(c => c.id === colId);
    return colDef?.fields?.find(f => f.isPrimary)?.name || 'name';
}

/**
 * Merges two maps of collections by primary key, additively.
 *
 * Wholesale replacement is what emptied a persona's inventory, spells and skills across
 * every chat at once. Master and chat used to overwrite each other on load and on save,
 * so a single empty copy anywhere propagated everywhere: open a fresh chat, let one
 * update land, and the items were gone from every chat that persona had ever played.
 *
 * Merging means a copy that has merely forgotten an item cannot delete it. Only an
 * explicit removal - reviewed, or stated outright in an update - can, and that path goes
 * through syncPlayerToMaster with authoritative set.
 *
 * @param {Record<string, object[]>} base Kept in full.
 * @param {Record<string, object[]>} newer Merged over it; wins on individual fields.
 * @returns {Record<string, object[]>}
 */
function mergeCollectionMaps(base, newer) {
    const result = {};
    const ids = new Set([...Object.keys(base || {}), ...Object.keys(newer || {})]);

    for (const colId of ids) {
        const primary = primaryFieldNameFor(colId);
        const keyOf = (item) => String(item?.[primary] ?? item?.name ?? '').trim().toLowerCase();

        const merged = [];
        const seen = new Map();
        for (const source of [base?.[colId] || [], newer?.[colId] || []]) {
            for (const item of source) {
                const key = keyOf(item);
                // A blank primary field is a placeholder row, not an item. One of these
                // was all that survived of a real spell list.
                if (!key) continue;
                if (seen.has(key)) {
                    // A quantity or description that moved on is not reverted by the
                    // older copy, but the item itself is never dropped.
                    Object.assign(seen.get(key), item);
                    continue;
                }
                const copy = structuredClone(item);
                seen.set(key, copy);
                merged.push(copy);
            }
        }
        result[colId] = merged;
    }
    return result;
}

/**
 * Strips rows whose primary field is blank.
 *
 * Adding an item in the library creates an empty row to type into, which is reasonable
 * while editing and meaningless as a stored record.
 */
function dropPlaceholderItems(collections) {
    const result = {};
    for (const [colId, items] of Object.entries(collections || {})) {
        const primary = primaryFieldNameFor(colId);
        result[colId] = (items || []).filter(
            item => String(item?.[primary] ?? item?.name ?? '').trim() !== '');
    }
    return result;
}

/**
 * A persona's starting point in a chat that has never seen them.
 *
 * Master storage is a seed, and only a seed. It used to be copied into the live state
 * every time the persona was reloaded, the sheet was opened, or a chat was switched -
 * replacing that chat's stats wholesale with whichever chat wrote to master last. Two
 * stories with the same character therefore could not hold different states, and the
 * mechanism enforcing that was a silent in-place overwrite: part 2 lost its HP and
 * Energy to part 1 exactly this way.
 *
 * It is read here and nowhere else, so a chat that already knows a persona can never be
 * written over by one that played them elsewhere.
 *
 * @param {string} key The avatar filename identifying the persona.
 * @param {string} [name] Display name, for a record still filed under it.
 * @returns {{ stats: object, collections: object }} A fresh copy, safe to own.
 */
export function seedPlayerFromMaster(key, name = key) {
    const settings = getSettings();
    if (!settings.personaData) settings.personaData = {};

    const masterData = takePersonaRecord(settings.personaData, key, name)
        || initPersonaData(key, name);
    debugLog(`Seeding "${name}" into this chat from master storage`);
    return {
        stats: structuredClone(masterData.stats || {}),
        collections: structuredClone(masterData.collections || {}),
    };
}

/**
 * Points state.player at the persona now active, keeping whoever was there.
 *
 * The only function allowed to repoint state.player, so there is one place where a
 * persona change can touch player data and one place to get it right.
 *
 * A chat keeps a record per persona rather than a single slot. Switching to somebody else
 * for a scene and back used to hand the second character the first one's belongings -
 * that is where an officer's watch, a signet ring and a set of journals once changed
 * owner - and there was nowhere for the first character's progress to wait.
 *
 * @param {object} state
 * @param {string} key The avatar filename of the persona now active.
 * @param {string} [name] Their display name; defaults to the key for callers with only one.
 * @returns {boolean} Whether the active persona actually changed.
 */
export function activatePersona(state, key, name = key) {
    if (!state || !key) return false;

    // Identity is the avatar; the name is only what it is called. A persona renamed
    // mid-story is still the same character and keeps everything.
    const previousKey = String(state.player?.personaKey ?? state.player?.name ?? '').trim();
    if (previousKey && previousKey === key) {
        state.player.personaKey = key;
        state.player.name = name;
        return false;
    }

    if (!state.players || typeof state.players !== 'object') state.players = {};

    // Whoever was playing keeps what they earned, in this chat, for their return.
    if (previousKey && state.player) {
        state.players[previousKey] = {
            name: state.player.name,
            stats: structuredClone(state.player.stats || {}),
            collections: structuredClone(state.player.collections || {}),
        };
    }

    const known = takePersonaRecord(state.players, key, name);
    const incoming = known
        ? { stats: structuredClone(known.stats || {}), collections: structuredClone(known.collections || {}) }
        : seedPlayerFromMaster(key, name);

    state.player = { name, personaKey: key, stats: incoming.stats, collections: incoming.collections };
    debugLog(`Active persona in this chat: ${name}${known ? ' (restored)' : ' (seeded)'}`);
    return true;
}

/**
 * Synchronizes the player state from the current chat state to master storage.
 */
export function syncPlayerToMaster(state, options = {}) {
    if (!state.player) return;

    // Only a state that actually stated its collections may shrink them. A stats-only
    // update, or a plain save after a load, must not be able to empty master - that is
    // the direction the loss travelled in: one chat with nothing in it, and the persona
    // was stripped in every other chat too.
    const { authoritative = false } = options;

    const name = getCurrentPersonaName();
    const key = getCurrentPersonaKey();
    const settings = getSettings();

    if (!settings.personaData) settings.personaData = {};

    const existing = takePersonaRecord(settings.personaData, key, name);
    const incoming = structuredClone(state.player.collections || {});
    const collections = authoritative
        ? dropPlaceholderItems(incoming)
        : mergeCollectionMaps(existing?.collections || {}, incoming);

    // There was a ten-slot rollback ring here, taking a snapshot whenever the item count
    // dropped. It never fired for the loss it was meant to catch: stats going wrong is not
    // an item count changing, so when a story's HP and Energy were overwritten the ring
    // held nothing at all, so it was removed.

    debugLog(`Syncing player data UP for persona "${name}"`, { authoritative });
    settings.personaData[key] = {
        // Whatever else the record held comes first. This write replaces it outright, so
        // without carrying them the player's portrait, description and lore link would
        // last exactly until their next message.
        ...(existing || {}),
        name,
        stats: structuredClone(state.player.stats),
        collections,
        lastUpdated: Date.now()
    };
    saveSettings();
}

/**
 * @typedef {Object} CollectionItem
 * @property {string} [id] - Optional unique identifier
 * @property {Record<string, any>} fields - Field values defined in settings
 */

/**
 * @typedef {Object} ActorState
 * @property {string} name
 * @property {Record<string, string>} stats
 * @property {Record<string, CollectionItem[]>} collections
 * @property {string} [boundTo] - For scene binding
 */

/**
 * @typedef {Object} StatusState
 * @property {Record<string, string>} global
 * @property {ActorState[]} characters
 * @property {ActorState} player
 * @property {number} timestamp
 */

const STATE_KEY = 'sillynpc_status_state';
const HISTORY_KEY = 'sillynpc_status_history';

/** @type {StatusState | null} */
let committedState = null;

/**
 * The chat committedState was read from.
 *
 * The cache is only ever valid for one chat, and CHAT_CHANGED is too late to be the thing
 * that says so: SillyTavern swaps chat_metadata inside getChat() and only fires the event
 * after printMessages() has already rendered the whole conversation. For that entire pass
 * the new chat's metadata is live while this still holds the previous chat's state - so
 * every status box, and the HUD, read the chat you just left. Worse, a state repaired
 * during that window was saved back, writing the old chat's values into the new chat.
 *
 * Keyed on the chat instead, the cache invalidates itself the moment the chat does.
 *
 * @type {string | undefined}
 */
let committedChatId;

/** @returns {string|undefined} Undefined between chats, which is a value like any other. */
function currentChatId() {
    return getContext()?.getCurrentChatId?.();
}

/**
 * Which chat each live state object was read from.
 *
 * Invalidating the read cache stops a stale state being handed out, but it cannot stop
 * one already handed out from being saved after the chat has moved on - and that is the
 * write that does real damage, because it puts one chat's values into another chat's
 * file. It is how a story lost its HP and Energy to the story opened before it.
 *
 * A WeakMap rather than a field on the state: this must not be serialised into the chat
 * file, survive a structuredClone, or be something an update object could carry.
 *
 * @type {WeakMap<object, string|undefined>}
 */
const stateOrigin = new WeakMap();

// Common RPG stat synonyms to handle different AI output styles
const STAT_SYNONYMS = {
    // NOTE: deliberately no *_max / *_current entries here. Those address one half of
    // a "cur/max" value and are handled by splitStatKeyPart(); listing them as synonyms
    // made hp_max and hp_current both write the whole HP stat, so whichever the model
    // emitted last silently destroyed the other.
    'hp': ['health', 'hitpoints', 'life'],
    'energy': ['mana', 'mp', 'essence', 'power', 'stamina'],
    'condition': ['status', 'state', 'conditions', 'status_effects', 'effect']
};

/**
 * Robustly gets persona avatar and description from ST context.
 * Uses official ST persona management structures and utility functions.
 */
export function getPersonaData() {
    const { avatar: avatarFilename, name: officialName } = resolvePersonaAvatarAndName();

    const officialDescription = personaDescription(avatarFilename);
    
    // 3. Native Asset Loading
    //
    // Two URLs, because the two consumers want different things. SillyTavern renders
    // persona thumbnails at 96x144 (config.yaml), which is right for the 60px HUD circle
    // and visibly soft anywhere larger - a 768x1408 avatar arrives at an eighth of its
    // resolution. Anything bigger than a favicon should ask for the file itself.
    const FALLBACK_AVATAR = '../../../../../img/twemoji/1f464.png'; // Default silhouette
    let avatarUrl = FALLBACK_AVATAR;
    let avatarThumbUrl = FALLBACK_AVATAR;

    if (avatarFilename && avatarFilename !== 'default_user.png') {
        avatarThumbUrl = getThumbnailUrl('persona', avatarFilename);
        avatarUrl = `/User Avatars/${encodeURIComponent(avatarFilename)}`;
    }

    const result = {
        name: officialName,
        avatar: avatarFilename,
        avatarUrl: avatarUrl,
        avatarThumbUrl: avatarThumbUrl,
        description: officialDescription,
        method: 'official-st-lookup'
    };

    return result;
}

/**
 * Returns the chat metadata object that SillyTavern persists alongside the chat.
 *
 * The context key is `chatMetadata` — there is no `window.chat_metadata`, and no
 * `context.chat_metadata`. Reading either of those returned a throwaway object
 * literal, so every state write went to garbage and nothing survived a reload.
 */
function getMetadata() {
    return getContext()?.chatMetadata ?? null;
}




/**
 * Initialize status tracker logic
 */
export function initStatusLogic() {
    debugLog('Initializing persona and system tracking');
    // Before anything reads configuration, so the world in use belongs to a system.
    migrateToActiveSystem();
    applyDefaultWorld();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.PERSONA_CHANGED, onPersonaChanged);
}

/** Where a chat records which persona was last used in it. */
export const PERSONA_KEY = 'sillynpc_persona';

/**
 * Whether a chat is actually open. SillyTavern returns undefined between chats, which is
 * the only reliable signal - the chat array is left populated after one closes.
 */
export function hasOpenChat() {
    return getContext()?.getCurrentChatId?.() !== undefined;
}

/** The persona this chat was last used with, or null if it has never recorded one. */
export function getChatPersona() {
    const avatar = getMetadata()?.[PERSONA_KEY];
    return (typeof avatar === 'string' && avatar) ? avatar : null;
}

/**
 * Records the persona in use against the open chat.
 *
 * Called whenever you switch persona, which is what makes a change mid-chat stick: the
 * chat remembers whoever you last played it as, not whoever was active when the
 * application last closed.
 *
 * @returns {boolean} False when there was nothing to record.
 */
export function rememberChatPersona() {
    const metadata = getMetadata();
    if (!metadata || !hasOpenChat()) return false;

    const { avatar } = resolvePersonaAvatarAndName();
    // A restore also lands here, via the PERSONA_CHANGED it emits - and needs no special
    // case, because it can only ever be writing back the value it just read.
    if (!avatar || metadata[PERSONA_KEY] === avatar) return false;

    metadata[PERSONA_KEY] = avatar;
    getContext()?.saveMetadataDebounced?.();
    debugLog(`Chat persona recorded: ${avatar}`);
    return true;
}

/**
 * Puts a chat back to the persona it was last played with.
 *
 * A chat that has never recorded one adopts whoever is active now, so nothing is guessed
 * about chats that predate this and the first open of an old chat simply claims it.
 *
 * One sharp edge worth knowing: setUserAvatar re-triggers the greeting on an *empty*
 * chat. A chat with no record returns before that point, so it only applies to an empty
 * chat that recorded a different persona earlier - rare, and still the right outcome.
 *
 * @returns {Promise<boolean>} Whether a switch actually happened.
 */
export async function restoreChatPersona() {
    if (!hasOpenChat()) return false;

    const recorded = getChatPersona();
    if (!recorded) {
        rememberChatPersona();
        return false;
    }

    const { avatar } = resolvePersonaAvatarAndName();
    if (recorded === avatar) return false;

    try {
        await setUserAvatar(recorded, { toastPersonaNameChange: false });
        debugLog(`Chat persona restored: ${recorded}`);
        return true;
    } catch (err) {
        // A persona deleted since the chat was last opened is the ordinary failure. The
        // chat stays on whoever is active rather than refusing to open.
        console.warn(LOG_PREFIX, 'Could not restore this chat\'s persona', err);
        return false;
    }
}

/** Where a chat records which system it belongs to. */
export const SYSTEM_KEY = 'sillynpc_system';

/** The system this chat belongs to, or null if it has never recorded one. */
export function getChatSystem() {
    const name = getMetadata()?.[SYSTEM_KEY];
    return (typeof name === 'string' && name) ? name : null;
}

/** Ties the open chat to the system in use. */
function rememberChatSystem() {
    const metadata = getMetadata();
    if (!metadata || !hasOpenChat()) return false;

    const active = getActiveSystem();
    if (!active || metadata[SYSTEM_KEY] === active) return false;

    metadata[SYSTEM_KEY] = active;
    getContext()?.saveMetadataDebounced?.();
    return true;
}

/**
 * Puts the extension into the system a chat belongs to.
 *
 * This is what makes changing ruleset stop being something you do. Opening a Pathfinder
 * chat brings its stats, its cast and its item library with it; a chat that has never
 * recorded a system adopts the one in use, so nothing is guessed about older chats.
 *
 * @returns {boolean} Whether a switch actually happened.
 */
export function restoreChatSystem() {
    if (!hasOpenChat()) return false;

    const recorded = getChatSystem();
    if (!recorded) {
        rememberChatSystem();
        return false;
    }
    if (recorded === getActiveSystem()) return false;

    if (!getSettings().statusTracker.presets?.[recorded]) {
        // Deleted since the chat was last opened. Staying put is the safe reading: the
        // alternative is loading a world at random and writing this chat's state into it.
        console.warn(LOG_PREFIX,
            `This chat belongs to a system that no longer exists: "${recorded}"`);
        return false;
    }
    const from = getActiveSystem();
    const switched = setActiveSystem(recorded);
    if (switched) {
        // Opening a chat that belongs to another system loads that system's saved HUD, combat
        // world and rules over the ones on screen. Say so, instead of settings changing unannounced.
        console.info(LOG_PREFIX, `System switched from "${from}" to "${recorded}" because this chat belongs to it`);
        try { toastr.info(`This chat belongs to the "${recorded}" system, so it was loaded (was "${from}"). Its own HUD and combat settings now apply.`, PRODUCT_NAME, { timeOut: 9000 }); } catch { /* no toast */ }
    }
    return switched;
}

async function onChatChanged() {
    committedState = null;
    // System first. It carries the persona records that the restore below reads from, so
    // the other order would match a persona against the outgoing system's storage.
    restoreChatSystem();
    await restoreChatPersona();
}

function onPersonaChanged() {
    const state = loadStateFromMetadata();
    // Only writes when the active persona actually changed, so an event fired for a
    // persona that was already active costs nothing and touches nothing.
    if (activatePersona(state, getCurrentPersonaKey(), getCurrentPersonaName())) {
        saveStateToMetadata(state, { label: 'Persona changed' });
        eventSource.emit('sillynpc-status-updated', state);
    }
    rememberChatPersona();
    // index.js will handle the HUD update via its own event listener
}

/**
 * Loads the current status from chat metadata
 */
export function loadStateFromMetadata() {
    // Belongs to a chat that is no longer open, whatever the event order was.
    if (committedState && committedChatId !== currentChatId()) committedState = null;

    let stateToReturn = committedState;

    if (!stateToReturn) {
        const metadata = getMetadata();
        if (metadata && metadata[STATE_KEY]) {
            stateToReturn = metadata[STATE_KEY];
            
            // Ensure legacy states have expected structure
            if (!stateToReturn.global) stateToReturn.global = {};
            if (!stateToReturn.characters) stateToReturn.characters = [];
            
            // The chat owns what is here. A different persona is a switch, handled in one
            // place; the same persona means this chat's record is already theirs and
            // nothing outside the chat gets a say in it.
            if (stateToReturn.player) {
                activatePersona(stateToReturn, getCurrentPersonaKey(), getCurrentPersonaName());
            } else {
                // Written before there was a player object at all.
                const name = getCurrentPersonaName();
                const key = getCurrentPersonaKey();
                stateToReturn.player = { name, personaKey: key, ...seedPlayerFromMaster(key, name) };
            }
        } else {
            const name = getCurrentPersonaName();
            const key = getCurrentPersonaKey();
            stateToReturn = createInitialState();
            stateToReturn.player = { name, personaKey: key, ...seedPlayerFromMaster(key, name) };
        }
        committedState = stateToReturn;
        committedChatId = currentChatId();
        stateOrigin.set(stateToReturn, committedChatId);
    }

    /* Fills in stats the system declares and repairs their casing. It deliberately does NOT
       remove a stored value whose stat has been deleted: erasing on load would take a stat's
       history with it the moment somebody deletes one by mistake, and a System Profile
       switch changes the schema under a chat without meaning to throw anything away.

       A deleted stat is instead ignored wherever anything reads - the tracker box and both
       prompts go through statsInSystem - so the value simply stops being seen. This comment
       used to promise validation that was never written, which is how a deleted stat came to
       be drawn and sent on every message while being unable to change. */
    const settings = getSettings().statusTracker;

    let stateChanged = false;

    // Ensure missing global stats from settings are added
    (settings.globalStats || []).forEach(stat => {
        if (stat && stat.name) {
            const existingKey = Object.keys(stateToReturn.global).find(k => k.toLowerCase() === stat.name.toLowerCase());
            if (!existingKey) {
                stateToReturn.global[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                stateChanged = true;
            } else {
                if (existingKey !== stat.name) {
                    // Non-destructive rename
                    stateToReturn.global[stat.name] = stateToReturn.global[existingKey];
                    delete stateToReturn.global[existingKey];
                    stateChanged = true;
                }
                const clamped = clampToCeiling(stateToReturn.global[stat.name]);
                if (clamped !== stateToReturn.global[stat.name]) {
                    stateToReturn.global[stat.name] = clamped;
                    stateChanged = true;
                }
            }
        }
    });

    // Validate Player stats
    if (stateToReturn.player && stateToReturn.player.stats) {
        // Ensure missing player stats from settings are added
        (settings.playerStats || []).forEach(stat => {
            if (stat && stat.name) {
                const existingKey = Object.keys(stateToReturn.player.stats).find(k => k.toLowerCase() === stat.name.toLowerCase());
                if (!existingKey) {
                    stateToReturn.player.stats[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                    stateChanged = true;
                } else {
                    if (existingKey !== stat.name) {
                        // Non-destructive rename
                        stateToReturn.player.stats[stat.name] = stateToReturn.player.stats[existingKey];
                        delete stateToReturn.player.stats[existingKey];
                        stateChanged = true;
                    }
                    const clamped = clampToCeiling(stateToReturn.player.stats[stat.name]);
                    if (clamped !== stateToReturn.player.stats[stat.name]) {
                        stateToReturn.player.stats[stat.name] = clamped;
                        stateChanged = true;
                    }
                }
            }
        });
    }

    // Ensure recently_deleted exists
    if (!stateToReturn.recently_deleted) {
        stateToReturn.recently_deleted = {};
        stateChanged = true;
    }

    // The standing-decision lists from before they were scoped per character: collection
    // -> [names], where they are now actor -> collection -> [names]. Ignored on read ever
    // since, so they have been inert - but a chat file carrying a shape nothing
    // understands is a puzzle for whoever opens it next, including us.
    for (const key of ['dismissed', 'protected']) {
        const map = stateToReturn[key];
        if (map && typeof map === 'object' && Object.values(map).some(Array.isArray)) {
            delete stateToReturn[key];
            stateChanged = true;
        }
    }

    stateToReturn.characters.forEach(char => {
        if (!char.stats) {
            char.stats = {};
            stateChanged = true;
        }

        // Optimization: Use a map for existing stats lookup
        const charStatsLower = new Map(Object.keys(char.stats).map(k => [k.toLowerCase(), k]));

        // Ensure missing NPC stats from settings are added
        (settings.npcStats || []).forEach(stat => {
            if (stat && stat.name) {
                const lowerName = stat.name.toLowerCase();
                const existingKey = charStatsLower.get(lowerName);
                if (!existingKey) {
                    char.stats[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                    charStatsLower.set(lowerName, stat.name);
                    stateChanged = true;
                } else {
                    if (existingKey !== stat.name) {
                        // Non-destructive rename
                        char.stats[stat.name] = char.stats[existingKey];
                        delete char.stats[existingKey];
                        charStatsLower.delete(existingKey.toLowerCase());
                        charStatsLower.set(lowerName, stat.name);
                        stateChanged = true;
                    }
                    const clamped = clampToCeiling(char.stats[stat.name]);
                    if (clamped !== char.stats[stat.name]) {
                        char.stats[stat.name] = clamped;
                        stateChanged = true;
                    }
                }
            }
        });
    });

    // Cleanup hardcoded items from current state
    if (stateToReturn.player && stateToReturn.player.collections) {
        for (const colId in stateToReturn.player.collections) {
            const items = stateToReturn.player.collections[colId];
            if (Array.isArray(items)) {
                const settings = getSettings().statusTracker;
                const colDef = settings.collections.find(c => c.id === colId);
                const primaryField = colDef ? colDef.fields.find(f => f.isPrimary) : { name: 'name' };
                const primaryFieldName = primaryField ? primaryField.name : 'name';
                
                stateToReturn.player.collections[colId] = items.filter(item => {
                    const name = item[primaryFieldName];
                    if (typeof name === 'string' && /^new item \d+$/i.test(name)) {
                        debugLog('Removing hardcoded item from player collection:', name);
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    if (stateChanged) {
        debugLog('State repaired during load, saving back to metadata and master.');
        saveStateToMetadata(stateToReturn, { recordHistory: false });
        syncPlayerToMaster(stateToReturn);
        eventSource.emit('sillynpc-status-updated', stateToReturn);
    }

    return stateToReturn;
}

/**
 * Saves the current status to chat metadata
 */
/**
 * Commits a state to chat metadata, recording the state it replaces so it can be undone.
 *
 * History used to store the state that had just been written, which is the wrong
 * direction: restoring it would be a no-op. It now stores the *outgoing* state, so
 * popping an entry moves you back one step.
 *
 * @param {StatusState} state
 * @param {{ recordHistory?: boolean, label?: string }} [options]
 *   Pass recordHistory:false for writes that should not become undo points - schema
 *   repairs during load, and the undo operation itself (which would otherwise
 *   immediately re-record what it just reverted).
 */
export function saveStateToMetadata(state, options = {}) {
    const { recordHistory = true, label = 'Change' } = options;
    const metadata = getMetadata();
    if (!metadata) return;

    // Between chats, SillyTavern leaves the last chat's metadata object in place - a read
    // there hands back whichever story was open before, and a write lands in an object
    // that belongs to nothing and is about to be replaced. Neither is anything anyone
    // asked for, so the write is refused where it can still be said out loud.
    if (!hasOpenChat()) {
        console.warn(LOG_PREFIX, 'Refused to write tracker state with no chat open.');
        return;
    }

    // A state read from one chat must never be written into another. SillyTavern swaps
    // chat_metadata inside getChat() and only fires CHAT_CHANGED after the conversation
    // has been re-rendered, so anything holding a state across that gap is pointing at
    // the wrong file - and this is the write that loses work rather than merely showing
    // the wrong number. A state built fresh is unmarked and always allowed.
    const here = currentChatId();
    const origin = stateOrigin.get(state);
    if (origin !== undefined && origin !== here) {
        console.error(LOG_PREFIX,
            `Refused to write state from chat "${origin}" into "${here}".`);
        return;
    }
    stateOrigin.set(state, here);

    // The very first change in a chat has no committed predecessor in metadata yet -
    // the initial state exists only in the in-memory cache. Fall back to it so that
    // first change is undoable too.
    const previous = metadata[STATE_KEY] ?? committedState;
    if (recordHistory && previous) {
        if (!Array.isArray(metadata[HISTORY_KEY])) metadata[HISTORY_KEY] = [];
        const history = metadata[HISTORY_KEY];
        history.push({
            state: structuredClone(previous),
            timestamp: Date.now(),
            label,
        });
        const depth = Math.max(1, Number(getSettings().statusTracker?.historyDepth) || 10);
        while (history.length > depth) history.shift();
    }

    metadata[STATE_KEY] = state;
    committedState = state;
    committedChatId = currentChatId();

    getContext()?.saveMetadataDebounced?.();
}


function createInitialState() {
    const settings = getSettings().statusTracker;
    const state = {
        global: {},
        characters: [],
        player: {
            name: 'Player',
            stats: {},
            collections: {}
        },
        recently_deleted: {},
        timestamp: Date.now()
    };
    
    (settings.globalStats || []).forEach(stat => {
        if (stat && stat.name) {
            state.global[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
        }
    });

    (settings.playerStats || []).forEach(stat => {
        if (stat && stat.name) {
            state.player.stats[stat.name] = getInitialStatValue(stat.defaultValue, stat.maxStatValue);
        }
    });
    
    return state;
}


/**
 * Suffixes models use to address one half of a "cur/max" stat.
 * Order matters only in that longer suffixes must not be shadowed by shorter ones.
 */
const STAT_PART_SUFFIXES = {
    current: ['_current', '_cur', '_now', '_value', '_val'],
    max: ['_maximum', '_max', '_total', '_cap'],
};

/**
 * Splits "energy_current" into { base: 'energy', part: 'current' }.
 * A key with no recognised suffix comes back as { base: key, part: null }.
 *
 * @param {string} key
 * @returns {{ base: string, part: 'current'|'max'|null }}
 */
export function splitStatKeyPart(key) {
    const lower = String(key).toLowerCase();
    for (const [part, suffixes] of Object.entries(STAT_PART_SUFFIXES)) {
        for (const suffix of suffixes) {
            if (lower.length > suffix.length && lower.endsWith(suffix)) {
                return { base: String(key).slice(0, -suffix.length), part: /** @type {'current'|'max'} */ (part) };
            }
        }
    }
    return { base: String(key), part: null };
}

/**
 * Buckets incoming stat keys by the stat they actually address.
 *
 * Without this, "hp_current" and "hp_max" both resolved to HP and were applied one
 * after another, so the result depended on JSON key order - which no model guarantees.
 * Grouping first means both halves are combined once, deterministically.
 *
 * @param {Record<string, any>} sourceStats Raw stats object from the model.
 * @param {(key: string) => string|null} resolveBase Maps a bare name to a real stat key.
 * @param {(key: string) => boolean} isExactStat True if the key IS a configured stat.
 * @param {(key: string) => boolean} shouldSkip Keys to ignore entirely.
 * @returns {Map<string, { whole?: any, current?: any, max?: any }>}
 */
function groupIncomingStats(sourceStats, resolveBase, isExactStat, shouldSkip) {
    const groups = new Map();

    for (const updKey of Object.keys(sourceStats)) {
        if (shouldSkip(updKey)) continue;

        let actualKey = null;
        let part = null;

        // A stat genuinely named like the key (say a user stat called "HP Max") wins
        // over reading the key as a suffix.
        if (isExactStat(updKey)) {
            actualKey = resolveBase(updKey) || updKey;
        } else {
            const split = splitStatKeyPart(updKey);
            if (split.part) {
                const baseMatch = resolveBase(split.base);
                if (baseMatch) { actualKey = baseMatch; part = split.part; }
            }
            if (!actualKey) actualKey = resolveBase(updKey);
        }

        if (!actualKey) {
            debugLog('Ignoring stat key that matches no configured stat:', updKey);
            continue;
        }

        const group = groups.get(actualKey) || {};
        if (part) group[part] = sourceStats[updKey];
        else group.whole = sourceStats[updKey];
        groups.set(actualKey, group);
    }

    return groups;
}

/**
 * Folds a grouped update into a stat's existing value.
 *
 * @param {any} existingValue
 * @param {{ whole?: any, current?: any, max?: any }} group
 * @param {object} statDef
 * @returns {any}
 */
/** The values a field is allowed to hold, or an empty list when it allows anything. */
export function allowedValues(def) {
    return (def?.options || [])
        .map(value => String(value ?? '').trim())
        .filter(Boolean);
}

/**
 * Holds a field to the values it is allowed to have.
 *
 * A field with no options allows anything, which is every field until somebody says
 * otherwise. With options, a value that is not on the list is refused and whatever was
 * there stays - the point of declaring a vocabulary is that the extractor cannot quietly
 * widen it, and inventing a synonym every few messages is exactly what it does otherwise.
 *
 * Matching is exact after trimming. "healthy" is refused rather than corrected to
 * "Healthy": a list of allowed values is also a list of allowed spellings, and silently
 * rewriting one is how the sheet and the story start disagreeing about what it says.
 *
 * Refusing means keeping what is there, so a value stored before the list was narrowed
 * survives untouched. Narrowing a list in the builder must not rewrite characters nobody
 * was looking at - the same rule renaming a field follows.
 *
 * @param {object} def The stat or field definition.
 * @param {*} incoming What is being written.
 * @param {*} existing What is there now.
 * @returns {*} The value to store.
 */
export function constrainToOptions(def, incoming, existing) {
    const allowed = allowedValues(def);
    if (!allowed.length) return incoming;

    const wanted = String(incoming ?? '').trim();
    // Clearing a field is always allowed: empty means "use the default" on a card, and
    // refusing it would make a value impossible to take back.
    if (!wanted) return incoming;
    if (allowed.includes(wanted)) return incoming;

    debugLog(`"${wanted}" is not an allowed value for ${def?.name || 'this field'} `
        + `(${allowed.join(', ')}); kept "${existing ?? ''}"`);
    return existing;
}

/**
 * Cuts a value down to the field's length, if it has one.
 *
 * At a word boundary, and marked. A value cut mid-word reads as corruption rather than as
 * a limit doing its job, and an unmarked one reads as the reader's own wording - which
 * matters here because the value goes back to the reader next turn as the current state.
 *
 * @param {object} def The stat or field definition.
 * @param {*} value
 * @returns {*} Unchanged when there is no limit, or none is needed.
 */
export function capToLength(def, value) {
    const limit = Number(def?.maxLength);
    if (!Number.isFinite(limit) || limit <= 0) return value;

    const text = String(value ?? '');
    if (text.length <= limit) return value;

    const cut = text.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    // Only back off to a word boundary when there is a reasonable amount of it left;
    // one very long word would otherwise cut down to nothing.
    const body = (lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();

    debugLog(`"${def?.name || 'field'}" trimmed from ${text.length} to ${limit} characters`);
    return `${body}…`;
}

/**
 * Every rule a field's definition places on an incoming value.
 *
 * One function because there is one choke point - world stats, player stats, character
 * stats and collection fields all pass through here - and two rules that both have to
 * hold. It is not called constrainToOptions any more because it no longer only does that,
 * and a name that describes half of what a function does is worse than a longer one.
 *
 * @param {object} def
 * @param {*} incoming
 * @param {*} existing
 * @returns {*}
 */
export function constrainToDefinition(def, incoming, existing) {
    const kept = constrainToOptions(def, incoming, existing);
    // Only ever cut what was actually written. When the options guard refuses a value it
    // hands back the one already stored, and trimming that would rewrite something nobody
    // submitted - the same rule that stops narrowing a list rewriting characters nobody
    // was looking at.
    if (kept !== incoming) return kept;
    return capToLength(def, kept);
}

function combineStatValue(existingValue, group, statDef, options = {}) {
    let value = existingValue;
    if (group.whole !== undefined) {
        value = mergeStatValue(value, group.whole, options);
    }
    if (group.current === undefined && group.max === undefined) return value;

    const parts = splitValue(value);
    let current = parts.current;
    /* The value's own denominator, and nothing else. The configured maximum used to stand
       in for it, which meant a stat that had been given a ceiling in play could never lose
       one: clear the "/120" and the setting handed it straight back. The setting seeds the
       first value and says nothing after that. */
    let max = parts.max || '';

    if (group.current !== undefined) current = String(group.current).trim();
    // A raised ceiling is a change like any other, so it is visible in the diff and can be
    // held for review rather than being forbidden outright - growth is legitimate, and it
    // should be something you agreed to rather than something that happened.
    if (group.max !== undefined) max = String(group.max).trim();

    return max ? clampToCeiling(`${current}/${max}`) : current;
}

/**
 * Finds the most likely existing key for a given stat name, handling synonyms.
 */
export function findMatchingStatKey(existingStats, searchKey) {
    const keys = Object.keys(existingStats);
    const searchLower = searchKey.toLowerCase();
    
    // 1. Exact match
    const exact = keys.find(k => k.toLowerCase() === searchLower);
    if (exact) return exact;
    
    // 2. Synonym match
    for (const [canonical, synonyms] of Object.entries(STAT_SYNONYMS)) {
        if (searchLower === canonical || synonyms.includes(searchLower)) {
            // Check if any of our existing keys are in this synonym group
            const match = keys.find(k => {
                const kLower = k.toLowerCase();
                return kLower === canonical || synonyms.includes(kLower);
            });
            if (match) return match;
        }
    }
    
    // 3. Fuzzy prefix match (e.g. "hp_current" matches "hp")
    const prefixMatch = keys.find(k => {
        const kLower = k.toLowerCase();
        return searchLower.startsWith(kLower) || kLower.startsWith(searchLower);
    });
    if (prefixMatch) return prefixMatch;

    return null;
}

/**
 * Merges an update into the current state.
 *
 * @param {object} update
 * @param {{ dryRun?: boolean, label?: string, verbatim?: boolean }} [options]
 *   dryRun returns the resulting state without saving, syncing or emitting, so callers
 *   can diff what an update *would* do before letting it happen.
 *   verbatim says the values are whole values rather than readings of part of one, which
 *   is what a person typing into a field submits - see mergeStatValue.
 * @returns {StatusState} The resulting state.
 */
export function applyUpdate(update, options = {}) {
    // allowReplace is off unless the caller asks: a per-message reply is a delta, and a
    // list in it is a mistake rather than an instruction to empty anything. The history
    // scan, which reads the whole story to produce a corrected list, passes it.
    const { dryRun = false, label = 'AI update', admitCharacters = false, allowReplace = false,
        partOfMessage = false, verbatim = false } = options;
    /* Refused here rather than at the end, because this function writes to two places and
       only one of them was guarded. Character cards live in settings, not in the cloned
       state, so the card writes below - and their saveSettings - happen before
       saveStateToMetadata is ever reached; if that write is then refused, the cards are
       left holding stats from a state that was never committed.
       Only the no-chat case can fire for this function: the cross-chat guard tests the
       state's recorded origin, and the clone below is fresh and unmarked. */
    if (!dryRun && !hasOpenChat()) {
        console.warn(LOG_PREFIX, 'Refused to apply a tracker update with no chat open.');
        return null;
    }

    // Findings for characters with nowhere to keep them, reported rather than dropped.
    const offstageSkipped = [];
    const state = structuredClone(committedState || loadStateFromMetadata());
    let statedPlayerCollections = false;
    
    // Decrement tombstones whenever a new update is processed (likely a new AI message)
    if (state.recently_deleted) {
        for (const colId in state.recently_deleted) {
            const items = state.recently_deleted[colId];
            for (const itemName in items) {
                if (--items[itemName] <= 0) delete items[itemName];
            }
            if (Object.keys(items).length === 0) delete state.recently_deleted[colId];
        }
    }

    const settings = getSettings().statusTracker;
    
    const bindingStat = settings.sceneBindingStat;
    let oldBindingValue = null;
    if (bindingStat) {
        oldBindingValue = state.global[bindingStat] !== undefined ? state.global[bindingStat] : '';
    }
    
    const validGlobalKeys = new Set(settings.globalStats.map(s => s.name.toLowerCase()));

    if (update.global) {
        Object.keys(update.global).forEach(updKey => {
            const actualKey = Object.keys(state.global).find(k => k.toLowerCase() === updKey.toLowerCase()) || updKey;
            if (validGlobalKeys.has(actualKey.toLowerCase())) {
                const statDef = settings.globalStats.find(s => s.name.toLowerCase() === actualKey.toLowerCase());
                const merged = mergeStatValue(state.global[actualKey], update.global[updKey], { verbatim });
                state.global[actualKey] = constrainToDefinition(statDef, merged, state.global[actualKey]);
            }
        });
    }
    
    let newBindingValue = null;
    if (bindingStat) {
        newBindingValue = state.global[bindingStat] !== undefined ? state.global[bindingStat] : '';
    }

    // Apply Player updates
    if (update.player) {
        debugLog('Applying player update:', update.player);
        const validPlayerKeys = new Set(settings.playerStats.map(s => s.name.toLowerCase()));
        const collectionIds = new Set(settings.collections.map(c => c.id.toLowerCase()));

        const sourceStats = update.player.stats || update.player;

        // Group first so "energy_current" and "energy_max" combine into a single
        // value instead of overwriting each other in whatever order the model emitted.
        const playerGroups = groupIncomingStats(
            sourceStats,
            (name) => {
                const matched = findMatchingStatKey(state.player.stats, name) || name;
                return validPlayerKeys.has(matched.toLowerCase()) ? matched : null;
            },
            (key) => validPlayerKeys.has(key.toLowerCase()),
            (key) => {
                const lower = key.toLowerCase();
                return lower === 'name' || lower === 'stats' || lower === 'collections'
                    || collectionIds.has(lower);
            },
        );

        for (const [actualKey, group] of playerGroups) {
            const statDef = settings.playerStats.find(s => s.name.toLowerCase() === actualKey.toLowerCase());
            const merged = combineStatValue(state.player.stats[actualKey], group, statDef, { verbatim });
            state.player.stats[actualKey] = constrainToDefinition(statDef, merged, state.player.stats[actualKey]);
        }

        // Look for collections both in .collections and at top level
        const collectionsToProcess = { ...(update.player.collections || {}) };
        Object.keys(update.player).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (collectionIds.has(lowerKey) && lowerKey !== 'stats' && lowerKey !== 'collections' && lowerKey !== 'name') {
                debugLog(`Found flattened collection "${key}" in player update`);
                collectionsToProcess[key] = update.player[key];
            }
        });

        Object.keys(collectionsToProcess).forEach(colId => {
            applyCollectionUpdate(state.player, colId, collectionsToProcess[colId], { allowReplace });
        });
        // Only an update that named the player's collections is allowed to shrink the
        // stored copy. Everything else merges, so a stats-only turn cannot empty them.
        statedPlayerCollections = Object.keys(collectionsToProcess).length > 0;
    }
    
    if (update.characters && Array.isArray(update.characters)) {
        // AI provided a list of characters.
        // We will update existing characters or add new ones. We do NOT remove existing characters.
        let hasOverridesUpdates = false;
        const validCharKeys = new Set(settings.npcStats.map(s => s.name.toLowerCase()));
        const collectionIds = new Set(settings.collections.map(c => c.id.toLowerCase()));

        // Create lookup maps for performance (Step 3: Reduce Redundant Logic)
        const stateCharMap = new Map(
            state.characters
                .filter(c => c && typeof c.name === 'string')
                .map(c => [c.name.toLowerCase(), c])
);
        const settingsChars = getSettings().characters;
        const settingsCharMap = new Map();
        const settingsCharRegexList = [];
        
        settingsChars.forEach(c => {
            if (c.name) settingsCharMap.set(c.name.toLowerCase(), c);
            if (c.aliases) {
                c.aliases.forEach(a => {
                    if (a.isRegex) {
                        try { settingsCharRegexList.push({ regex: new RegExp(a.pattern, 'i'), char: c }); } catch { /* skip invalid regex */ }
                    } else if (a.pattern) {
                        settingsCharMap.set(a.pattern.toLowerCase(), c);
                    }
                });
            }
        });

        update.characters.forEach(updChar => {
            if (!updChar.name) return;
            // Through the alias map first. The narrator calls the same person different
            // things from line to line, and matching the raw name meant an update
            // addressed to an alias found nobody - then, in speakers mode, was dropped
            // as an invented character rather than applied to the character it named.
            const canonicalUpdName = resolveCanonicalName(updChar.name);
            const lowerUpdName = canonicalUpdName.toLowerCase();
            debugLog(`Applying update for character: ${updChar.name}`, updChar);
            
        // Find existing data for this character to preserve any stats not mentioned in the update
        let charData = stateCharMap.get(lowerUpdName);
        
        // Find character definition in settings
        let matchedChar = settingsCharMap.get(lowerUpdName) || settingsCharRegexList.find(r => r.regex.test(updChar.name))?.char;

        // In 'speakers' mode presence is decided by what appeared in the message, so a
        // character the model invents in its JSON must not silently join the scene.
        //
        if (!charData && settings.castMode === 'speakers' && !admitCharacters) {
            debugLog('Ignoring character not present in the message:', updChar.name);
            return;
        }

        // A history scan is the deliberate exception: it reads the whole story, and
        // almost everyone it has something to say about is off stage. Their card can
        // still be brought up to date - but they must not walk onto the stage to do it.
        // Admitting them to state.characters *is* joining the scene, which is how one
        // scan filled the tracker bar with the entire cast of the story.
        if (!charData && admitCharacters) {
            if (!matchedChar) {
                // Nowhere to keep it. Counted rather than dropped in silence.
                offstageSkipped.push(updChar.name);
                return;
            }
            const detached = updateCardOffstage(matchedChar, updChar, state, settings, { dryRun, allowReplace });
            // A dry run works on a throwaway clone, and the review panel can only show a
            // row for something the diff can see. Putting them in the clone gives the
            // panel its rows; the real apply above went to the card, so the scene itself
            // is untouched.
            if (dryRun && detached) state.characters.push(detached);
            return;
        }

        if (!charData) {
            // The third way into the cast, and the last one this guard was missing: an
            // update naming somebody who is not here yet builds them a row.
            if (!mayJoinScene(canonicalUpdName)) return;
            // The same construction the scene cast uses. It was written out again here,
            // which is why a character walking back on stage came back with their stats
            // restored from their card but none of their belongings - the two copies had
            // drifted, and only one of them knew about collections.
            charData = buildCharacterState(canonicalUpdName, state, settings);
            state.characters.push(charData);
            stateCharMap.set(lowerUpdName, charData);
        }
            
            if (bindingStat) {
                charData.boundTo = newBindingValue !== null ? newBindingValue : '';
            }
            
            const sourceStats = updChar.stats || updChar;

            const charGroups = groupIncomingStats(
                sourceStats,
                (name) => {
                    const matched = findMatchingStatKey(charData.stats, name) || name;
                    return validCharKeys.has(matched.toLowerCase()) ? matched : null;
                },
                (key) => validCharKeys.has(key.toLowerCase()),
                (key) => {
                    const lower = key.toLowerCase();
                    return lower === 'name' || lower === 'stats' || lower === 'boundto'
                        || lower === 'collections' || collectionIds.has(lower);
                },
            );

            for (const [canonicalKey, group] of charGroups) {
                const statDef = settings.npcStats.find(s => s.name.toLowerCase() === canonicalKey.toLowerCase());
                const merged = combineStatValue(charData.stats[canonicalKey], group, statDef, { verbatim });
                charData.stats[canonicalKey] = constrainToDefinition(statDef, merged, charData.stats[canonicalKey]);

                // The card object lives in settings, not in the cloned state, so a dry
                // run must not touch it at all - skipping the save would still leave the
                // mutation in memory for the next unrelated save to persist.
                if (matchedChar && !dryRun) {
                    if (!matchedChar.statusOverrides) matchedChar.statusOverrides = {};
                    // Record the combined result rather than the raw fragment, so a card
                    // override is never left holding just a "_max" half.
                    matchedChar.statusOverrides[canonicalKey] = charData.stats[canonicalKey];
                    hasOverridesUpdates = true;
                }
            }

            // Look for collections both in .collections and at top level
            const collectionsToProcess = { ...(updChar.collections || {}) };
            Object.keys(updChar).forEach(key => {
                const lowerKey = key.toLowerCase();
                if (collectionIds.has(lowerKey) && lowerKey !== 'stats' && lowerKey !== 'collections' && lowerKey !== 'name') {
                    debugLog(`Found flattened collection "${key}" in character update for ${updChar.name}`);
                    collectionsToProcess[key] = updChar[key];
                }
            });

            Object.keys(collectionsToProcess).forEach(colId => {
                applyCollectionUpdate(charData, colId, collectionsToProcess[colId], { allowReplace });
            });

            // Keep them on the card too, so what this character carries and knows
            // outlives their time on stage. Same reasoning as statusOverrides above, and
            // the same dry-run rule: the card lives in settings, not in the cloned state.
            if (matchedChar && !dryRun && Object.keys(collectionsToProcess).length) {
                matchedChar.statusCollections = structuredClone(charData.collections || {});
                hasOverridesUpdates = true;
            }
        });

        if (hasOverridesUpdates) {
            saveSettings();
        }
    }
    
    // Scene binding is the *other* way of deciding who left. Running both would give
    // two authorities over the same list, so it only applies in 'ai' cast mode.
    if (settings.castMode !== 'speakers'
        && bindingStat && oldBindingValue !== null && newBindingValue !== null
        && oldBindingValue !== newBindingValue) {
        state.characters = state.characters.filter(char => char.boundTo === newBindingValue);
    }
    
    state.timestamp = Date.now();

    // Hung off the returned state so a caller can report what it could not place,
    // without changing the shape every other caller reads.
    if (offstageSkipped.length) {
        Object.defineProperty(state, 'offstageSkipped', {
            value: offstageSkipped, enumerable: false, configurable: true,
        });
    }

    if (dryRun) return state;

    saveStateToMetadata(state, { label, partOfMessage });
    syncPlayerToMaster(state, { authoritative: statedPlayerCollections });
    eventSource.emit('sillynpc-status-updated', state);
    return state;
}

/**
 * The character card a name belongs to: the card's own name first, then its aliases.
 *
 * @param {string} name
 * @returns {object|null}
 */
export function findCardForName(name) {
    if (!name) return null;
    const lower = String(name).trim().toLowerCase();
    const cards = getSettings().characters || [];

    const byName = cards.find(c => (c.name || '').toLowerCase() === lower);
    if (byName) return byName;

    for (const card of cards) {
        for (const alias of card.aliases || []) {
            if (!alias?.pattern) continue;
            if (alias.isRegex) {
                try { if (new RegExp(alias.pattern, 'i').test(name)) return card; } catch { /* invalid regex */ }
            } else if (alias.pattern.trim().toLowerCase() === lower) {
                return card;
            }
        }
    }
    return null;
}

/**
 * The name a character should be stored under.
 *
 * Aliases collapse onto the card's own name, so a character the narrator calls
 * "Instructor Kovacs" in one line and "Mr. Kovacs" in the next is one row in the cast
 * rather than two. A name with no card is its own canonical form - unknown characters
 * are tracked too, and there is nothing to collapse them onto.
 *
 * @param {string} name
 * @returns {string}
 */
export function resolveCanonicalName(name) {
    return findCardForName(name)?.name || String(name ?? '').trim();
}

/** This name is you. You are the player, and the player is not one of the cast. */
export const CAST_PERSONA = 'persona';

/**
 * Standing decisions about who is not an NPC in this chat.
 *
 * Kept in the chat rather than the settings, beside the item rules, and for the same
 * reason: "Alex is me" is true in this story, and another chat may have a real
 * character of that name. The extension cannot tell the two apart - which is why this is
 * a decision somebody makes rather than a name match - so it must not carry one chat's
 * answer into another.
 *
 * One map, name to reason, rather than two lists. Both reasons keep the name out of the
 * cast; recording which one it was is what lets the panel say why, and lets "this is me"
 * come to mean more later without every entry being re-decided.
 *
 * @returns {Record<string, 'persona'|'excluded'>} Keyed by lowercased canonical name.
 */
export function getCastDecisions() {
    try {
        const map = loadStateFromMetadata()?.castDecisions;
        return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch {
        return {};
    }
}


/**
 * Your own portrait, for a speaker label you have said is you.
 *
 * "This is me" kept the name out of the cast and stopped there, so the chat still drew the
 * same blank stand-in it gives any name it has never heard of - which reads as the decision
 * having been ignored. The persona has a picture and a sheet already; this is what lets a
 * line the model wrote as "Alex:" use them.
 *
 * Deliberately outranks a card of the same name, as the decision does everywhere else: it
 * was made about this name, in this chat, by you.
 *
 * @param {string} name The speaker label as it was written.
 * @returns {{ name: string, imageUrl: string } | null} Null when this is not you.
 */
export function resolvePersonaSpeaker(name) {
    // No blank-name guard here: a nameless speaker
    // has no decision to find and falls out here like anybody else undecided.
    const canonical = resolveCanonicalName(name);
    if (getCastDecisions()[canonical.toLowerCase()] !== CAST_PERSONA) return null;

    const persona = resolvePersonaAvatarAndName();
    // The player's own portrait wins, since that is the face they made for this character.
    // The persona picture stays as the fallback here rather than the blank the sheet
    // shows: a line in the chat needs something beside it either way.
    return {
        name: persona.name,
        imageUrl: getPlayerImageUrl() || getUserAvatar(persona.avatar),
    };
}

/**
 * Whether this name is allowed to be a character in this chat.
 *
 * The one gate every admission goes through. There are three ways into the cast - the
 * chat decorator, the extractor, and an update that names somebody new - and they used to
 * disagree: the Not Speakers list guarded only the first, so a label you had excluded was
 * still reported into the scene by the second. Asking one question in one place is what
 * stops them drifting apart again.
 *
 * A card always wins, as it does for speaker detection: somebody genuinely called "Guide"
 * is not silenced by "guide" being on a list of things that are not people. A decision
 * made here is not overridden that way, because it was made about this character.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function mayJoinScene(name) {
    const canonical = resolveCanonicalName(name);
    if (!canonical) return false;
    if (getCastDecisions()[canonical.toLowerCase()]) return false;

    // Only for names nobody has made a card for.
    if (findCardForName(canonical)) return true;
    return !getIgnoredSpeakerLabels().has(normaliseSpeakerLabel(canonical));
}


/**
 * Builds a fresh character state seeded from the NPC schema and any card overrides.
 * Used by presence reconciliation.
 */
/**
 * Brings a character's card up to date while they are elsewhere.
 *
 * The scene cast and the record of what a character owns used to be the same list, so
 * the only way to update someone was to put them in the room. This writes to the card
 * instead: buildCharacterState reads it back the moment they next appear, so nothing is
 * lost and nobody is teleported into a scene they are not in.
 *
 * @param {object} card The character card from settings.
 * @param {object} updChar The character's portion of the update.
 * @param {object} state Current state, read for defaults only.
 * @param {object} settings Tracker settings.
 * @param {{dryRun?: boolean}} options
 */
function updateCardOffstage(card, updChar, state, settings, { dryRun = false, allowReplace = false } = {}) {
    // A detached actor: built the same way the cast builds one, so it starts from what
    // the card already knows rather than from nothing.
    const actor = buildCharacterState(card.name, state, settings);

    const validKeys = new Set((settings.npcStats || []).map(s => s.name.toLowerCase()));
    const sourceStats = updChar.stats || {};
    for (const [key, value] of Object.entries(sourceStats)) {
        const matched = findMatchingStatKey(actor.stats, key) || key;
        if (!validKeys.has(matched.toLowerCase())) continue;
        actor.stats[matched] = String(value);
    }

    const collectionIds = new Set((settings.collections || []).map(c => c.id.toLowerCase()));
    const collectionsToProcess = { ...(updChar.collections || {}) };
    for (const key of Object.keys(updChar)) {
        const lower = key.toLowerCase();
        if (collectionIds.has(lower) && lower !== 'stats' && lower !== 'collections' && lower !== 'name') {
            collectionsToProcess[key] = updChar[key];
        }
    }
    for (const colId of Object.keys(collectionsToProcess)) {
        applyCollectionUpdate(actor, colId, collectionsToProcess[colId], { allowReplace });
    }

    if (dryRun) return actor;

    card.statusOverrides = { ...(card.statusOverrides || {}), ...actor.stats };
    if (Object.keys(collectionsToProcess).length) {
        card.statusCollections = structuredClone(actor.collections || {});
    }
    saveSettings();
    debugLog(`Updated ${card.name} on their card without adding them to the scene`);
    return actor;
}

function buildCharacterState(charName, state, trackerSettings) {
    const charData = { name: charName, stats: {}, collections: {} };
    if (trackerSettings.sceneBindingStat) {
        charData.boundTo = state.global[trackerSettings.sceneBindingStat] ?? '';
    }
    const matchedChar = (getSettings().characters || [])
        .find(c => (c.name || '').toLowerCase() === charName.toLowerCase());

    (trackerSettings.npcStats || []).forEach(stat => {
        let value = stat.defaultValue || '';
        const override = matchedChar?.statusOverrides?.[stat.name];
        if (override !== undefined && String(override).trim() !== '') value = override;
        charData.stats[stat.name] = getInitialStatValue(value, resolveMaxValue(stat));
    });

    // What they were carrying and knew last time they were on stage.
    //
    // The scene cast is the only place a character's collections used to live, and
    // leaving the scene deleted the entry - so an NPC's spells and inventory survived
    // exactly as long as they were in the room. Their card keeps them now, the same way
    // it already keeps their stats.
    if (matchedChar?.statusCollections) {
        charData.collections = structuredClone(matchedChar.statusCollections);
    }
    return charData;
}


/**
 * Logic to handle collection updates (add, remove, update)
 * @param {ActorState} actor 
 * @param {string} collectionId 
 * @param {Object} update 
 */
/**
 * An item with every configured field present, defaulted and of the right type.
 *
 * This lived inside the full-replace branch only, so an item arriving through the
 * normal delta path - which is every item the per-message extractor adds - kept
 * whatever the model sent and never gained the fields it did not mention. A new item
 * therefore turned up holding little more than a name, with a quantity of "3" stored
 * as text beside another stored as a number.
 *
 * Fields the message did not state are filled from the schema default rather than
 * guessed: a blank is an honest record that the story never said so.
 *
 * @param {object} itemData Raw item from a reply, or from the master database.
 * @param {Array<object>} fields The collection's configured fields.
 * @returns {object}
 */
/**
 * One item, with every field the schema declares, typed and within its allowed values.
 *
 * `previous` is the item as it stands, when there is one. Without it a value already
 * stored off-list would be refused on every later write - narrowing a list in the builder
 * would then rewrite items nobody was editing, which is exactly what keeping the old value
 * is meant to prevent.
 */
function normaliseItem(itemData, fields, previous = null) {
    const out = {};
    for (const fieldDef of fields || []) {
        let val = constrainToDefinition(fieldDef, itemData?.[fieldDef.name], previous?.[fieldDef.name]);

        if (val === undefined || val === null) {
            val = fieldDef.defaultValue !== undefined && fieldDef.defaultValue !== ''
                ? fieldDef.defaultValue
                : (fieldDef.type === 'number' ? 0 : (fieldDef.type === 'boolean' ? false : ''));
        }

        if (fieldDef.type === 'number') {
            out[fieldDef.name] = parseFloat(val) || 0;
        } else if (fieldDef.type === 'boolean') {
            out[fieldDef.name] = (val === true || val === 'true');
        } else {
            out[fieldDef.name] = String(val);
        }
    }
    return out;
}
function applyCollectionUpdate(actor, collectionId, update, { allowReplace = false } = {}) {
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id.toLowerCase() === collectionId.toLowerCase());
    
    // Validate collection exists
    if (!colDef) {
        console.warn(LOG_PREFIX, `Attempted to update non-existent collection: ${collectionId}`);
        return;
    }

    const actualCollectionId = colDef.id;

    // Validate target
    const isPlayer = actor.name === getCurrentPersonaName(); // Simple check for player
    if (isPlayer && colDef.target === 'npc') {
        debugLog(`Blocked collection update: ${collectionId} is NPC-only, but target is player.`);
        return;
    }
    if (!isPlayer && colDef.target === 'player') {
        debugLog(`Blocked collection update: ${collectionId} is player-only, but target is NPC (${actor.name}).`);
        return;
    }

    if (!actor.collections) actor.collections = {};
    
    // A bare array used to mean "this is everything" whatever asked for it, so a reply
    // that listed items instead of reporting changes emptied the collection and rebuilt
    // it from that list - deleting everything the reply happened not to restate. The
    // system prompt asks for {add, remove} and says omission is not removal; a small
    // model disobeys anyway, and the code has to survive that.
    //
    // Replacement is still right for the history scan, which reads the whole story to
    // produce a corrected list and puts it through the review panel. It is never right
    // for a single message, so the caller has to say so.
    // An explicit replacement: code that rebuilt the list itself and means it. Said in
    // the data rather than through an option on the call, because the flag had to be
    // remembered by every caller of buildUpdateFromChanges and three of the four forgot -
    // so an accepted removal was read as a list of additions and the item never left.
    if (update && !Array.isArray(update) && Array.isArray(update.replace)) {
        return applyCollectionUpdate(actor, collectionId, update.replace, { allowReplace: true });
    }

    if (Array.isArray(update) && !allowReplace) {
        debugLog(`Collection "${actualCollectionId}" arrived as a list; treating it as additions.`);
        return applyCollectionUpdate(actor, collectionId, { add: update }, { allowReplace });
    }
    // Handle Full State Sync (Array)
    if (Array.isArray(update)) {
        actor.collections[actualCollectionId] = [];
        const validFields = colDef.fields;
        const primaryField = validFields.find(f => f.isPrimary) || { name: 'name' };

        update.forEach(itemData => {
            if (!itemData || typeof itemData !== 'object') return;
            
            const itemName = itemData[primaryField.name] || itemData.name;
            if (!String(itemName ?? '').trim()) return;

            // Skip if recently deleted (tombstone)
            const lowerName = String(itemName).toLowerCase();
            const state = committedState || loadStateFromMetadata();
            if (state && state.recently_deleted && state.recently_deleted[actualCollectionId] && state.recently_deleted[actualCollectionId][lowerName]) {
                debugLog(`Skipping tombstoned item: ${itemName} in ${actualCollectionId}`);
                return;
            }

            // Master Database Merge Logic
            const masterItem = getMergedItem(actualCollectionId, itemData);

            actor.collections[actualCollectionId].push(normaliseItem(masterItem, validFields));
        });
        return;
    }

    if (!actor.collections[actualCollectionId]) actor.collections[actualCollectionId] = [];
    
    // Handle Delta Update (Object)
    /* "clear" is a replacement like any other, and is gated like one.
     *
     * It was not, which made it the one way past the care taken directly above: a bare list
     * is downgraded to additions unless the caller says otherwise, precisely because a small
     * model restating an inventory would otherwise delete everything it did not mention.
     * `clear` skipped all of that and emptied the collection outright. Nothing in the
     * extension sends it and no shipped prompt mentions it, so it was unreachable by design
     * and fully reachable by accident - a model emitting a plausible "clear": true.
     *
     * Kept rather than deleted because the history scan does legitimately rebuild a list,
     * and allowReplace is exactly the flag that says so. */
    if (update.clear === true) {
        if (!allowReplace) {
            debugLog(`Ignored "clear" on "${actualCollectionId}": a single message may not empty a collection.`);
            return;
        }
        actor.collections[actualCollectionId] = [];
        return;
    }

    // Handle "add"
    if (Array.isArray(update.add)) {
            for (const itemData of update.add) {
                const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
                const itemName = itemData[primaryField.name] || itemData.name;
                const lowerName = String(itemName).toLowerCase();
                const state = committedState || loadStateFromMetadata();
                
                if (state?.recently_deleted?.[actualCollectionId]?.[lowerName]) {
                    debugLog(`Skipping AI-added tombstoned item: ${itemName} in ${actualCollectionId}`);
                    continue;
                }
                addItem(actor, actualCollectionId, itemData);
            }
    }

    // Handle "remove"
    if (Array.isArray(update.remove)) {
        for (const itemName of update.remove) removeItem(actor, actualCollectionId, itemName);
    }

    // Handle "update"
    if (Array.isArray(update.update)) {
        for (const upd of update.update) {
            if (upd.name) updateItem(actor, actualCollectionId, upd.name, upd);
        }
    }
}

/**
 * Adds an item to an actor's collection.
 */
export function addItem(actor, collectionId, itemData) {
    if (!actor.collections) actor.collections = {};
    if (!actor.collections[collectionId]) actor.collections[collectionId] = [];
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const itemName = itemData[primaryField.name] !== undefined ? itemData[primaryField.name] : itemData.name;
    if (itemName === undefined || itemName === null) return;

    // Clear from recently_deleted if it was there
    const lowerName = String(itemName).toLowerCase();
    const state = committedState || loadStateFromMetadata();
    if (state && state.recently_deleted && state.recently_deleted[collectionId]) {
        if (state.recently_deleted[collectionId][lowerName]) {
            delete state.recently_deleted[collectionId][lowerName];
        }
    }

    const validFields = new Set(colDef.fields.map(f => f.name));

    // Filter fields to only allowed ones
    const filteredItem = { [primaryField.name]: itemName };
    Object.keys(itemData).forEach(key => {
        if (validFields.has(key)) {
            filteredItem[key] = itemData[key];
        }
    });

    // Find if item with same primary field value exists (case-insensitive)
    const existingIndex = actor.collections[collectionId].findIndex(i => String(i[primaryField.name]).toLowerCase() === String(itemName).toLowerCase());
    
    if (existingIndex !== -1) {
        const existing = actor.collections[collectionId][existingIndex];
        // Merge fields
        const merged = { ...existing, ...filteredItem };
        
        // Handle quantity merging if a numeric quantity field exists
        const qtyField = colDef.fields.find(f => f.type === 'number' && (f.name === 'quantity' || f.name === 'qty' || f.name === 'count'));
        if (qtyField) {
            const fieldName = qtyField.name;
            if (existing[fieldName] !== undefined && filteredItem[fieldName] !== undefined) {
                const q1 = parseFloat(existing[fieldName]) || 0;
                const q2 = parseFloat(filteredItem[fieldName]) || 0;
                // The same number that is already held is the model restating the state,
                // not the character acquiring a second lot. Summing it doubled the
                // quantity on every message that mentioned the item, compounding in
                // silence - and asked the review panel to confirm the same doubling over
                // and over.
                //
                // The two cannot be told apart from the delta alone, so this picks the
                // safer error: finding exactly two more rope while already holding two is
                // missed, which the story shows and a person can correct. The other way
                // round grows without bound and reads as the tracker inventing loot.
                //
                // Judged on the quantity alone rather than on the whole item: an add that
                // corrects some other field - a note, a description - is a real update,
                // and the quantity coming along with it unchanged must not be doubled for
                // having been mentioned.
                if (q1 !== q2) merged[fieldName] = q1 + q2;
            }
        }

        // Normalised like any other item: the merge could otherwise leave a quantity the
        // model sent as text sitting beside one already stored as a number.
        actor.collections[collectionId][existingIndex] = normaliseItem(merged, colDef.fields, existing);
    } else {
        // This branch filled in defaults but never enforced types, so an item added
        // through the delta path - which is every item the per-message extractor adds -
        // kept "4" as a string where the replace path would have stored 4.
        actor.collections[collectionId].push(normaliseItem(filteredItem, colDef.fields));
    }
}

/**
 * Removes an item from an actor's collection by name.
 */
export function removeItem(actor, collectionId, itemName, isManual = false) {
    if (!actor.collections || !actor.collections[collectionId] || !itemName) return;
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    const primaryField = colDef ? colDef.fields.find(f => f.isPrimary) : { name: 'name' };
    const primaryFieldName = primaryField ? primaryField.name : 'name';

    const lowerName = String(itemName).toLowerCase();
    actor.collections[collectionId] = actor.collections[collectionId].filter(i => String(i[primaryFieldName]).toLowerCase() !== lowerName);

    if (isManual) {
        const state = committedState || loadStateFromMetadata();
        if (state && state.recently_deleted) {
            if (!state.recently_deleted[collectionId]) state.recently_deleted[collectionId] = {};
            state.recently_deleted[collectionId][lowerName] = 3; // TTL 3 messages
        }
    }
}

/**
 * Updates an item in an actor's collection.
 */
function updateItem(actor, collectionId, itemName, updates) {
    if (!actor.collections || !actor.collections[collectionId] || !itemName) return;
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const primaryFieldName = primaryField.name;
    const validFields = new Set(colDef.fields.map(f => f.name));

    const lowerName = String(itemName).toLowerCase();
    const itemIndex = actor.collections[collectionId].findIndex(i => String(i[primaryFieldName]).toLowerCase() === lowerName);
    
    if (itemIndex !== -1) {
        const item = actor.collections[collectionId][itemIndex];

        const merged = { ...item };
        Object.keys(updates).forEach(key => {
            if (validFields.has(key)) merged[key] = updates[key];
        });

        /* Normalised like the add and replace paths, which this used to skip: writing
           straight through meant the field-name check was the only guard, so an update row
           could store "seven" in a number field and a value outside a configured options
           list. Both are reachable from an ordinary per-message reply.

           `item` as the previous value for the same reason addItem passes it: a value
           already stored off-list must not be refused on every later write. */
        actor.collections[collectionId][itemIndex] = normaliseItem(merged, colDef.fields, item);
    }
}


/**
 * Merges an AI-provided item with its Master Database entry if it exists.
 * If not, adds the item to the Master Database.
 */
function getMergedItem(collectionId, aiItem) {
    const settings = getSettings();
    const colDef = settings.statusTracker.collections.find(c => c.id === collectionId);
    if (!colDef) return aiItem;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const itemName = aiItem[primaryField.name] || aiItem.name;
    if (!itemName) return aiItem;

    const masterDb = settings.master_items || {};
    if (!masterDb[collectionId]) masterDb[collectionId] = {};
    
    const lowerName = String(itemName).toLowerCase();
    const masterEntry = masterDb[collectionId][lowerName];

    if (masterEntry) {
        const mergedItem = { ...aiItem };
        colDef.fields.forEach(field => {
            // Static fields come from Master DB if available
            if (isStaticField(field) && masterEntry[field.name] !== undefined) {
                mergedItem[field.name] = masterEntry[field.name];
            }
        });
        return mergedItem;
    } else {
        // Not found, add to master
        updateMasterItem(collectionId, itemName, aiItem);
        return aiItem;
    }
}

/**
 * Updates a single item in the Master Database.
 * Only saves fields marked as static.
 */
export function updateMasterItem(collectionId, itemName, itemData) {
    const settings = getSettings();
    if (!settings.master_items) settings.master_items = {};
    if (!settings.master_items[collectionId]) settings.master_items[collectionId] = {};

    const colDef = settings.statusTracker.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const staticData = {};
    colDef.fields.forEach(field => {
        if (isStaticField(field) && itemData[field.name] !== undefined) {
            staticData[field.name] = itemData[field.name];
        }
    });

    const lowerName = String(itemName).toLowerCase();
    settings.master_items[collectionId][lowerName] = staticData;
    saveSettings();
}

/**
 * Handles renaming an item in the Master Database.
 */
export function renameMasterItem(collectionId, oldName, newName, itemData) {
    const settings = getSettings();
    if (!settings.master_items || !settings.master_items[collectionId]) return;

    const oldLower = String(oldName).toLowerCase();
    const newLower = String(newName).toLowerCase();

    if (settings.master_items[collectionId][oldLower]) {
        delete settings.master_items[collectionId][oldLower];
    }
    
    updateMasterItem(collectionId, newName, itemData);
}


/**
 * Renames a stat, carrying its stored values and the settings that point at it.
 *
 * Stats are keyed by their name in five places, and the builder used to change only the
 * name in the schema. Everything else then failed to find the stat and filled it in at
 * its default - which is why renaming "HP" to "Health" showed 100 where 300/3000 had
 * been, and why the HUD stopped drawing it as a meter: a bare default has no ceiling, and
 * only a value with one can be a meter.
 *
 * Nothing deleted the old values. They stayed under the old key, unreachable, which is
 * the reason this can be repaired at all rather than only prevented.
 *
 * References are machine-written and are moved with the stat: the scene binding, and any
 * time rule whose scope points at this list. The display template is only rewritten when
 * the old name is unambiguous - if another stat list still has a stat by that name, a
 * {{HP}} in the template may well mean that one, and rewriting it would break a working
 * template to fix one that is not.
 *
 * @param {'globalStats'|'playerStats'|'npcStats'} listKey
 * @param {string} oldName
 * @param {string} newName
 * @returns {{ values: number, references: number, templateUpdated: boolean, cssMentions: boolean }}
 */
/**
 * The stored values a stat list still recognises.
 *
 * The schema lives in settings and the values live in the chat's metadata, and deleting a
 * stat in System Builder only removes it from the first. Nothing removed the value, and
 * four separate places read the stored object directly rather than the schema - the tracker
 * box, the scene block sent to the story model, the reader's prompt, and the sheet's
 * history - so a deleted stat kept being drawn and kept being sent on every message. It
 * could never change, because applyUpdate filters incoming values against the schema and
 * rejects anything it does not know; it was simply inert and permanent.
 *
 * So the schema is what decides, at every point that reads. The stored values are left
 * alone deliberately rather than deleted: they cost nothing once nobody reads them, and
 * erasing them would take a stat's history with it the moment somebody deletes one by
 * mistake - or the moment a System Profile switch changes the schema under a chat.
 *
 * Case-insensitively, because a stored key and a configured name differ in case often
 * enough that findMatchingStatKey and the player sheet both already allow for it.
 *
 * @param {Record<string, any>} stored The stats as the chat holds them.
 * @param {'globalStats'|'playerStats'|'npcStats'} listKey
 * @returns {Record<string, any>} A copy holding only what the schema still declares.
 */
export function statsInSystem(stored, listKey) {
    if (!stored || typeof stored !== 'object') return {};
    const declared = new Set(
        (getSettings().statusTracker?.[listKey] || [])
            .map(stat => String(stat?.name ?? '').trim().toLowerCase())
            .filter(Boolean));

    const out = {};
    for (const [key, value] of Object.entries(stored)) {
        if (declared.has(String(key).trim().toLowerCase())) out[key] = value;
    }
    return out;
}


/**
 * What a system deliberately does NOT carry.
 *
 * Stated as an exclusion rather than a list of what to keep. A system used to capture
 * thirteen named keys, which meant every setting added afterwards was silently left
 * global - Time Rules, the clock, review thresholds, the lore and portrait prompts and
 * the lorebook selections all followed you from one ruleset into the next. An allow-list
 * falls behind by default; this way a new setting travels unless somebody decides it
 * should not.
 *
 * The line is your world versus your machine: everything about the fiction belongs to the
 * system, and the connections that do the work belong to you.
 */
const SYSTEM_EXCLUDED_ROOT = new Set([
    // Carried separately, as the world.
    'characters', 'personaData', 'master_items',
    // The library itself, and which system is open.
    'statusTracker', 'activeSystem', 'version', 'enabled',
    // Which provider makes images and where the files land: accounts and disk.
    'imageBackend', 'geminiImageModel', 'imageSaveRoute',
    'loreProfileId', 'imageProfileId', 'combatProfileId', 'internalStatesProfileId', 'bondProfileId', 'vitalsProfileId', 'inventoryProfileId', 'knivesProfileId', 'activitiesProfileId',
    // Custom combat world types are a library, like the systems themselves: shared by all of them.
    'combatTypes', 'combatAbilities',
    // Your window, not your world.
    'popupWidth', 'popupHeight',
]);

const SYSTEM_EXCLUDED_TRACKER = new Set([
    // The library lives inside statusTracker; a system must never contain itself.
    'presets',
    // Which connection reads, what it is capable of, and what it is allowed to spend.
    'extractionProfileId', 'scanProfileId',
    // How often to checkpoint is a habit, not a property of a ruleset.
    'systemAutoSaveMinutes', 'systemCheckpointsKept',
    'extractionMaxTokens', 'scanMaxTokens', 'extractionUseSchema',
    // Whether the tracker runs at all is not a property of a ruleset.
    'enabled',
]);

/** A deep copy of everything except the named keys. */
function copyExcept(source, excluded) {
    const out = {};
    for (const [key, value] of Object.entries(source || {})) {
        if (excluded.has(key)) continue;
        out[key] = structuredClone(value);
    }
    return out;
}

/** Writes a captured block back, skipping anything that block is not allowed to set. */
function assignExcept(target, source, excluded) {
    for (const [key, value] of Object.entries(source || {})) {
        if (excluded.has(key)) continue;
        target[key] = structuredClone(value);
    }
}

/**
 * The part of a system that is not configuration: who exists in it, what they carry, and
 * the player's records.
 *
 * A ruleset without its cast is only half a system. Changing from one to another used to
 * keep every character, the whole item library and the player's stats from the last one,
 * none of which fit - so the choice was to lose the work or live with the mismatch.
 */
function captureWorld(settings) {
    return {
        characters: structuredClone(settings.characters || []),
        personaData: structuredClone(settings.personaData || {}),
        master_items: structuredClone(settings.master_items || {}),
    };
}

/** @param {object|undefined} world Absent on any profile saved before systems carried one. */
function restoreWorld(settings, world) {
    if (!world) return false;
    // Emptied and refilled rather than reassigned: chat.js caches the character list by
    // identity, and replacing the reference would leave it holding the old system's cast.
    const characters = settings.characters;
    characters.splice(0, characters.length, ...structuredClone(world.characters || []));
    settings.personaData = structuredClone(world.personaData || {});
    settings.master_items = structuredClone(world.master_items || {});
    return true;
}

/** Writes the active system back to its slot. Always called before switching away. */
function captureActiveSystem() {
    const settings = getSettings();
    const active = settings.activeSystem;
    const existing = settings.statusTracker.presets?.[active];
    if (!active || !existing) return false;
    saveSystemPreset(active,
        existing.metadata?.description ?? '', existing.metadata?.author ?? 'User');
    return true;
}

/** The system currently in use. */
export function getActiveSystem() {
    return getSettings().activeSystem || '';
}

/** What makes one configuration recognisably the same system as another. */
function systemSignature(config) {
    // Either shape: a profile saved since systems carried everything nests its tracker
    // settings, one saved before that holds them flat.
    const tracker = config?.statusTracker || config || {};
    return JSON.stringify([
        (tracker.globalStats || []).map(s => s?.name),
        (tracker.npcStats || []).map(s => s?.name),
        (tracker.playerStats || []).map(s => s?.name),
        (tracker.collections || []).map(c => c?.id),
    ]);
}

function unusedSystemName(presets, base) {
    if (!presets[base]) return base;
    for (let i = 2; ; i++) if (!presets[`${base} ${i}`]) return `${base} ${i}`;
}

/**
 * Gives the configuration already in use a system to belong to.
 *
 * Runs once, when nothing is marked active. The configuration you are working in is
 * matched against the saved systems by which stats and collections it defines - a
 * configuration built from "Energy RPG" is still recognisably that system - so it adopts
 * the current characters and item library rather than a duplicate appearing beside it.
 * With no match, the live configuration becomes a system of its own.
 *
 * Either way the current world goes with it. Nothing is stranded, and nothing is deleted.
 *
 * @returns {boolean} Whether a migration happened.
 */
export function migrateToActiveSystem() {
    const settings = getSettings();
    if (settings.activeSystem) return false;

    const st = settings.statusTracker;
    const presets = st.presets || {};
    const live = systemSignature(st);
    const matches = Object.keys(presets)
        .filter(name => systemSignature(presets[name]?.config || {}) === live);

    // Two systems that define the same stats cannot be told apart, so neither is claimed.
    const name = matches.length === 1
        ? matches[0]
        : unusedSystemName(presets, 'Default System');

    const existing = presets[name];
    saveSystemPreset(name,
        existing?.metadata?.description ?? '', existing?.metadata?.author ?? 'User');
    settings.activeSystem = name;
    saveSettings();
    debugLog(`Configuration adopted by system: ${name}`);
    return true;
}

/**
 * Makes a system the one in use, carrying its world in with it.
 *
 * The outgoing system is captured first, always. Switching away must never be the thing
 * that loses a world, which is why nothing here depends on having saved by hand.
 *
 * @returns {boolean} False when there is no such system, or it is already active.
 */
/** The world marked as the default, or ''. A name that no longer exists counts as none. */
export function getDefaultWorld() {
    const settings = getSettings();
    return settings.defaultWorld && settings.statusTracker.presets?.[settings.defaultWorld] ? settings.defaultWorld : '';
}

/** Marks a world as the one opened at startup; the same name again clears it. */
export function setDefaultWorld(name) {
    const settings = getSettings();
    settings.defaultWorld = name && settings.statusTracker.presets?.[name] && settings.defaultWorld !== name ? name : '';
    saveSettings();
}

/** At startup, moves into the default world when it is not the one already in use. */
function applyDefaultWorld() {
    const name = getDefaultWorld();
    if (name && name !== getActiveSystem()) setActiveSystem(name);
}

export function setActiveSystem(name) {
    const settings = getSettings();
    const target = settings.statusTracker.presets?.[name];
    if (!target || settings.activeSystem === name) return false;

    captureActiveSystem();
    applySystemPreset(target);
    // A saved system with no recorded world has an empty one - the starter systems ship
    // that way. Moving into it must not inherit the last system's cast, which is the
    // whole point: a Pathfinder chat should not open holding twenty-five D&D characters.
    // The outgoing world was captured a moment ago, so switching back returns all of it.
    if (!target.world) {
        restoreWorld(settings, { characters: [], personaData: {}, master_items: {} });
    }
    settings.activeSystem = name;
    saveSettings();
    debugLog(`Active system: ${name}`);
    return true;
}

/**
 * Starts a new system from the shipped defaults, with nobody in it.
 *
 * The old flow was "save current as", which asks you to remember to do it and leaves no
 * way to begin from a clean sheet - a new ruleset always started as a copy of the last.
 *
 * @returns {boolean} False when the name is missing or already taken.
 */
export function createSystem(name) {
    const settings = getSettings();
    const st = settings.statusTracker;
    if (!name || st.presets?.[name]) return false;

    captureActiveSystem();

    // Reset by the same rule the capture uses, so a new system starts from the defaults in
    // everything it owns. Resetting a named handful meant time rules, prompts and review
    // thresholds quietly carried over from whichever system you happened to be in.
    const defaults = structuredClone(defaultSettings);
    assignExcept(st, defaults.statusTracker, SYSTEM_EXCLUDED_TRACKER);
    assignExcept(settings, defaults, SYSTEM_EXCLUDED_ROOT);

    settings.characters.splice(0, settings.characters.length);
    settings.personaData = {};
    settings.master_items = {};

    saveSystemPreset(name);
    settings.activeSystem = name;
    saveSettings();
    return true;
}

/**
 * Saves the current status tracker configuration as a preset.
 */
export function saveSystemPreset(name, description = '', author = 'User') {
    if (!name) return;
    const settings = getSettings();
    const st = settings.statusTracker;
    
    const profile = {
        version: '2.1.0',
        metadata: {
            name,
            description,
            author
        },
        config: {
            ...copyExcept(settings, SYSTEM_EXCLUDED_ROOT),
            statusTracker: copyExcept(st, SYSTEM_EXCLUDED_TRACKER),
        },
        world: captureWorld(settings),
    };

    if (!st.presets) st.presets = {};
    st.presets[name] = profile;
    saveSettings();
}

/**
 * Applies a system preset to the current configuration.
 */
export function applySystemPreset(profile) {
    if (!profile || !profile.config) return;
    const st = getSettings().statusTracker;
    const cfg = profile.config;
    
    const settings = getSettings();

    // Two shapes. A profile saved since systems carried everything keeps its tracker
    // settings under `statusTracker`; one saved before that, or exported to share a
    // ruleset, holds a flat handful of tracker keys directly. Both load, and neither
    // touches a setting it does not define.
    if (cfg.statusTracker) {
        assignExcept(st, cfg.statusTracker, SYSTEM_EXCLUDED_TRACKER);
        assignExcept(settings, cfg, new Set([...SYSTEM_EXCLUDED_ROOT, 'displayStyle']));
    } else {
        assignExcept(st, cfg, new Set([...SYSTEM_EXCLUDED_TRACKER, 'displayStyle']));
    }

    // A stat list from an older profile may predate either field.
    for (const stat of st.playerStats || []) {
        if (stat.format === undefined) stat.format = '{{value}}';
        if (stat.maxStatValue === undefined) stat.maxStatValue = '100';
    }

    /* The other door a schema comes through. normalizeSettings runs on load and never sees
       this one, so a system saved before Meter was renamed to Number would arrive holding
       'bar' - and only the systems somebody had saved would misbehave, which is the kind of
       half-migration that takes weeks to be reported. */
    for (const listName of ['globalStats', 'npcStats', 'playerStats']) {
        normaliseStatDefs(st[listName]);
    }

    // The theme was called displayStyle and lived in config; it is menuStyle at the root
    // now, and carried like anything else. Old profiles still name the old one.
    if (cfg.displayStyle !== undefined) {
        settings.menuStyle = 'default';   // one look now; an old profile's theme is ignored
    }

    // Absent on any profile saved before systems carried a world, and on a profile
    // somebody exported to share a ruleset. Both must leave the current cast alone rather
    // than emptying it.
    restoreWorld(getSettings(), profile.world);

    saveSettings();
}

/**
 * Saved states of a system.
 *
 * A system's stored copy is only rewritten when you switch away from it, so a system you
 * never leave keeps whatever it held the last time you did - which is how two deleted
 * characters and a 165KB image stayed frozen inside one for weeks. Checkpoints give it a
 * history instead of a single overwritten copy.
 *
 * The state itself is written to user/files/ and only an index entry - about a hundred
 * bytes - is kept in settings.json. The first version stored the whole thing inline, which
 * would have re-serialised and re-uploaded every saved world on every settings change:
 * five states of a 200KB world is a megabyte rewritten each time a slider moves. The
 * payload never changes after it is written, so it has no business in a file that does.
 *
 * @param {object} preset
 * @returns {Array<{ id: string, savedAt: number, label: string, path: string, characters: number }>}
 */
export function getCheckpoints(preset) {
    return Array.isArray(preset?.checkpoints) ? preset.checkpoints : [];
}

/** Base64 for a UTF-8 string. btoa alone throws on anything outside Latin-1, and character
 *  names here are routinely Hungarian. Chunked because spreading a large array into
 *  fromCharCode overflows the call stack. */
export function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/** Counts saves within a session, so two in the same millisecond cannot collide. */
let checkpointSequence = 0;

/**
 * A filename the upload route accepts: alphanumerics, dash and underscore only.
 *
 * The timestamp alone was not unique. Date.now() repeats inside a millisecond, and a
 * restore saves "Before restore" immediately after whatever prompted it - so the two
 * could share a name, the second would overwrite the first, and dropping the older index
 * entry would then delete the file the newer one still pointed at.
 */
function checkpointFileName(system, savedAt) {
    const slug = String(system).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'system';
    const unique = `${savedAt}-${(checkpointSequence++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `worldkit-state-${slug}-${unique}.json`;
}

/**
 * Records the live state as a new checkpoint of the active system.
 *
 * Captures configuration as well as the world: "so we cannot screw up permanently a
 * setting" is the point, and a world-only checkpoint would restore your characters while
 * leaving a ruined ruleset in place.
 *
 * @param {string} [label]
 * @returns {Promise<{ saved: boolean, kept: number, reason?: string }>}
 */
export async function saveCheckpoint(label = 'Manual save') {
    const settings = getSettings();
    const active = settings.activeSystem;
    const preset = settings.statusTracker.presets?.[active];
    if (!active || !preset) return { saved: false, kept: 0, reason: 'no active system' };

    const payload = {
        config: {
            ...copyExcept(settings, SYSTEM_EXCLUDED_ROOT),
            statusTracker: copyExcept(settings.statusTracker, SYSTEM_EXCLUDED_TRACKER),
        },
        world: captureWorld(settings),
    };
    const serialised = JSON.stringify(payload);

    const history = getCheckpoints(preset);
    // A checkpoint identical to the newest is noise: an interval save on an untouched
    // system would otherwise push real history out a few minutes at a time. Compared by
    // the bytes we are about to write, so it needs no second copy in memory.
    if (history[0]?.size === serialised.length && history[0]?.digest === digestOf(serialised)) {
        return { saved: false, kept: history.length, reason: 'unchanged' };
    }

    const savedAt = Date.now();
    const name = checkpointFileName(active, savedAt);
    let path;
    try {
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name, data: toBase64(serialised) }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        path = (await response.json()).path;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not write the saved state:', err);
        // No index entry without a file behind it: an entry pointing at nothing offers a
        // restore that cannot work, which is worse than not offering one.
        return { saved: false, kept: history.length, reason: 'write failed' };
    }

    history.unshift({
        id: name,
        savedAt,
        label: String(label || 'Manual save'),
        path,
        characters: (payload.world.characters || []).length,
        size: serialised.length,
        digest: digestOf(serialised),
    });

    const limit = Math.max(1, Number(settings.statusTracker.systemCheckpointsKept) || 5);
    // Files for anything falling off the end go too, or user/files/ grows without bound.
    // Awaited so the caller knows the cleanup finished: left floating, a save that returns
    // before its deletes land reports a state the disk does not yet agree with.
    const dropped = history.slice(limit);
    history.length = Math.min(history.length, limit);
    // Never delete a file another entry still points at. Names are unique now, so this
    // should not arise - but the cost of being wrong is a saved state that restores
    // nothing, and the check is one comparison.
    const stillReferenced = new Set(history.map(entry => entry.path));
    await Promise.all(
        dropped
            .filter(entry => !stillReferenced.has(entry.path))
            .map(entry => deleteCheckpointFile(entry.path)),
    );
    preset.checkpoints = history;

    saveSettings();
    debugLog(`Checkpoint saved for "${active}" (${history.length} kept)`);
    return { saved: true, kept: history.length };
}

/**
 * A cheap fingerprint of a saved state, for spotting one that has not changed.
 *
 * Not a cryptographic hash and does not need to be: a collision costs one skipped save of
 * an identical-looking state, and the length is checked alongside it.
 */
function digestOf(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return hash;
}

/** Removes a checkpoint's file, ignoring one that has already gone. */
async function deleteCheckpointFile(path) {
    if (!path) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (err) {
        debugLog('Could not delete a saved state file', path, err);
    }
}

/**
 * Puts a checkpoint back.
 *
 * Takes a checkpoint of the current state first, so restoring is itself undoable - the one
 * thing a restore must never be is a one-way door.
 *
 * @param {number} index Into the checkpoint list, newest first.
 * @returns {Promise<boolean>}
 */
export async function restoreCheckpoint(index) {
    const settings = getSettings();
    const active = settings.activeSystem;
    const preset = settings.statusTracker.presets?.[active];
    if (!active || !preset) return false;

    const target = getCheckpoints(preset)[Number(index)];
    if (!target) return false;

    let payload;
    try {
        const response = await fetch(target.path.startsWith('/') ? target.path : `/${target.path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not read the saved state:', err);
        return false;
    }

    // Only after the payload is in hand: a failed read must not cost you a checkpoint slot
    // for a restore that then does not happen.
    await saveCheckpoint('Before restore');

    applySystemPreset({ config: payload.config, world: payload.world });
    saveSettings();
    debugLog(`Restored the state saved at ${new Date(target.savedAt).toLocaleString()}`);
    return true;
}

/**
 * Removes one checkpoint and its file.
 *
 * @param {number} index
 * @returns {Promise<boolean>}
 */
export async function deleteCheckpoint(index) {
    const settings = getSettings();
    const preset = settings.statusTracker.presets?.[settings.activeSystem];
    if (!preset) return false;
    const history = getCheckpoints(preset);
    const target = history[Number(index)];
    if (!target) return false;
    history.splice(Number(index), 1);
    preset.checkpoints = history;
    saveSettings();
    await deleteCheckpointFile(target.path);
    return true;
}

let checkpointTimer = null;

/**
 * Starts or stops the interval save, matching the current settings.
 *
 * Idempotent: it clears any existing timer first, so it can be called freely without
 * stacking them up.
 */
export function applyCheckpointSchedule() {
    if (checkpointTimer) {
        clearInterval(checkpointTimer);
        checkpointTimer = null;
    }

    const minutes = Number(getSettings().statusTracker.systemAutoSaveMinutes) || 0;
    if (minutes <= 0) return;

    checkpointTimer = setInterval(() => {
        // Silent by design: an interval save that toasts every few minutes is a nuisance,
        // and one that saved nothing because nothing changed has nothing to announce.
        saveCheckpoint('Automatic');
    }, minutes * 60 * 1000);

    debugLog(`Automatic system checkpoints every ${minutes} minute(s)`);
}

/**
 * Deletes a system preset.
 */
export function deleteSystemPreset(name) {
    if (!name) return;
    const settings = getSettings();
    if (settings.defaultWorld === name) settings.defaultWorld = '';
    if (settings.statusTracker.presets?.[name]) {
        delete settings.statusTracker.presets[name];
        saveSettings();
    }
}

/**
 * Imports a system preset from a JSON string.
 */
export function importSystemPreset(jsonText) {
    const profile = JSON.parse(jsonText);
    if (!profile.config || !profile.metadata || !profile.metadata.name) {
        throw new Error('Invalid System Profile format.');
    }
    const settings = getSettings();
    if (!settings.statusTracker.presets) settings.statusTracker.presets = {};
    settings.statusTracker.presets[profile.metadata.name] = profile;
    saveSettings();
    return profile;
}


