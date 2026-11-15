import { activeCombatType, userGearOverlay, saveUserLadder, resetUserLadder, saveUserKind, deleteUserKind, resetUserKind,
    saveUserTool, deleteUserTool, resetUserTool, armoury, saveArmouryItem, deleteArmouryItem } from './combat-access.js';
import { gearRules, kindOf } from './combat-gear.js';
import { kindChoices, tierChoices, effectLine, readableOn, tierBadge } from './combat-gear-view.js';
import { TOOL_EFFECTS } from './combat-gear-defaults.js';
import { tierBadgeElement } from './ui-gear.js';

import { PRODUCT_NAME } from './constants.js';
/**
 * The Armoury (fork): the weapon rules of the active world, in one place, and the world's named
 * weapons.
 *
 *   Tiers     each tier ladder: rename a tier, change its colour, add or remove tiers; the numbers
 *             (power, hit, crit, damage) sit under "More numbers"
 *   Kinds     what a weapon or focus can be: its slot, hands, proficiency and numbers
 *   Tools     the consumables and what they do
 *   Armoury   named weapons ("Areadbhar") anyone in this world can be given from their sheet
 *
 * Changes are kept beside the world type as an overlay, never in the type itself, so a built-in
 * world stays as it came and "Reset" always brings it back. They follow the System like the
 * abilities do. Draws only; the rules live in combat-gear*.js.
 */

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

const textIn = (value, onChange, placeholder = '') => {
    const i = el('input', 'text_pole');
    i.value = value ?? '';
    i.placeholder = placeholder;
    i.addEventListener('change', () => onChange(i.value));
    return i;
};

const numIn = (value, onChange, { step = 1, min } = {}) => {
    const i = el('input', 'text_pole');
    i.type = 'number';
    i.step = String(step);
    if (min !== undefined) i.min = String(min);
    i.value = value ?? 0;
    i.addEventListener('change', () => onChange(Number(i.value)));
    return i;
};

const selectIn = (options, value, onChange) => {
    const s = el('select', 'text_pole');
    for (const [v, label] of options) s.append(new Option(label, v));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
};

