import { hasReadableText } from './message-content.js';
import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1,
    saveChatDebounced, updateMessageBlock,
} from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { moduleActive } from './vector-core.js';
import { vectorSettings, currentPicks } from './vector-service.js';
import { requestOnConnection } from './connections.js';
import { sceneNames, sceneSet } from './scene-cast.js';
import { charactersMentionedIn } from './mentions.js';
import { latestInternalStatesHtml } from './internal-states.js';
import { sceneClock } from '../modules/shim.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import { MESSAGE_RENDERED_EVENT } from './beats.js';
import { drawBondSection, markBusy, markFailure, clearFailure, sectionKey } from './bond-section.js';
import {
    normalizeBondSettings, normalizeStore, findPerson, ensurePerson, timingAction,
    applyTurn, revertTurn, setMeter, parseUpdate, stripInlineBlock, milestoneDate,
    parseLegacyBonds, migrateLegacy, selectPeople, buildBondInjection,
    buildMonitorPrompt, buildInlineInstruction, acceptRomanceSuggestion, declineRomanceSuggestion,
    readInlineReply, finishInlineReply, setPresenceProvider,
} from './bonds-core.js';

/**
 * The Bond Tracker's SillyTavern side (fork): where the bonds are kept, when the tracker runs,
 * and how it reaches the story prompt. Every decision is made in bonds-core.js; this file only
 * fetches what those decisions need and stores what they return.
 *
 * Bonds are per chat, in the chat's metadata, like the rivalry record: the same character can
 * be a stranger in one story and a partner in another. The rules are global settings, and
 * travel with a System like the rest of the fiction; the connection that does the work does not.
 */

// "Hide characters not in the scene" asks who is here through this.
setPresenceProvider(() => sceneSet());

const META_KEY = 'sillynpc_bonds';
/** Per swipe, on the message: the update that swipe produced, so swiping back needs no new request. */
const EXTRA_KEY = 'sillynpc_bonds';
const INJECT_KEY = 'sillynpc_bonds';
const INLINE_KEY = 'sillynpc_bonds_inline';
/** Fired whenever the bonds of the open chat change, so an open panel can redraw. */
export const BONDS_CHANGED_EVENT = 'sillynpc-bonds-changed';

/* ---- settings ------------------------------------------------------------------------ */

/** The tracker's settings, repaired in place. */
export function bondSettings() {
    const settings = getSettings();
    settings.bonds = normalizeBondSettings(settings.bonds);
    return settings.bonds;
}

export function saveBondSettings() {
    bondSettings();
    saveSettings();
}

/* ---- the per-chat store -------------------------------------------------------------- */

/** The persona's name, as the bond prompts and the panel use it. */
export function playerName() {
    return String(name1 || getContext()?.name1 || 'the player');
}

/**
 * This chat's bonds, or null when no chat is open. The first time a chat is read, bonds the old
 * Internal States block recorded are brought over, so nothing written before the move is lost.
 */
export function chatStore() {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !context.chatId) return null;
    const settings = bondSettings();
    const growth = settings.growth;
    // Settings too, so per-person gate overrides of gates since deleted are dropped.
    const store = normalizeStore(meta[META_KEY], growth, settings);
    meta[META_KEY] = store;
    if (!store.migrated) {
        let count = 0;
        try {
            count = migrateLegacy(store, parseLegacyBonds(latestInternalStatesHtml(context.chat)), growth);
        } catch (err) {
            store.migrated = true;
            debugLog('Bond migration from Internal States failed', err);
        }
        if (count) saveStore();
    }
    return store;
}

export function saveStore() {
    getContext()?.saveMetadataDebounced?.();
    eventSource.emit(BONDS_CHANGED_EVENT);
}

/** Who the tracker may create on its own: carded characters and whoever the tracker has in scene. */
function knownNames() {
    const names = (getSettings().characters || []).map(c => c?.name).filter(Boolean);
    try {
        for (const n of sceneNames()) names.push(n);
    } catch { /* tracker not available */ }
    return names;
}

