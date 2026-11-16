import {
    locationSettings, saveLocationSettings, listBackgrounds, syncLocationBackground, currentPlace, vistalyzeActive, backgroundCss,
} from './location-backgrounds.js';
import { matchLocation, parseLocationFile } from './location-core.js';

/**
 * The Location backgrounds table (fork), drawn in the Images module: each place and the background it uses, whether
 * it is on, a button to apply the current place now, and import / export of the table as a file.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function renderLocationBackgrounds(pane, { live = true } = {}) {
    const s = locationSettings();
    pane.append(el('h4', 'sillynpc-combat-heading', 'Location backgrounds'));
    pane.append(el('small', 'notes',
        'When the tracker\'s Location changes, the chat\'s background switches to the picture you set for that place. Nothing is generated and '
        + 'no model is asked: the pictures are ones already in SillyTavern\'s backgrounds folder. A place matches by name or alias, and a longer '
        + 'name wins ("Dining Hall Kitchen" over "Kitchen").'));

    const on = el('input');
    on.type = 'checkbox';
    on.checked = s.enabled;
    const onRow = el('label', 'checkbox_label');
    onRow.append(on, el('span', '', 'Switch the background when the location changes'));
    pane.append(onRow);
    if (live && vistalyzeActive()) {
        pane.append(el('div', 'sillynpc-imagegen-warning', 'Vistalyze is installed and switched on. Use only one of the two for a chat: this table steps aside in a chat where Vistalyze has set the background.'));
    }

    const status = el('small', 'notes sillynpc-imagegen-state');
    const apply = el('button', 'menu_button', 'Apply the current place now');
    apply.type = 'button';
    const refreshStatus = () => {
        const place = currentPlace();
        const hit = place ? matchLocation(s.entries, place) : null;
        status.textContent = place ? `Tracker location: ${place} → ${hit ? (hit.file ? `${hit.name} (${hit.file})` : `${hit.name} has no background chosen`) : 'no entry'}` : 'The tracker has no Location yet.';
    };
    apply.addEventListener('click', () => {
        const r = syncLocationBackground({ force: true });
        toastr.info(r.applied ? `Background set for ${r.entry?.name || r.place}.` : (r.why || 'Nothing changed.'), 'Worldkit');
        refreshStatus();
    });
    pane.append(apply, status);

    const rowsHost = el('div', 'sillynpc-location-rows');
    pane.append(rowsHost);
    let files = [];
    const draw = () => {
        rowsHost.replaceChildren();
        s.entries.forEach((entry, index) => {
            const row = el('div', 'sillynpc-location-row');
            const name = el('input', 'text_pole');
            name.value = entry.name;
            name.placeholder = 'Place';
            name.addEventListener('change', () => { entry.name = name.value.trim() || entry.name; saveLocationSettings(); refreshStatus(); });
            const aliases = el('input', 'text_pole');
            aliases.value = (entry.aliases || []).join(', ');
            aliases.placeholder = 'Other names, comma separated';
            aliases.addEventListener('change', () => { entry.aliases = aliases.value.split(',').map(a => a.trim()).filter(Boolean); saveLocationSettings(); refreshStatus(); });
            const pick = el('select', 'text_pole');
            pick.append(new Option('No background', ''));
            const names = files.slice();
            if (entry.file && !names.includes(entry.file)) names.unshift(entry.file);
            for (const f of names) pick.append(new Option(files.includes(f) || !live ? f : `${f} (missing)`, f));
            pick.value = entry.file || '';
            const thumb = el('img', 'sillynpc-location-thumb');
            const showThumb = () => { thumb.style.display = pick.value ? '' : 'none'; if (pick.value) thumb.src = `backgrounds/${encodeURIComponent(pick.value)}`; };
            pick.addEventListener('change', () => { entry.file = pick.value; saveLocationSettings(); showThumb(); refreshStatus(); });
            const remove = el('button', 'menu_button', '×');
            remove.type = 'button';
            remove.title = 'Remove this place';
            remove.addEventListener('click', () => { s.entries.splice(index, 1); saveLocationSettings(); draw(); refreshStatus(); });
            row.append(name, aliases, pick, thumb, remove);
            rowsHost.append(row);
            showThumb();
        });
        if (!s.entries.length) rowsHost.append(el('small', 'notes', 'No places yet. Add one, or import a list.'));
    };
    const load = async () => {
        if (!live) { draw(); return; }
        try { files = await listBackgrounds(); } catch (err) { toastr.warning(err?.message || String(err), 'Worldkit'); }
        draw();
    };

    const add = el('button', 'menu_button', 'Add a place');
    add.type = 'button';
    add.addEventListener('click', () => {
        let n = s.entries.length + 1;
        while (s.entries.some(e => e.name === `New place ${n}`)) n++;
        s.entries.push({ name: `New place ${n}`, aliases: [], file: '' });
        saveLocationSettings();
        draw();
    });
    const exp = el('button', 'menu_button', 'Export');
    exp.type = 'button';
    exp.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ entries: s.entries }, null, 2)], { type: 'application/json' });
        const a = el('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'worldkit-location-backgrounds.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    const imp = el('button', 'menu_button', 'Import…');
    imp.type = 'button';
    imp.title = 'Add the places in a file. A place already in the table is left as it is.';
    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        file.value = '';
        if (!picked) return;
        const list = parseLocationFile(await picked.text());
        if (!list) { toastr.error('That file is not a list of places.', 'Worldkit'); return; }
        const have = new Set(s.entries.map(e => e.name.toLowerCase()));
        let added = 0;
        for (const e of list) if (!have.has(e.name.toLowerCase())) { s.entries.push(e); added++; }
        saveLocationSettings();
        draw();
        refreshStatus();
        toastr.success(`${added} place${added === 1 ? '' : 's'} added.`, 'Worldkit');
    });
    const actions = el('div', 'sillynpc-imagegen-actions');
    actions.append(add, imp, exp, file);
    pane.append(actions);

    on.addEventListener('change', () => { s.enabled = on.checked; saveLocationSettings(); if (s.enabled) syncLocationBackground({ force: true }); refreshStatus(); });
    refreshStatus();
    void backgroundCss;
    load();
}