function slug(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function freeId(taken, wanted) {
    const root = slug(wanted) || 'new';
    if (!taken.includes(root)) return root;
    for (let n = 2; n < 1000; n++) if (!taken.includes(`${root}_${n}`)) return `${root}_${n}`;
    return `${root}_${Date.now()}`;
}

const heading = (text, hint) => {
    const h = el('div', 'sillynpc-combat-group', text);
    if (hint) h.title = hint;
    return h;
};

/**
 * @param {HTMLElement} host
 * @param {() => void} rerender redraws the whole Armoury after a change
 */
export function renderArmoury(host, rerender) {
    const type = activeCombatType();
    if (!type) {
        host.append(el('p', 'notes', 'Pick a combat world type under Settings first. The Armoury holds that world\'s weapon tiers, kinds and tools.'));
        return;
    }
    const rules = gearRules(type);
    const overlay = userGearOverlay(type.id);
    host.append(el('p', 'notes', `The weapons of ${type.name}. Your changes are kept beside the world and can be reset at any time; the world itself is never altered.`));

    /* ---------------------------------------------------------------- tiers */
    host.append(heading('Tiers', 'How good a weapon is. The world names its own tiers.'));
    for (const [ladderId, ladder] of Object.entries(rules.ladders)) {
        const box = el('div', 'snpc-armoury-ladder');
        const top = el('div', 'snpc-armoury-ladder-head');
        top.append(el('strong', '', `${ladder.label || 'Tier'} ladder${ladderId === 'default' ? '' : ` (${ladderId})`}`));
        const save = (tiers, label = ladder.label) => {
            saveUserLadder(type.id, ladderId, { label, defaultTier: ladder.defaultTier, tiers });
            rerender();
        };
        top.append(textIn(ladder.label, (v) => save(ladder.tiers, v || ladder.label), 'What the world calls it'));
        if (overlay.ladders[ladderId]) {
            const reset = el('button', 'menu_button', 'Reset to the world\'s tiers');
            reset.type = 'button';
            reset.addEventListener('click', () => { resetUserLadder(type.id, ladderId); rerender(); });
            top.append(reset);
        }
        box.append(top);

        ladder.tiers.forEach((tier, i) => {
            const row = el('div', 'snpc-armoury-tier');
            const preview = tierBadgeElement({ ...tier, text: readableOn(tier.color) });
            const edit = (patch) => save(ladder.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
            const colour = el('input');
            colour.type = 'color';
            colour.value = /^#[0-9a-f]{6}$/i.test(tier.color) ? tier.color : '#9e9e9e';
            colour.addEventListener('change', () => edit({ color: colour.value }));
            row.append(preview, field('Name', textIn(tier.label, (v) => edit({ label: v || tier.label }))),
                field('Prefix', textIn(tier.prefix, (v) => edit({ prefix: v }), 'e.g. Silver, for "Silver Sword"')),
                field('Colour', colour));
            const more = el('details', 'snpc-gear-more');
            more.append(el('summary', '', 'More numbers'));
            const nums = el('div', 'sillynpc-combat-meta');
            nums.append(
                field('Power', numIn(tier.power, (v) => edit({ power: v })), 'Added to the power of every strike'),
                field('Hit', numIn(tier.hit, (v) => edit({ hit: v })), 'Added to the attack roll'),
                field('Crit %', numIn(tier.crit, (v) => edit({ crit: v }), { min: 0 }), 'Chance a landed blow lands a band better'),
                field('Damage ×', numIn(tier.mult, (v) => edit({ mult: v }), { step: 0.05, min: 0.1 }), 'Multiplies the damage the world works out'),
            );
            more.append(nums);
            row.append(more);
            if (ladder.tiers.length > 1 && tier.id !== ladder.defaultTier) {
                const del = el('button', 'menu_button', 'Remove');
                del.type = 'button';
                del.addEventListener('click', () => save(ladder.tiers.filter((_, j) => j !== i)));
                row.append(del);
            }
            box.append(row);
        });
        const add = el('button', 'menu_button', '+ Add a tier');
        add.type = 'button';
        add.addEventListener('click', () => {
            const last = ladder.tiers[ladder.tiers.length - 1];
            const label = `Tier ${ladder.tiers.length + 1}`;
            save([...ladder.tiers, { ...last, id: freeId(ladder.tiers.map(t => t.id), label), label, prefix: '', signature: false }]);
        });
        box.append(add);
        host.append(box);
    }

    /* ---------------------------------------------------------------- kinds */
    host.append(heading('Weapon kinds', 'What a weapon or focus can be. Power and hit here are on top of the world\'s basic attack for its skill.'));
    const profs = type.proficiencies.filter(p => (p.roles || []).some(r => r === 'weapon' || r === 'magic'));
    const slotLabel = { hand: 'Held', focus: 'Focus (no hand)', natural: 'Natural (fists)' };
    for (const kind of rules.kinds) {
        const state = overlay.kinds.edited[kind.id] ? 'edited' : overlay.kinds.added.some(k => k.id === kind.id) ? 'yours' : 'world';
        const row = el('div', 'snpc-armoury-row');
        const change = (patch) => { saveUserKind(type.id, { ...kind, ...patch }); rerender(); };
        row.append(
            field('Name', textIn(kind.label, (v) => change({ label: v || kind.label }))),
            field('Used as', selectIn(Object.entries(slotLabel), kind.slot, (v) => change({ slot: v, hands: v === 'hand' ? (kind.hands || 1) : 0 }))),
        );
        if (kind.slot === 'hand') {
            row.append(field('Hands', selectIn([['1', 'One'], ['2', 'Two']], String(kind.hands || 1), (v) => change({ hands: Number(v), dualable: v === '1' && kind.dualable }))));
            if (kind.hands === 1) {
                const d = el('input');
                d.type = 'checkbox';
                d.checked = kind.dualable;
                d.addEventListener('change', () => change({ dualable: d.checked }));
                const wrap = el('label', 'checkbox_label');
                wrap.append(d, el('span', '', 'Can be a pair'));
                row.append(wrap);
            }
        }
        row.append(
            field('Skill', selectIn([['', 'None'], ...profs.map(p => [p.id, p.label])], kind.prof, (v) => change({ prof: v, channel: type.proficiencies.find(p => p.id === v)?.channel || kind.channel }))),
            field('Power', numIn(kind.power, (v) => change({ power: v }))),
            field('Hit', numIn(kind.hit, (v) => change({ hit: v }))),
        );
        const tag = el('small', 'notes', state === 'world' ? '' : state === 'edited' ? 'changed by you' : 'yours');
        row.append(tag);
        if (state === 'edited') {
            const reset = el('button', 'menu_button', 'Reset');
            reset.type = 'button';
            reset.addEventListener('click', () => { resetUserKind(type.id, kind.id); rerender(); });
            row.append(reset);
        }
        const del = el('button', 'menu_button', state === 'yours' ? 'Delete' : 'Hide');
        del.type = 'button';
        del.addEventListener('click', () => { deleteUserKind(type.id, kind.id); rerender(); });
        row.append(del);
        host.append(row);
    }
    for (const id of overlay.kinds.removed) {
        const row = el('div', 'snpc-armoury-row is-hidden');
        row.append(el('small', 'notes', `Hidden: ${id}`));
        const back = el('button', 'menu_button', 'Bring back');
        back.type = 'button';
        back.addEventListener('click', () => { resetUserKind(type.id, id); rerender(); });
        row.append(back);
        host.append(row);
    }
    const addKind = el('button', 'menu_button', '+ Add a weapon kind');
    addKind.type = 'button';
    addKind.addEventListener('click', () => {
        saveUserKind(type.id, { id: freeId(rules.kinds.map(k => k.id), 'new_kind'), label: 'New kind', slot: 'hand', hands: 1, dualable: false, range: 'melee', ladder: 'default', prof: '', power: 0, hit: 0, weight: 3, verb: 'strikes' });
        rerender();
    });
    host.append(addKind);

    /* ---------------------------------------------------------------- tools */
    host.append(heading('Tools', 'Things used up in a fight instead of attacking: throwing knives, smoke bombs.'));
    for (const tool of rules.tools) {
        const state = overlay.tools.edited[tool.id] ? 'edited' : overlay.tools.added.some(k => k.id === tool.id) ? 'yours' : 'world';
        const row = el('div', 'snpc-armoury-row');
        const change = (patch, effect) => { saveUserTool(type.id, { ...tool, ...patch, effect: { ...tool.effect, ...(effect || {}) } }); rerender(); };
        row.append(
            field('Name', textIn(tool.label, (v) => change({ label: v || tool.label }))),
            field('Uses', numIn(tool.uses, (v) => change({ uses: Math.max(1, Math.round(v) || 1) }), { min: 1 })),
            field('Does', selectIn(TOOL_EFFECTS.map(t => [t, t === 'damage' ? 'Hurts' : t === 'smoke' ? 'Helps escape' : t === 'blind' ? 'Blinds' : t === 'stun' ? 'Stuns' : 'Heals']), tool.effect.type, (v) => change({}, { type: v }))),
        );
        if (tool.effect.type === 'damage') row.append(field('Power', numIn(tool.effect.power ?? 0, (v) => change({}, { power: v }))));
        if (tool.effect.type === 'heal') row.append(field('Heals %', numIn(Math.round((tool.effect.share ?? 0) * 100), (v) => change({}, { share: Math.max(0, Math.min(100, v)) / 100 }), { min: 0 })));
        if (['blind', 'stun', 'smoke'].includes(tool.effect.type)) row.append(field('Turns', numIn(tool.effect.turns ?? 1, (v) => change({}, { turns: Math.max(1, Math.round(v) || 1) }), { min: 1 })));
        row.append(el('small', 'notes', `${state === 'world' ? '' : state === 'edited' ? 'changed by you. ' : 'yours. '}${effectLine(tool)}`));
        if (state === 'edited') {
            const reset = el('button', 'menu_button', 'Reset');
            reset.type = 'button';
            reset.addEventListener('click', () => { resetUserTool(type.id, tool.id); rerender(); });
            row.append(reset);
        }
        const del = el('button', 'menu_button', state === 'yours' ? 'Delete' : 'Hide');
        del.type = 'button';
        del.addEventListener('click', () => { deleteUserTool(type.id, tool.id); rerender(); });
        row.append(del);
        host.append(row);
    }
    for (const id of overlay.tools.removed) {
        const row = el('div', 'snpc-armoury-row is-hidden');
        row.append(el('small', 'notes', `Hidden: ${id}`));
        const back = el('button', 'menu_button', 'Bring back');
        back.type = 'button';
        back.addEventListener('click', () => { resetUserTool(type.id, id); rerender(); });
        row.append(back);
        host.append(row);
    }
    const addTool = el('button', 'menu_button', '+ Add a tool');
    addTool.type = 'button';
    addTool.addEventListener('click', () => {
        saveUserTool(type.id, { id: freeId(rules.tools.map(t => t.id), 'new_tool'), label: 'New tool', uses: 1, verb: 'uses', effect: { type: 'damage', power: 2, area: 'one', range: 'ranged' } });
        rerender();
    });
    host.append(addTool);

    /* ------------------------------------------------------------- named weapons */
    host.append(heading('Named weapons', 'Weapons of this world that anyone can be given from their own sheet.'));
    const named = armoury(type.id);
    if (!named.some(n => !n.builtIn)) host.append(el('p', 'notes', 'None of your own yet. Add a famous weapon here and give it to a character in one click.'));
    const builtIns = el('details', 'snpc-gear-more');
    const builtInCount = named.filter(n => n.builtIn).length;
    if (builtInCount) {
        builtIns.append(el('summary', '', `The world's own weapons (${builtInCount}, cannot be deleted)`));
        host.append(builtIns);
    }
    for (const item of named) {
        const row = el('div', 'snpc-armoury-row');
        const badge = tierBadge(rules, item);
        if (badge) row.append(tierBadgeElement(badge));
        const kind = kindOf(rules, item.kind);
        row.append(el('strong', '', item.name), el('small', 'notes', `${badge ? `${badge.label} ` : ''}${kind?.label || item.kind}${item.desc ? `. ${item.desc}` : ''}`));
        if (item.builtIn) { builtIns.append(row); continue; }
        const del = el('button', 'menu_button', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => { deleteArmouryItem(type.id, item.id); rerender(); });
        row.append(del);
        host.append(row);
    }
    host.append(addNamedForm(type, rules, rerender));
}

/** The small form that adds one named weapon. */
function addNamedForm(type, rules, rerender) {
    const form = el('div', 'snpc-armoury-row snpc-armoury-new');
    const name = el('input', 'text_pole');
    name.placeholder = 'e.g. Areadbhar';
    const kinds = kindChoices(rules);
    const kind = selectIn(kinds.map(k => [k.id, k.label]), kinds[0]?.id || '', () => fill());
    const tier = el('select', 'text_pole');
    const desc = el('input', 'text_pole');
    desc.placeholder = 'A line about it (optional)';
    const fill = () => {
        tier.replaceChildren();
        const choices = tierChoices(rules, kind.value);
        for (const t of choices.tiers) tier.append(new Option(t.label, t.id));
        tier.value = choices.defaultTier;
    };
    fill();
    const add = el('button', 'menu_button', 'Add to the Armoury');
    add.type = 'button';
    add.addEventListener('click', () => {
        if (!name.value.trim()) { toastr.info('Give the weapon a name first.', PRODUCT_NAME); return; }
        saveArmouryItem(type.id, { name: name.value, kind: kind.value, tier: tier.value, desc: desc.value });
        rerender();
    });
    form.append(field('Name', name), field('Kind', kind), field('Tier', tier), field('Description', desc), add);
    return form;
}
