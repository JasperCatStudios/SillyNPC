import { saveSettings } from './settings.js';
import { requestOnConnection } from './connections.js';
import { profileText } from './profile-text.js';
import {
    PREF_CATEGORIES, PREF_LABELS, PREF_MAX_CHARS, PREF_NOTE_MAX, GENERIC_SUGGESTIONS,
    normalizePrefs, addPref, removePref, setNote, hasPrefs, buildPrefsRequest, parsePrefSuggestion,
} from './likes-core.js';

/**
 * The Likes tab on a character's profile (fork): what they like and dislike, in five lists (teas, foods,
 * activities, gifts, topics) and a free note. Activities such as Tea Time read it, and so can the story.
 *
 * Chips save as you press a button; the note saves as you type and is never redrawn from there. "Suggest from
 * lore" asks the model (the Activities connection) and shows what it found as chips to keep or drop: nothing is
 * applied silently. A card is only given a `prefs` field once something is set.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const LIKE = '#3f9b5a';
const DISLIKE = '#c0504d';

/**
 * @param {object} char the character card (the saved object)
 * @param {{ suggestions?: Partial<Record<string, string[]>> }} [opts] pick lists from a world preset
 * @returns {HTMLElement}
 */
export function buildLikesCard(char, { suggestions } = {}) {
    const card = el('div', 'snpc-likes-card');
    card.append(el('p', 'notes',
        'What this character likes and dislikes. Tea Time and other activities read it, and it can colour how they talk. '
        + 'Tap a chip to remove it. Press Like or Dislike to add what you typed.'));

    const status = el('small', 'notes');
    status.setAttribute('role', 'status');
    const say = (text) => { status.textContent = text; };

    const commit = (prefs) => {
        // The field is only written once there is something in it, and dropped again when emptied.
        if (hasPrefs(prefs)) char.prefs = prefs; else delete char.prefs;
        saveSettings();
    };
    const current = () => normalizePrefs(char.prefs);

    /** Suggestions waiting for a decision: { side, category, value }. Not saved. */
    let pending = [];

    const chip = (text, color, { ghost = false, onRemove, onKeep } = {}) => {
        const c = el('span', 'snpc-pref-chip');
        c.style.cssText = `display:inline-flex; align-items:center; gap:4px; padding:2px 4px 2px 8px; margin:2px; border-radius:12px; border:1px ${ghost ? 'dashed' : 'solid'} ${color}; ${ghost ? '' : `background:${color}22;`} font-size:0.9em; min-height:28px;`;
        c.append(el('span', '', text));
        if (onKeep) {
            const keep = el('button', 'menu_button');
            keep.type = 'button'; keep.title = 'Keep'; keep.setAttribute('aria-label', `Keep ${text}`);
            keep.style.cssText = 'padding:2px 6px; margin:0; min-height:24px;';
            keep.append(el('i', 'fa-solid fa-check'));
            keep.addEventListener('click', onKeep);
            c.append(keep);
        }
        const x = el('button', 'menu_button');
        x.type = 'button'; x.title = ghost ? 'Drop' : 'Remove'; x.setAttribute('aria-label', `${ghost ? 'Drop' : 'Remove'} ${text}`);
        x.style.cssText = 'padding:2px 6px; margin:0; min-height:24px;';
        x.append(el('i', 'fa-solid fa-xmark'));
        x.addEventListener('click', onRemove);
        c.append(x);
        return c;
    };

    const rowsHost = el('div', 'snpc-likes-rows');
    rowsHost.style.cssText = 'display:flex; flex-direction:column; gap:10px; margin:8px 0;';

    const draw = () => {
        const prefs = current();
        rowsHost.replaceChildren();
        for (const category of PREF_CATEGORIES) {
            const row = el('div', 'snpc-likes-row');
            row.append(el('strong', '', PREF_LABELS[category]));

            const chips = el('div');
            chips.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; min-height:30px;';
            for (const side of ['likes', 'dislikes']) {
                const color = side === 'likes' ? LIKE : DISLIKE;
                for (const value of prefs[side][category]) {
                    chips.append(chip(`${side === 'likes' ? '👍' : '👎'} ${value}`, color, {
                        onRemove: () => { commit(removePref(char.prefs, side, category, value).prefs); draw(); },
                    }));
                }
            }
            for (const s of pending.filter(p => p.category === category)) {
                chips.append(chip(`${s.side === 'likes' ? '👍' : '👎'} ${s.value}?`, s.side === 'likes' ? LIKE : DISLIKE, {
                    ghost: true,
                    onKeep: () => { commit(addPref(char.prefs, s.side, s.category, s.value).prefs); pending = pending.filter(p => p !== s); draw(); },
                    onRemove: () => { pending = pending.filter(p => p !== s); draw(); },
                }));
            }
            if (!chips.childNodes.length) chips.append(el('small', 'notes', 'Nothing yet.'));
            row.append(chips);

            const add = el('div');
            add.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;';
            const input = el('input', 'text_pole');
            input.type = 'text';
            input.maxLength = PREF_MAX_CHARS;
            input.placeholder = `Add to ${PREF_LABELS[category].toLowerCase()}`;
            input.style.cssText = 'flex:1; min-width:10em;';
            const listId = `snpc-likes-${category}-${char.id || 'card'}`;
            const list = el('datalist');
            list.id = listId;
            for (const s of (suggestions?.[category] || GENERIC_SUGGESTIONS[category] || [])) list.append(new Option(s, s));
            input.setAttribute('list', listId);
            const press = (side) => {
                if (!input.value.trim()) return;
                const res = addPref(char.prefs, side, category, input.value);
                if (res.reason && !res.changed) { say(res.reason); return; }
                if (res.changed) commit(res.prefs);
                say('');
                draw();
            };
            const like = el('button', 'menu_button', 'Like');
            like.type = 'button';
            like.style.minHeight = '32px';
            like.addEventListener('click', () => press('likes'));
            const dislike = el('button', 'menu_button', 'Dislike');
            dislike.type = 'button';
            dislike.style.minHeight = '32px';
            dislike.addEventListener('click', () => press('dislikes'));
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); press('likes'); } });
            add.append(input, list, like, dislike);
            row.append(add);
            rowsHost.append(row);
        }
    };

    // The free note.
    const noteWrap = el('div');
    noteWrap.append(el('strong', '', 'Note'));
    const note = el('textarea', 'text_pole');
    note.rows = 2;
    note.maxLength = PREF_NOTE_MAX;
    note.placeholder = 'Anything else about their tastes, in your own words.';
    note.value = current().note;
    // Saved as typed; nothing is redrawn from here.
    note.addEventListener('input', () => { commit(setNote(char.prefs, note.value)); });
    noteWrap.append(note);

    // Suggest from lore.
    const suggest = el('div');
    suggest.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const go = el('button', 'menu_button', 'Suggest from lore');
    go.type = 'button';
    go.title = 'Asks the model (the Activities connection) what this character might like, from their linked lorebook entry. You choose which to keep.';
    go.addEventListener('click', async () => {
        go.disabled = true;
        say('Asking...');
        try {
            const { system, user } = buildPrefsRequest({ name: char.name, profile: profileText(char), existing: char.prefs });
            const raw = await requestOnConnection('activitiesProfileId', system, user, 800);
            const found = parsePrefSuggestion(raw);
            if (!found) { say('The model gave nothing that could be read. Try again.'); return; }
            const have = current();
            pending = [];
            for (const side of ['likes', 'dislikes']) {
                for (const category of PREF_CATEGORIES) {
                    for (const value of found[side][category]) {
                        const known = have.likes[category].concat(have.dislikes[category]).some(v => v.toLowerCase() === value.toLowerCase());
                        if (!known) pending.push({ side, category, value });
                    }
                }
            }
            say(pending.length ? `${pending.length} suggestion${pending.length === 1 ? '' : 's'}: tick the ones to keep.` : 'Nothing new to suggest.');
            draw();
        } catch (err) {
            console.warn('[Worldkit] suggest likes failed', err);
            say('Could not get suggestions.');
            toastr.error(`Could not get suggestions: ${err?.message || err}`, 'Worldkit');
        } finally {
            go.disabled = false;
        }
    });
    const clear = el('button', 'menu_button', 'Clear all');
    clear.type = 'button';
    clear.addEventListener('click', () => {
        if (!hasPrefs(char.prefs)) return;
        commit(normalizePrefs(null));
        pending = [];
        note.value = '';
        say('Cleared.');
        draw();
    });
    suggest.append(go, clear, status);

    // The Tea Time portrait: a picture of this character for the Tea Time screen. Without one, their ordinary portrait is used.
    const portraitWrap = el('div');
    portraitWrap.style.cssText = 'margin-top: 12px;';
    portraitWrap.append(el('strong', '', 'Tea Time portrait'));
    const portraitRow = el('div');
    portraitRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:4px;';
    const portraitInput = el('input', 'text_pole');
    portraitInput.type = 'text';
    portraitInput.maxLength = 300;
    portraitInput.placeholder = 'An image address, e.g. /user/images/sillynpc/tea-portrait.png';
    portraitInput.style.cssText = 'flex:1; min-width:14em;';
    portraitInput.value = char.teaPortrait || '';
    portraitInput.setAttribute('aria-label', 'Tea Time portrait address');
    const thumb = el('img');
    thumb.alt = '';
    thumb.style.cssText = 'width:44px; height:44px; object-fit:cover; border-radius:6px; border:1px solid #a4947d;';
    const showThumb = () => {
        const v = portraitInput.value.trim();
        thumb.style.display = v ? '' : 'none';
        if (v) thumb.src = v;
    };
    thumb.addEventListener('error', () => { thumb.style.display = 'none'; });
    // Saved as typed; nothing is redrawn from here.
    portraitInput.addEventListener('input', () => {
        const v = portraitInput.value.trim().slice(0, 300);
        if (v) char.teaPortrait = v; else delete char.teaPortrait;
        saveSettings();
        showThumb();
    });
    portraitRow.append(portraitInput, thumb);
    portraitWrap.append(portraitRow, el('small', 'notes', 'Shown beside the table on the Tea Time screen instead of the usual portrait. Leave it empty to use the usual one.'));
    showThumb();

    card.append(rowsHost, noteWrap, portraitWrap, suggest);
    draw();
    return card;
}
