import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { sceneNames } from './scene-cast.js';
import { debugLog } from './constants.js';
import { normalizeIdentitySettings, buildIdentityBlock, chooseIdentity } from './identity-core.js';

/**
 * Hidden identities at run time (fork): when one of two linked characters is in the scene, the story model is told
 * not to reveal who they secretly are, with that character's own prompt. The rules and the wording are in
 * identity-core.js; this finds who is in the scene, decides whether this reply carries the block (always, or a
 * chance), and places it the way the other injections are placed (SillyTavern's prompt list, or in the chat).
 *
 * A swipe or a regenerate of the same turn rolls again (a random chance can come out differently), and the cooldown is wound back so the replaced roll does not count.
 */

const KEY = 'sillynpc_identity';
const NAME = 'Worldkit - Hidden Identities';
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

let since = Infinity;   // replies since it last went; not saved
let turn = null;        // { key, sinceBefore } the turn being generated, and the cooldown count before its roll

/** The saved settings, repaired in place so the object a screen holds is the saved one. */
export function identitySettings() {
    const settings = getSettings();
    if (!settings.identity || typeof settings.identity !== 'object' || Array.isArray(settings.identity)) settings.identity = {};
    Object.assign(settings.identity, normalizeIdentitySettings(settings.identity));
    return settings.identity;
}

export function saveIdentitySettings() {
    identitySettings();
    saveSettings();
}

/** What would be sent for the scene as it stands, ignoring the mode (for the preview). */
export function currentIdentityText() {
    return buildIdentityBlock(getSettings().characters || [], sceneNames(), identitySettings());
}

function place(text) {
    const cfg = identitySettings();
    if (cfg.inList) {
        placeWritingPrompt(KEY, text, { inList: true, depth: cfg.depth, order: cfg.order, name: NAME });
        return;
    }
    placeWritingPrompt(KEY, '', { inList: false });
    setExtensionPrompt(KEY, text, POSITIONS[cfg.position] ?? extension_prompt_types.IN_CHAT, cfg.depth, false, ROLES[cfg.role] ?? extension_prompt_roles.SYSTEM);
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

function onGeneration(type, _options, dryRun) {
    if (dryRun || type === 'quiet' || type === 'impersonate') return;
    try {
        const cfg = identitySettings();
        if (!getSettings().enabled || cfg.mode === 'off') { place(''); return; }
        // A swipe or a regenerate of the same turn is a NEW roll (a random chance is rolled again). The cooldown count is
        // wound back to where it stood before this turn's first roll, so the roll being replaced does not count against it.
        const key = turnKey(type);
        if (key && turn && turn.key === key) since = turn.sinceBefore;
        else turn = key ? { key, sinceBefore: since } : null;
        const text = currentIdentityText();
        if (!text) { place(''); return; }
        const res = chooseIdentity({ cfg, since });
        if (!res.fire) {
            since += 1;
            place('');
            return;
        }
        since = 0;
        place(text);
        debugLog(`Hidden identity block sent (${res.reason})`);
    } catch (err) {
        console.warn('[Worldkit] hidden identities failed', err);
    }
}

export function initIdentity() {
    eventSource.on(event_types.GENERATION_STARTED, onGeneration);
    eventSource.on(event_types.CHAT_CHANGED, () => { since = Infinity; turn = null; });
}
