import { loadArt } from '../activities-runtime.js';

/**
 * The hosting table (fork): the screen shared by Tea Time and Share a Meal. It is one tall column:
 *
 *   the guest's portrait (with their reaction),
 *   the table, with things to click on it (tea tins, the tea set, plates of food ...),
 *   a bar with what to do next, the buttons and the how-to.
 *
 * The chat beside it (and the Log and How to play tabs) belong to the activity window and are not drawn here.
 *
 * This file only draws and reports clicks. What the things are, and what happens when they are clicked, is the activity's business
 * (tea-ui.js, meal-ui.js). Every thing is a button with a cut-out picture; when no picture is found it shows a plain icon, so the
 * screen works with no art at all. Art keys: 'tea.tabletop' behind the table, then whatever a spot asks for ('tea.tin', 'tea.set',
 * 'tea.food', 'tea.cup', 'mech.prop', 'mech.food', 'mech.table'); see docs/ASSETS-README.md.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export const REACTION_ICON = { delighted: 'fa-face-grin-stars', pleased: 'fa-face-smile', neutral: 'fa-face-meh', uneasy: 'fa-face-frown-open', displeased: 'fa-face-angry' };
export const REACTION_WORD = { delighted: 'Delighted', pleased: 'Pleased', neutral: 'Neutral', uneasy: 'Uneasy', displeased: 'Displeased' };

/**
 * @param {{ partner: string, portraitUrl?: string, groups: { id: string, cols?: number, label?: string }[] }} o
 */
export function createHostTable({ partner, portraitUrl = '', groups = [] }) {
    const root = el('div', 'snpc-act-host');

    // 1. The guest.
    const portrait = el('div', 'snpc-act-hostportrait');
    if (portraitUrl) {
        const face = el('img', 'snpc-act-hostface');
        face.alt = partner;
        face.draggable = false;
        face.src = portraitUrl;
        face.addEventListener('error', () => { face.remove(); portrait.classList.add('is-plain'); });
        portrait.append(face);
    } else portrait.classList.add('is-plain');
    portrait.append(el('div', 'snpc-act-portrait-name', partner));
    const badge = el('div', 'snpc-act-hostmood');
    badge.hidden = true;
    badge.setAttribute('aria-live', 'polite');
    portrait.append(badge);

    // 2. The table.
    const table = el('div', 'snpc-act-hosttable');
    const tabletop = el('img', 'snpc-act-tabletop');
    tabletop.alt = '';
    tabletop.draggable = false;
    loadArt(tabletop, 'tea.tabletop', {}, () => { tabletop.remove(); table.classList.add('is-plain'); });
    table.append(tabletop);
    const boxes = new Map();
    for (const g of groups) {
        const box = el('div', `snpc-act-hostgroup is-${g.id}`);
        box.style.setProperty('--cols', String(g.cols || 4));
        if (g.label) box.setAttribute('aria-label', g.label);
        box.setAttribute('role', 'group');
        table.append(box);
        boxes.set(g.id, box);
    }

    // 3. The bar: what to do next, anything that needs room (a meter), and the buttons.
    const bar = el('div', 'snpc-act-hostbar');
    const hint = el('p', 'snpc-act-hosthint');
    hint.setAttribute('aria-live', 'polite');
    const slot = el('div', 'snpc-act-hostslot');
    const buttons = el('div', 'snpc-act-row snpc-act-hostbuttons');
    bar.append(hint, slot, buttons);

    root.append(portrait, table, bar);

    /**
     * Puts a clickable thing on the table. `layers` are the pictures stacked inside it: [{ key, vars, cls? }]; if the first one is
     * not found the thing shows `icon` instead.
     */
    function addSpot(groupId, { id, label, layers = [], icon = 'fa-circle', mark = null, onClick, title }) {
        const b = el('button', 'snpc-act-tableitem');
        b.type = 'button';
        b.dataset.spot = id;
        const art = el('span', 'snpc-act-spotart');
        layers.forEach((layer, i) => {
            const img = el('img', `snpc-act-sprite ${layer.cls || ''}`.trim());
            img.alt = '';
            img.draggable = false;
            loadArt(img, layer.key, layer.vars || {}, () => {
                img.remove();
                if (i === 0 && !art.querySelector('img')) art.append(el('i', `fa-solid ${icon} snpc-act-sprite-icon`));
            });
            art.append(img);
        });
        if (!layers.length) art.append(el('i', `fa-solid ${icon} snpc-act-sprite-icon`));
        b.append(art, el('span', 'snpc-act-itemname', label));
        const markEl = el('span', 'snpc-act-itemmark');
        const tick = el('span', 'snpc-act-itemcheck');
        tick.append(el('i', 'fa-solid fa-check'));
        tick.hidden = true;
        markEl.hidden = true;
        b.append(markEl, tick);
        const api = {
            el: b, id, label,
            setMark(m) {
                markEl.hidden = !m;
                markEl.replaceChildren(...(m ? [el('i', `fa-solid ${m === 'like' ? 'fa-heart' : 'fa-heart-crack'}`)] : []));
                api.mark = m;
                refresh();
            },
            setChosen(on) { b.classList.toggle('is-chosen', Boolean(on)); tick.hidden = !on; b.setAttribute('aria-pressed', String(Boolean(on))); api.chosen = Boolean(on); refresh(); },
            setDisabled(on) { b.disabled = Boolean(on); b.classList.toggle('is-off', Boolean(on)); },
            mark: null, chosen: false,
        };
        function refresh() {
            const words = [label];
            if (api.mark) words.push(`you know they ${api.mark === 'like' ? 'like' : 'dislike'} this`);
            if (api.chosen) words.push('chosen');
            b.setAttribute('aria-label', words.join(', '));
        }
        b.setAttribute('aria-pressed', 'false');
        b.title = title || label;
        refresh();
        b.addEventListener('click', () => onClick?.(api));
        api.setMark(mark);
        boxes.get(groupId)?.append(b);
        return api;
    }

    /** Puts a decoration on the table that cannot be clicked (the cup that was made, the plate that was chosen). */
    function addDecor(groupId, { layers = [], label = '' }) {
        const d = el('div', 'snpc-act-decor');
        if (label) d.setAttribute('aria-label', label);
        for (const layer of layers) {
            const img = el('img', `snpc-act-sprite ${layer.cls || ''}`.trim());
            img.alt = '';
            img.draggable = false;
            loadArt(img, layer.key, layer.vars || {}, () => img.remove());
            d.append(img);
        }
        boxes.get(groupId)?.append(d);
        return d;
    }

    const button = (text, onClick, { quiet = false, primary = false } = {}) => {
        const b = el('button', `snpc-act-btn${quiet ? ' is-quiet' : ''}`, text);
        b.type = 'button';
        b.addEventListener('click', onClick);
        if (primary) b.classList.add('is-primary');
        buttons.append(b);
        return b;
    };

    return {
        el: root, table, bar, slot, buttons, addSpot, addDecor, button, group: (id) => boxes.get(id),
        setHint: (text) => { hint.textContent = text; },
        /** The guest's face: an icon and a word, never colour alone. */
        setReaction(word) {
            badge.hidden = !word;
            badge.replaceChildren(...(word ? [el('i', `fa-solid ${REACTION_ICON[word] || 'fa-face-meh'}`), el('strong', '', REACTION_WORD[word] || 'Neutral')] : []));
            if (word) badge.setAttribute('aria-label', `${partner} reacted: ${REACTION_WORD[word] || 'Neutral'}`);
        },
    };
}
