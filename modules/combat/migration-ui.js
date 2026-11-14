import { POPUP_TYPE, Popup } from '../../../../../popup.js';
import { loadWorldInfo, world_names } from '../../../../../world-info.js';
import { getSettings } from '../../src/settings.js';
import { LOG_PREFIX } from '../../src/constants.js';
import { combatPrefs } from '../../src/combat-access.js';
import { planFromLegacy } from '../../src/combat-plan.js';
import { planFromLore } from '../../src/combat-lore-parse.js';
import { runMigration, undoById, runTidy } from '../../src/combat-run.js';

/**
 * The screens for moving combat data (fork): from the old flat keys, from a lorebook table,
 * undoing either, and tidying the old keys away. Everything here previews first and writes
 * only through src/combat-run.js, which takes a backup before it changes anything.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const records = () => getSettings().characters || [];

function summary(item) {
    const parts = [`${item.writes.length} value${item.writes.length === 1 ? '' : 's'}`];
    if (item.unknown?.length) parts.push(`${item.unknown.length} kept as unknown`);
    if (item.conflicts?.length) parts.push(`${item.conflicts.length} differ from what is already there`);
    return parts.join(', ');
}

/** A table of plan items with a tick per row. Returns the node and a way to read the ticked ones. */
function itemTable(items) {
    const table = el('table', 'sillynpc-combat-table');
    const head = el('tr');
    for (const t of ['', 'Character', 'What will be written']) head.append(el('th', '', t));
    table.append(head);
    const boxes = [];
    for (const item of items) {
        const tr = el('tr');
        const cell = el('td');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = true;
        cell.append(box);
        boxes.push([box, item]);
        const name = el('td', '', item.name);
        if (item.loreName && item.loreName !== item.name) name.append(el('small', 'notes', ` (${item.loreName})`));
        tr.append(cell, name, el('td', 'notes', summary(item)));
        table.append(tr);
    }
    return { table, chosen: () => boxes.filter(([b]) => b.checked).map(([, i]) => i) };
}

function overwriteOption(items) {
    const conflicts = items.reduce((n, i) => n + (i.conflicts?.length || 0), 0);
    const label = el('label', 'checkbox_label');
    const box = el('input');
    box.type = 'checkbox';
    label.append(box, el('span', '', ` Replace the ${conflicts} value${conflicts === 1 ? '' : 's'} that differ from what is already there`));
    return { node: conflicts ? label : null, get: () => conflicts > 0 && box.checked };
}

async function confirmAndRun(type, wrap, ok, items, label, chosen, overwrite, rerender) {
    if (!(await new Popup(wrap, POPUP_TYPE.CONFIRM, '', { okButton: ok, cancelButton: 'Cancel' }).show())) return;
    const picked = chosen();
    toastr.info('Saving a backup, then copying...', 'SillyNPC');
    const result = await runMigration(type, picked, { label, overwrite: overwrite.get() });
    if (!result.ok) {
        toastr.error(result.reason, 'SillyNPC');
    } else {
        toastr.success(`Copied ${result.values} value${result.values === 1 ? '' : 's'} onto ${result.characters} character${result.characters === 1 ? '' : 's'}. The old keys were not touched.`, 'SillyNPC');
    }
    rerender();
}

/** Copy combat data from the old flat keys. */
export async function openLegacyMigration(type, rerender) {
    const items = planFromLegacy(records(), type);
    if (!items.length) { toastr.info('No character has combat data in the old keys.', 'SillyNPC'); return; }

    const wrap = el('div', 'sillynpc-combat-dialog');
    wrap.append(el('h3', '', 'Copy combat data'));
    wrap.append(el('p', 'notes',
        'These characters hold combat values in their old flat keys. They are copied into the new combat block for '
        + `${type.name}. The old keys stay where they are, and a backup is saved first so this can be undone.`));
    const { table, chosen } = itemTable(items);
    const overwrite = overwriteOption(items);
    wrap.append(table);
    if (overwrite.node) wrap.append(overwrite.node);
    await confirmAndRun(type, wrap, 'Copy', items, 'Copied from old keys', chosen, overwrite, rerender);
}

