import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1 } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { getSettings, saveSettings } from './settings.js';
import { listRecords } from './rivalry.js';
import { sceneNames, sceneSet } from './scene-cast.js';
import { charactersMentionedIn } from './mentions.js';
import { normalizeInject, selectOpponents, buildInjection, buildInjectionWithin, recordsSentAsTalk } from './rivalry-inject-core.js';
import { currentPicks, currentSentTalk, vectorSettings, currentRivalryRoom, setRecallStats } from './vector-service.js';
import { debugLog } from './constants.js';
import { moduleActive } from './vector-core.js';
import { listTalk } from './talk-store.js';

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
        try { here = sceneSet(); } catch { /* no chat open */ }
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
export function currentInjection({ everyone = false, record = false } = {}) {
    const opts = injectSettings();
    const records = listRecords();
    if (!records.length) return '';
    // Everyone who took part in a record, on either side (allies too), but never the player.
    const names = selectOpponents(records, everyone ? { ...opts, trigger: 'always', chance: 100 } : opts, {
        applies: everyone ? () => true : appliesFor(opts),
        rng: everyone ? () => 0 : Math.random,
    }, name1 || '');
    const mode = historyMode(records);
    const picks = currentPicks('rivalry');
    if (everyone || !mode.vectors) return buildInjection(records, names, opts, name1 || 'the player', picks, mode);
    // Vectors chose the records: the block keeps to its part of "History brought back, total".
    let room = null;
    try { room = currentRivalryRoom(); } catch { /* no limit */ }
    const r = buildInjectionWithin(records, names, opts, name1 || 'the player', picks, mode, room);
    if (record && Array.isArray(picks)) {
        try {
            setRecallStats('rivalry', { kept: r.kept.length, dropped: r.dropped.length });
            if (r.dropped.length) debugLog(`Vectors: Rivalry history: ${r.kept.length} whole kept, ${r.dropped.length} left out to fit ${room} tokens`, r.dropped);
        } catch { /* stats only */ }
    }
    return r.text;
}

/**
 * One source per history. With Rivalry vectors on, the records written are the ones the vectors
 * recalled (whole), in this same block; with them off, the newest, as always. Either way a
 * record whose game or fight is already in the prompt with its table talk is not written again.
 */
function historyMode(records) {
    let vectors = false;
    let skip = null;
    try {
        vectors = moduleActive(vectorSettings(), 'rivalry');
        const sent = currentSentTalk();
        if (sent.games.length || sent.combat.length) {
            skip = recordsSentAsTalk(records, { games: listTalk('games'), combat: listTalk('combat') }, [...sent.games, ...sent.combat], name1 || '');
        }
    } catch { /* no vectors: the block as it always was */ }
    return { vectors, skip };
}

/** Sets or clears the prompt. Called on every generation. */
export function applyHistoryInjection() {
    const settings = getSettings();
    const opts = injectSettings();
    if (!settings.enabled || !opts.enabled) { clear(); return; }
    const text = currentInjection({ record: true });
    if (!text) { clear(); return; }
    setExtensionPrompt(KEY, text, POSITIONS[opts.position], opts.depth, false, ROLES[opts.role]);
}
