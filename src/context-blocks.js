import { name1, substituteParams } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { debugLog } from './constants.js';

/**
 * What every module sends along with its own request (fork): who the player is, and what the
 * other memory extensions have put into the story prompt.
 *
 * The modules write their own prompts and send them straight to a model, so SillyTavern never
 * adds anything to them - no persona, no VectFox recall, no Summaryception summary. These two
 * blocks put that back, per module, and each module can switch either one off.
 *
 * The memory is read from SillyTavern's extension prompt slots, which other extensions fill
 * when a main-chat reply is built. It is therefore the memory as it stood at the last reply
 * there, not memory searched for this request.
 */

/** Whether a module sends one of the blocks. A module with no entry yet sends both. */
export function moduleSends(moduleId, kind) {
    const entry = getSettings().moduleContext?.[moduleId];
    return entry?.[kind] !== false;
}

/** Sets one of a module's switches. */
export function setModuleSends(moduleId, kind, on) {
    const settings = getSettings();
    if (!settings.moduleContext || typeof settings.moduleContext !== 'object') settings.moduleContext = {};
    settings.moduleContext[moduleId] = { ...settings.moduleContext[moduleId], [kind]: !!on };
}

/** The player's persona description, or '' when it is off, empty or unavailable. */
export function personaBlock(moduleId) {
    if (!moduleSends(moduleId, 'persona')) return '';
    try {
        const text = String(substituteParams('{{persona}}') || '').trim();
        if (!text || text === '{{persona}}') return '';
        const max = Math.max(200, Number(getSettings().contextPersonaMaxChars) || 3000);
        return `[ABOUT ${name1 || 'THE PLAYER'}:\n${text.slice(0, max)}\n]`;
    } catch (err) {
        debugLog('Could not read the persona', err);
        return '';
    }
}

/** What other extensions have put into the story prompt, or '' when it is off or empty. */
export function extensionMemoryBlock(moduleId) {
    if (!moduleSends(moduleId, 'memory')) return '';
    try {
        const settings = getSettings();
        const prefixes = String(settings.contextMemoryKeys || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!prefixes.length) return '';
        const slots = getContext().extensionPrompts || {};
        const parts = [];
        for (const key of Object.keys(slots).sort()) {
            if (!prefixes.some(p => key.startsWith(p))) continue;
            const value = String(slots[key]?.value ?? '').trim();
            if (value) parts.push(value);
        }
        if (!parts.length) return '';
        const max = Math.max(500, Number(settings.contextMemoryMaxChars) || 6000);
        return `[MEMORY OF THE STORY SO FAR (from the main roleplay):\n${parts.join('\n\n').slice(0, max)}\n]`;
    } catch (err) {
        debugLog('Could not read the extension memory', err);
        return '';
    }
}

/** Both blocks for a module, as a list with the empty ones left out. */
export function contextBlocks(moduleId) {
    return [personaBlock(moduleId), extensionMemoryBlock(moduleId)].filter(Boolean);
}
