/**
 * Panes drawn by a module's own code (fork).
 *
 * Phone and Games build a settings drawer in SillyTavern's Extensions list, and the Modules
 * tab borrows it. A module written for this extension has no drawer: it registers a function
 * here instead, and the Modules tab calls it with the pane to draw into.
 *
 * It also keeps how each module's load went, so the Modules tab can say why one is missing
 * (the real error) instead of only that it is.
 */

const panes = new Map();
const loads = new Map();
const listeners = new Set();

/** @param {string} id The module id used in the Modules tab. @param {(pane: HTMLElement, ctx: object) => void} render */
export function registerModulePane(id, render) {
    if (typeof render === 'function') panes.set(id, render);
    notify(id);
}

export function getModulePane(id) {
    return panes.get(id) || null;
}

/**
 * Records how a module's import went: 'loading', 'loaded' or 'failed' (with the error).
 * @param {string} id
 * @param {'loading'|'loaded'|'failed'} state
 * @param {unknown} [error]
 */
export function recordModuleLoad(id, state, error) {
    const message = error ? String(error?.message || error) : '';
    loads.set(id, { state, error: message, stack: error?.stack ? String(error.stack) : '', at: Date.now() });
    notify(id);
}

/** @returns {{ state: string, error: string, stack: string, at: number } | null} */
export function moduleLoadState(id) {
    return loads.get(id) || null;
}

/** Called with a module id whenever a pane registers or a load finishes. Returns an unsubscribe. */
export function onModuleLoad(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function notify(id) {
    for (const fn of [...listeners]) {
        try { fn(id); } catch { /* a listener's trouble is its own */ }
    }
}

/**
 * The note shown where a module's pane should be. Pure, so it can be tested.
 * @param {string} name The module's display name.
 * @param {{ state: string, error: string } | null} load
 */
export function missingModuleText(name, load) {
    if (load?.state === 'failed') {
        return `${name} failed to load: ${load.error || 'unknown error'}. Details are in the browser console (lines starting with [SillyNPC]).`;
    }
    if (!load || load.state === 'loading') {
        return `${name} is still loading. This pane fills in by itself when it is ready.`;
    }
    return `${name} loaded, but its settings panel is not on the page yet. This pane fills in by itself when it appears; `
        + 'if it does not, reload SillyTavern.';
}
