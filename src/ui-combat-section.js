import { saveSettings } from './settings.js';
import { project, ladderOf, rolesUsingStat, PROF_ROLES } from './combat-roles.js';
import { getTypeData, hasTypeData } from './combat-store.js';
import { detectLegacy } from './combat-migrate.js';
import { planFromLegacy } from './combat-plan.js';
import { setStat, setMeta, setRank, setStatus, setAbilities, setXp, setLevel, removeUnknown, visibleProfs } from './combat-edit.js';
import { combatPrefs, allTypes, activeCombatType, isPersonaChar, setPersonaChar } from './combat-access.js';
import { runMigration } from './combat-run.js';
import { generateCombatSheet } from './combat-generate.js';
import { pickLorebookInto } from './ui-lorebook-section.js';
import { abilityPicker } from './ui-abilities.js';
import { renderGearBlock } from './ui-gear.js';
import { STATUS_RUNGS, STATUS_DEFAULT } from './combat-status.js';
import { XP_PER_LEVEL, readLevel, hasLevelMeta } from './combat-level.js';

import { PRODUCT_NAME } from './constants.js';
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
    // One line: the heading on the left, "Persona" and its checkbox side by side on the right.
    const headRow = el('div', 'sillynpc-combat-headrow');
    headRow.append(el('span', 'sillynpc-combat-headtitle', 'Combat'));
    if (!record.isPlayer) {
        const wrap = el('label', 'sillynpc-combat-persona');
        wrap.title = 'A persona is somebody you can play. When your active persona has this name, you fight with the stats on this character. Characters in the OC category are personas automatically.';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = isPersonaChar(record);
        box.addEventListener('change', () => setPersonaChar(record, box.checked));
        wrap.append(el('span', '', 'Persona'), box);
        headRow.append(wrap);
    }
    container.replaceChildren(headRow);

    const genType = activeCombatType();
    if (genType) {
        const gen = el('button', 'menu_button', 'Generate from lore');
        gen.type = 'button';
        gen.title = 'Writes the combat sheet from their lorebook entry, using the Combat stats connection. Does nothing without a linked entry.';
        gen.addEventListener('click', async () => {
            if (!record.lorebook?.world) { toastr.info('Link a lorebook entry on this character first.', PRODUCT_NAME); return; }
            if (hasTypeData(record, genType.dataKey) && !confirm(`Replace values on ${record.name}'s ${genType.name} sheet with generated ones?`)) return;
            gen.disabled = true;
            gen.textContent = 'Generating...';
            try {
                const out = await generateCombatSheet(record, genType);
                if (out.reason === 'no-lore') toastr.info('Their lorebook entry is empty or missing, so there is nothing to base stats on.', PRODUCT_NAME);
                else if (!out.ok) toastr.warning(out.reason, PRODUCT_NAME);
                else { saveSettings(); toastr.success(`Filled ${out.applied} values from their lore.`, PRODUCT_NAME); options.onChange?.(); }
            } catch (err) {
                console.error('[SillyNPC] combat generation failed', err);
                toastr.error('Could not generate combat stats.', PRODUCT_NAME);
            }
            renderCombatSection(record, container, options);
        });
        container.append(gen);
        // Generating reads the linked lorebook entry, so linking is offered right here too.
        const linked = record.lorebook?.world;
        const link = el('button', 'menu_button', linked ? 'Change lore link' : 'Link lore entry');
        link.type = 'button';
        link.title = linked ? `Linked to ${record.lorebook.world}. Pick a different entry.` : 'Pick the lorebook entry that describes this character.';
        const pickerHost = el('div', 'sillynpc-combat-linkpicker');
        link.addEventListener('click', async () => {
            link.disabled = true;
            try {
                await pickLorebookInto(pickerHost, record, () => {
                    // The link is saved on Confirm; the page's own Lorebook section needs to show it.
                    options.onChange?.();
                    renderCombatSection(record, container, options);
                });
            } catch (err) {
                console.error('[SillyNPC] could not open the lorebook picker', err);
                toastr.error('Could not open the lorebook picker.', PRODUCT_NAME);
                link.disabled = false;
            }
        });
        container.append(link, pickerHost);
        if (!linked) container.append(el('small', 'notes', 'No lore entry linked yet: Generate needs one.'));
    }

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
            toastr.warning(result.reason, PRODUCT_NAME);
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
                if (out.ok) toastr.success(`Copied ${out.values} values. The old keys were not touched.`, PRODUCT_NAME);
                else toastr.error(out.reason, PRODUCT_NAME);
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
                const have = data.meta[m.id];
                const opts = have && !(m.options || []).includes(have) ? [have, ...(m.options || [])] : (m.options || []);
                for (const o of opts) input.append(new Option(o, o));
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

    // Level and experience: 200 XP a level, 15 for every enemy fought.
    {
        const row = el('div', 'sillynpc-combat-level');
        const level = readLevel(type, data);
        // A type with a Level detail already shows it above; this row only adds it when there is none.
        if (!hasLevelMeta(type)) {
            const lv = el('input', 'text_pole');
            lv.type = 'number'; lv.min = '1'; lv.value = level;
            lv.addEventListener('change', () => commit(setLevel(record, type, lv.value), null));
            row.append(field('Level', lv));
        }
        const bar = el('div', 'sillynpc-xp');
        const fill = el('div', 'sillynpc-xp-fill');
        fill.style.width = `${Math.min(100, ((data.xp || 0) / XP_PER_LEVEL) * 100)}%`;
        bar.append(fill);
        const label = el('small', 'notes', `Level ${level}: ${data.xp || 0} / ${XP_PER_LEVEL} XP`);
        const xp = el('input', 'text_pole');
        xp.type = 'number'; xp.min = '0'; xp.max = String(XP_PER_LEVEL - 1); xp.value = data.xp || 0;
        xp.addEventListener('change', () => { commit(setXp(record, type, xp.value), null); rerender(); });
        const track = el('div', 'sillynpc-xp-wrap');
        track.append(label, bar);
        row.append(track, field('XP', xp, 'Progress toward the next level, 0 to 199'));
        body.append(row);
    }

    // Condition: how hurt they are. Fights start from this and write it back afterwards.
    {
        const row = el('div', 'sillynpc-combat-meta');
        const statusSel = el('select', 'text_pole');
        for (const g of [...STATUS_RUNGS].reverse()) statusSel.append(new Option(g === STATUS_DEFAULT ? `${g} (healthy)` : g === STATUS_RUNGS[0] ? `${g} (near death)` : g, g));
        statusSel.value = data.status || STATUS_DEFAULT;
        statusSel.addEventListener('change', () => commit(setStatus(record, type, statusSel.value), null));
        row.append(field('Status', statusSel, 'How hurt they are. Fights start from this and update it afterwards. Set S+ to fully rest.'));
        body.append(row);
    }

    // Weapons and tools: what they attack with, and carry, in the combat window.
    body.append(renderGearBlock(record, type, { commit }));

    // Abilities this character has, by category, for this world type only.
    if ((type.abilities || []).length) {
        body.append(el('div', 'sillynpc-combat-group', 'Abilities'));
        const held = new Set(data.abilities || []);
        body.append(abilityPicker(type, held, () => commit(setAbilities(record, type, [...held]), null)));
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
