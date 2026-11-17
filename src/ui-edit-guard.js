/**
 * Never redraw a form while somebody is using it (fork).
 *
 * Replacing the nodes under a control that has focus (or rebuilding its options while its list is open) throws away what
 * the person was doing: the picked option falls back to "(none)", typed text is lost, the caret jumps. Three screens had
 * that bug (the Combat and Games result settings, and the world type editor's dropdowns). Anything that redraws on its
 * own, without a click on a button that asks for it, goes through this.
 *
 * Pure DOM, no SillyTavern imports.
 */

const ENTRY = 'input, select, textarea, [contenteditable="true"], [contenteditable=""]';

/**
 * Whether the focus is in a control inside `root` that takes input (a text box, a list, a text area; not a button).
 * @param {Element|null|undefined} root
 */
export function isEditingIn(root) {
    const active = document.activeElement;
    if (!root || !active || active === document.body || !root.contains(active)) return false;
    if (active.matches?.(ENTRY)) {
        const type = String(active.getAttribute?.('type') || '').toLowerCase();
        // a checkbox or a colour well is a click, not typing
        return !['button', 'submit', 'reset'].includes(type);
    }
    return false;
}

const waiting = new WeakMap();

/**
 * Runs `redraw` now, or, if `root` is being edited, once after the person has left the control. Several requests while
 * they are still typing become one redraw. Returns whether it ran at once.
 * @param {Element|null|undefined} root
 * @param {() => void} redraw
 */
export function redrawWhenIdle(root, redraw) {
    if (!root) return false;
    if (!isEditingIn(root)) { redraw(); return true; }
    if (waiting.has(root)) return false;
    const run = () => {
        // focusout fires before the focus has moved, so wait a tick and check again
        setTimeout(() => {
            if (isEditingIn(root)) return;     // moved to another control inside: stay deferred
            root.removeEventListener('focusout', run);
            waiting.delete(root);
            if (root.isConnected) redraw();
        }, 0);
    };
    waiting.set(root, run);
    root.addEventListener('focusout', run);
    return false;
}
