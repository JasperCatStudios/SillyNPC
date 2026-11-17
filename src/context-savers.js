/**
 * The context-saver regex scripts, found in SillyTavern's regex list by name so they can be switched off or given another depth.
 *
 * A context saver is a prompt-only regex that removes a tracker's block from older messages before the prompt goes to the story
 * model. It only matters while that block is written inside the reply; each runs from a certain depth back (its "minimum depth"):
 * 2 means the newest message keeps its block and the older ones lose theirs.
 *
 * Pure, so it is tested in node. Scripts are found by name, not by id, because SillyTavern gives a script a new id when it is
 * imported. Changes are made on the script objects themselves (the list the regex engine reads), so they apply at once.
 */

/** Which scripts there are, in the order shown. `names` are matched without regard to case. */
export const CONTEXT_SAVERS = Object.freeze([
    { key: 'states', label: 'Internal States', names: ['Worldkit - Internal States Context Saver'] },
    { key: 'bonds', label: 'Bonds', names: ['Worldkit - Bond Tracker Context Saver', 'SillyNPC - Bond Tracker Context Saver'] },
    { key: 'vitals', label: 'Vitals', names: ['Worldkit - Vitals Context Saver'] },
    { key: 'inventory', label: 'Inventory', names: ['Worldkit - Inventory Context Saver'] },
]);

/** The script for a saver, or null when it has not been imported. */
export function findSaver(scripts, saver) {
    const wanted = saver.names.map(n => n.toLowerCase());
    return (Array.isArray(scripts) ? scripts : []).find(s => s && wanted.includes(String(s.scriptName || '').toLowerCase())) || null;
}

/** On means the script is not disabled. */
export const isSaverOn = (script) => Boolean(script) && !script.disabled;

/** A depth as stored: a whole number from 0 up. Anything else is 0. */
export function cleanDepth(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
}

/** The depth the script starts at (its minimum depth), 0 when it has none. */
export const saverDepth = (script) => cleanDepth(script?.minDepth);

export function setSaverOn(script, on) {
    if (!script) return false;
    script.disabled = !on;
    return true;
}

export function setSaverDepth(script, depth) {
    if (!script) return false;
    script.minDepth = cleanDepth(depth);
    return true;
}
