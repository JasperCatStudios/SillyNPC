import { eventSource, event_types } from '../../../../events.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getSettings, saveSettings } from './settings.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { debugLog } from './constants.js';
import { normalizeSceneHeaderSettings, sceneHeaderText } from './scene-header-prompt.js';

/**
 * The scene header instruction at run time (fork): when it is switched on (Writing Rules, Scene Header), the instruction
 * that asks the story model to start every reply with the scene header is sent with the story prompt, so the Scene module
 * gets the date, time, place and weather from the main API call. Off by default; a preset that already asks for the header
 * does not need it. The words and settings are in scene-header-prompt.js.
 */

const KEY = 'sillynpc_scene_header';
const NAME = 'Worldkit - Scene Header';
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

/** The saved settings, repaired in place so the object a screen holds is the saved one. */
export function sceneHeaderSettings() {
    const settings = getSettings();
    if (!settings.sceneHeader || typeof settings.sceneHeader !== 'object' || Array.isArray(settings.sceneHeader)) settings.sceneHeader = {};
    Object.assign(settings.sceneHeader, normalizeSceneHeaderSettings(settings.sceneHeader));
    return settings.sceneHeader;
}

export function saveSceneHeaderSettings() {
    sceneHeaderSettings();
    saveSettings();
}

/** Puts the instruction in front of the model, or takes it away. Safe to call as often as wanted. */
export function applySceneHeaderPrompt() {
    try {
        const s = sceneHeaderSettings();
        const text = getSettings().enabled === false ? '' : sceneHeaderText(s);
        if (s.inList) {
            placeWritingPrompt(KEY, text, { inList: true, depth: s.depth, order: s.order, name: NAME });
            return;
        }
        placeWritingPrompt(KEY, '', { inList: false });
        setExtensionPrompt(KEY, text, POSITIONS[s.position] ?? extension_prompt_types.IN_CHAT, s.depth, false, ROLES[s.role] ?? extension_prompt_roles.SYSTEM);
    } catch (err) {
        debugLog('Scene header instruction not placed', err);
    }
}

export function initSceneHeaderPrompt() {
    applySceneHeaderPrompt();
    eventSource.on(event_types.GENERATION_STARTED, (type) => {
        if (type === 'quiet' || type === 'impersonate') return;
        applySceneHeaderPrompt();
    });
}
