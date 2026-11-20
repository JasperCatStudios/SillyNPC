/**
 * The four tracker context savers, shipped with the extension so nothing has to be imported first. They are the same
 * scripts as regex/<tracker>/Worldkit-*-Context-Saver.json (and the Content Kit copies): same ids, names and patterns.
 * Each removes a tracker's block from messages older than minDepth, in the prompt only, never in the chat.
 */

const base = {
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: 2,
    maxDepth: null,
};

/** A tracker block is a <details> whose summary names the tracker, optionally inside a code fence. */
const detailsBlock = (word) => `/(?:\`\`\`(?:html|xml|markdown)?\\s{0,8})?<details>\\s{0,8}<summary>[^<]{0,80}${word}[^<]{0,80}<\\/summary>[\\s\\S]{0,20000}?<\\/details>(?:\\s{0,8}\`\`\`)?/gi`;

export const TRACKER_SAVER_SCRIPTS = Object.freeze([
    { ...base, id: '05b65ab4-d80f-46a3-a433-691f34f84030', scriptName: 'Worldkit - Internal States Context Saver', findRegex: '/<!-- GFX_START -->\\s*<internal_states>[\\s\\S]*?<!-- GFX_END -->/g' },
    { ...base, id: 'e3f05bcb-fc93-4170-8142-9a06ae2e2997', scriptName: 'Worldkit - Bond Tracker Context Saver', findRegex: detailsBlock('BOND TRACKER') },
    { ...base, id: 'e5029501-9d13-456a-a9da-aec9b31594d8', scriptName: 'Worldkit - Vitals Context Saver', findRegex: detailsBlock('VITALS') },
    { ...base, id: 'b73860a6-376e-4e7f-a951-ea9ccce1b0b3', scriptName: 'Worldkit - Inventory Context Saver', findRegex: detailsBlock('INVENTORY') },
]);

/** The script names that count as "already there": the current name and the old SillyNPC one for bonds. */
const ALIASES = Object.freeze({ 'worldkit - bond tracker context saver': ['sillynpc - bond tracker context saver'] });

/**
 * Adds any saver that is missing from a regex list. One that is there is left exactly as the owner has it (on or off,
 * any depth). Returns the new list and how many were added.
 */
export function withTrackerSavers(list) {
    const existing = Array.isArray(list) ? list.slice() : [];
    const names = new Set(existing.map(s => String(s?.scriptName ?? '').trim().toLowerCase()));
    const ids = new Set(existing.map(s => s?.id).filter(Boolean));
    let added = 0;
    for (const script of TRACKER_SAVER_SCRIPTS) {
        const name = script.scriptName.toLowerCase();
        const there = names.has(name) || ids.has(script.id) || (ALIASES[name] || []).some(a => names.has(a));
        if (there) continue;
        existing.push({ ...script, placement: [...script.placement], trimStrings: [] });
        added++;
    }
    return { list: existing, added };
}
