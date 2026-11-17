import { slug } from '../../src/combat-type-draft.js';
import { getPath, setPath } from '../../src/path-utils.js';
import { artworkUrl } from '../../src/faction-theme.js';
import { factionSettings } from '../../src/ui-faction.js';

/**
 * Form editors for the parts of a world type that used to be a box of JSON (fork): sheet fields, ranks,
 * proficiencies, moves, advantage rules, abilities, weapons, tiers, tools, elements and the roll extras.
 *
 * One generic list editor does them all. Each category is described by its fields (a label, a kind of input and
 * where the value lives), and every record is edited in place, so anything the form does not show (a field only a
 * pasted file carries) is kept untouched. Records open on demand: a world with a hundred abilities does not build a
 * thousand inputs up front.
 */

export { getPath, setPath };

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const csvToList = (text) => String(text ?? '').split(',').map(s => s.trim()).filter(Boolean);

/* ---- one field --------------------------------------------------------------------------------------- */

function buildInput(field, rec, onChange) {
    const read = () => (field.get ? field.get(rec) : getPath(rec, field.key));
    const write = (value) => { if (field.set) field.set(rec, value); else setPath(rec, field.key, value); onChange(); };
    const type = field.type || 'text';

    if (type === 'bool') {
        const label = el('label', 'checkbox_label');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(read());
        box.addEventListener('change', () => write(box.checked ? true : undefined));
        label.append(box, el('span', '', field.label));
        return label;
    }

    const wrap = el('div', 'sillynpc-te-field');
    wrap.append(el('label', 'sillynpc-te-title', field.label));
    if (field.help) wrap.append(el('small', 'notes sillynpc-te-help', field.help));

    if (type === 'select') {
        const select = el('select', 'text_pole');
        const fill = () => {
            const current = String(read() ?? '');
            select.replaceChildren(new Option('(none)', ''));
            const options = typeof field.options === 'function' ? field.options(rec) : (field.options || []);
            const seen = new Set();
            for (const o of options) {
                const value = typeof o === 'object' ? o.value : o;
                const text = typeof o === 'object' ? o.label : o;
                seen.add(String(value));
                select.append(new Option(text, value));
            }
            // A value the list does not offer (from a pasted file) is kept and shown, not dropped.
            if (current && !seen.has(current)) select.append(new Option(`${current} (not in the list)`, current));
            select.value = current;
        };
        fill();
        select.addEventListener('focus', fill);
        select.addEventListener('mousedown', fill);
        select.addEventListener('change', () => write(select.value === '' ? undefined : select.value));
        wrap.append(select);
        return wrap;
    }

    if (type === 'area') {
        const box = el('textarea', 'text_pole sillynpc-te-area');
        box.rows = field.rows || 3;
        box.value = read() ?? '';
        box.placeholder = field.placeholder || '';
        box.addEventListener('input', () => write(box.value === '' ? undefined : box.value));
        wrap.append(box);
        return wrap;
    }

    const box = el('input', 'text_pole');
    box.type = type === 'number' ? 'number' : 'text';
    if (type === 'number' && field.step) box.step = String(field.step);
    box.placeholder = field.placeholder || '';
    const value = read();
    box.value = type === 'csv' ? (Array.isArray(value) ? value.join(', ') : '') : (value ?? '');
    box.addEventListener('input', () => {
        if (type === 'number') {
            const n = Number(box.value);
            write(box.value === '' || !Number.isFinite(n) ? undefined : n);
        } else if (type === 'csv') {
            const items = csvToList(box.value);
            write(items.length ? items : undefined);
        } else write(box.value === '' ? undefined : box.value);
    });
    wrap.append(box);
    return wrap;
}

/* ---- the list ---------------------------------------------------------------------------------------- */

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.help]
 * @param {() => object[]} spec.list the live array of records (created when missing)
 * @param {{ read?: (id: string, value: any) => object, write?: (rec: object) => any, get: () => object, set: (o: object) => void }} [spec.map]
 *   records come from an object keyed by id instead of an array
 * @param {object[]} spec.fields
 * @param {() => object} spec.make a new record
 * @param {(rec: object) => string} spec.name
 * @param {string} [spec.idKey] 'id' (default) or 'key'
 * @param {boolean} [spec.idFromLabel] fill the id from the label while it is empty
 * @param {{ table: object, keyOf?: (rec: object) => string, placeholder?: string, label?: string }} [spec.icon] a picture per record
 * @param {(rec: object, body: HTMLElement, changed: () => void) => void} [spec.extra] more controls inside a record
 * @param {string} [spec.addLabel]
 * @param {() => void} spec.onChange
 */
