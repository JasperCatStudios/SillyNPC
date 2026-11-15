import { listRecords, addRecord, updateRecord, removeRecord } from './rivalry.js';
import { tally, tallyText, RESULTS } from './rivalry-core.js';

/**
 * The history window (fork): every fight, spar and game in this chat, editable.
 *
 * Change a result, reword the summary, add a note the characters will be told about, delete
 * what did not happen, or add something that did happen off screen.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

let overlay = null;

function close() {
    overlay?.remove();
    overlay = null;
}

function dateText(ts) {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function draw(filter) {
    const panel = overlay.querySelector('.snpc-hist');
    panel.replaceChildren();

    const head = el('div', 'snpc-hist-head');
    head.append(el('span', '', 'History'));
    const x = el('button', 'snpc-hist-close', '×');
    x.type = 'button';
    x.addEventListener('click', close);
    head.append(x);
    panel.append(head);

    const all = listRecords();
    const names = [...new Set(all.map(r => r.opponent))].sort();
    const bar = el('div', 'snpc-hist-bar');
    const who = el('select', 'text_pole');
    who.append(new Option('Everyone', ''));
    for (const n of names) who.append(new Option(n, n));
    if (filter && !names.includes(filter)) who.append(new Option(filter, filter));
    who.value = filter || '';
    who.addEventListener('change', () => draw(who.value));
    bar.append(who, el('span', 'snpc-hist-tally', tallyText(tally(all, who.value))));
    panel.append(bar);

    const list = el('div', 'snpc-hist-list');
    const shown = all.filter(r => !who.value || r.opponent.toLowerCase() === who.value.toLowerCase()).reverse();
    if (!shown.length) list.append(el('p', 'notes', 'Nothing here yet. Fights and games are added when they end.'));
    for (const r of shown) {
        const row = el('div', `snpc-hist-row is-${r.result}`);
        const top = el('div', 'snpc-hist-top');
        top.append(el('b', '', `${r.kind === 'game' ? (r.game || 'Game') : (r.game || 'Fight')} vs ${r.opponent}`), el('small', 'notes', dateText(r.at)));
        const result = el('select', 'text_pole');
        for (const v of RESULTS) result.append(new Option(v === 'won' ? 'You won' : v === 'lost' ? 'You lost' : 'Draw', v));
        result.value = r.result;
        result.addEventListener('change', () => { updateRecord(r.id, { result: result.value }); draw(who.value); });
        const del = el('button', 'menu_button', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => { removeRecord(r.id); draw(who.value); });
        top.append(result, del);
        const summary = el('input', 'text_pole');
        summary.value = r.summary;
        summary.placeholder = 'What happened';
        summary.addEventListener('change', () => updateRecord(r.id, { summary: summary.value }));
        const note = el('input', 'text_pole');
        note.value = r.note;
        note.placeholder = 'Your note (they are told it)';
        note.addEventListener('change', () => updateRecord(r.id, { note: note.value }));
        row.append(top, summary, note);
        list.append(row);
    }
    panel.append(list);

    // Something that happened off screen.
    const add = el('div', 'snpc-hist-add');
    const who2 = el('input', 'text_pole');
    who2.placeholder = 'Opponent';
    who2.value = who.value || '';
    const kind = el('select', 'text_pole');
    kind.append(new Option('Fight', 'combat'), new Option('Game', 'game'));
    const res = el('select', 'text_pole');
    res.append(new Option('You won', 'won'), new Option('You lost', 'lost'), new Option('Draw', 'draw'));
    const text = el('input', 'text_pole');
    text.placeholder = 'What happened';
    const go = el('button', 'menu_button', 'Add');
    go.type = 'button';
    go.addEventListener('click', () => {
        if (!who2.value.trim()) { toastr.info('Say who it was against.', 'SillyNPC'); return; }
        addRecord({ kind: kind.value, opponent: who2.value, result: res.value, summary: text.value, game: kind.value === 'game' ? 'Game' : 'Fight' });
        draw(who2.value.trim());
    });
    add.append(who2, kind, res, text, go);
    panel.append(el('div', 'snpc-hist-addtitle', 'Add one'), add);
}

/** Opens the history window, optionally already narrowed to one opponent. */
export function openRivalryEditor(opponent = '') {
    close();
    overlay = el('div', 'snpc-hist-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.append(el('div', 'snpc-hist'));
    document.body.append(overlay);
    draw(opponent);
}
