import { listWorkflows, checkWorkflow, describeComfyError } from './comfy-engine.js';
import { API_FORMAT_HELP } from './comfy-core.js';

/**
 * The workflow chooser (fork), shared by the Images module and a character's profile: a list of the files in
 * SillyTavern's ComfyUI workflow folder, with a line under it saying whether the chosen one is API format.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** A box that says in plain words that workflows must be API format. Always shown where a workflow is chosen. */
export function apiFormatWarning() {
    const box = el('div', 'sillynpc-imagegen-warning');
    const icon = el('i', 'fa-solid fa-triangle-exclamation');
    const text = el('span', '', API_FORMAT_HELP);
    box.append(icon, text);
    return box;
}


/**
 * A select of the workflows in SillyTavern's ComfyUI folder, with a check line under it that says whether the
 * chosen file is API format and which placeholders it uses. Used here and on a character's profile.
 *
 * @param {{ value: string, blank: string, onChange: (name: string) => void, live?: boolean }} opts
 */
export function workflowPicker({ value, blank, onChange, live = true }) {
    const wrap = el('div', 'sillynpc-imagegen-workflow');
    const select = el('select', 'text_pole');
    select.append(new Option(blank, ''));
    const status = el('small', 'notes sillynpc-imagegen-check');
    const refresh = el('button', 'menu_button sillynpc-imagegen-refresh');
    refresh.type = 'button';
    refresh.title = 'Read the workflow folder again';
    refresh.append(el('i', 'fa-solid fa-rotate'));
    const row = el('div', 'sillynpc-imagegen-row');
    row.append(select, refresh);
    wrap.append(row, status);

    const show = async (name) => {
        status.className = 'notes sillynpc-imagegen-check';
        if (!name) { status.textContent = ''; return; }
        status.textContent = 'Checking…';
        const info = await checkWorkflow(name);
        status.textContent = info.message;
        status.classList.add(info.ok && info.hasPrompt ? 'is-ok' : 'is-bad');
    };
    const fill = async (force) => {
        if (!live) return;
        let list = [];
        try { list = await listWorkflows(force); } catch (err) { status.textContent = describeComfyError(err); status.classList.add('is-bad'); return; }
        select.replaceChildren(new Option(blank, ''));
        for (const name of list) select.append(new Option(name, name));
        // A chosen file that has been removed from the folder stays visible, marked, rather than silently vanishing.
        if (value && !list.includes(value)) select.append(new Option(`${value} (missing)`, value));
        select.value = value || '';
        show(select.value);
    };
    select.addEventListener('change', () => { value = select.value; onChange(select.value); show(select.value); });
    refresh.addEventListener('click', () => fill(true));
    select.value = value || '';
    if (value) select.append(new Option(value, value));
    select.value = value || '';
    fill(false);
    return wrap;
}