/** Applies an update and saves. Milestones it recorded are announced, because they are rare and worth seeing. */
function commit(update, ctx) {
    const store = chatStore();
    if (!store) return null;
    const settings = bondSettings();
    const clock = sceneClock();
    const result = applyTurn(store, update, settings, {
        known: knownNames(),
        player: playerName(),
        date: milestoneDate(clock),
        now: Date.now(),
        ...ctx,
    });
    if (!result.applied) return result;
    saveStore();
    for (const m of result.record.milestones) {
        const label = settings.milestones.find(p => p.id === m.type)?.label || m.type;
        toastr.info(`${label}: ${m.name}`, 'Bond milestone');
    }
    // Romance-unlock flags that passed every rule. Rare, so each one is announced.
    const reasonOf = (name) => (update?.catalysts || []).find(c => String(c?.name || '').toLowerCase() === name.toLowerCase())?.reason || '';
    for (const name of result.record.suggested || []) {
        const why = reasonOf(name);
        toastr.info(`${name} may be developing feelings for ${playerName()}${why ? `: ${why}` : '.'} Turn romance on or keep it platonic under the reply or in the Bonds tab.`, 'Romance suggestion');
    }
    for (const name of result.record.unlocked || []) {
        const why = reasonOf(name);
        toastr.info(`Romance is now on for ${name}'s side${why ? `: ${why}` : '.'}`, 'Romance unlocked');
    }
    debugLog('Bonds updated', result.record);
    return result;
}

/* ---- remembering each swipe's update ------------------------------------------------- */

function storedUpdate(message) {
    return message?.extra?.[EXTRA_KEY]?.[String(message.swipe_id ?? 0)] ?? null;
}

function rememberUpdate(message, update) {
    message.extra = message.extra || {};
    message.extra[EXTRA_KEY] = message.extra[EXTRA_KEY] || {};
    message.extra[EXTRA_KEY][String(message.swipe_id ?? 0)] = update;
    saveChatDebounced();
}

/* ---- the separate request ------------------------------------------------------------ */

const inFlight = new Set();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits until the story reply has finished: the stop button shows for exactly as long as one runs. */
async function waitUntilIdle() {
    await sleep(600);
    for (let i = 0; i < 180; i++) {
        const stop = document.getElementById('mes_stop');
        if (!stop || getComputedStyle(stop).display === 'none') return;
        await sleep(500);
    }
}

/** The newest reply that is not yours, or -1. */
export function latestReplyId() {
    const chat = getContext()?.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system) return i;
    return -1;
}

/**
 * Reads one reply on the bond connection and applies what it proposes.
 *
 * @param {number} messageId
 * @param {{ force?: boolean, only?: string|string[], button?: boolean }} [options]
 *   force re-reads a reply already read; only updates one person or a chosen few; button is the user asking,
 *   which works in every timing (manual included) as long as the tracker is on.
 * @returns {Promise<object|null>} The applied record, or null.
 */
export async function runBondUpdate(messageId, { force = false, only: onlyRaw = '', button = false } = {}) {
    const names = [].concat(onlyRaw || []).map(n => String(n).trim()).filter(Boolean);
    const only = names.length ? names : null;
    const isChosen = (name) => names.some(n => n.toLowerCase() === String(name).toLowerCase());
    const settings = bondSettings();
    if (timingAction(settings, button ? 'button' : 'rendered') !== 'request') return null;
    const context = getContext();
    const chat = context?.chat;
    const message = chat?.[messageId];
    if (!message || message.is_user || message.is_system) return null;
    if (!hasReadableText(message)) return null;   // nothing written yet (a blank greeting, a chat just opening)

    const swipeId = message.swipe_id ?? 0;
    const key = only ? `manual:${names.map(n => n.toLowerCase()).sort().join('|')}:${messageId}` : String(messageId);
    const store = chatStore();
    if (!store) return null;
    if (!force && store.turns.some(t => t.key === key && t.swipeId === swipeId)) return null;

    const flight = `${context.chatId}:${key}:${swipeId}`;
    if (inFlight.has(flight)) return null;
    inFlight.add(flight);
    const shown = sectionKey(messageId, swipeId);
    markBusy(shown, true);
    redrawSection(messageId);
    try {
        if (!button) await waitUntilIdle();
        // A swipe made while this waited belongs to another call.
        if ((message.swipe_id ?? 0) !== swipeId) return null;

        // Swiping back to a reply already read reuses what it produced rather than asking again.
        const remembered = !force && !only ? storedUpdate(message) : null;
        let update = remembered;
        if (!update) {
            const people = (chatStore()?.people || []).filter(p => p.tracked && (!only || isChosen(p.name)));
            const depth = settings.contextMessages;
            const recent = chat.slice(Math.max(0, messageId - depth), messageId)
                .map(m => `${m.name}: ${String(m.mes)}`).join('\n\n');
            const { system, user } = buildMonitorPrompt(settings, people, {
                playerName: playerName(),
                recent,
                latest: String(message.mes),
                speaker: message.name,
                lastDate: chatStore()?.lastDate || '',
                // The turn this read will count as, for the romance-unlock cooldown.
                turn: (chatStore()?.turn ?? 0) + 1,
            });
            const focus = only ? `\n\nOnly ${names.join(', ')} ${names.length > 1 ? 'matter' : 'matters'} for this update; leave everyone else out.` : '';
            const raw = await requestOnConnection('bondProfileId', system, user + focus, settings.maxTokens);
            update = parseUpdate(raw);
            if (!only) rememberUpdate(message, update);
        }
        const result = commit(update, { key, swipeId, messageId, force: true, only: only || undefined });
        clearFailure(shown);
        return result?.record || null;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Bond update failed', err);
        markFailure(shown, err?.message || err);
        toastr.warning(`Bonds could not be updated: ${err?.message || err}`, PRODUCT_NAME);
        return null;
    } finally {
        inFlight.delete(flight);
        markBusy(shown, false);
        redrawSection(messageId);
    }
}

