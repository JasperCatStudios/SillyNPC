import { saveSettings } from './settings.js';
import { project, ladderOf, rolesUsingStat, PROF_ROLES } from './combat-roles.js';
import { getTypeData, hasTypeData } from './combat-store.js';
import { detectLegacy } from './combat-migrate.js';
import { planFromLegacy } from './combat-plan.js';
import { setStat, setMeta, setRank, removeUnknown, visibleProfs } from './combat-edit.js';
import { combatPrefs, allTypes } from './combat-access.js';
import { runMigration } from './combat-run.js';

/**
 * The Combat block on a character's page and on the player's sheet (fork).
 *
 * One tab per world type the character has data for, plus the type picked for this System.
 * Everything shown comes from the type: its stat names, its scales, its ladders, what each
 * stat drives. Edits are written through combat-edit.js and saved straight away.
 *
 * Lives in src/ rather than modules/combat/ so the editor keeps working if the module's own
 * files fail to load.
 */

const GROUP_TITLES = {
    weapon: 'Weapons', magic: 'Magic', support: 'Support', heal: 'Healing',
    movement: 'Movement', defense: 'Defence', passive: 'Passive',
};

/** Which tab was open last, per character, for the session. */
const lastTab = new Map();

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const field = (label, input, hint) => {
    const wrap = el('div', 'sillynpc-combat-field');
    const l = el('label', '', label);
    if (hint) l.title = hint;
    wrap.append(l, input);
    return wrap;
};

/**
 * @param {object} record A character, or the player's card.
 * @param {HTMLElement} container
 * @param {{ onChange?: () => void }} [options] Called after a change the page must redraw for.
 */
export function renderCombatSection(record, container, options = {}) {
    if (!container) return;
    container.className = 'sillynpc-editor-field sillynpc-combat-section';
    container.replaceChildren(el('label', '', 'Combat'));

    const valid = allTypes().filter(t => t.errors.length === 0).map(t => t.type);
    if (!valid.length) {
        container.append(el('small', 'notes', 'No usable combat world types.'));
        return;
    }

    const prefs = combatPrefs();
    const key = record.id || 'player';
    const shown = valid.filter(t => hasTypeData(record, t.dataKey) || t.id === prefs.activeType
        || lastTab.get(`${key}:added`) === t.id);

    if (!shown.length) {
        container.append(el('small', 'notes',
            'Pick a combat world type under Modules, Combat, or add one here to give this character combat stats.'));
        container.append(typePicker(valid, key, () => renderCombatSection(record, container, options)));
        return;
    }

    const wanted = lastTab.get(key);
    const type = shown.find(t => t.id === wanted) || shown.find(t => t.id === prefs.activeType) || shown[0];

    const bar = el('div', 'sillynpc-combat-tabs');
    for (const t of shown) {
        const tab = el('button', `menu_button${t.id === type.id ? ' is-active' : ''}`, t.name);
        tab.type = 'button';
        tab.addEventListener('click', () => { lastTab.set(key, t.id); renderCombatSection(record, container, options); });
        bar.append(tab);
    }
    const others = valid.filter(t => !shown.includes(t));
    if (others.length) bar.append(typePicker(others, key, () => renderCombatSection(record, container, options)));
    container.append(bar);

    container.append(renderType(record, type, () => renderCombatSection(record, container, options), options));
}

function typePicker(types, key, rerender) {
    const select = el('select', 'text_pole sillynpc-combat-add');
    select.append(new Option('+ add a world type', ''));
    for (const t of types) select.append(new Option(t.name, t.id));
    select.addEventListener('change', () => {
        if (!select.value) return;
        lastTab.set(`${key}:added`, select.value);
        lastTab.set(key, select.value);
        rerender();
    });
    return select;
}

