import { hasReadableText } from './message-content.js';
import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1,
} from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { requestOnConnection } from './connections.js';
import { sceneNames, sceneSet } from './scene-cast.js';
import { charactersMentionedIn } from './mentions.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import { registerInventoryCommands } from './inventory-commands.js';
import { normalizeItemDatabase, allDbItems, allPresets, toInventoryItem, resolvePreset, isLockedItem, dbItemNamed } from './item-database.js';
import {
    normalizeInventorySettings, normalizeStore, findPerson, ensurePerson, applyTurn, revertTurn,
    setGold, giveItem, takeItem, editItem, removePerson, parseUpdate, buildMonitorPrompt, selectPeople, buildInjection,
    parseInventoryText, applyInventoryEdit,
} from './inventory-core.js';

/**
 * The Inventory Tracker's SillyTavern side (fork): what each person carries and their money, kept
 * per chat in the chat's metadata and read from each reply on a connection of your choosing. The
 * rules live in inventory-core.js; this file fetches what they need and stores what they return,
 * as vitals.js does.
 *
 * Off by default. With it off nothing is read, changed or added to the story prompt, and what is
 * already recorded is kept. Only the player is tracked unless "Track other characters" is on.
 */

const META_KEY = 'sillynpc_inventory';
const EXTRA_KEY = 'sillynpc_inventory';
const INJECT_KEY = 'sillynpc_inventory';
export const INVENTORY_CHANGED_EVENT = 'sillynpc-inventory-changed';

export function inventorySettings() {
    const settings = getSettings();
    settings.inventory = normalizeInventorySettings(settings.inventory);
    return settings.inventory;
}

export function saveInventorySettings() {
    inventorySettings();
    saveSettings();
}

export function playerName() {
    return String(name1 || getContext()?.name1 || 'the player');
}

/** This chat's inventory, or null when no chat is open. */
export function inventoryStore() {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !context.chatId) return null;
    const store = normalizeStore(meta[META_KEY]);
    meta[META_KEY] = store;
    return store;
}

function saveStore() {
    getContext()?.saveMetadataDebounced?.();
    eventSource.emit(INVENTORY_CHANGED_EVENT);
}

function knownNames() {
    const names = (getSettings().characters || []).map(c => c?.name).filter(Boolean);
    try {
        for (const n of sceneNames()) names.push(n);
    } catch { /* tracker not available */ }
    return names;
}

/** One person's inventory in this chat, or null. */
export function getInventory(name) {
    const store = inventoryStore();
    return store ? findPerson(store, name) : null;
}

/** Runs a change against one person (created empty if new) and saves. */
export function editInventory(name, change) {
    const store = inventoryStore();
    if (!store || !String(name || '').trim()) return null;
    const isPlayer = String(name).trim().toLowerCase() === playerName().toLowerCase();
    const person = ensurePerson(store, String(name).trim(), { player: isPlayer });
    change(person, store);
    saveStore();
    return person;
}

/** Applies hand-edited block text to this chat's inventory and saves. Returns how many people changed. */
export function editInventoryText(text) {
    const store = inventoryStore();
    if (!store) return 0;
    const changed = applyInventoryEdit(store, parseInventoryText(text), inventorySettings(), { now: Date.now(), removeMissing: true, keep: [playerName()] });
    if (changed) saveStore();
    return changed;
}

/** Removes one person's whole inventory record from this chat. */
export function removePersonFor(name) {
    const store = inventoryStore();
    if (!store || !removePerson(store, name)) return false;
    saveStore();
    return true;
}

export const setGoldFor = (name, value) => editInventory(name, (p) => { setGold(p, value); });
export const giveItemFor = (name, item) => editInventory(name, (p) => { giveItem(p, item); });
export const editItemFor = (name, oldName, item) => editInventory(name, (p) => { editItem(p, oldName, item); });
/**
 * Takes an item away. A locked item (a certification seal) cannot be taken by hand: only the activity that
 * awarded it spends it, and says so with { award: true }.
 */
export function takeItemFor(name, itemName, qty, { award = false } = {}) {
    if (!award && isLockedItem(dbItemNamed(allDbItems(itemDatabase()), itemName))) {
        toastr.info(`${itemName} is awarded by a professor and cannot be taken away by hand.`, PRODUCT_NAME);
        return null;
    }
    return editInventory(name, (p) => { takeItem(p, itemName, qty); });
}

/* ---- the item database and presets ---------------------------------------------------- */