/* ---- the section under a reply ------------------------------------------------------- */

function drawSectionFor(mesEl) {
    if (!mesEl) return;
    const id = Number(mesEl.getAttribute('mesid'));
    const message = getContext()?.chat?.[id];
    drawBondSection(mesEl, {
        message, id,
        store: chatStore(),
        settings: bondSettings(),
        playerName: playerName(),
        refresh: () => redrawSection(id),
        latest: id === latestReplyId(),
        redo: () => { runBondUpdate(id, { force: true, button: true }).catch(err => console.warn(LOG_PREFIX, err)); },
        onAccept: (name) => { acceptSuggestion(name); },
        onDecline: (name) => { declineSuggestion(name); },
        onEdit: (entries) => {
            const growth = bondSettings().growth;
            for (const e of entries) {
                const person = chatStore()?.people.find(p => p.name.toLowerCase() === e.name.toLowerCase());
                if (!person) continue;
                editPerson(person.name, (p) => {
                    setMeter(p, 'toPlayer', 'affection', e.affection, growth);
                    setMeter(p, 'toPlayer', 'trust', e.trust, growth);
                    setMeter(p, 'toPlayer', 'respect', e.respect, growth);
                    if (e.desire !== null && p.edges?.toPlayer?.romance && (p.lock ?? 'open') === 'open') setMeter(p, 'toPlayer', 'desire', e.desire, growth);
                });
            }
        },
    });
}

/** Draws the Bond section again on every reply in the chat (the Look changed, so older ones change too). */
export function redrawAllBondSections() {
    try { document.querySelectorAll('#chat .mes').forEach(drawSectionFor); } catch (err) { debugLog('Bond sections failed', err); }
}

function redrawSection(messageId) {
    try { drawSectionFor(document.querySelector(`#chat .mes[mesid="${messageId}"]`)); } catch (err) { debugLog('Bond section failed', err); }
}

/* ---- the inline timing --------------------------------------------------------------- */

/** Sets the reply's text and the copy its current swipe keeps. */
function setMessageText(message, text) {
    message.mes = text;
    if (Array.isArray(message.swipes) && message.swipes[message.swipe_id ?? 0] !== undefined) {
        message.swipes[message.swipe_id ?? 0] = text;
    }
}

/**
 * Takes the bond block out of a freshly rendered reply and applies it.
 *
 * Always strips the hidden block, whatever the settings say: a block written while the timing was
 * inline must not be left in the story because the switch moved before the reply finished. The
 * visible BOND TRACKER lines are only read while the tracker is on and the timing is inline:
 * their values become changes, go through the growth rules, and the block is rewritten with the
 * clamped result. Synchronous up to the redraw, and registered first, so the rest of Worldkit
 * reads the clean text.
 */