/** Import from a lorebook entry holding Attributes{...} / Proficiencies{...} blocks. */
export async function openLoreImport(type, rerender) {
    if (!type.loreImport) { toastr.info(`${type.name} has no lorebook table format.`, 'SillyNPC'); return; }

    const wrap = el('div', 'sillynpc-combat-dialog');
    wrap.append(el('h3', '', `Import from a lorebook`));
    wrap.append(el('p', 'notes',
        'Pick the lorebook entry that lists people as "Name\'s Attributes{ ... }" and "Name\'s Proficiencies{ ... }". '
        + 'Numbers are rescaled to this world type, so they are estimates to adjust by hand afterwards.'));

    const worldSelect = el('select', 'text_pole');
    worldSelect.append(new Option('- lorebook -', ''));
    for (const w of Array.isArray(world_names) ? world_names : []) worldSelect.append(new Option(w, w));
    const entrySelect = el('select', 'text_pole');
    entrySelect.disabled = true;
    entrySelect.append(new Option('- entry -', ''));
    const scale = el('input');
    scale.type = 'checkbox';
    scale.checked = true;
    const scaleLabel = el('label', 'checkbox_label');
    scaleLabel.append(scale, el('span', '', ' Rescale numbers to this world type'));
    const result = el('div', 'sillynpc-combat-import-result');
    wrap.append(worldSelect, entrySelect, scaleLabel, result);

    let entries = {};
    let plan = null;
    let ticked = () => [];
    let overwrite = { get: () => false };

    const preview = async () => {
        result.replaceChildren();
        plan = null;
        const entry = entries[entrySelect.value];
        if (!entry) return;
        plan = planFromLore(String(entry.content || ''), records(), type, { rescaleValues: scale.checked });
        if (!plan.items.length && !plan.unmatched.length) {
            result.append(el('p', 'notes', 'No Attributes / Proficiencies blocks were found in that entry.'));
            return;
        }
        const t = itemTable(plan.items);
        ticked = t.chosen;
        overwrite = overwriteOption(plan.items);
        result.append(el('h4', '', `${plan.items.length} matched`), t.table);
        if (overwrite.node) result.append(overwrite.node);
        if (plan.unmatched.length) {
            result.append(el('h4', '', `${plan.unmatched.length} not matched`));
            const list = el('small', 'notes', plan.unmatched.map(u => u.how === 'ambiguous'
                ? `${u.name} (could be ${u.candidates.map(c => c.name).join(' or ')})` : u.name).join('; '));
            result.append(list, el('small', 'notes', 'Give the character that name as an alias, or the same name, and import again.'));
        }
    };

    worldSelect.addEventListener('change', async () => {
        entrySelect.replaceChildren(new Option('- entry -', ''));
        entrySelect.disabled = true;
        result.replaceChildren();
        entries = {};
        if (!worldSelect.value) return;
        try {
            const data = await loadWorldInfo(worldSelect.value);
            for (const e of Object.values(data?.entries || {})) {
                if (!/\{[^}]*:[^}]*\}/.test(String(e.content || ''))) continue;
                entries[e.uid] = e;
                entrySelect.append(new Option(e.comment || (e.key || []).join(', ') || `Entry ${e.uid}`, e.uid));
            }
            entrySelect.disabled = false;
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not read the lorebook', err);
            toastr.error('Could not read that lorebook.', 'SillyNPC');
        }
    });
    entrySelect.addEventListener('change', preview);
    scale.addEventListener('change', preview);

    if (!(await new Popup(wrap, POPUP_TYPE.CONFIRM, '', { okButton: 'Import', cancelButton: 'Cancel' }).show())) return;
    const picked = ticked();
    if (!plan || !picked.length) { toastr.info('Nothing was chosen.', 'SillyNPC'); return; }

    toastr.info('Saving a backup, then copying...', 'SillyNPC');
    const label = `Lorebook import: ${entries[entrySelect.value]?.comment || worldSelect.value}`;
    const done = await runMigration(type, picked, { label, overwrite: overwrite.get() });
    if (!done.ok) toastr.error(done.reason, 'SillyNPC');
    else toastr.success(`Imported ${done.values} value${done.values === 1 ? '' : 's'} onto ${done.characters} character${done.characters === 1 ? '' : 's'}.`, 'SillyNPC');
    rerender();
}

/** The migrations done in this System, with Undo, and the tidy button. */
export function renderMigrationList(host, type, rerender) {
    const prefs = combatPrefs();
    host.append(el('h4', 'sillynpc-combat-heading', 'Moved data'));

    const actions = el('div', 'sillynpc-combat-actions');
    const copy = el('button', 'menu_button', 'Copy from old keys...');
    copy.type = 'button';
    copy.addEventListener('click', () => openLegacyMigration(type, rerender));
    actions.append(copy);

    if (type.loreImport) {
        const lore = el('button', 'menu_button', 'Import from a lorebook...');
        lore.type = 'button';
        lore.addEventListener('click', () => openLoreImport(type, rerender));
        actions.append(lore);
    }

    const tidy = el('button', 'menu_button', 'Remove old keys...');
    tidy.type = 'button';
    tidy.title = 'Removes only keys already copied with the same value. A backup is saved first.';
    tidy.addEventListener('click', async () => {
        const wrap = el('div');
        wrap.append(el('h3', '', 'Remove the old keys?'));
        wrap.append(el('p', 'notes',
            'Only keys whose values are already in the combat block, unchanged, are removed. A backup is saved first and '
            + 'this can be undone from the list below. The narrator will no longer read these values from the old keys.'));
        if (!(await new Popup(wrap, POPUP_TYPE.CONFIRM, '', { okButton: 'Remove', cancelButton: 'Cancel' }).show())) return;
        const out = await runTidy(type);
        if (!out.ok) toastr.error(out.reason, 'SillyNPC');
        else toastr.success(out.keys ? `Removed ${out.keys} old key${out.keys === 1 ? '' : 's'} from ${out.characters} character${out.characters === 1 ? '' : 's'}.` : 'Nothing to remove.', 'SillyNPC');
        rerender();
    });
    actions.append(tidy);
    host.append(actions);

    const list = prefs.migrations.filter(m => m.typeId === type.id);
    if (!list.length) {
        host.append(el('small', 'notes', 'Nothing has been moved for this world type in this System yet.'));
        return;
    }
    for (const m of list) {
        const row = el('div', 'sillynpc-combat-migration');
        const when = new Date(m.at).toLocaleString();
        row.append(el('span', '', `${m.label} - ${m.count} character${m.count === 1 ? '' : 's'}, ${m.values} ${m.kind === 'tidy' ? 'keys' : 'values'} - ${when}`));
        if (m.undone) {
            row.append(el('small', 'notes', ' (undone)'));
        } else {
            const undo = el('button', 'menu_button', 'Undo');
            undo.type = 'button';
            undo.addEventListener('click', async () => {
                const out = await undoById(m.id);
                if (!out.ok) toastr.error(out.reason, 'SillyNPC');
                else if (out.kept?.length) toastr.warning(`Restored ${out.restored}. Left as they are, because they were changed since: ${out.kept.join(', ')}.`, 'SillyNPC');
                else toastr.success(`Restored ${out.restored} character${out.restored === 1 ? '' : 's'}.`, 'SillyNPC');
                rerender();
            });
            row.append(undo);
        }
        host.append(row);
    }
}