export function recordList(spec) {
    const idKey = spec.idKey || 'id';
    const wrap = el('div', 'sillynpc-te-list');
    const rows = el('div', 'sillynpc-te-items');
    let records;

    const load = () => {
        if (spec.map) {
            const source = spec.map.get() || {};
            records = Object.entries(source).map(([id, value]) => (spec.map.read ? spec.map.read(id, value) : { [idKey]: id, ...value }));
        } else records = spec.peek ? spec.peek() : spec.list();
    };
    const commit = () => {
        if (!spec.map) return;
        const out = {};
        for (const rec of records) {
            const id = String(rec[idKey] ?? '').trim();
            if (!id) continue;
            if (spec.map.write) out[id] = spec.map.write(rec);
            else { const { [idKey]: _drop, ...rest } = rec; out[id] = rest; }
        }
        spec.map.set(out);
    };
    const changed = () => { commit(); spec.onChange(); };

    const takenIds = (except) => new Set(records.filter(r => r !== except).map(r => String(r[idKey] ?? '')));

    const drawItem = (rec) => {
        const item = el('details', 'sillynpc-te-item');
        const summary = el('summary', 'sillynpc-te-item-head', spec.name(rec) || '(new)');
        item.append(summary);
        let built = false;
        const build = () => {
            if (built) return;
            built = true;
            const body = el('div', 'sillynpc-te-item-body');
            const grid = el('div', 'sillynpc-te-grid');
            for (const field of spec.fields) {
                const input = buildInput(field, rec, () => {
                    // the id follows the label while it is empty, and stays put once it has a value
                    if (spec.idFromLabel && field.key === 'label' && !rec[idKey]) {
                        const generated = slug(rec.label, 'item');
                        const taken = takenIds(rec);
                        let id = generated;
                        for (let i = 2; taken.has(id); i++) id = `${generated.slice(0, 36)}_${i}`;
                        rec[idKey] = id;
                    }
                    summary.textContent = spec.name(rec) || '(new)';
                    changed();
                });
                grid.append(input);
            }
            body.append(grid);

            if (spec.icon) {
                const table = spec.icon.table;
                const keyOf = spec.icon.keyOf || ((r) => String(r[idKey] ?? '').toLowerCase());
                const iconRow = el('div', 'sillynpc-te-field');
                iconRow.append(el('label', 'sillynpc-te-title', spec.icon.label || 'Icon'));
                iconRow.append(el('small', 'notes sillynpc-te-help', 'A picture shown with this one, as a path under the artwork folder (for example my-world/icons/axe.png). Leave empty to show nothing.'));
                const line = el('div', 'sillynpc-te-row');
                const path = el('input', 'text_pole');
                path.type = 'text';
                path.placeholder = spec.icon.placeholder || 'my-world/icons/name.png';
                path.value = table[keyOf(rec)] || '';
                const thumb = el('img', 'sillynpc-te-thumb');
                const showThumb = () => {
                    const url = artworkUrl(path.value.trim(), factionSettings());
                    thumb.style.display = url ? '' : 'none';
                    if (url) thumb.src = url;
                };
                thumb.addEventListener('error', () => { thumb.style.display = 'none'; });
                path.addEventListener('input', () => {
                    const key = keyOf(rec);
                    if (!key) return;
                    if (path.value.trim()) table[key] = path.value.trim(); else delete table[key];
                    showThumb();
                    spec.onChange();
                });
                showThumb();
                line.append(path, thumb);
                iconRow.append(line);
                body.append(iconRow);
            }

            spec.extra?.(rec, body, changed);

            const remove = el('button', 'menu_button', 'Remove');
            remove.type = 'button';
            remove.addEventListener('click', () => {
                const at = records.indexOf(rec);
                if (at >= 0) records.splice(at, 1);
                item.remove();
                changed();
            });
            body.append(remove);
            item.append(body);
        };
        item.addEventListener('toggle', () => { if (item.open) build(); }, { once: false });
        return item;
    };

    const draw = () => {
        load();
        rows.replaceChildren();
        if (!records.length) rows.append(el('small', 'notes', spec.empty || 'None yet.'));
        for (const rec of records) rows.append(drawItem(rec));
    };

    if (spec.title) wrap.append(el('h5', 'sillynpc-te-subtitle', spec.title));
    if (spec.help) wrap.append(el('small', 'notes', spec.help));
    wrap.append(rows);
    const add = el('button', 'menu_button', spec.addLabel || 'Add one');
    add.type = 'button';
    add.addEventListener('click', () => {
        load();
        const rec = spec.make(takenIds(null));
        if (spec.map) records.push(rec); else spec.list().push(rec);
        changed();
        draw();
        // open the new one so it can be filled in
        const last = rows.lastElementChild;
        if (last && last.tagName === 'DETAILS') last.open = true;
    });
    wrap.append(add);
    draw();
    return wrap;
}

/**
 * Plain rows of a few labelled values kept in one object, no add or remove. The object is only created when a value is
 * set (`ensure`), and `prune` runs afterwards so an object left empty can be dropped from the type.
 */
export function fieldGroup({ title, help, source, ensure, prune, fields, onChange }) {
    const wrap = el('div', 'sillynpc-te-list');
    if (title) wrap.append(el('h5', 'sillynpc-te-subtitle', title));
    if (help) wrap.append(el('small', 'notes', help));
    const grid = el('div', 'sillynpc-te-grid');
    for (const field of fields) {
        const wired = field.get && field.set ? field : {
            ...field,
            get: () => getPath(source() || {}, field.key),
            set: (_rec, value) => {
                if (value === undefined) {
                    const existing = source();
                    if (existing && Object.keys(existing).length) setPath(existing, field.key, undefined);
                } else setPath(ensure(), field.key, value);
                prune?.();
            },
        };
        grid.append(buildInput(wired, {}, onChange));
    }
    wrap.append(grid);
    return wrap;
}
