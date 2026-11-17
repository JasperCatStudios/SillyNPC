import { saveSettings } from './settings.js';
import {
    MAX_KNIVES, MAX_KNIFE_TEXT, normalizeKnives, addKnife, editKnife, removeKnife, setKnifeUsed, resetKnives, unusedKnives,
} from './knives-core.js';
import { suggestKnives } from './knives-runtime.js';

/**
 * The Knives tab on a character's profile (fork): the story twists this character keeps, each with a used flag,
 * and a "Suggest knives" button that asks the model for more (added for review, never overwriting).
 *
 * Text boxes save as they are typed and nothing redraws while typing. The list redraws only after a button press
 * (add, delete, reset, suggest). Status is shown in a line of text; only a failure raises a toast.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/**
 * @param {object} char the character card (the saved object)
 * @returns {HTMLElement}
 */
export function buildKnivesCard(char) {
    const card = el('div', 'snpc-knives-card');
    char.knives = normalizeKnives(char.knives);

    card.append(el('p', 'notes',
        'Story twists this character can bring into the story: a secret, a debt, an old grudge. When the Knives trigger fires '
        + '(Modules, Combat), one unused twist of somebody in the scene is offered to the story model, hidden, and then marked used. '
        + 'The twist is told to the model as a hidden turn of events, never as a rule.'));

    const status = el('small', 'notes');
    status.setAttribute('role', 'status');
    const say = (text) => { status.textContent = text; };
    const commit = (list) => { char.knives = list; saveSettings(); };

    const listHost = el('div', 'snpc-knives-list');
    listHost.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin:8px 0;';

    const summary = () => {
        const n = char.knives.length;
        const u = unusedKnives(char.knives).length;
        say(n ? `${n} twist${n === 1 ? '' : 's'}, ${u} unused.` : 'No twists yet.');
    };

    const drawList = () => {
        listHost.replaceChildren();
        for (const knife of char.knives) {
            const line = el('div', 'snpc-knife-row');
            line.style.cssText = 'display:flex; gap:6px; align-items:flex-start;';

            const used = el('input');
            used.type = 'checkbox';
            used.checked = knife.used;
            used.title = 'Used: it has already gone to the story. Untick to arm it again.';
            used.style.marginTop = '8px';
            used.addEventListener('change', () => { commit(setKnifeUsed(char.knives, knife.id, used.checked)); summary(); });

            const text = el('textarea', 'text_pole');
            text.rows = 2;
            text.maxLength = MAX_KNIFE_TEXT;
            text.style.flex = '1';
            text.value = knife.text;
            // Saved as typed; the list is never redrawn from here.
            text.addEventListener('input', () => { commit(editKnife(char.knives, knife.id, text.value)); });

            const del = el('button', 'menu_button');
            del.type = 'button';
            del.title = 'Delete this twist';
            del.append(el('i', 'fa-solid fa-trash'));
            del.addEventListener('click', () => { commit(removeKnife(char.knives, knife.id)); drawList(); summary(); });

            line.append(used, text, del);
            listHost.append(line);
        }
    };

    // Add one by hand.
    const addRow = el('div');
    addRow.style.cssText = 'display:flex; gap:6px; align-items:flex-start; flex-wrap:wrap;';
    const addText = el('input', 'text_pole');
    addText.type = 'text';
    addText.placeholder = 'A new twist (for example: she owes a favour to someone she avoids)';
    addText.maxLength = MAX_KNIFE_TEXT;
    addText.style.cssText = 'flex:1; min-width:12em;';
    const addBtn = el('button', 'menu_button', 'Add');
    addBtn.type = 'button';
    const add = () => {
        if (!addText.value.trim()) return;
        if (char.knives.length >= MAX_KNIVES) { say(`At most ${MAX_KNIVES} twists per character.`); return; }
        commit(addKnife(char.knives, addText.value));
        addText.value = '';
        drawList(); summary();
    };
    addBtn.addEventListener('click', add);
    addText.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    addRow.append(addText, addBtn);

    const reset = el('button', 'menu_button', 'Reset used');
    reset.type = 'button';
    reset.title = 'Make every twist unused again.';
    reset.addEventListener('click', () => { commit(resetKnives(char.knives)); drawList(); summary(); });

    // Suggest.
    const suggest = el('div');
    suggest.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const theme = el('input', 'text_pole');
    theme.type = 'text';
    theme.placeholder = 'Theme (optional): betrayal, old debts, a missing sibling...';
    theme.maxLength = 80;
    theme.style.cssText = 'flex:1; min-width:12em;';
    const count = el('input', 'text_pole');
    count.type = 'number';
    count.min = '1'; count.max = '10'; count.value = '5';
    count.title = 'How many to ask for';
    count.style.width = '4.5em';
    const go = el('button', 'menu_button', 'Suggest knives');
    go.type = 'button';
    go.title = 'Asks the model (the Knives connection) for new twists and adds them to the list for you to review. Nothing is overwritten.';
    go.addEventListener('click', async () => {
        const n = Math.max(1, Math.min(10, Math.round(Number(count.value)) || 5));
        const room = MAX_KNIVES - char.knives.length;
        if (room <= 0) { say(`At most ${MAX_KNIVES} twists per character.`); return; }
        go.disabled = true;
        say('Asking for twists...');
        try {
            const found = await suggestKnives(char, { theme: theme.value, count: Math.min(n, room) });
            if (!found.length) { say('The model gave no twists that could be read. Try again.'); return; }
            let list = char.knives;
            for (const t of found) list = addKnife(list, t, theme.value);
            const added = list.length - char.knives.length;
            commit(list);
            drawList();
            say(`Added ${added} twist${added === 1 ? '' : 's'} for you to review. ${char.knives.length} in all.`);
        } catch (err) {
            console.warn('[Worldkit] suggest knives failed', err);
            say('Could not get suggestions.');
            toastr.error(`Could not get twists: ${err?.message || err}`, 'Worldkit');
        } finally {
            go.disabled = false;
        }
    });
    suggest.append(theme, count, go);

    const tools = el('div');
    tools.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px;';
    tools.append(reset, status);

    card.append(listHost, addRow, suggest, tools);
    drawList();
    summary();
    return card;
}
