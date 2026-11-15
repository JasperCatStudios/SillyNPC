import { injectSettings, saveInjectSettings, currentInjection } from './history-inject.js';
import { listRecords } from './rivalry.js';
import { tally, tallyText } from './rivalry-core.js';
import { INJECT_POSITIONS, INJECT_ROLES, INJECT_TRIGGERS, INJECT_ORDERS } from './rivalry-inject-core.js';
import { openRivalryEditor } from './ui-rivalry.js';
import { mountVectorPanel } from './ui-vectors.js';

/**
 * The History view of the Combat tab (fork): how the shared history of fights and games gets
 * into the story prompt, and a way into the history itself.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const row = (label, input, hint) => {
    const wrap = el('div', 'sillynpc-setting-row snpc-hi-row');
    const l = el('label', '', label);
    if (hint) l.title = hint;
    wrap.append(l, input);
    return wrap;
};

function select(table, value, onChange) {
    const s = el('select', 'text_pole');
    for (const [k, v] of Object.entries(table)) s.append(new Option(v, k));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

function number(value, min, max, onChange, step = 1) {
    const i = el('input', 'text_pole');
    i.type = 'number';
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    i.addEventListener('change', () => onChange(Number(i.value)));
    return i;
}

export function renderHistoryView(host, rerender) {
    const o = injectSettings();
    const set = (patch, redraw = false) => { saveInjectSettings(patch); if (redraw) rerender(); };

    const all = listRecords();
    const top = el('div', 'sillynpc-combat-banner');
    top.append(el('span', '', `This chat has ${all.length} recorded fight${all.length === 1 ? '' : 's'} and game${all.length === 1 ? '' : 's'} (${tallyText(tally(all))}).`));
    const open = el('button', 'menu_button', 'Open history');
    open.type = 'button';
    open.addEventListener('click', () => openRivalryEditor(''));
    top.append(open);
    host.append(top);

    host.append(el('h4', 'sillynpc-combat-heading', 'In the story prompt'));
    host.append(el('p', 'notes', 'Adds the shared history to the prompt the main model sees, so the people in your story can remember it and bring it up on their own. It is placed the way a lorebook entry is.'));

    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.checked = o.enabled;
    enabled.addEventListener('change', () => set({ enabled: enabled.checked }, true));
    const toggle = el('label', 'checkbox_label');
    toggle.append(enabled, el('span', '', 'Put the history in the story prompt'));
    host.append(toggle);
    // Vectors pick which records fill the slots; their list is useful even with injection off.
    const vectors = el('div');
    if (!o.enabled) { host.append(vectors); mountVectorPanel(vectors, 'rivalry'); mountFightTalk(host); return; }

    host.append(row('Where', select(INJECT_POSITIONS, o.position, v => set({ position: v }, true))));
    if (o.position === 'chat') host.append(row('Messages back', number(o.depth, 0, 100, v => set({ depth: v })), '0 is right after the newest message'));
    host.append(row('Role', select(INJECT_ROLES, o.role, v => set({ role: v }))));
    host.append(row('When', select(INJECT_TRIGGERS, o.trigger, v => set({ trigger: v }, true))));
    if (o.trigger === 'mentioned') host.append(row('Look back', number(o.scanDepth, 1, 50, v => set({ scanDepth: v })), 'How many recent messages to read for names'));
    host.append(row(o.trigger === 'random' ? 'Chance for each person (%)' : 'Chance for each person (%)',
        number(o.chance, 0, 100, v => set({ chance: v })),
        o.trigger === 'random' ? 'Left at 100 this is treated as 35, so it really is occasional' : 'Rolled on every message, on top of the trigger. Below 100 means they only sometimes remember.'));
    host.append(row('Order', select(INJECT_ORDERS, o.order, v => set({ order: v })), 'Which person comes first, and who is dropped when there are more than the limit'));
    host.append(row('Most people at once', number(o.maxPeople, 1, 10, v => set({ maxPeople: v }))));
    host.append(row('Entries per person', number(o.recent, 1, 20, v => set({ recent: v })), 'How many of the latest encounters are written out'));

    const text = el('textarea', 'text_pole');
    text.rows = 3;
    text.value = o.instruction;
    text.addEventListener('change', () => set({ instruction: text.value }));
    host.append(row('Instruction', text, 'Sent after the history. Say how much the characters should lean on it.'));

    const preview = el('pre', 'snpc-hi-preview');
    const show = el('button', 'menu_button', 'Preview');
    show.type = 'button';
    show.title = 'What would be sent, ignoring the trigger and the dice';
    show.addEventListener('click', () => { preview.textContent = currentInjection({ everyone: true }) || 'Nothing: there is no history in this chat yet.'; });
    host.append(show, preview);
    host.append(vectors);
    mountVectorPanel(vectors, 'rivalry');
    mountFightTalk(host);
}

/** What was said during fights in this chat: its own Vectors panel, with its own prompt block. */
function mountFightTalk(host) {
    const box = el('div');
    host.append(box);
    mountVectorPanel(box, 'combat');
}
