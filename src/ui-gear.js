import { saveSettings } from './settings.js';
import { getTypeData } from './combat-store.js';
import { gearRules, effectiveGear, kindOf, toolKindOf } from './combat-gear.js';
import { addItem, updateItem, removeItem, equip, setBelt, refillTools } from './combat-edit.js';
import { armoury } from './combat-access.js';
import {
    kindChoices, tierChoices, slotsFor, equippedSlot, tierBadge, itemSummary, loadoutLine, canTakeTool,
    specialChoices, effectLine, toolsForFight, SLOT_LABELS,
} from './combat-gear-view.js';

import { PRODUCT_NAME } from './constants.js';
import { buildArtIcon } from './ui-faction.js';
/**
 * Weapons and tools on a character's combat sheet (fork).
 *
 * Shows what they hold (main hand, off hand, focus), everything they carry with its tier badge,
 * an editor for one item at a time, and the tool belt. Everything shown comes from the world's
 * gear rules (its tier names, its weapon kinds), so a world that calls its tiers something else
 * reads that way here. Writes go through combat-edit.js; this file draws and asks.
 *
 * A character who only has an old-style weapon sees it here as one item right away (the read
 * is a migration view); the first edit saves it as gear.
 *
 * Lives in src/ with the rest of the sheet so it keeps working if the combat module's files
 * fail to load. Draws only; the numbers and rules are in combat-gear*.js.
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

/** Which item is being edited, per character and type, for the session: an id, or 'new-weapon'/'new-tool'. */
const editing = new Map();

/** A small coloured tier badge: the tier's own words, colour and icon. */
export function tierBadgeElement(badge) {
    const b = el('span', `snpc-tier${badge.signature ? ' is-signature' : ''}`);
    b.style.setProperty('--tier-color', badge.color);
    b.style.setProperty('--tier-text', badge.text);
    const icon = el('i', badge.icon);
    icon.setAttribute('aria-hidden', 'true');
    b.append(icon, document.createTextNode(` ${badge.label}`));
    return b;
}

/**
 * @param {object} record A character, or the player's card.
 * @param {object} type The world type, with the player's gear changes applied.
 * @param {{ commit: (result: object, input: any) => void }} ctx commit saves, reports a refusal and tells the page.
 * @returns {HTMLElement}
 */