function renderType(record, type, rerender, options) {
    const body = el('div', 'sillynpc-combat-type-body');
    const data = getTypeData(record, type.dataKey);
    const poolLine = el('small', 'notes sillynpc-combat-pools');
    const showPools = () => {
        const c = project(getTypeData(record, type.dataKey), type);
        poolLine.textContent = Object.values(c.pools).map(p => `${p.label} ${p.max}`).join('  |  ');
    };
    const commit = (result, input) => {
        if (!result.ok) {
            toastr.warning(result.reason, 'SillyNPC');
            rerender();
            return;
        }
        saveSettings();
        if (input) input.classList.toggle('is-out-of-scale', Boolean(result.outOfScale));
        showPools();
        options.onChange?.();
    };

    // Old keys that hold combat data for this type, and nothing in the new place yet.
    if (!hasTypeData(record, type.dataKey)) {
        const found = detectLegacy(record, type);
        if (found.matches.length) {
            const banner = el('div', 'sillynpc-combat-banner');
            banner.append(el('span', '', `${found.matches.length} values for ${type.name} are in this character's old keys.`));
            const copy = el('button', 'menu_button', 'Copy them over');
            copy.type = 'button';
            copy.addEventListener('click', async () => {
                copy.disabled = true;
                const out = await runMigration(type, planFromLegacy([record], type), { label: `Copied for ${record.name}` });
                if (out.ok) toastr.success(`Copied ${out.values} values. The old keys were not touched.`, 'SillyNPC');
                else toastr.error(out.reason, 'SillyNPC');
                rerender();
            });
            banner.append(copy);
            body.append(banner);
        }
    }

    // Meta: class, level, tier, faction...
    if (type.meta.length) {
        const row = el('div', 'sillynpc-combat-meta');
        for (const m of type.meta) {
            let input;
            if (m.type === 'choice') {
                input = el('select', 'text_pole');
                input.append(new Option('-', ''));
                for (const o of m.options || []) input.append(new Option(o, o));
                input.value = data.meta[m.id] ?? '';
            } else {
                input = el('input', 'text_pole');
                input.type = m.type === 'number' ? 'number' : 'text';
                input.value = data.meta[m.id] ?? '';
                if (m.type === 'number') {
                    if (m.min !== undefined) input.min = String(m.min);
                    if (m.max !== undefined) input.max = String(m.max);
                }
            }
            input.addEventListener('change', () => {
                const result = setMeta(record, type, m.id, input.value);
                // A faction decides which skills are shown, so the whole block is drawn again.
                commit(result, null);
                if (result.ok && m.id === 'faction') rerender();
            });
            row.append(field(m.label, input));
        }
        body.append(row);
    }

    // Stats, each with what it drives.
    const drives = rolesUsingStat(type);
    const grid = el('div', 'sillynpc-combat-stats');
    for (const s of type.stats) {
        const input = el('input', 'text_pole');
        input.type = 'number';
        input.step = '1';
        input.placeholder = String(s.default ?? '');
        input.value = data.stats[s.id] ?? '';
        const scale = s.scale;
        if (scale) input.title = `Usual range ${scale.min} to ${scale.max}`;
        const outOfScale = (v) => scale && v !== '' && (Number(v) < scale.min || Number(v) > scale.max);
        input.classList.toggle('is-out-of-scale', Boolean(outOfScale(input.value)));
        input.addEventListener('change', () => commit(setStat(record, type, s.id, input.value), input));

        const cell = field(s.abbr || s.label, input, s.label);
        const used = drives.get(s.id);
        if (used?.length) cell.append(el('small', 'notes sillynpc-combat-drives', used.join(', ')));
        grid.append(cell);
    }
    body.append(grid);
    body.append(poolLine);
    showPools();

    // Ranks, grouped by what the proficiency is for.
    const profs = visibleProfs(type, data);
    const groups = new Map();
    for (const p of profs) {
        const g = (p.roles || []).find(r => PROF_ROLES.includes(r)) || 'weapon';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(p);
    }
    for (const [group, list] of groups) {
        body.append(el('div', 'sillynpc-combat-group', GROUP_TITLES[group] || group));
        const row = el('div', 'sillynpc-combat-ranks');
        for (const p of list) {
            const select = el('select', 'text_pole');
            select.append(new Option('-', ''));
            for (const rung of ladderOf(type, p.ladder).rungs) select.append(new Option(rung, rung));
            select.value = data.profs[p.id]?.rank ?? '';
            select.addEventListener('change', () => commit(setRank(record, type, p.id, select.value), null));
            row.append(field(p.label, select));
        }
        body.append(row);
    }

    const unknown = Object.entries(data.unknown || {});
    if (unknown.length) {
        body.append(el('div', 'sillynpc-combat-group', 'Kept, not understood'));
        for (const [k, v] of unknown) {
            const row = el('div', 'sillynpc-combat-unknown');
            row.append(el('span', '', `${k}: ${v}`));
            const del = el('button', 'menu_button', 'Remove');
            del.type = 'button';
            del.addEventListener('click', () => { removeUnknown(record, type, k); saveSettings(); rerender(); });
            row.append(del);
            body.append(row);
        }
    }
    return body;
}
