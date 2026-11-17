import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1,
} from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { placeWritingPrompt, promptListAvailable } from './prompt-slot.js';
import { debugLog, PRODUCT_NAME } from './constants.js';
import {
    normalizeResultInjection, normalizePending, chooseResult, resultBlockText,
} from './result-injection.js';

/**
 * The SillyTavern side of result injection (fork): where the waiting report of a fight or a game is kept, how
 * the block is placed in the prompt (in SillyTavern's prompt list on Chat Completion, otherwise as an in-chat
 * prompt), and the per-turn cache that makes a swipe or a regenerate carry the same thing. The rules are in
 * result-injection.js.
 */

export const RESULT_IDS = Object.freeze(['combat', 'games', 'levelup']);
const KEYS = { combat: 'sillynpc_combat_result', games: 'sillynpc_games_result', levelup: 'sillynpc_levelup_result' };
const NAMES = { combat: 'Worldkit - Combat Result', games: 'Worldkit - Game Result', levelup: 'Worldkit - Level Up' };
const NOTICES = { combat: 'The combat result', games: 'The game result', levelup: 'The level-up' };

const since = { combat: Infinity, games: Infinity, levelup: Infinity };   // replies since it last went; not saved
const turns = {};                                      // id -> { key, text } the decision made for the current turn

function box(id) {
    const root = getSettings();
    if (!root.resultInjection || typeof root.resultInjection !== 'object' || Array.isArray(root.resultInjection)) root.resultInjection = {};
    const b = root.resultInjection[id] && typeof root.resultInjection[id] === 'object' ? root.resultInjection[id] : (root.resultInjection[id] = {});
    // Repaired in place, so the object the settings panel holds is always the saved one. Replacing it with a copy
    // left the panel editing a stale object, and every change was lost the next time the settings were read.
    // A level-up is meant to reach the story, so it starts on Always; a fight or a game starts Off.
    if (!b.cfg || typeof b.cfg !== 'object') b.cfg = id === 'levelup' ? { mode: 'always' } : {};
    Object.assign(b.cfg, normalizeResultInjection(b.cfg));
    b.pending = normalizePending(b.pending);
    b.armed = b.armed === true;
    return b;
}

/** The settings of one module's result injection (edited in place by the Modules tab). */
export function resultSettings(id) { return box(id).cfg; }

/** The waiting report, whether the next reply was asked for, and the mode. */
export function resultStatus(id) {
    const b = box(id);
    return { pending: b.pending, armed: b.armed, mode: b.cfg.mode };
}

/**
 * Keeps a finished fight or game's report for the story. Nothing is kept when the mode is off, unless forced: the
 * button in the fight or game window forces it, and the result then goes with the next reply on the default placement.
 * @returns {boolean} Whether it was kept.
 */
export function queueResult(id, text, { force = false, append = false } = {}) {
    const b = box(id);
    if (b.cfg.mode === 'off' && !force) return false;
    // append: a report that has not gone yet keeps its text and gains this (two fights before one reply)
    const joined = append && b.pending?.text ? `${b.pending.text}\n${text}` : text;
    const pending = normalizePending({ text: joined, at: Date.now() });
    if (!pending) return false;
    b.pending = pending;
    saveSettings();
    return true;
}

/** Asks for the waiting report to go with the next reply (or takes the request back). */
export function armResult(id, on) {
    const b = box(id);
    b.armed = Boolean(on);
    saveSettings();
}

/** Forgets the waiting report. */
export function clearResult(id) {
    const b = box(id);
    b.pending = null;
    b.armed = false;
    saveSettings();
}

function turnKey(type) {
    try {
        const ctx = getContext();
        const chat = Array.isArray(ctx.chat) ? ctx.chat.slice() : [];
        if ((type === 'regenerate' || type === 'swipe') && chat.length && !chat[chat.length - 1]?.is_user) chat.pop();
        const last = chat[chat.length - 1];
        return [ctx.chatId ?? '', chat.length, last?.send_date ?? '', String(last?.mes ?? '').length].join('|');
    } catch { return ''; }
}

/** Puts the block in the prompt, or takes it out (empty text). Same placement rules as the phone's texts. */
function place(id, text) {
    const cfg = box(id).cfg;
    if (cfg.inList && promptListAvailable()) {
        placeWritingPrompt(KEYS[id], text, { inList: true, depth: cfg.depth, order: cfg.order, name: NAMES[id] });
        return;
    }
    placeWritingPrompt(KEYS[id], '', { inList: false });
    const role = extension_prompt_roles[String(cfg.role).toUpperCase()] ?? extension_prompt_roles.SYSTEM;
    setExtensionPrompt(KEYS[id], text, extension_prompt_types.IN_CHAT, cfg.depth, false, role);
}

function blockFor(id) {
    const b = box(id);
    return resultBlockText({ id, report: b.pending?.text, user: name1 || 'the player', instruction: b.cfg.instruction });
}

/** What would go now, without spending the waiting report. */
export function previewResult(id) {
    const b = box(id);
    const res = chooseResult({ cfg: { ...b.cfg, chance: 100 }, pending: b.pending, armed: b.cfg.mode !== 'off', since: Infinity });
    return { fire: res.fire, reason: res.reason, text: res.fire ? blockFor(id) : '' };
}

function onGeneration(id, type, _options, dryRun) {
    if (dryRun || type === 'quiet' || type === 'impersonate') return;
    try {
        const b = box(id);
        // Off still delivers a result somebody asked for with the button.
        if (!getSettings().enabled || (b.cfg.mode === 'off' && !b.armed)) {
            placeWritingPrompt(KEYS[id], '', { inList: false });
            setExtensionPrompt(KEYS[id], '', extension_prompt_types.IN_CHAT, 0, false);
            return;
        }
        place(id, '');
        const key = turnKey(type);
        // a swipe or regenerate of the same turn: the same thing again, nothing spent twice
        if (key && turns[id] && turns[id].key === key) {
            if (turns[id].text) place(id, turns[id].text);
            return;
        }
        const res = chooseResult({ cfg: b.cfg, pending: b.pending, armed: b.armed, since: since[id] });
        if (!res.fire) {
            since[id] += 1;
            turns[id] = key ? { key, text: '' } : null;
            return;
        }
        const text = blockFor(id);
        place(id, text);
        b.pending = null;       // told to the story once
        b.armed = false;
        since[id] = 0;
        turns[id] = key ? { key, text } : null;
        saveSettings();
        if (b.cfg.notify && typeof toastr !== 'undefined') toastr.info(`${NOTICES[id] || 'The result'} went to the story.`, PRODUCT_NAME);
        debugLog(`Result injected for ${id} (${res.reason})`);
    } catch (err) {
        console.warn('[Worldkit] result injection failed', id, err);
    }
}

export function initResultInjection() {
    for (const id of RESULT_IDS) {
        eventSource.on(event_types.GENERATION_STARTED, (type, options, dryRun) => onGeneration(id, type, options, dryRun));
    }
}
