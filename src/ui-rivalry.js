import { name1 } from '../../../../../script.js';
import { listRecords, addRecord, updateRecord, removeRecord } from './rivalry.js';
import {
    tally, tallyVsPlayer, tallyText, sideList, sideNames, sideOf, tookPart, knowsOf, peopleIn, sidesText,
} from './rivalry-core.js';

import { PRODUCT_NAME } from './constants.js';
/**
 * The history window (fork): every fight, spar and game in this chat, editable.
 *
 * Each record has two sides of any number of people, so it can be the player against someone,
 * a team fight, or two other people entirely. Change who was on which side, who won, reword the
 * summary, add a note the characters will be told about, delete what did not happen, or add
 * something that did happen off screen.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const you = () => name1 || 'You';

let overlay = null;

function close() {
    overlay?.remove();
    overlay = null;
}

function dateText(ts) {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The names typed for a side, without the player (they are marked by "You were on"). */
const typedSide = (input) => sideList(input.value).filter(n => !same(n, you()));

/** A side's names for its input: everyone but the player. */
const sideValue = (r, side) => sideNames(r, side, '').filter(n => !(r.userSide && (same(n, r.player) || same(n, you())))).join(', ');

function userSideSelect(value) {
    const s = el('select', 'text_pole');
    s.title = 'Which side you were on';
    s.append(new Option('You: side A', 'A'), new Option('You: side B', 'B'), new Option('You: not there', ''));
    s.value = value;
    return s;
}

function winnerSelect(labelA, labelB, value) {
    const s = el('select', 'text_pole');
    s.append(new Option(`${labelA} won`, 'A'), new Option(`${labelB} won`, 'B'), new Option('Draw', 'draw'));
    s.value = value;
    return s;
}

/** The sides as written into a record: the player's name goes on their side. */
function sidesPatch(aInput, bInput, userSide, player) {
    const a = typedSide(aInput);
    const b = typedSide(bInput);
    const me = player || you();
    if (userSide === 'A') a.unshift(me);
    if (userSide === 'B') b.unshift(me);
    return { sideA: a, sideB: b, userSide, player: userSide ? me : '' };
}

/** won / lost / draw for the row's colour: from the chosen person's side, else the player's. */
function rowResult(r, person) {
    const side = person ? sideOf(r, person) : r.userSide;
    if (!side) return 'others';
    if (r.winner === 'draw') return 'draw';
    return r.winner === side ? 'won' : 'lost';
}

function headTally(all, person) {
    if (!person) return tallyText(tally(all));
    const own = tallyText(tally(all, person));
    const vs = tallyVsPlayer(all, person);
    return vs.total ? `${person}: ${own} · you against them: ${tallyText(vs)}` : `${person}: ${own}`;
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
    const names = peopleIn(all, you()).sort((a, b) => a.localeCompare(b));
    const bar = el('div', 'snpc-hist-bar');
    const who = el('select', 'text_pole');
    who.append(new Option('Everyone', ''));
    for (const n of names) who.append(new Option(n, n));
    if (filter && !names.some(n => same(n, filter))) who.append(new Option(filter, filter));
    who.value = names.find(n => same(n, filter)) || filter || '';
    who.addEventListener('change', () => draw(who.value));
    bar.append(who, el('span', 'snpc-hist-tally', headTally(all, who.value)));
    panel.append(bar);

    const list = el('div', 'snpc-hist-list');
    // A person's history is the records they took part in, on either side.
    const shown = all.filter(r => !who.value || knowsOf(r, who.value)).reverse();
    if (!shown.length) list.append(el('p', 'notes', 'Nothing here yet. Fights and games are added when they end.'));
    for (const r of shown) list.append(recordRow(r, who.value));
    panel.append(list);

    panel.append(el('div', 'snpc-hist-addtitle', 'Add one'), addForm(who.value));
}