/** Your own database items and presets, well-formed. Built-in ones are added by allDbItems / allPresets. */
export function itemDatabase() {
    const settings = getSettings();
    settings.itemDatabase = normalizeItemDatabase(settings.itemDatabase);
    return settings.itemDatabase;
}

export function saveItemDatabase() {
    itemDatabase();
    saveSettings();
    eventSource.emit(INVENTORY_CHANGED_EVENT);
}

export const databaseItems = () => allDbItems(itemDatabase());
export const databasePresets = () => allPresets(itemDatabase());

/** Gives one database item, with its kind and note filled in from the database. */
export function giveDbItemFor(name, dbItem, qty = 1, { award = false } = {}) {
    if (!award && isLockedItem(dbItem)) {
        toastr.info(`${dbItem.name} is awarded by a professor for passing a certification exam. It cannot be given by hand.`, PRODUCT_NAME);
        return null;
    }
    return editInventory(name, (p) => { giveItem(p, toInventoryItem(dbItem, qty)); });
}

/**
 * Gives everything in a preset (and its gold) to one person, `times` over.
 * @returns {{ person: object, count: number, gold: number } | null} null when no chat is open
 */
export function givePresetFor(name, preset, times = 1) {
    const { items, gold } = resolvePreset(preset, databaseItems());
    const n = Math.max(1, Math.round(Number(times)) || 1);
    let count = 0;
    const person = editInventory(name, (p) => {
        for (const item of items) { if (giveItem(p, { ...item, qty: item.qty * n }, { why: 'preset' })) count++; }
        if (gold) setGold(p, p.gold + gold * n, { why: 'preset' });
    });
    return person ? { person, count, gold: gold * n } : null;
}

/** The player's own record, created on first use so the screens always have somewhere to show it. */
export function ensurePlayerInventory() {
    return editInventory(playerName(), () => {});
}

/* ---- remembering each swipe's update -------------------------------------------------- */

function storedUpdate(message) {
    return message?.extra?.[EXTRA_KEY]?.[String(message.swipe_id ?? 0)] ?? null;
}

function rememberUpdate(message, update) {
    message.extra = message.extra || {};
    message.extra[EXTRA_KEY] = message.extra[EXTRA_KEY] || {};
    message.extra[EXTRA_KEY][String(message.swipe_id ?? 0)] = update;
    getContext()?.saveChat?.();
}

function commit(update, ctx) {
    const store = inventoryStore();
    if (!store) return null;
    const result = applyTurn(store, update, inventorySettings(), {
        known: knownNames(), player: playerName(), now: Date.now(), ...ctx,
    });
    saveStore();
    return result;
}

/* ---- the separate request ------------------------------------------------------------- */

const inFlight = new Set();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntilIdle() {
    await sleep(600);
    for (let i = 0; i < 180; i++) {
        const stop = document.getElementById('mes_stop');
        if (!stop || getComputedStyle(stop).display === 'none') return;
        await sleep(500);
    }
}

export function latestReplyId() {
    const chat = getContext()?.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system) return i;
    return -1;
}

/**
 * Reads one reply and applies what it proposes.
 * @param {number} messageId
 * @param {{ force?: boolean, button?: boolean }} [options] button is the user asking, which works
 *   in every timing as long as the tracker is on.
 */
export async function runInventoryUpdate(messageId, { force = false, button = false } = {}) {
    const settings = inventorySettings();
    if (!settings.enabled) return null;
    if (settings.timing !== 'request' && !button) return null;
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return null;
    if (!hasReadableText(message)) return null;
    const store = inventoryStore();
    if (!store) return null;

    const swipeId = message.swipe_id ?? 0;
    const key = String(messageId);
    if (!force && store.turns.some(t => t.key === key && t.swipeId === swipeId)) return null;
    const flight = `${context.chatId}:${key}:${swipeId}`;
    if (inFlight.has(flight)) return null;
    inFlight.add(flight);
    try {
        if (!button) await waitUntilIdle();
        if ((message.swipe_id ?? 0) !== swipeId) return null;
        let update = !force ? storedUpdate(message) : null;
        if (!update) {
            const people = (inventoryStore()?.people || []).filter(p => p.tracked);
            const recent = context.chat.slice(Math.max(0, messageId - settings.contextMessages), messageId)
                .map(m => `${m.name}: ${String(m.mes)}`).join('\n\n');
            const { system, user } = buildMonitorPrompt(settings, people, {
                playerName: playerName(), recent, latest: String(message.mes), speaker: message.name,
            });
            const raw = await requestOnConnection('inventoryProfileId', system, user, settings.maxTokens);
            update = parseUpdate(raw);
            rememberUpdate(message, update);
        }
        return commit(update, { key, swipeId, messageId })?.record || null;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Inventory update failed', err);
        toastr.warning(`Inventory could not be updated: ${err?.message || err}`, PRODUCT_NAME);
        return null;
    } finally {
        inFlight.delete(flight);
    }
}

