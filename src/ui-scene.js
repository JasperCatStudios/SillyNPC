import { redrawWhenIdle } from './ui-edit-guard.js';
import { offerDownload } from './utils.js';
import { PRODUCT_NAME } from './constants.js';
import {
    sceneSettings, saveSceneSettings, getScene, backgroundStatus, onSceneStatus, setSceneEnabled, setBackgroundsEnabled,
    rematchScene, syncBackground, listBackgrounds,
} from './scene-state.js';
import {
    treeOrder, worldLabels, explainMatch, parseLocationFile, mergeLocations, exportLocations, addLocation, removeLocation,
    canParent, pathLabel, badRegex, backgroundFor,
} from './scene-locations.js';
import { describeScene } from './scene-core.js';

/**
 * The Scene pane on the Modules tab (fork). Draws only: the rules are in scene-locations.js and scene-core.js, the
 * SillyTavern side in scene-state.js.
 *
 * The location map is a form edited in place. Typing saves as typed and never redraws the list; the list is redrawn
 * only after a click (add, delete, a new parent) or, for a renamed place, once the person has left the form
 * (redrawWhenIdle). No toasts for confirmations: what happened is said in the line under the toolbar.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const button = (label, title, icon) => {
    const b = el('button', 'menu_button');
    b.type = 'button';
    if (icon) b.innerHTML = `<i class="fa-solid ${icon}"></i> `;
    b.append(document.createTextNode(label));
    if (title) b.title = title;
    return b;
};

/** Which rows are open and which world label the list shows, kept across redraws for the session. */
const ui = { open: new Set(), world: '', test: '' };
/** The backgrounds folder, read once per session (and again on Refresh). */
let backgroundFiles = null;

const NO_LABEL = '\u0000none';

/** The world-label choices, as a select. */
function worldSelect(labels, value, { any = 'All worlds', none = '' } = {}) {
    const select = el('select', 'text_pole');
    select.append(new Option(any, ''));
    if (none) select.append(new Option(none, NO_LABEL));
    for (const label of labels) select.append(new Option(label, label));
    select.value = labels.includes(value) || value === NO_LABEL ? value : '';
    return select;
}

/**
 * @param {HTMLElement} pane
 * @param {{ live?: boolean, head?: HTMLElement, makeSwitch?: Function }} ctx
 */
