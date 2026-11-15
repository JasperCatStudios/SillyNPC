import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1 } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { getSettings, saveSettings } from './settings.js';
import { listRecords } from './rivalry.js';
import { loadStateFromMetadata } from './status-logic.js';
import { charactersMentionedIn } from './mentions.js';
import { normalizeInject, selectOpponents, buildInjection } from './rivalry-inject-core.js';
import { currentPicks } from './vector-service.js';

/**
 * The shared history, in the main story prompt (fork).
 *
 * Set on every generation, like the other blocks SillyNPC injects, so what goes in can change
 * from one message to the next: who is in the scene, whose name came up, and a dice roll when
 * the trigger is random. Nothing is sent when it is off or when nobody qualifies.
 */

const KEY = 'sillynpc_history';

export function injectSettings() {
    const settings = getSettings();
    settings.historyInject = normalizeInject(settings.historyInject);
    return settings.historyInject;
}

export function saveInjectSettings(patch) {
    const settings = getSettings();
    settings.historyInject = normalizeInject({ ...settings.historyInject, ...patch });
    saveSettings();
    return settings.historyInject;
}

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

function clear() {
    setExtensionPrompt(KEY, '', extension_prompt_types.IN_PROMPT, 0, false);
}

/** Whether the trigger holds for one person, for this generation. */
function appliesFor(opts) {
    if (opts.trigger === 'scene') {
        let here = new Set();
        try { here = new Set((loadStateFromMetadata()?.characters || []).map(c => String(c?.name || '').trim().toLowerCase())); } catch { /* no tracker */ }
        return (name) => here.has(String(name).trim().toLowerCase());
    }
    if (opts.trigger === 'mentioned') {
        const chat = getContext()?.chat || [];
        const text = chat.slice(-opts.scanDepth).map(m => String(m?.mes || '')).join('\n');
        const known = getSettings().characters || [];
        return (name) => {
            const rec = known.find(c => String(c.name).toLowerCase() === String(name).toLowerCase());
            if (rec) return charactersMentionedIn(text, [rec]).length > 0;
            return text.toLowerCase().includes(String(name).toLowerCase());
        };
    }
    return () => true;
}

/**
 * The text that would be injected right now. With `everyone` the trigger and the dice are
 * ignored, for the preview.
 */
export function currentInjection({ everyone = false } = {}) {
    const opts = injectSettings();
    const records = listRecords();
    if (!records.length) return '';
    const names = selectOpponents(records, everyone ? { ...opts, trigger: 'always', chance: 100 } : opts, {
        applies: everyone ? () => true : appliesFor(opts),
        rng: everyone ? () => 0 : Math.random,
    });
    // Null unless vectors chose records for this turn; then they fill the history slots.
    return buildInjection(records, names, opts, name1 || 'the player', currentPicks('rivalry'));
}

/** Sets or clears the prompt. Called on every generation. */
export function applyHistoryInjection() {
    const settings = getSettings();
    const opts = injectSettings();
    if (!settings.enabled || !opts.enabled) { clear(); return; }
    const text = currentInjection();
    if (!text) { clear(); return; }
    setExtensionPrompt(KEY, text, POSITIONS[opts.position], opts.depth, false, ROLES[opts.role]);
}