/* ---- the story prompt ----------------------------------------------------------------- */

const POSITIONS = {
    before: extension_prompt_types.BEFORE_PROMPT,
    prompt: extension_prompt_types.IN_PROMPT,
    chat: extension_prompt_types.IN_CHAT,
};
const ROLES = {
    system: extension_prompt_roles.SYSTEM,
    user: extension_prompt_roles.USER,
    assistant: extension_prompt_roles.ASSISTANT,
};

function appliesFor(opts) {
    const chat = getContext()?.chat || [];
    const known = getSettings().characters || [];
    const recentText = chat.slice(-opts.scanDepth).map(m => String(m?.mes || '')).join('\n');
    const mentioned = (name) => {
        const rec = known.find(c => String(c.name).toLowerCase() === String(name).toLowerCase());
        if (rec) return charactersMentionedIn(recentText, [rec]).length > 0;
        return recentText.toLowerCase().includes(String(name).toLowerCase());
    };
    if (opts.trigger === 'scene') {
        let here = new Set();
        try { here = sceneSet(); } catch { /* no chat open */ }
        const player = playerName().toLowerCase();
        if (!here.size) return (name) => String(name).toLowerCase() === player || mentioned(name);
        return (name) => String(name).toLowerCase() === player || here.has(String(name).trim().toLowerCase());
    }
    if (opts.trigger === 'mentioned') return mentioned;
    return () => true;
}

/** The text that would be sent right now. */
export function currentInventoryInjection({ everyone = false } = {}) {
    const settings = inventorySettings();
    const store = inventoryStore();
    if (!store) return '';
    const names = selectPeople(store, settings.inject, { applies: everyone ? () => true : appliesFor(settings.inject) });
    return buildInjection(store, names, settings, playerName());
}

export function applyInventoryPrompts() {
    const settings = inventorySettings();
    const on = Boolean(getSettings().enabled) && settings.enabled;
    const text = on ? currentInventoryInjection() : '';
    if (text) setExtensionPrompt(INJECT_KEY, text, POSITIONS[settings.inject.position], settings.inject.depth, false, ROLES[settings.inject.role]);
    else setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_PROMPT, 0, false);
}

/* ---- wiring --------------------------------------------------------------------------- */

export function initInventory() {
    registerInventoryCommands();
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun) return;
        try {
            if (type === 'regenerate') {
                const id = latestReplyId();
                const store = id >= 0 ? inventoryStore() : null;
                if (store && revertTurn(store, String(id))) saveStore();
            }
            applyInventoryPrompts();
        } catch (err) { debugLog('Inventory prompts failed', err); }
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const s = inventorySettings();
        if (!s.enabled || s.timing !== 'request') return;
        runInventoryUpdate(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        try {
            const id = Number(messageId);
            const message = getContext()?.chat?.[id];
            const store = inventoryStore();
            const s = inventorySettings();
            if (!message || !store || !s.enabled) return;
            const remembered = storedUpdate(message);
            if (remembered && s.timing === 'request') {
                revertTurn(store, String(id));
                commit(remembered, { key: String(id), swipeId: message.swipe_id ?? 0, messageId: id });
                return;
            }
            if (revertTurn(store, String(id))) saveStore();
            if (s.timing === 'request') runInventoryUpdate(id).catch(err => console.warn(LOG_PREFIX, err));
        } catch (err) { console.warn(LOG_PREFIX, 'Inventory swipe failed', err); }
    });

    eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
        try {
            const store = inventoryStore();
            if (!store) return;
            const gone = store.turns.filter(t => Number.isInteger(t.messageId) && t.messageId >= Number(newLength)).map(t => t.key);
            for (const key of gone) revertTurn(store, key);
            if (gone.length) saveStore();
        } catch (err) { debugLog('Inventory cleanup after a delete failed', err); }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        try { inventoryStore(); } catch (err) { debugLog('Inventory store failed to load', err); }
        eventSource.emit(INVENTORY_CHANGED_EVENT);
    });
}