export function renderScenePane(pane, { live = true, head, makeSwitch } = {}) {
    const s = sceneSettings();
    // Filled in below for the live pane; the head switch can be clicked before (or without) it.
    let drawStatus = () => {};
    if (head && typeof makeSwitch === 'function') {
        head.append(makeSwitch(s.enabled, (on) => { setSceneEnabled(on); drawStatus(); }));
    }

    pane.append(el('small', 'notes sillynpc-scene-intro',
        'Reads where and when the story is from the scene header at the top of each reply '
        + '([ Time 07:24 AM | Friday, May 01, 1180 | \u{1F4CD} Harbour Inn - Common Room | Drizzle ]). With no header the time '
        + 'is your device\'s and the place stays the last one known. The places below are one map for every world; '
        + 'a world label only sorts them.'));

    if (!live) {
        for (const title of ['Status', 'Test a place', 'Location map']) pane.append(el('h4', 'sillynpc-combat-heading', title));
        return;
    }

    /* ---- switches ---- */
    const bgRow = el('label', 'sillynpc-pane-opt sillynpc-scene-opt');
    bgRow.append(
        makeSwitch ? makeSwitch(s.backgrounds, (on) => { setBackgroundsEnabled(on); drawStatus(); }) : el('span'),
        el('span', '', 'Switch the chat background to the place\'s picture'),
    );
    const matchRow = el('div', 'sillynpc-setting-row sillynpc-scene-row');
    matchRow.append(el('label', '', 'Match places of'));
    const matchHost = el('span');
    matchRow.append(matchHost);
    const drawMatchWorld = () => {
        const select = worldSelect(worldLabels(s.locations), s.matchWorld, { any: 'every world' });
        select.title = 'Only places with this world label, or with none, are matched. Use it when two worlds both have a "Library".';
        select.addEventListener('change', () => { s.matchWorld = select.value; saveSceneSettings(); rematchScene(); runTest(); });
        matchHost.replaceChildren(select);
    };
    pane.append(bgRow, matchRow);

    /* ---- status ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Status'));
    const status = el('div', 'sillynpc-scene-status');
    const statusLine = el('div', 'notes');
    const statusBg = el('div', 'notes');
    const statusActions = el('div', 'sillynpc-scene-actions');
    status.append(statusLine, statusBg, statusActions);
    pane.append(status);

    drawStatus = () => {
        statusActions.replaceChildren();
        if (!s.enabled) {
            statusLine.textContent = 'The Scene module is off. Turn it on with the switch above.';
            statusBg.textContent = '';
            return;
        }
        const scene = getScene();
        statusLine.textContent = describeScene(scene);
        const notes = [];
        if (scene?.match === 'tie') notes.push(`Ambiguous: "${scene.place}" matches ${scene.ties.join(' and ')}. The place stays as it was.`);
        if (scene?.match === 'none') notes.push(`No place in the map for "${scene.place}".`);
        notes.push(backgroundStatus());
        statusBg.textContent = notes.filter(Boolean).join(' ');
        if (scene?.match === 'none' && scene.place) {
            const name = scene.placeMain && scene.area ? scene.area : scene.place;
            const add = button(`Add "${name}" as a place`, 'Adds it to the map; open it below to set its parent, aliases and picture.', 'fa-plus');
            add.addEventListener('click', () => {
                const parent = scene.area ? s.locations.find(e => e.name.toLowerCase() === scene.placeMain.toLowerCase()) : null;
                const entry = addLocation(s.locations, { name, parentId: parent?.id || '', world: ui.world && ui.world !== NO_LABEL ? ui.world : '' });
                ui.open.add(entry.id);
                saveSceneSettings();
                rematchScene();
                drawList();
                say(`Added ${pathLabel(s.locations, entry)}.`);
            });
            statusActions.append(add);
        }
        if (s.backgrounds && scene?.location) {
            const apply = button('Apply the background now', 'Puts this place\'s picture on the chat again.', 'fa-image');
            apply.addEventListener('click', () => { syncBackground(); drawStatus(); });
            statusActions.append(apply);
        }
    };
    const off = onSceneStatus(() => {
        if (!pane.isConnected) { off(); return; }
        drawStatus();
    });

    /* ---- test box ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Test a place'));
    const testInput = el('input', 'text_pole sillynpc-scene-test');
    testInput.type = 'text';
    testInput.placeholder = 'Type a place, e.g. Harbour Inn - Common Room';
    testInput.value = ui.test;
    const testOut = el('div', 'sillynpc-scene-explain');
    pane.append(testInput, testOut);
    const runTest = () => {
        ui.test = testInput.value;
        testOut.replaceChildren();
        if (!testInput.value.trim()) {
            testOut.append(el('small', 'notes', 'Shows which place a text matches and why, by the same rules the scene uses.'));
            return;
        }
        const { result, lines } = explainMatch(s.locations, testInput.value, { world: s.matchWorld });
        for (const line of lines) testOut.append(el('div', '', line));
        testOut.dataset.kind = result.kind;
    };
    testInput.addEventListener('input', runTest);

    /* ---- the map ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Location map'));
    pane.append(el('small', 'notes',
        'A place matches when its name or an alias equals the place text, or one part of it ("Harbour Inn - Common Room" '
        + 'has the parts "Harbour Inn" and "Common Room"). Tick Regex to write a regular expression instead. A parent\'s '
        + 'name never matches its children, and when two places match equally well nothing is picked. A place without a '
        + 'picture uses its parent\'s.'));

    const toolbar = el('div', 'sillynpc-scene-toolbar');
    const filterHost = el('span', 'sillynpc-scene-filter');
    const add = button('Add a place', 'A new place at the top level, with the world label shown in the filter.', 'fa-plus');
    const imp = button('Import…', 'Adds the places in a file. Places already in the map are kept as they are.', 'fa-file-import');
    const exp = button('Export', 'Saves the whole map as a file (no pictures).', 'fa-file-export');
    const refresh = button('Refresh pictures', 'Reads SillyTavern\'s backgrounds folder again.', 'fa-rotate');
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.style.display = 'none';
    toolbar.append(filterHost, add, imp, exp, refresh, file);
    const said = el('div', 'notes sillynpc-scene-said');
    const list = el('div', 'sillynpc-scene-tree');
    pane.append(toolbar, said, list);

    const say = (text) => { said.textContent = text; };

    const drawFilter = () => {
        const select = worldSelect(worldLabels(s.locations), ui.world, { any: 'All worlds', none: 'No world label' });
        select.title = 'Show only places with this world label.';
        select.addEventListener('change', () => { ui.world = select.value; drawList(); });
        filterHost.replaceChildren(select);
    };

    /** After a change that can change what matches: the scene and the test box are read again. */
    let rematchTimer = 0;
    const changed = () => {
        saveSceneSettings();
        clearTimeout(rematchTimer);
        rematchTimer = setTimeout(() => { rematchScene(); if (testInput.isConnected) runTest(); }, 250);
    };

    const drawList = () => {
        drawFilter();
        drawMatchWorld();
        list.replaceChildren();
        const labels = worldLabels(s.locations);
        let rows = treeOrder(s.locations, { world: ui.world === NO_LABEL ? '' : ui.world });
        if (ui.world === NO_LABEL) rows = rows.filter(r => !r.entry.world);
        else if (ui.world) rows = rows.filter(r => r.entry.world);
        if (!rows.length) {
            list.append(el('small', 'notes', s.locations.length ? 'No places with this world label.' : 'No places yet. Add one, or import a map.'));
        }
        const datalistId = 'sillynpc-scene-world-labels';
        const datalist = el('datalist');
        datalist.id = datalistId;
        for (const label of labels) datalist.append(new Option(label, label));
        list.append(datalist);
        for (const { entry, depth } of rows) list.append(drawRow(entry, depth, datalistId));
    };

    const drawRow = (entry, depth, datalistId) => {
        const row = el('div', 'sillynpc-scene-place');
        row.style.setProperty('--depth', String(Math.min(depth, 6)));
        const summary = el('button', 'sillynpc-scene-summary');
        summary.type = 'button';
        const caret = el('i', `fa-solid ${ui.open.has(entry.id) ? 'fa-caret-down' : 'fa-caret-right'}`);
        const title = el('span', 'sillynpc-scene-name');
        const meta = el('span', 'sillynpc-scene-meta');
        const drawSummary = () => {
            title.textContent = entry.name || '(no name)';
            const bits = [];
            if (entry.world) bits.push(entry.world);
            const n = entry.aliases.filter(a => a.pattern.trim()).length;
            if (n) bits.push(`${n} alias${n === 1 ? '' : 'es'}`);
            if (entry.background) bits.push('picture');
            else if (backgroundFor(s.locations, entry)) bits.push('parent\'s picture');
            meta.textContent = bits.join(' · ');
        };
        drawSummary();
        summary.append(caret, title, meta);
        row.append(summary);
        const body = el('div', 'sillynpc-scene-body');
        row.append(body);
        const openBody = () => {
            const open = ui.open.has(entry.id);
            caret.className = `fa-solid ${open ? 'fa-caret-down' : 'fa-caret-right'}`;
            body.replaceChildren();
            body.style.display = open ? '' : 'none';
            if (open) fillBody(body, entry, datalistId, drawSummary);
        };
        summary.addEventListener('click', () => {
            if (ui.open.has(entry.id)) ui.open.delete(entry.id); else ui.open.add(entry.id);
            openBody();
        });
        openBody();
        return row;
    };

    const field = (label, control) => {
        const wrap = el('label', 'sillynpc-scene-field');
        wrap.append(el('span', 'sillynpc-scene-label', label), control);
        return wrap;
    };

    const fillBody = (body, entry, datalistId, drawSummary) => {
        // Name: saved as typed; the rest of the list (parent pickers, order) is redrawn once the form is left.
        const name = el('input', 'text_pole');
        name.type = 'text';
        name.value = entry.name;
        name.placeholder = 'Name';
        name.addEventListener('input', () => {
            if (!name.value.trim()) return;           // an empty name is not saved; the old one stays until a new one is typed
            entry.name = name.value;
            drawSummary();
            changed();
        });
        name.addEventListener('change', () => {
            if (!name.value.trim()) name.value = entry.name;
            redrawWhenIdle(list, drawList);
        });

        const world = el('input', 'text_pole');
        world.type = 'text';
        world.value = entry.world;
        world.placeholder = 'World label (optional)';
        world.setAttribute('list', datalistId);
        world.addEventListener('input', () => { entry.world = world.value.trim(); drawSummary(); changed(); });
        world.addEventListener('change', () => redrawWhenIdle(list, drawList));

        const parent = el('select', 'text_pole');
        parent.append(new Option('(top level)', ''));
        for (const { entry: other, depth } of treeOrder(s.locations)) {
            if (other.id === entry.id || !canParent(s.locations, entry.id, other.id)) continue;
            parent.append(new Option(`${' '.repeat(depth)}${other.name}${other.world ? ` (${other.world})` : ''}`, other.id));
        }
        parent.value = entry.parentId;
        parent.addEventListener('change', () => {
            if (!canParent(s.locations, entry.id, parent.value)) { parent.value = entry.parentId; return; }
            entry.parentId = parent.value;
            changed();
            parent.blur();
            drawList();
        });

        // Aliases: the same rows as a character's aliases.
        const aliasList = el('div', 'sillynpc-alias-list');
        const drawAliases = (focusLast = false) => {
            aliasList.replaceChildren();
            entry.aliases.forEach((alias, index) => {
                const aliasRow = el('div', 'sillynpc-alias-row');
                const input = el('input', 'text_pole sillynpc-alias-pattern');
                input.type = 'text';
                input.value = alias.pattern;
                input.placeholder = 'Other name, e.g. the inn';
                const label = el('label', 'checkbox_label sillynpc-alias-regex');
                const check = el('input');
                check.type = 'checkbox';
                check.checked = alias.isRegex;
                label.append(check, el('span', '', 'Regex'));
                const del = el('button', 'menu_button delete-btn');
                del.type = 'button';
                del.title = 'Remove this alias';
                del.innerHTML = '<i class="fa-solid fa-trash"></i>';
                const validate = () => input.classList.toggle('sillynpc-invalid', badRegex(alias));
                input.addEventListener('input', () => { alias.pattern = input.value; validate(); drawSummary(); changed(); });
                check.addEventListener('change', () => { alias.isRegex = check.checked; validate(); changed(); });
                del.addEventListener('click', () => { entry.aliases.splice(index, 1); drawSummary(); changed(); drawAliases(); });
                validate();
                aliasRow.append(input, label, del);
                aliasList.append(aliasRow);
                if (focusLast && index === entry.aliases.length - 1) setTimeout(() => input.focus(), 0);
            });
        };
        drawAliases();
        const addAlias = button('Add alias', 'Another name for this place. Exact (any case) unless Regex is ticked.', 'fa-plus');
        addAlias.addEventListener('click', () => { entry.aliases.push({ pattern: '', isRegex: false }); saveSceneSettings(); drawAliases(true); });

        // Picture.
        const picture = el('select', 'text_pole');
        const thumb = el('img', 'sillynpc-scene-thumb');
        thumb.alt = '';
        thumb.loading = 'lazy';
        const drawPictures = () => {
            picture.replaceChildren(new Option(entry.parentId ? 'None (use the parent\'s)' : 'None', ''));
            const files = backgroundFiles ? backgroundFiles.slice() : [];
            if (entry.background && !files.includes(entry.background)) files.unshift(entry.background);
            for (const f of files) {
                const missing = backgroundFiles && !backgroundFiles.includes(f);
                picture.append(new Option(missing ? `${f} (missing)` : f, f));
            }
            picture.value = entry.background;
        };
        const showThumb = () => {
            const f = entry.background;
            thumb.style.display = f ? '' : 'none';
            if (f) thumb.src = `/thumbnail?type=bg&file=${encodeURIComponent(f)}`;
        };
        drawPictures();
        showThumb();
        picture.addEventListener('change', () => {
            entry.background = picture.value;
            showThumb();
            drawSummary();
            saveSceneSettings();
            if (getScene()?.location?.id) syncBackground();
        });

        const actions = el('div', 'sillynpc-scene-actions');
        const child = button('Add a place inside', 'A new place with this one as its parent.', 'fa-turn-down');
        child.addEventListener('click', () => {
            const made = addLocation(s.locations, { name: 'New place', parentId: entry.id, world: entry.world });
            ui.open.add(entry.id);
            ui.open.add(made.id);
            changed();
            drawList();
            say(`Added a place inside ${entry.name}.`);
        });
        const del = button('Delete', 'Removes this place. The places inside it move up a level.', 'fa-trash');
        let armed = 0;
        del.addEventListener('click', () => {
            if (!armed) {
                del.lastChild.textContent = 'Click again to delete';
                armed = setTimeout(() => { armed = 0; del.lastChild.textContent = 'Delete'; }, 3000);
                return;
            }
            clearTimeout(armed);
            const gone = entry.name;
            removeLocation(s.locations, entry.id);
            ui.open.delete(entry.id);
            changed();
            drawList();
            say(`Deleted ${gone}.`);
        });
        actions.append(child, del);

        const aliasField = el('div', 'sillynpc-scene-field');
        aliasField.append(el('span', 'sillynpc-scene-label', 'Aliases'), aliasList, addAlias);
        const pictureField = field('Picture', picture);
        pictureField.append(thumb);
        body.append(field('Name', name), field('World', world), field('Inside', parent), aliasField, pictureField, actions);
    };

    /* ---- toolbar actions ---- */
    add.addEventListener('click', () => {
        const entry = addLocation(s.locations, { name: 'New place', world: ui.world && ui.world !== NO_LABEL ? ui.world : '' });
        ui.open.add(entry.id);
        changed();
        drawList();
        say('Added a new place at the top of the tree. Open it to name it.');
    });
    exp.addEventListener('click', () => {
        offerDownload(exportLocations(s.locations), 'worldkit-scene-locations.json');
        say(`Exported ${s.locations.length} place${s.locations.length === 1 ? '' : 's'}.`);
    });
    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        file.value = '';
        if (!picked) return;
        let places = null;
        try { places = parseLocationFile(await picked.text()); } catch { places = null; }
        if (!places) {
            toastr.error('That file is not a Worldkit location map.', PRODUCT_NAME);
            return;
        }
        const { added, skipped } = mergeLocations(s.locations, places);
        changed();
        drawList();
        say(`Imported ${picked.name}: ${added} added, ${skipped} already in the map.`);
    });
    const loadPictures = async () => {
        try {
            backgroundFiles = await listBackgrounds();
            say(`${backgroundFiles.length} picture${backgroundFiles.length === 1 ? '' : 's'} in SillyTavern's backgrounds folder.`);
        } catch (err) {
            say(String(err?.message || err));
        }
        if (list.isConnected) redrawWhenIdle(list, drawList);
    };
    refresh.addEventListener('click', () => { backgroundFiles = null; loadPictures(); });

    drawList();
    runTest();
    drawStatus();
    if (!backgroundFiles) loadPictures();
}
