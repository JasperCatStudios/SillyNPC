import { validateExpr } from './combat-formula.js';
import { validateAbilities, MAX_ABILITIES } from './combat-abilities.js';
import { gearRules, needsText } from './combat-gear.js';
import { groupByCategory, normalizeAbility, freeId } from './combat-ability-overlay.js';
import {
    allTypes, activeCombatType, saveUserAbility, deleteUserAbility, resetUserAbility, baseAbilities,
} from './combat-access.js';

/**
 * Abilities on screen (fork): a picker for the character page, sorted by category, and the
 * editor for making and changing them, which lives in the Combat tab.
 *
 * Only the abilities of the world type being looked at are ever shown: Fire Emblem's and
 * Bleach's are separate lists, and nothing here mixes them.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const KIND_LABEL = { passive: 'Passive', active: 'Active', defensive: 'Defence' };

function poolLabel(type, role) {
    return (type.pools || []).find(p => p.role === role)?.label || role;
}

/** One line of facts about an ability: kind, cost, chance. */
export function abilityFacts(type, a) {
    const bits = [KIND_LABEL[a.kind] || a.kind];
    if (a.cost?.amount) bits.push(`${a.cost.amount} ${poolLabel(type, a.cost.pool)}`);
    if (a.kind === 'passive' && a.chance) bits.push(`on ${a.trigger === 'turnStart' ? 'turn start' : a.trigger}`);
    return bits.join(' · ');
}

