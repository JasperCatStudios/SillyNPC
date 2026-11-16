import { listWorkflows, loadWorkflowText, bindingsFor, setBindings, describeComfyError } from './comfy-engine.js';
import { BINDING_ROLES, detectBindings, normalizeBindings } from './comfy-bindings.js';

/**
 * The workflow inputs editor (fork): for a workflow that takes pictures and a prompt through nodes rather than
 * %placeholders%, say which node input is you, which are the other people, which is the place, and where the
 * prompt, the seed and the size go. It reads the workflow, guesses from the node titles, and keeps what is chosen
 * per workflow file.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const IMAGE_ROLES = BINDING_ROLES.filter(r => r.kind === 'image');

/** A select of roles for one node input; `blank` is the "not used" line. */
function roleSelect(roles, value, blank) {
    const select = el('select', 'text_pole');
    select.append(new Option(blank, ''));
    for (const r of roles) select.append(new Option(r.label, r.id));
    select.value = value || '';
    return select;
}

export function bindingsEditor({ live = true } = {}) {
    const wrap = el('div', 'sillynpc-imagegen-bindings');
    const pick = el('select', 'text_pole');
    pick.append(new Option('Choose a workflow to set up its inputs…', ''));
    const body = el('div', 'sillynpc-imagegen-bindings-body');
    wrap.append(pick, body);

    // The rows' current choices, by "node|input".
    let rows = [];
    let current = '';

    const save = () => {
        const list = rows.map(r => ({ role: r.select.value, node: r.node, input: r.input })).filter(b => b.role);
        const clean = normalizeBindings(list);
        if (clean.length < list.length) toastr.info('A role can only be used once, and so can an input: the later duplicates were dropped.', 'Worldkit');
        setBindings(current, clean);
        return clean;
    };

    const draw = async (name) => {
        current = name;
        body.replaceChildren();
        rows = [];
        if (!name) return;
        let detected;
        try { detected = detectBindings(await loadWorkflowText(name)); }
        catch (err) { body.append(el('small', 'notes sillynpc-imagegen-check is-bad', describeComfyError(err))); return; }
        const saved = bindingsFor(name);
        const roleOf = (node, input) => saved.find(b => b.node === node && b.input === input)?.role || '';

        const add = (heading, hint, items, roles, blank, label) => {
            if (!items.length) return;
            body.append(el('b', '', heading));
            if (hint) body.append(el('small', 'notes', hint));
            for (const item of items) {
                const select = roleSelect(roles, roleOf(item.node, item.input), blank);
                select.addEventListener('change', () => { const clean = save(); void clean; });
                const row = el('div', 'sillynpc-imagegen-bind-row');
                row.append(el('span', 'sillynpc-imagegen-bind-name', label(item)), select);
                body.append(row);
                rows.push({ node: item.node, input: item.input, select });
            }
        };
        add('Pictures', 'Which picture slot is you, which are the other people, and which is the place. Unused people slots are left out.',
            detected.images, IMAGE_ROLES, 'Not used by Worldkit',
            i => `Node ${i.node}: ${i.title.replace(/^.*?\((.*)\)\s*$/, '$1')}  (now ${i.current})`);
        add('Prompt', 'Where the wording of the scene goes.', detected.texts,
            BINDING_ROLES.filter(r => r.kind === 'text'), 'Leave as it is',
            t => `Node ${t.node} ${t.input}: ${t.title.replace(/^.*?\((.*)\)\s*$/, '$1')}`);
        const numberRoles = ['seed', 'width', 'height'];
        const numberItems = detected.numbers.filter((n, i, all) => all.findIndex(m => m.node === n.node && m.input === n.input) === i);
        if (numberItems.length) {
            body.append(el('b', '', 'Seed and size'));
            body.append(el('small', 'notes', 'A random seed each time, and the picture size from the module settings.'));
            for (const item of numberItems) {
                const options = BINDING_ROLES.filter(r => numberRoles.includes(r.id) && r.id === item.role);
                const select = roleSelect(options, roleOf(item.node, item.input), 'Leave as it is');
                select.addEventListener('change', () => save());
                const row = el('div', 'sillynpc-imagegen-bind-row');
                row.append(el('span', 'sillynpc-imagegen-bind-name', `Node ${item.node} ${item.input}: ${item.title.replace(/^.*?\((.*)\)\s*$/, '$1')}`), select);
                body.append(row);
                rows.push({ node: item.node, input: item.input, select });
            }
        }
        if (!rows.length) { body.append(el('small', 'notes', 'This workflow has no picture, prompt or seed inputs to set. Placeholders in it still work.')); return; }
        const use = el('button', 'menu_button', 'Use the detected inputs');
        use.type = 'button';
        use.title = 'Guess from the node titles: pictures in their numbered order (1 is you), the one called location last';
        use.addEventListener('click', () => {
            for (const r of rows) r.select.value = detected.suggested.find(b => b.node === r.node && b.input === r.input)?.role || '';
            const clean = save();
            toastr.success(`${clean.length} input${clean.length === 1 ? '' : 's'} set from the node titles.`, 'Worldkit');
        });
        const status = el('small', 'notes', saved.length ? `${saved.length} inputs set for this workflow.` : 'Nothing set yet: press the button to use what was detected.');
        select_status(status, rows);
        body.append(use, status);
    };
    // keeps the line under the button honest as choices change
    const select_status = (status, list) => {
        const update = () => { const n = list.filter(r => r.select.value).length; status.textContent = n ? `${n} input${n === 1 ? '' : 's'} set for this workflow.` : 'Nothing set yet: press the button to use what was detected.'; };
        for (const r of list) r.select.addEventListener('change', update);
    };

    const fill = async () => {
        if (!live) return;
        let names = [];
        try { names = await listWorkflows(false); } catch { return; }
        for (const n of names) pick.append(new Option(n, n));
    };
    pick.addEventListener('change', () => draw(pick.value));
    fill();
    return wrap;
}