function takeInlineBlock(messageId) {
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    const swipeId = message.swipe_id ?? 0;
    const key = String(messageId);

    if (timingAction(bondSettings(), 'rendered') !== 'parse') {
        const { text, block } = stripInlineBlock(message.mes);
        if (!block) return;
        setMessageText(message, text);
        rememberUpdate(message, parseUpdate(block));
        try { updateMessageBlock(messageId, message); } catch (err) { debugLog('Could not redraw the reply without its bond block', err); }
        return;
    }

    const store = chatStore();
    const read = readInlineReply(message.mes, store, { key, swipeId });
    // No hidden block and either no lines or only our own block from a read already done.
    if (read.skip) return;
    setMessageText(message, read.text);
    rememberUpdate(message, read.update);
    const result = commit(read.update, { key, swipeId, messageId, force: true });
    if (result?.record && read.rows.length) {
        setMessageText(message, finishInlineReply(message.mes, chatStore(), result.record, bondSettings(), playerName()));
    }
    try { updateMessageBlock(messageId, message); } catch (err) { debugLog('Could not redraw the reply without its bond block', err); }
}

/* ---- the story prompt ---------------------------------------------------------------- */

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

/** Whether the trigger holds for one person, for this generation. */
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
        // With the tracker off nobody is "in the scene", which would silence the bonds
        // entirely; who was recently named is the nearest honest answer.
        if (!here.size) return mentioned;
        return (name) => here.has(String(name).trim().toLowerCase());
    }
    if (opts.trigger === 'mentioned') return mentioned;
    return () => true;
}

/**
 * The text that would be injected right now. With `everyone` the trigger and the dice are
 * ignored, for the preview.
 */
export function currentBondInjection({ everyone = false } = {}) {
    const settings = bondSettings();
    const store = chatStore();
    if (!store) return '';
    const opts = settings.inject;
    const names = selectPeople(store, everyone ? { ...opts, trigger: 'always', chance: 100 } : opts, {
        applies: everyone ? () => true : appliesFor(opts),
        rng: everyone ? () => 0 : Math.random,
    });
    // Bond numbers are current state; the milestones are not. With Bond milestones vectors on, the ones that match the scene fill
    // each person's history slots (the rest still the newest); without, the newest, as always.
    let picks = null;
    if (!everyone) {
        try { if (moduleActive(vectorSettings(), 'bonds')) picks = currentPicks('bonds'); } catch { /* vectors unavailable: the newest */ }
    }
    return buildBondInjection(store, names, settings, playerName(), picks);
}

/** Sets or clears both prompts. Called on every generation. */
export function applyBondPrompts(type = 'normal') {
    const settings = bondSettings();
    // Worldkit's own master switch, as the other injected blocks read it.
    const on = Boolean(getSettings().enabled);

    const text = on ? currentBondInjection() : '';
    if (text) setExtensionPrompt(INJECT_KEY, text, POSITIONS[settings.inject.position], settings.inject.depth, false, ROLES[settings.inject.role]);
    else setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_PROMPT, 0, false);

    let instruction = '';
    // Quiet and impersonate requests (the tracker's own, other extensions') never write a story reply,
    // so asking them for a bond block would only leak it into their output.
    if (on && type !== 'quiet' && type !== 'impersonate' && timingAction(settings, 'generation') === 'instruct') {
        const people = (chatStore()?.people || []).filter(p => p.tracked);
        instruction = buildInlineInstruction(settings, people, playerName(), chatStore()?.lastDate || '', (chatStore()?.turn ?? 0) + 1);
    }
    // At depth 0, right before the reply, so the instruction is the last thing the model reads.
    setExtensionPrompt(INLINE_KEY, instruction, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}

/* ---- edits from the panel ------------------------------------------------------------ */

/** Runs a change against one person and saves. Creates them if needed. */
export function editPerson(name, change) {
    const store = chatStore();
    if (!store || !String(name || '').trim()) return null;
    const person = ensurePerson(store, String(name).trim(), bondSettings().growth);
    change(person, store);
    saveStore();
    return person;
}

/**
 * Answers one person's pending romance suggestion, then redraws the replies that showed it (the
 * one it came from, and the newest, which shows every pending one). chatStore() returns a fresh
 * object each call, so the redraw reads the saved state rather than a held reference.
 */
