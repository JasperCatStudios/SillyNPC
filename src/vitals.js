import { hasReadableText } from './message-content.js';
import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1,
} from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { requestOnConnection } from './connections.js';
import { loadStateFromMetadata } from './status-logic.js';
import { charactersMentionedIn } from './mentions.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import {
    normalizeVitalsSettings, normalizeStore, findPerson, ensurePerson, applyTurn, revertTurn,
    setVital, resetVital, parseUpdate, buildMonitorPrompt, selectPeople, buildInjection,
} from './vitals-core.js';

/**
 * The Vitals Tracker's SillyTavern side (fork): health, hunger, energy and mood, kept per chat in the
 * chat's metadata and read from each reply on a connection of your choosing. The rules live in
 * vitals-core.js; this file fetches what they need and stores what they return, as bonds.js does.
 *
 * Off by default. With it off nothing is read, changed or added to the story prompt, and what is
 * already recorded is kept.
 */

const META_KEY = 'sillynpc_vitals';
const EXTRA_KEY = 'sillynpc_vitals';
const INJECT_KEY = 'sillynpc_vitals';
export const VITALS_CHANGED_EVENT = 'sillynpc-vitals-changed';

export function vitalsSettings() {
    const settings = getSettings();
    settings.vitals = normalizeVitalsSettings(settings.vitals);
    return settings.vitals;
}

export function saveVitalsSettings() {
    vitalsSettings();
    saveSettings();
}

export function playerName() {
    return String(name1 || getContext()?.name1 || 'the player');
}

/** This chat's vitals, or null when no chat is open. */
export function vitalsStore() {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !context.chatId) return null;
    const store = normalizeStore(meta[META_KEY]);
    meta[META_KEY] = store;
    return store;
}

function saveStore() {
    getContext()?.saveMetadataDebounced?.();
    eventSource.emit(VITALS_CHANGED_EVENT);
}

function knownNames() {
    const names = (getSettings().characters || []).map(c => c?.name).filter(Boolean);
    try {
        for (const c of loadStateFromMetadata()?.characters || []) if (c?.name) names.push(c.name);
    } catch { /* tracker not available */ }
    return names;
}

/** One person's vitals in this chat, or null. */
export function getVitals(name) {
    const store = vitalsStore();
    return store ? findPerson(store, name) : null;
}

/** Runs a change against one person (created at full health if new) and saves. */
export function editVitals(name, change) {
    const store = vitalsStore();
    if (!store || !String(name || '').trim()) return null;
    const isPlayer = String(name).trim().toLowerCase() === playerName().toLowerCase();
    const person = ensurePerson(store, String(name).trim(), { player: isPlayer });
    change(person, store);
    saveStore();
    return person;
}

/** Puts one vital back to its default: health, hunger and energy 100, mood calm. */
export function resetVitalFor(name, stat) {
    return editVitals(name, (p) => { resetVital(p, stat); });
}

export function setVitalFor(name, stat, value) {
    return editVitals(name, (p) => { setVital(p, stat, value); });
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
    const store = vitalsStore();
    if (!store) return null;
    const result = applyTurn(store, update, vitalsSettings(), {
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
export async function runVitalsUpdate(messageId, { force = false, button = false } = {}) {
    const settings = vitalsSettings();
    if (!settings.enabled) return null;
    if (settings.timing !== 'request' && !button) return null;
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return null;
    if (!hasReadableText(message)) return null;   // nothing written yet (a blank greeting, a chat just opening)
    const store = vitalsStore();
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
            const people = (vitalsStore()?.people || []).filter(p => p.tracked);
            const recent = context.chat.slice(Math.max(0, messageId - settings.contextMessages), messageId)
                .map(m => `${m.name}: ${String(m.mes)}`).join('\n\n');
            const { system, user } = buildMonitorPrompt(settings, people, {
                playerName: playerName(), recent, latest: String(message.mes), speaker: message.name,
            });
            const raw = await requestOnConnection('vitalsProfileId', system, user, settings.maxTokens);
            update = parseUpdate(raw);
            rememberUpdate(message, update);
        }
        return commit(update, { key, swipeId, messageId })?.record || null;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Vitals update failed', err);
        toastr.warning(`Vitals could not be updated: ${err?.message || err}`, PRODUCT_NAME);
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
        try { here = new Set((loadStateFromMetadata()?.characters || []).map(c => String(c?.name || '').trim().toLowerCase())); } catch { /* no tracker */ }
        const player = playerName().toLowerCase();
        if (!here.size) return (name) => String(name).toLowerCase() === player || mentioned(name);
        return (name) => String(name).toLowerCase() === player || here.has(String(name).trim().toLowerCase());
    }
    if (opts.trigger === 'mentioned') return mentioned;
    return () => true;
}

/** The text that would be sent right now. */
export function currentVitalsInjection({ everyone = false } = {}) {
    const settings = vitalsSettings();
    const store = vitalsStore();
    if (!store) return '';
    const names = selectPeople(store, settings.inject, { applies: everyone ? () => true : appliesFor(settings.inject) });
    return buildInjection(store, names, settings, playerName());
}

export function applyVitalsPrompts() {
    const settings = vitalsSettings();
    const on = Boolean(getSettings().enabled) && settings.enabled;
    const text = on ? currentVitalsInjection() : '';
    if (text) setExtensionPrompt(INJECT_KEY, text, POSITIONS[settings.inject.position], settings.inject.depth, false, ROLES[settings.inject.role]);
    else setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_PROMPT, 0, false);
}

/* ---- wiring --------------------------------------------------------------------------- */

export function initVitals() {
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun) return;
        try {
            if (type === 'regenerate') {
                const id = latestReplyId();
                const store = id >= 0 ? vitalsStore() : null;
                if (store && revertTurn(store, String(id))) saveStore();
            }
            applyVitalsPrompts();
        } catch (err) { debugLog('Vitals prompts failed', err); }
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        const s = vitalsSettings();
        if (!s.enabled || s.timing !== 'request') return;
        runVitalsUpdate(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        try {
            const id = Number(messageId);
            const message = getContext()?.chat?.[id];
            const store = vitalsStore();
            const s = vitalsSettings();
            if (!message || !store || !s.enabled) return;
            const remembered = storedUpdate(message);
            if (remembered && s.timing === 'request') {
                revertTurn(store, String(id));
                commit(remembered, { key: String(id), swipeId: message.swipe_id ?? 0, messageId: id });
                return;
            }
            if (revertTurn(store, String(id))) saveStore();
            if (s.timing === 'request') runVitalsUpdate(id).catch(err => console.warn(LOG_PREFIX, err));
        } catch (err) { console.warn(LOG_PREFIX, 'Vitals swipe failed', err); }
    });

    eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
        try {
            const store = vitalsStore();
            if (!store) return;
            const gone = store.turns.filter(t => Number.isInteger(t.messageId) && t.messageId >= Number(newLength)).map(t => t.key);
            for (const key of gone) revertTurn(store, key);
            if (gone.length) saveStore();
        } catch (err) { debugLog('Vitals cleanup after a delete failed', err); }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        try { vitalsStore(); } catch (err) { debugLog('Vitals store failed to load', err); }
        eventSource.emit(VITALS_CHANGED_EVENT);
    });
}