function recordRow(r, filter) {
    const redraw = () => draw(filter);
    const row = el('div', `snpc-hist-row is-${rowResult(r, filter)}`);
    const top = el('div', 'snpc-hist-top');
    const what = r.kind === 'game' ? (r.game || 'Game') : (r.game || 'Fight');
    top.append(el('b', '', `${what}: ${sidesText(r, you())}`), el('small', 'notes', dateText(r.at)));
    const a = sideNames(r, 'A', you()).join(', ') || 'Side A';
    const b = sideNames(r, 'B', you()).join(', ') || 'Side B';
    const winner = winnerSelect(a, b, r.winner);
    winner.addEventListener('change', () => { updateRecord(r.id, { winner: winner.value }); redraw(); });
    const del = el('button', 'menu_button', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => { removeRecord(r.id); redraw(); });
    top.append(winner, del);

    // Who was on which side.
    const sides = el('div', 'snpc-hist-sides');
    const sideA = el('input', 'text_pole');
    sideA.value = sideValue(r, 'A');
    sideA.placeholder = 'Side A: names, comma separated';
    const sideB = el('input', 'text_pole');
    sideB.value = sideValue(r, 'B');
    sideB.placeholder = 'Side B: names, comma separated';
    const mine = userSideSelect(r.userSide);
    const saveSides = () => {
        const patch = sidesPatch(sideA, sideB, mine.value, r.player);
        if (!updateRecord(r.id, patch)) toastr.info('A record needs someone other than you in it.', PRODUCT_NAME);
        redraw();
    };
    sideA.addEventListener('change', saveSides);
    sideB.addEventListener('change', saveSides);
    mine.addEventListener('change', saveSides);
    sides.append(sideA, el('span', 'notes', 'vs'), sideB, mine);

    const summary = el('input', 'text_pole');
    summary.value = r.summary;
    summary.placeholder = 'What happened';
    summary.addEventListener('change', () => updateRecord(r.id, { summary: summary.value }));
    const note = el('input', 'text_pole');
    note.value = r.note;
    note.placeholder = 'Your note (they are told it)';
    note.addEventListener('change', () => updateRecord(r.id, { note: note.value }));
    row.append(top, sides, summary, note);
    return row;
}

/** Something that happened off screen: any people, on two sides, with or without the player. */
function addForm(filter) {
    const add = el('div', 'snpc-hist-add');
    const kind = el('select', 'text_pole');
    kind.append(new Option('Fight', 'combat'), new Option('Game', 'game'));
    const game = el('input', 'text_pole');
    game.placeholder = 'Name (Spar, Chess…)';
    const sideA = el('input', 'text_pole');
    sideA.placeholder = 'Side A: names, comma separated';
    const sideB = el('input', 'text_pole');
    sideB.placeholder = 'Side B: names, comma separated';
    sideB.value = filter || '';
    const mine = userSideSelect('A');
    const winner = winnerSelect('Side A', 'Side B', 'A');
    const text = el('input', 'text_pole');
    text.placeholder = 'What happened';
    const go = el('button', 'menu_button', 'Add');
    go.type = 'button';
    go.addEventListener('click', () => {
        const patch = sidesPatch(sideA, sideB, mine.value, '');
        const others = [...patch.sideA, ...patch.sideB].filter(n => !(patch.userSide && same(n, patch.player)));
        if (!others.length) { toastr.info('Say who took part.', PRODUCT_NAME); return; }
        if (!patch.sideA.length || !patch.sideB.length) { toastr.info('Both sides need someone.', PRODUCT_NAME); return; }
        const label = game.value.trim() || (kind.value === 'game' ? 'Game' : 'Fight');
        addRecord({ kind: kind.value, game: label, ...patch, winner: winner.value, summary: text.value });
        draw(filter || others[0]);
    });
    const first = el('div', 'snpc-hist-sides');
    first.append(sideA, el('span', 'notes', 'vs'), sideB, mine);
    add.append(kind, game, winner, text, go);
    const wrap = el('div', 'snpc-hist-addwrap');
    wrap.append(first, add);
    return wrap;
}

/** Opens the history window, optionally already narrowed to one person's records. */
export function openRivalryEditor(person = '') {
    close();
    overlay = el('div', 'snpc-hist-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.append(el('div', 'snpc-hist'));
    document.body.append(overlay);
    draw(person);
}