function tip(type, a) {
    const lines = [a.desc];
    if (a.chance) lines.push(`Chance: ${a.chance}`);
    if (a.effect?.dmgMult && a.effect.dmgMult !== 1) lines.push(`Blow x${a.effect.dmgMult}`);
    if (a.effect?.block) lines.push(`Blocks ${Math.round(a.effect.block * 100)}%`);
    if (a.effect?.heal) lines.push(`Heals ${Math.round(a.effect.heal * 100)}% (not in a spar)`);
    if (a.power) lines.push(`Power ${a.power}`);
    if (a.needs) lines.push(needsText(gearRules(type), a.needs));
    return lines.filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ the picker */

/**
 * The abilities of one type as a grid of chips, a section per category. Click a chip to give
 * the ability to the character or take it away.
 *
 * @param {object} type
 * @param {Set<string>} held Ids the character has; changed in place.
 * @param {(held: Set<string>) => void} onChange
 */
export function abilityPicker(type, held, onChange) {
    const root = el('div', 'snpc-abil-picker');
    // An ability that names a weapon comes with that weapon, so it is not something to pick.
    const list = (type.abilities || []).filter(a => !a.needs?.weapon?.length && !a.needs?.together?.length);

    const top = el('div', 'snpc-abil-top');
    const search = el('input', 'text_pole');
    search.placeholder = 'Find an ability';
    const count = el('small', 'notes');
    top.append(search, count);
    root.append(top);

    const body = el('div', 'snpc-abil-groups');
    root.append(body);

    const draw = () => {
        const q = search.value.trim().toLowerCase();
        body.replaceChildren();
        count.textContent = `${held.size} of ${MAX_ABILITIES} equipped`;
        count.classList.toggle('is-full', held.size >= MAX_ABILITIES);
        for (const { category, items } of groupByCategory(list)) {
            const shown = items.filter(a => !q || `${a.label} ${a.desc} ${category}`.toLowerCase().includes(q));
            if (!shown.length) continue;
            const mine = items.filter(a => held.has(a.id)).length;
            const group = el('details', 'snpc-abil-group');
            group.open = Boolean(q) || mine > 0;
            const head = el('summary', 'snpc-abil-head');
            head.append(el('span', 'snpc-abil-cat', category), el('span', 'snpc-abil-n', mine ? `${mine} / ${items.length}` : String(items.length)));
            group.append(head);
            const grid = el('div', 'snpc-abil-grid');
            for (const a of shown) {
                const chip = el('button', `snpc-abil-chip is-${a.kind}${held.has(a.id) ? ' is-on' : ''}`);
                chip.type = 'button';
                chip.title = tip(type, a);
                chip.setAttribute('aria-pressed', held.has(a.id) ? 'true' : 'false');
                chip.append(el('span', 'snpc-abil-name', a.label), el('span', 'snpc-abil-facts', abilityFacts(type, a)));
                const full = held.size >= MAX_ABILITIES && !held.has(a.id);
                if (full) { chip.classList.add('is-locked'); chip.title = `${tip(type, a)}\n\nAll ${MAX_ABILITIES} slots are used. Take one off first.`; }
                chip.addEventListener('click', () => {
                    if (full) { toastr.info(`Up to ${MAX_ABILITIES} abilities can be equipped. Take one off first.`, 'SillyNPC'); return; }
                    if (held.has(a.id)) held.delete(a.id); else held.add(a.id);
                    onChange(held);
                    draw();
                });
                grid.append(chip);
            }
            group.append(grid);
            body.append(group);
        }
        if (!body.childElementCount) body.append(el('p', 'notes', list.length ? 'No ability matches.' : 'This world type has no abilities yet. Make some in the Combat tab.'));
    };
    search.addEventListener('input', draw);
    draw();
    return root;
}

/* ------------------------------------------------------------------ the editor */

let editingType = '';
let selected = '';
let draft = null;
let filter = '';

const field = (label, input, hint) => {
    const wrap = el('label', 'snpc-aed-field');
    wrap.append(el('span', '', label), input);
    if (hint) wrap.title = hint;
    return wrap;
};

function typeOptions() {
    return allTypes().filter(t => t.errors.length === 0 || t.type.builtin).map(t => t.type);
}

/** Renders the ability editor into a host. `rerender` redraws the whole Combat pane. */
export function renderAbilityEditor(host, rerender) {
    const types = typeOptions();
    if (!types.length) { host.append(el('p', 'notes', 'No usable world types.')); return; }
    if (!types.some(t => t.id === editingType)) editingType = (activeCombatType() || types[0]).id;
    const type = types.find(t => t.id === editingType);
    const list = type.abilities || [];

    const redraw = () => { host.replaceChildren(); renderAbilityEditor(host, rerender); };

    const bar = el('div', 'snpc-aed-bar');
    const typeSel = el('select', 'text_pole');
    for (const t of types) typeSel.append(new Option(`${t.name}${t.builtin ? ' (built-in)' : ''}`, t.id));
    typeSel.value = type.id;
    typeSel.addEventListener('change', () => { editingType = typeSel.value; selected = ''; draft = null; redraw(); });
    const search = el('input', 'text_pole');
    search.placeholder = 'Find an ability';
    search.value = filter;
    const add = el('button', 'menu_button', '+ New ability');
    add.type = 'button';
    add.addEventListener('click', () => {
        selected = '';
        draft = normalizeAbility({ id: freeId(list, 'new_ability'), label: 'New ability', category: 'General', kind: 'active', power: 5 });
        draft.__new = true;
        redraw();
    });
    bar.append(typeSel, search, add);
    host.append(bar);

    const cols = el('div', 'snpc-aed');
    const side = el('div', 'snpc-aed-list');
    const form = el('div', 'snpc-aed-form');
    cols.append(side, form);
    host.append(cols);

    // The list, by category, for this world type only.
    const drawList = () => {
        side.replaceChildren();
        const q = filter.trim().toLowerCase();
        for (const { category, items } of groupByCategory(list)) {
            const shown = items.filter(a => !q || `${a.label} ${category}`.toLowerCase().includes(q));
            if (!shown.length) continue;
            side.append(el('div', 'snpc-aed-cat', `${category} (${shown.length})`));
            for (const a of shown) {
                const row = el('button', `snpc-aed-item is-${a.kind}${a.id === selected ? ' is-selected' : ''}`);
                row.type = 'button';
                row.append(el('span', 'snpc-aed-item-name', a.label));
                row.append(el('span', 'snpc-aed-item-tag', a.source === 'custom' ? 'yours' : a.source === 'edited' ? 'edited' : KIND_LABEL[a.kind]));
                row.addEventListener('click', () => {
                    selected = a.id;
                    draft = structuredClone(a);
                    delete draft.source;
                    redraw();
                });
                side.append(row);
            }
        }
        const shownIds = new Set(list.map(x => x.id));
        const hidden = baseAbilities(type.id).filter(x => !shownIds.has(x.id));
        if (hidden.length) {
            side.append(el('div', 'snpc-aed-cat', `Hidden (${hidden.length})`));
            for (const h of hidden) {
                const row = el('div', 'snpc-aed-item is-hidden');
                row.append(el('span', 'snpc-aed-item-name', h.label));
                const restore = el('button', 'menu_button', 'Restore');
                restore.type = 'button';
                restore.addEventListener('click', () => { resetUserAbility(type.id, h.id); rerender(); });
                row.append(restore);
                side.append(row);
            }
        }
        if (!side.childElementCount) side.append(el('p', 'notes', list.length ? 'Nothing matches.' : 'No abilities yet. Make the first one.'));
    };
    search.addEventListener('input', () => { filter = search.value; drawList(); });
    drawList();

    // The form.
    if (!draft) {
        form.append(el('p', 'notes', 'Pick an ability to edit it, or make a new one. Changes to built-in abilities are kept separately and can be reset.'));
        return;
    }
    const a = draft;
    const isNew = Boolean(a.__new);
    const source = list.find(x => x.id === a.id)?.source;
    const builtinHere = baseAbilities(type.id).some(x => x.id === a.id);

    const label = el('input', 'text_pole'); label.value = a.label || '';
    const category = el('input', 'text_pole'); category.value = a.category || '';
    const cats = el('datalist'); cats.id = 'snpc-aed-cats';
    for (const g of groupByCategory(list)) cats.append(new Option(g.category));
    category.setAttribute('list', cats.id);
    const kind = el('select', 'text_pole');
    for (const k of ['active', 'passive', 'defensive']) kind.append(new Option(KIND_LABEL[k], k));
    kind.value = a.kind;
    const desc = el('textarea', 'text_pole'); desc.rows = 2; desc.value = a.desc || '';

    const trigger = el('select', 'text_pole');
    for (const [v, t] of [['attack', 'When you strike'], ['defend', 'When you are struck'], ['turnStart', 'At the start of your turn']]) trigger.append(new Option(t, v));
    trigger.value = a.trigger || 'attack';
    const chance = el('input', 'text_pole'); chance.value = a.chance || ''; chance.placeholder = 'e.g. a.luck/4 + 5';
    const prof = el('select', 'text_pole');
    prof.append(new Option('any', ''));
    for (const p of type.proficiencies) prof.append(new Option(p.label, p.id));
    prof.value = a.prof || '';
    const power = el('input', 'text_pole'); power.type = 'number'; power.value = a.power ?? 0;
    const pool = el('select', 'text_pole');
    pool.append(new Option('free', ''));
    for (const p of type.pools) pool.append(new Option(p.label, p.role));
    pool.value = a.cost?.pool || '';
    const amount = el('input', 'text_pole'); amount.type = 'number'; amount.value = a.cost?.amount ?? 0;
    const dmg = el('input', 'text_pole'); dmg.type = 'number'; dmg.step = '0.1'; dmg.value = a.effect?.dmgMult ?? 1;
    const block = el('input', 'text_pole'); block.type = 'number'; block.step = '0.05'; block.min = '0'; block.max = '1'; block.value = a.effect?.block ?? 0;
    const heal = el('input', 'text_pole'); heal.type = 'number'; heal.step = '0.05'; heal.min = '0'; heal.max = '1'; heal.value = a.effect?.heal ?? 0;
    const below = el('input', 'text_pole'); below.type = 'number'; below.step = '5'; below.min = '0'; below.max = '100'; below.value = a.whenBelow ? Math.round(a.whenBelow * 100) : 0;
    const missing = el('input', 'text_pole'); missing.type = 'number'; missing.step = '0.1'; missing.min = '0'; missing.max = '5'; missing.value = a.effect?.missingBonus ?? 0;
    const drain = el('input', 'text_pole'); drain.type = 'number'; drain.step = '0.05'; drain.min = '0'; drain.max = '1'; drain.value = a.effect?.drain ?? 0;
    const counter = el('input', 'text_pole'); counter.type = 'number'; counter.step = '0.1'; counter.min = '0'; counter.max = '3'; counter.value = a.effect?.counter ?? 0;

    // What gear it needs (optional): see needs in combat-gear.js. Names are separated by commas.
    const csv = (v) => (Array.isArray(v) ? v.join(', ') : '');
    const needTogether = el('input', 'text_pole'); needTogether.value = csv(a.needs?.together); needTogether.placeholder = 'e.g. Twin Tide, Salt Fang';
    const needWeapon = el('input', 'text_pole'); needWeapon.value = csv(a.needs?.weapon); needWeapon.placeholder = 'e.g. Thunderbrand';
    const needTier = el('input', 'text_pole'); needTier.value = a.needs?.tier || ''; needTier.placeholder = 'e.g. relic, bankai';
    const needLadder = el('input', 'text_pole'); needLadder.value = a.needs?.ladder || ''; needLadder.placeholder = 'e.g. release (blank: any)';
    const readNeeds = () => {
        const names = (v) => String(v).split(',').map(x => x.trim()).filter(Boolean);
        return { together: names(needTogether.value), weapon: names(needWeapon.value), tier: needTier.value.trim(), ladder: needLadder.value.trim(), kind: a.needs?.kind };
    };
    const groups = {
        trigger: field('When it can fire', trigger),
        chance: field('Chance (0 to 100, a formula)', chance, 'Over your roles, e.g. a.luck/4 + 5'),
        prof: field('Rolls with', prof),
        power: field('Power', power, 'Added to the blow'),
        pool: field('Paid from', pool),
        amount: field('Cost', amount),
        dmg: field('Blow multiplier', dmg, '1 is no change, 1.5 is half again'),
        block: field('Blocks (0 to 1)', block, 'Share of the next blow negated'),
        heal: field('Heals (0 to 1)', heal, 'Share of max health. Never in a spar.'),
        below: field('Only when health is below (%)', below, '0 means always. 50 means only while under half health.'),
        missing: field('Grows when hurt (0 to 5)', missing, '1 doubles the blow by the time you have nothing left'),
        drain: field('Drains (0 to 1)', drain, 'Share of the damage dealt that you take back as health. Never in a spar.'),
        counter: field('Strikes back (0 to 3)', counter, 'After being struck you hit back at once, at this strength'),
    };
    const showKind = () => {
        const k = kind.value;
        groups.trigger.style.display = k === 'passive' ? '' : 'none';
        groups.chance.style.display = k === 'passive' ? '' : 'none';
        groups.prof.style.display = k === 'active' ? '' : 'none';
        groups.power.style.display = k === 'active' ? '' : 'none';
        groups.pool.style.display = k === 'passive' ? 'none' : '';
        groups.amount.style.display = k === 'passive' ? 'none' : '';
        groups.dmg.style.display = k === 'defensive' ? 'none' : '';
        const t = trigger.value;
        const passive = k === 'passive';
        groups.below.style.display = passive ? '' : 'none';
        groups.missing.style.display = (k === 'active' || (passive && t === 'attack')) ? '' : 'none';
        groups.drain.style.display = (k === 'active' || (passive && t === 'attack')) ? '' : 'none';
        groups.counter.style.display = passive && t === 'defend' ? '' : 'none';
        groups.block.style.display = (k === 'defensive' || (passive && t === 'defend')) ? '' : 'none';
        groups.heal.style.display = (k === 'defensive' || (passive && t !== 'attack')) ? '' : 'none';
        if (passive) groups.dmg.style.display = t === 'attack' ? '' : 'none';
    };
    kind.addEventListener('change', showKind);
    trigger.addEventListener('change', showKind);

    const head = el('div', 'snpc-aed-title');
    head.append(el('b', '', isNew ? 'New ability' : a.label));
    if (!isNew) head.append(el('small', 'notes', source === 'custom' ? 'yours' : source === 'edited' ? 'built-in, edited' : 'built-in'));
    form.append(head, cats);
    const g1 = el('div', 'snpc-aed-grid');
    g1.append(field('Name', label), field('Category', category), field('Kind', kind));
    form.append(g1, field('Description', desc));
    const g2 = el('div', 'snpc-aed-grid');
    g2.append(groups.trigger, groups.chance, groups.below, groups.prof, groups.power, groups.pool, groups.amount, groups.dmg, groups.missing, groups.drain, groups.block, groups.heal, groups.counter);
    form.append(g2);
    const needsBox = el('details', 'snpc-gear-more');
    needsBox.open = Boolean(a.needs);
    needsBox.append(el('summary', '', 'Needs gear (optional)'));
    const g3 = el('div', 'snpc-aed-grid');
    g3.append(
        field('All of these weapons held', needTogether, 'Weapons that must be held at once (twin relics). The ability comes with them.'),
        field('Any of these weapons', needWeapon, 'One of these named weapons must be held. The ability comes with it.'),
        field('Tier it must be at or above', needTier, "The tier's id on its ladder, such as relic or bankai."),
        field('Tier ladder', needLadder, 'Only needed when the tier name exists on more than one ladder.'),
    );
    needsBox.append(g3);
    form.append(needsBox);
    showKind();

    const problems = el('div', 'snpc-aed-problems');
    form.append(problems);

    const build = () => normalizeAbility({
        id: a.id, label: label.value, category: category.value, kind: kind.value, desc: desc.value,
        trigger: trigger.value, chance: chance.value, whenBelow: Number(below.value) / 100, prof: prof.value, power: power.value,
        cost: pool.value ? { pool: pool.value, amount: amount.value } : null,
        effect: { dmgMult: dmg.value, block: block.value, heal: heal.value, missingBonus: missing.value, drain: drain.value, counter: counter.value },
        needs: readNeeds(),
    });
    const check = (ability) => {
        const others = list.filter(x => x.id !== ability.id);
        return validateAbilities({ ...type, abilities: [...others, ability] }, validateExpr).errors
            .filter(e => e.includes(`"${ability.id}"`) || e.includes(ability.id));
    };

    const buttons = el('div', 'snpc-aed-buttons');
    const save = el('button', 'menu_button', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => {
        const ability = build();
        if (isNew) ability.id = freeId(list, ability.label || 'ability');
        if (!ability.label) { toastr.warning('Give it a name.', 'SillyNPC'); return; }
        const errors = check(ability);
        if (errors.length) { problems.replaceChildren(...errors.map(e => el('div', 'snpc-aed-problem', e))); return; }
        saveUserAbility(type.id, ability);
        selected = ability.id;
        draft = null;
        toastr.success(`${ability.label} saved.`, 'SillyNPC');
        rerender();
    });
    buttons.append(save);

    if (!isNew) {
        const dup = el('button', 'menu_button', 'Duplicate');
        dup.type = 'button';
        dup.addEventListener('click', () => {
            const copy = build();
            copy.id = freeId(list, `${copy.label} copy`);
            copy.label = `${copy.label} copy`;
            saveUserAbility(type.id, copy);
            selected = copy.id;
            draft = { ...copy };
            rerender();
        });
        buttons.append(dup);
        if (builtinHere && source === 'edited') {
            const reset = el('button', 'menu_button', 'Reset to built-in');
            reset.type = 'button';
            reset.addEventListener('click', () => { resetUserAbility(type.id, a.id); draft = null; selected = ''; rerender(); });
            buttons.append(reset);
        }
        const del = el('button', 'menu_button', builtinHere ? 'Hide' : 'Delete');
        del.type = 'button';
        del.title = builtinHere ? 'Hides this built-in ability. Reset brings it back.' : 'Deletes this ability. Characters who had it simply lose it.';
        del.addEventListener('click', () => {
            if (!confirm(`${builtinHere ? 'Hide' : 'Delete'} "${a.label}"?`)) return;
            deleteUserAbility(type.id, a.id);
            draft = null; selected = '';
            rerender();
        });
        buttons.append(del);
    }
    const cancel = el('button', 'menu_button', 'Close');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { draft = null; selected = ''; redraw(); });
    buttons.append(cancel);
    form.append(buttons);
}
