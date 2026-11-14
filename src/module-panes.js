/**
 * Panes drawn by a module's own code (fork).
 *
 * Phone and Games build a settings drawer in SillyTavern's Extensions list, and the Modules
 * tab borrows it. A module written for this extension has no drawer: it registers a function
 * here instead, and the Modules tab calls it with the pane to draw into.
 */

const panes = new Map();

/** @param {string} id The module id used in the Modules tab. @param {(pane: HTMLElement, ctx: object) => void} render */
export function registerModulePane(id, render) {
    if (typeof render === 'function') panes.set(id, render);
}

export function getModulePane(id) {
    return panes.get(id) || null;
}
