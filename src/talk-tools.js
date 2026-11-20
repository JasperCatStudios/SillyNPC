/**
 * Edit and regenerate buttons for one line of table talk, shared by the Combat, Games and
 * Activities windows. They keep their talk in different shapes; this only draws the buttons and
 * the inline editor, and each window decides what editing or regenerating a line means.
 */

const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/**
 * A small button strip for a line. Pass `edit` and/or `regen`; each is called with no arguments.
 * @param {{ edit?: () => void, regen?: () => void }} actions
 * @returns {HTMLElement}
 */
export function lineTools({ edit, regen } = {}) {
    const bar = make('span', 'snpc-line-tools');
    const add = (icon, label, fn) => {
        const b = make('button', 'snpc-line-tool');
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.append(make('i', `fa-solid ${icon}`));
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
        bar.append(b);
    };
    if (edit) add('fa-pen', 'Edit this line', edit);
    if (regen) add('fa-rotate', 'Regenerate this reply', regen);
    return bar;
}

/**
 * Swaps what is inside `host` for a text box with Save and Cancel. Save with an empty box
 * counts as Cancel, so a line is never emptied by accident.
 * @param {HTMLElement} host
 * @param {string} text
 * @param {{ onSave: (text: string) => void, onCancel: () => void }} handlers
 */
export function editLine(host, text, { onSave, onCancel }) {
    host.replaceChildren();
    const box = make('textarea', 'text_pole snpc-line-edit');
    box.value = text;
    box.rows = Math.min(8, Math.max(2, Math.ceil(String(text).length / 40)));
    const row = make('span', 'snpc-line-edit-actions');
    const save = make('button', 'menu_button', 'Save');
    const cancel = make('button', 'menu_button', 'Cancel');
    for (const b of [save, cancel]) b.type = 'button';
    const done = () => { const v = box.value.trim(); if (v) onSave(v); else onCancel(); };
    save.addEventListener('click', (e) => { e.stopPropagation(); done(); });
    cancel.addEventListener('click', (e) => { e.stopPropagation(); onCancel(); });
    box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(); }
    });
    row.append(save, cancel);
    host.append(box, row);
    box.focus();
}