function answerSuggestion(name, change) {
    const before = getPerson(name);
    if (!before?.suggestion) return false;
    const from = before.suggestion.messageId;
    editPerson(before.name, change);
    for (const id of new Set([from, latestReplyId()])) if (Number.isInteger(id) && id >= 0) redrawSection(id);
    return true;
}

/** "Turn romance on": their side's romance goes on. Your side is never touched. */
export function acceptSuggestion(name) {
    return answerSuggestion(name, (p) => { acceptRomanceSuggestion(p); });
}

/** "Keep platonic": the suggestion is dropped and they are not suggested again for the cooldown. */
export function declineSuggestion(name) {
    return answerSuggestion(name, (p, store) => { declineRomanceSuggestion(p, store.turn); });
}

export function getPerson(name) {
    const store = chatStore();
    return store ? findPerson(store, name) : null;
}

/** Today's date for a milestone added by hand: the story's when it has a clock. */
export function todayForMilestone() {
    return milestoneDate(sceneClock());
}

/** Forgets one person's bond entirely in this chat. */
export function removePerson(name) {
    const store = chatStore();
    if (!store) return false;
    const before = store.people.length;
    store.people = store.people.filter(p => p.name.toLowerCase() !== String(name).toLowerCase());
    if (store.people.length === before) return false;
    saveStore();
    return true;
}

/* ---- wiring -------------------------------------------------------------------------- */

function loadStylesheet() {
    if (document.getElementById('sillynpc-bonds-css')) return;
    const link = document.createElement('link');
    link.id = 'sillynpc-bonds-css';
    link.rel = 'stylesheet';
    link.href = new URL('./bonds.css', import.meta.url).href;
    document.head.append(link);
}

export function initBonds() {
    loadStylesheet();

    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun) return;
        try {
            // A regenerate throws the newest reply away, so what it did to the bonds goes too.
            if (type === 'regenerate') {
                const id = latestReplyId();
                const store = id >= 0 ? chatStore() : null;
                if (store && revertTurn(store, String(id), bondSettings().growth)) saveStore();
            }
            applyBondPrompts(type);
        } catch (err) {
            debugLog('Bond prompts failed', err);
        }
    });

    // First, so the tracker's extraction and the chat decoration read the reply without the block.
    eventSource.makeFirst(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        try { takeInlineBlock(Number(messageId)); } catch (err) { console.warn(LOG_PREFIX, 'Bond block failed', err); }
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        if (timingAction(bondSettings(), 'rendered') !== 'request') return;
        runBondUpdate(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });

    eventSource.on(MESSAGE_RENDERED_EVENT, (mesEl) => {
        try { drawSectionFor(mesEl); } catch (err) { debugLog('Bond section failed', err); }
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        try {
            const id = Number(messageId);
            const message = getContext()?.chat?.[id];
            const store = chatStore();
            if (!message || !store) return;
            const remembered = storedUpdate(message);
            const settings = bondSettings();
            if (remembered && settings.enabled && settings.timing !== 'manual') {
                // A reply already read: its own update replaces the other swipe's.
                commit(remembered, { key: String(id), swipeId: message.swipe_id ?? 0, messageId: id, force: true });
                return;
            }
            // Otherwise the swipe on screen has done nothing yet, so nothing may stay applied
            // from the one it replaced. A new swipe being written is read when it renders.
            if (revertTurn(store, String(id), settings.growth)) saveStore();
            if (timingAction(settings, 'rendered') === 'request') {
                runBondUpdate(id).catch(err => console.warn(LOG_PREFIX, err));
            }
        } catch (err) {
            console.warn(LOG_PREFIX, 'Bond swipe failed', err);
        }
    });

    // Message ids are positions: any turn recorded at or past the new end belongs to a message
    // that is gone, so what it did is taken back.
    eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
        try {
            const store = chatStore();
            if (!store) return;
            const gone = store.turns.filter(t => Number.isInteger(t.messageId) && t.messageId >= Number(newLength)).map(t => t.key);
            for (const key of gone) revertTurn(store, key, bondSettings().growth);
            if (gone.length) saveStore();
        } catch (err) {
            debugLog('Bond cleanup after a delete failed', err);
        }
    });

    // Reading the store once on a chat switch is what runs the migration, even before anything is generated.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        try { chatStore(); } catch (err) { debugLog('Bond store failed to load', err); }
        eventSource.emit(BONDS_CHANGED_EVENT);
    });
}