export function renderGearBlock(record, type, { commit }) {
    const box = el('div', 'snpc-gear');
    const key = `${record.id || 'player'}:${type.id}`;
    const rules = gearRules(type);

    const act = (result) => {
        commit(result, null);
        if (result.ok) draw();
    };

    function currentGear() {
        return effectiveGear(type, getTypeData(record, type.dataKey)) || { items: [], equipped: { main: null, off: null, focus: null }, belt: [] };
    }

    function draw() {
        const gear = currentGear();
        box.replaceChildren();
        box.append(el('div', 'sillynpc-combat-group', 'Weapons and tools'));

        // What they hold.
        const slots = el('div', 'sillynpc-combat-meta snpc-gear-slots');
        for (const slot of ['main', 'off', 'focus']) {
            const select = el('select', 'text_pole');
            select.append(new Option('Nothing', ''));
            for (const item of gear.items) {
                if (slotsFor(rules, item).includes(slot)) select.append(new Option(item.name || item.kind, item.id));
            }
            select.value = gear.equipped[slot] || '';
            select.addEventListener('change', () => act(equip(record, type, slot, select.value || null)));
            slots.append(field(SLOT_LABELS[slot], select,
                slot === 'main' ? 'What they attack with' : slot === 'off' ? 'A second one-handed weapon, if the main one is not a pair' : 'A book or staff: it takes no hand'));
        }
        box.append(slots, el('small', 'notes snpc-gear-line', loadoutLine(gear)));

        // What they carry.
        const weapons = gear.items.filter(i => !i.tool);
        const tools = gear.items.filter(i => i.tool);
        const list = el('div', 'snpc-gear-list');
        for (const item of weapons) list.append(itemRow(gear, item));
        if (!weapons.length) list.append(el('small', 'notes', 'No weapons yet. With none they use their basic attacks.'));
        box.append(list);

        if (tools.length) {
            box.append(el('div', 'sillynpc-combat-group', 'Tools'));
            const tl = el('div', 'snpc-gear-list');
            for (const item of tools) tl.append(toolRow(gear, item));
            box.append(tl);
            if (tools.some(t => t.uses < t.maxUses)) {
                const refill = el('button', 'menu_button', 'Refill all tools');
                refill.type = 'button';
                refill.addEventListener('click', () => act(refillTools(record, type)));
                box.append(refill);
            }
            box.append(el('small', 'notes', 'The tools ticked here go into the next fight. You can change them on the fight screen before it begins.'));
        }

        // Add.
        const add = el('div', 'snpc-gear-add');
        const addW = el('button', 'menu_button', '+ Weapon');
        addW.type = 'button';
        addW.addEventListener('click', () => { editing.set(key, 'new-weapon'); draw(); });
        add.append(addW);
        if (rules.tools.length) {
            const addT = el('button', 'menu_button', '+ Tool');
            addT.type = 'button';
            addT.addEventListener('click', () => { editing.set(key, 'new-tool'); draw(); });
            add.append(addT);
        }
        const named = armoury(type.id);
        if (named.length) {
            const pick = el('select', 'text_pole snpc-gear-armoury');
            pick.append(new Option('+ From the Armoury', ''));
            for (const n of named) pick.append(new Option(`${n.name} (${itemSummary(rules, n)})`, n.id));
            pick.addEventListener('change', () => {
                const found = named.find(n => n.id === pick.value);
                if (!found) return;
                const { id, ...copy } = found;
                const slot = slotsFor(rules, found).find(s => !gear.equipped[s]);
                act(addItem(record, type, copy, slot ? { equip: slot } : {}));
            });
            add.append(pick);
        }
        box.append(add);

        const which = editing.get(key);
        if (which) box.append(editor(gear, which));
    }

    function itemRow(gear, item) {
        const row = el('div', 'snpc-gear-item');
        const badge = tierBadge(rules, item);
        if (badge) row.append(tierBadgeElement(badge));
        // The world's picture for this kind of weapon, or a built-in icon, or nothing.
        try {
            const icon = buildArtIcon(type, item.kind, { kind: 'kind', title: item.kind, quiet: true });
            if (icon) row.append(icon);
        } catch { /* presentation only */ }
        const text = el('div', 'snpc-gear-text');
        text.append(el('strong', '', item.name || item.kind));
        const slot = equippedSlot(gear, item.id);
        text.append(el('small', 'notes', `${itemSummary(rules, item)}${slot ? `, in the ${SLOT_LABELS[slot].toLowerCase()}` : ''}`));
        if (item.desc) text.append(el('small', 'notes snpc-gear-desc', item.desc));
        row.append(text, rowButtons(item));
        return row;
    }

    function toolRow(gear, item) {
        const row = el('div', 'snpc-gear-item is-tool');
        const text = el('div', 'snpc-gear-text');
        text.append(el('strong', '', item.name || item.kind));
        const kind = toolKindOf(rules, item.kind);
        text.append(el('small', 'notes', `${itemSummary(rules, item)}${kind ? `. ${effectLine(kind)}` : ''}`));
        const carry = el('label', 'checkbox_label snpc-gear-carry');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = gear.belt.includes(item.id);
        check.disabled = !check.checked && !canTakeTool(gear, item.id);
        check.addEventListener('change', () => {
            const belt = check.checked ? [...gear.belt, item.id] : gear.belt.filter(x => x !== item.id);
            act(setBelt(record, type, belt));
        });
        carry.append(check, el('span', '', 'Takes it into a fight'));
        row.append(text, carry, rowButtons(item));
        return row;
    }

    function rowButtons(item) {
        const wrap = el('div', 'snpc-gear-buttons');
        const edit = el('button', 'menu_button', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', () => { editing.set(key, item.id); draw(); });
        const del = el('button', 'menu_button', 'Remove');
        del.type = 'button';
        del.addEventListener('click', () => {
            if (!confirm(`Remove ${item.name || item.kind}?`)) return;
            act(removeItem(record, type, item.id));
        });
        wrap.append(edit, del);
        return wrap;
    }

    /** The editor for one item, or a new one. Cancel just closes it. */
    function editor(gear, which) {
        const isTool = which === 'new-tool' || Boolean(gear.items.find(i => i.id === which)?.tool);
        const isNew = which === 'new-weapon' || which === 'new-tool';
        const item = isNew ? null : gear.items.find(i => i.id === which);
        if (!isNew && !item) { editing.delete(key); return el('div'); }

        const panel = el('div', 'snpc-gear-editor');
        panel.append(el('div', 'sillynpc-combat-group', isNew ? (isTool ? 'New tool' : 'New weapon') : `Editing ${item.name || item.kind}`));

        const name = el('input', 'text_pole');
        name.placeholder = isTool ? 'e.g. Throwing knives' : 'e.g. Dual Scimitars';
        name.value = item?.name || '';

        const kinds = kindChoices(rules, { tool: isTool });
        const kindSel = el('select', 'text_pole');
        for (const k of kinds) kindSel.append(new Option(k.label, k.id));
        kindSel.value = item?.kind || kinds[0]?.id || '';

        const tierSel = el('select', 'text_pole');
        const tierWrap = field('Tier', tierSel, 'How good it is. The world names its own tiers.');
        const pair = el('input');
        pair.type = 'checkbox';
        pair.checked = Boolean(item?.pair);
        const pairWrap = el('label', 'checkbox_label');
        pairWrap.append(pair, el('span', '', 'A pair (two blades, a second strike)'));

        const fillTiers = () => {
            tierSel.replaceChildren();
            const choices = tierChoices(rules, kindSel.value);
            tierWrap.querySelector('label').textContent = choices.label;
            for (const t of choices.tiers) tierSel.append(new Option(t.label, t.id));
            tierSel.value = choices.tiers.some(t => t.id === item?.tier) ? item.tier : choices.defaultTier;
            const kind = kindOf(rules, kindSel.value);
            pairWrap.style.display = kind?.dualable ? '' : 'none';
            if (!kind?.dualable) pair.checked = false;
        };
        kindSel.addEventListener('change', fillTiers);

        const desc = el('input', 'text_pole');
        desc.placeholder = 'A line about it (optional)';
        desc.value = item?.desc || '';

        const special = el('select', 'text_pole');
        special.append(new Option('None', ''));
        for (const s of specialChoices(type)) special.append(new Option(s.label, s.id));
        special.value = item?.special || '';

        const uses = el('input', 'text_pole');
        uses.type = 'number'; uses.min = '1'; uses.max = '99';
        uses.value = item?.maxUses ?? toolKindOf(rules, kindSel.value)?.uses ?? 1;

        const more = el('details', 'snpc-gear-more');
        more.append(el('summary', '', 'More'));
        const num = (v) => { const i = el('input', 'text_pole'); i.type = 'number'; i.value = v ?? 0; return i; };
        const bPower = num(item?.bonus?.power);
        const bHit = num(item?.bonus?.hit);
        const bCrit = num(item?.bonus?.crit);
        const partner = el('input', 'text_pole');
        partner.placeholder = 'e.g. Salt Fang';
        partner.value = item?.partner || '';
        const mutes = el('input', 'text_pole');
        mutes.placeholder = 'e.g. Crests';
        mutes.value = item?.mutes || '';
        const bonusRow = el('div', 'sillynpc-combat-meta');
        bonusRow.append(
            field('Power bonus', bPower, 'Added to the power of every strike with it'),
            field('Hit bonus', bHit, 'Added to the attack roll'),
            field('Crit bonus %', bCrit, 'Extra chance a landed blow lands a band better'),
            field('Silences an ability group', mutes, 'While this is held, every ability in that category (such as Crests) is switched off'),
            field('Needs its partner', partner, 'A twin relic: held without this weapon it loses a tier (and the abilities that need it)'),
        );
        more.append(bonusRow);

        const top = el('div', 'sillynpc-combat-meta');
        top.append(field('Name', name), field(isTool ? 'Kind of tool' : 'Kind', kindSel));
        if (isTool) top.append(field('Uses (full)', uses, 'How many times it can be used before a refill'));
        else top.append(tierWrap);
        panel.append(top);
        if (!isTool) panel.append(pairWrap);
        panel.append(field('Description', desc));
        if (!isTool && specialChoices(type).length) panel.append(field('Special', special, 'A passive ability this weapon carries'));
        if (!isTool) panel.append(more);
        fillTiers();

        const buttons = el('div', 'snpc-gear-buttons');
        const save = el('button', 'menu_button', 'Save');
        save.type = 'button';
        save.addEventListener('click', () => {
            const raw = {
                name: name.value, kind: kindSel.value, desc: desc.value,
                ...(isTool
                    ? { tool: true, maxUses: uses.value, uses: uses.value }
                    : { tier: tierSel.value, pair: pair.checked, special: special.value, partner: partner.value, mutes: mutes.value, bonus: { power: bPower.value, hit: bHit.value, crit: bCrit.value } }),
            };
            editing.delete(key);
            if (isNew) {
                const slot = !isTool ? slotsFor(rules, { kind: kindSel.value }).find(s => !gear.equipped[s]) : null;
                act(addItem(record, type, raw, slot ? { equip: slot } : {}));
            } else {
                act(updateItem(record, type, item.id, raw));
            }
        });
        const cancel = el('button', 'menu_button', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => { editing.delete(key); draw(); });
        buttons.append(save, cancel);
        panel.append(buttons);
        return panel;
    }

    draw();
    return box;
}


/**
 * The equipment menu before a fight (fork): what each person holds and which tools go on the belt.
 *
 * Changes are written to the character as they are made, like the sheet. In a spar tools are
 * shown (so you can see what is carried) but cannot be used: a spar is for practice. In a real
 * fight they can be picked, up to three.
 *
 * @param {object} record A character, or the player's card.
 * @param {object} type The world type, with the player's gear changes applied.
 * @param {{ mode?: 'spar'|'fight', onChange?: () => void }} [opts]
 * @returns {HTMLElement}
 */
export function renderLoadoutPicker(record, type, { mode = 'fight', onChange = () => {} } = {}) {
    const rules = gearRules(type);
    const box = el('div', 'snpc-loadout');
    const gear = effectiveGear(type, getTypeData(record, type.dataKey)) || { items: [], equipped: { main: null, off: null, focus: null }, belt: [] };

    const apply = (result) => {
        if (!result.ok) toastr.warning(result.reason, PRODUCT_NAME);
        else saveSettings();
        onChange();
    };

    if (!gear.items.length) {
        box.append(el('small', 'notes', "No weapons or tools yet, so they fight with their basic attacks. Add some on this character's sheet, under Combat."));
        return box;
    }

    for (const slot of ['main', 'off', 'focus']) {
        const candidates = gear.items.filter(i => slotsFor(rules, i).includes(slot));
        if (slot !== 'main' && !candidates.length) continue;
        const select = el('select', 'text_pole');
        select.append(new Option('Nothing', ''));
        for (const item of candidates) select.append(new Option(item.name || item.kind, item.id));
        select.value = gear.equipped[slot] || '';
        select.addEventListener('change', () => apply(equip(record, type, slot, select.value || null)));
        const wrap = field(SLOT_LABELS[slot], select);
        const held = gear.items.find(i => i.id === gear.equipped[slot]);
        const badge = held ? tierBadge(rules, held) : null;
        if (badge) wrap.append(tierBadgeElement(badge));
        box.append(wrap);
    }

    const tools = gear.items.filter(i => i.tool);
    if (tools.length) {
        box.append(el('div', 'snpc-loadout-heading', 'Tools'));
        const { spar, shown } = toolsForFight(gear, mode);
        for (const item of shown) {
            const row = el('label', `checkbox_label snpc-loadout-tool${spar ? ' is-unusable' : ''}`);
            const check = el('input');
            check.type = 'checkbox';
            check.checked = gear.belt.includes(item.id);
            check.disabled = spar || (!check.checked && !canTakeTool(gear, item.id));
            check.addEventListener('change', () => {
                const belt = check.checked ? [...gear.belt, item.id] : gear.belt.filter(x => x !== item.id);
                apply(setBelt(record, type, belt));
            });
            row.append(check, el('span', '', `${item.name || item.kind} (${item.uses} of ${item.maxUses} left)`));
            box.append(row);
        }
        if (spar) {
            box.append(el('small', 'notes', gear.belt.length
                ? 'Not usable in a spar: tools are for a real fight.'
                : 'No tools on the belt. Tools cannot be used in a spar anyway.'));
        } else {
            box.append(el('small', 'notes', 'Up to three go into the fight. Using them in battle is added in an upcoming update.'));
        }
    }
    return box;
}
