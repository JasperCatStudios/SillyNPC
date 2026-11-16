import { getSettings } from './settings.js';

/**
 * Finding a character among many.
 *
 * The Entry Library has had a filter since it was written; the grid beside it did not,
 * and past a certain number of cards finding one by eye stops working.
 *
 * Its own module rather than another hundred lines of ui-manage.js, and because the
 * matching and the hiding are worth testing without opening a popup to do it.
 */

/**
 * What the grid is filtered to.
 *
 * Module-level so it survives the redraws that deleting, dragging and importing cause - a
 * filter that clears itself the moment you act on what it found is worse than none.
 */
let gridFilter = '';

/** Everything about a character worth searching: their name, their other names, their category. */
export function cardHaystack(char) {
    return [
        char.name,
        char.category,
        ...(char.aliases || []).map(alias => alias?.pattern),
    ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Shows only the cards that answer the filter, and hides a heading left with nothing.
 *
 * By hiding rather than by rebuilding, so typing never destroys the box being typed into.
 * The grid is rebuilt only when something actually changes.
 *
 * @param {HTMLElement} root The card grid.
 * @returns {number} How many characters are showing.
 */
export function applyGridFilter(root) {
    const needle = gridFilter.trim().toLowerCase();
    const byId = new Map((getSettings().characters || []).map(c => [c.id, c]));
    let shown = 0;

    // Each category is a section holding its banner, heading and cards, so a category that
    // matches nothing disappears as one piece.
    for (const section of root.children) {
        if (!String(section.className || '').includes('sillynpc-cat-section')) continue;
        const sub = [...section.children].find(c => String(c.className || '').includes('sillynpc-card-subgrid'));
        if (!sub) continue;

        let here = 0;
        for (const card of sub.children) {
            // The + card makes a new character; it answers no search.
            if (String(card.className || '').includes('sillynpc-card-add')) {
                card.style.display = needle ? 'none' : '';
                continue;
            }
            const char = byId.get(card.dataset?.id);
            const match = !needle || (char && cardHaystack(char).includes(needle));
            card.style.display = match ? '' : 'none';
            if (match) here++;
        }
        shown += here;

        // A section with nothing in it is a category that does not match, and a column of
        // empty ones is what makes a filter feel broken.
        section.style.display = (!needle || here > 0) ? '' : 'none';
    }

    return shown;
}

/**
 * The box above the grid.
 *
 * The Entry Library has had one of these since it was written, and this is the same
 * problem: past a certain number of cards, finding one by eye stops working.
 *
 * @param {HTMLElement} root The card grid, filtered in place.
 * @returns {{ row: HTMLElement, apply: () => void }}
 */
export function buildGridFilterRow(root) {
    const row = document.createElement('div');
    row.className = 'sillynpc-grid-filter';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'text_pole sillynpc-grid-filter-input';
    input.placeholder = 'Find a character…';
    input.title = 'Matches a name, any of their other names, or their category.';
    input.value = gridFilter;

    const count = document.createElement('small');
    count.className = 'notes sillynpc-grid-filter-count';

    const apply = () => {
        const shown = applyGridFilter(root);
        const total = (getSettings().characters || []).length;
        count.textContent = gridFilter.trim()
            ? (shown ? `${shown} of ${total}` : 'Nobody by that name')
            : '';
    };

    input.addEventListener('input', () => { gridFilter = input.value; apply(); });
    // A search input's own clear button fires this rather than input on some browsers.
    input.addEventListener('search', () => { gridFilter = input.value; apply(); });

    row.append(input, count);
    return { row, apply };
}
