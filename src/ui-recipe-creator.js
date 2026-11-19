import {
    creatorAvailability, filterItems, categoriesOf, usableItems, buildCustomRecipe, suggestRestore, allRecipes, MAX_INGREDIENTS, MAX_QTY,
} from './activity-recipe-creator-core.js';

/**
 * The recipe creator inside the Cooking activity (fork): choose items from the item database and save a dish of your own.
 *
 * The rules are in src/activity-recipe-creator-core.js. With no item database active (no items of your own) it says so and offers
 * nothing to choose. A saved recipe appears with the others, can be cooked and shows in the recipe book; "My recipes" lists them
 * with a Delete button.
 */

let wasOpen = false;

/**
 * @param {{ presetRecipes: object[], onChange: () => void, doc: Document, settings: object, save: () => void, getItems: () => object[] }} hooks
 *   `onChange` redraws the cooking setup after a recipe is saved or deleted; `doc`, `settings` (the Activities settings), `save` and
 *   `getItems` (the item database) are passed in so the screen can be tested without SillyTavern.
 * @returns {HTMLDetailsElement}
 */
export function renderRecipeCreator({ presetRecipes, onChange, doc, settings, save: saveSettings, getItems }) {
    const el = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const option = (label, value) => { const o = doc.createElement('option'); o.textContent = label; o.value = value; return o; };
    const s = settings;
    const items = getItems();
    const avail = creatorAvailability(items);

    const box = el('details', 'snpc-act-book snpc-act-creator');
    box.open = wasOpen;
    box.addEventListener('toggle', () => { wasOpen = box.open; });
    box.append(el('summary', '', 'Recipe creator'));

    if (!avail.ok) {
        const note = el('p', 'snpc-act-note is-small', avail.message);
        note.setAttribute('role', 'status');
        box.append(note);
    } else {
        const picks = [];
        const body = el('div');
        body.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:6px;';
        body.append(el('p', 'snpc-act-note is-small', `Choose up to ${MAX_INGREDIENTS} items from your item database (${avail.count} available), name the dish and save it. It is then in the list above.`));

        const name = el('input', 'snpc-act-select');
        name.type = 'text'; name.maxLength = 50; name.placeholder = 'Name of the dish';
        name.setAttribute('aria-label', 'Name of the dish');
        const desc = el('input', 'snpc-act-select');
        desc.type = 'text'; desc.maxLength = 90; desc.placeholder = 'A short description (optional)';
        desc.setAttribute('aria-label', 'Description');
        body.append(name, desc);

        const search = el('input', 'snpc-act-select');
        search.type = 'search'; search.placeholder = 'Search items'; search.setAttribute('aria-label', 'Search items');
        const cat = el('select', 'snpc-act-select');
        cat.setAttribute('aria-label', 'Category');
        cat.append(option('All categories', ''));
        for (const c of categoriesOf(usableItems(items))) cat.append(option(c, c));
        const filters = el('div', 'snpc-act-row');
        filters.append(search, cat);
        body.append(filters);

        const pool = el('div');
        pool.style.cssText = 'max-height:170px; overflow:auto; display:flex; flex-wrap:wrap; gap:6px; border:1px solid #a4947d55; border-radius:8px; padding:6px;';
        body.append(pool);

        const chosen = el('div');
        chosen.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
        const restore = el('input', 'snpc-act-select');
        restore.type = 'number'; restore.min = '0'; restore.max = '100';
        restore.setAttribute('aria-label', 'Hunger restored when eaten');
        const restoreRow = el('label', 'snpc-act-field-row');
        restoreRow.append(el('span', '', 'Hunger it restores'), restore);
        const message = el('p', 'snpc-act-note is-small');
        message.setAttribute('role', 'status');
        const save = el('button', 'snpc-act-btn', 'Save recipe');
        save.type = 'button';

        const drawPool = () => {
            pool.replaceChildren();
            const found = filterItems(items, { query: search.value, category: cat.value });
            if (!found.length) pool.append(el('small', '', 'No items match.'));
            for (const item of found.slice(0, 120)) {
                const b = el('button', 'snpc-act-btn is-quiet', item.name);
                b.type = 'button';
                b.title = item.category || '';
                b.disabled = picks.some(p => p.name === item.name) || picks.length >= MAX_INGREDIENTS;
                b.addEventListener('click', () => { picks.push({ name: item.name, qty: 1 }); drawChosen(); drawPool(); });
                pool.append(b);
            }
        };
        const drawChosen = () => {
            chosen.replaceChildren();
            if (!picks.length) chosen.append(el('small', '', 'No items chosen yet.'));
            picks.forEach((p, at) => {
                const row = el('div', 'snpc-act-row');
                row.append(el('span', '', p.name));
                const qty = el('input', 'snpc-act-select');
                qty.type = 'number'; qty.min = '1'; qty.max = String(MAX_QTY); qty.value = String(p.qty); qty.style.width = '4.5em';
                qty.setAttribute('aria-label', `How many ${p.name}`);
                qty.addEventListener('change', () => { p.qty = Math.max(1, Math.min(MAX_QTY, Math.round(Number(qty.value)) || 1)); qty.value = String(p.qty); restore.placeholder = String(suggestRestore(picks)); });
                const rm = el('button', 'snpc-act-btn is-quiet', 'Remove');
                rm.type = 'button';
                rm.addEventListener('click', () => { picks.splice(at, 1); drawChosen(); drawPool(); });
                row.append(qty, rm);
                chosen.append(row);
            });
            restore.placeholder = String(suggestRestore(picks));
        };
        search.addEventListener('input', drawPool);
        cat.addEventListener('change', drawPool);
        save.addEventListener('click', () => {
            const taken = allRecipes(presetRecipes, s.myRecipes);
            const made = buildCustomRecipe({ name: name.value, desc: desc.value, picks, restore: restore.value, taken, items });
            if (!made.ok) { message.textContent = made.reason; return; }
            s.myRecipes = (s.myRecipes || []).concat([made.recipe]);
            saveSettings();
            wasOpen = true;
            onChange();
        });
        body.append(chosen, restoreRow, message, save);
        box.append(body);
        drawPool();
        drawChosen();
    }

    // The player's own recipes, with a way to remove one.
    const mine = s.myRecipes || [];
    if (mine.length) {
        const list = el('div');
        list.style.cssText = 'margin-top:10px; display:flex; flex-direction:column; gap:4px;';
        list.append(el('strong', '', 'My recipes'));
        for (const r of mine) {
            const row = el('div', 'snpc-act-row');
            row.append(el('span', '', `${r.name}: ${r.needs.map(n => `${n.qty > 1 ? `${n.qty} ` : ''}${n.label}`).join(', ')}${r.restore !== undefined ? ` (restores ${r.restore} hunger)` : ''}`));
            const del = el('button', 'snpc-act-btn is-quiet', 'Delete');
            del.type = 'button';
            del.addEventListener('click', () => {
                s.myRecipes = (s.myRecipes || []).filter(x => x.id !== r.id);
                saveSettings();
                wasOpen = true;
                onChange();
            });
            row.append(del);
            list.append(row);
        }
        box.append(list);
    }
    return box;
}
