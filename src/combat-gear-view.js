import { kindOf, toolKindOf, ladderFor, tierOf, fitsSlot, MAX_BELT } from './combat-gear.js';

/**
 * What the gear screens need to know, without any screen in it (fork): which kinds and tiers an
 * item may have, where it can be equipped, how to say it in words, and what colour its badge is.
 * The screens (ui-gear.js, ui-armoury.js) only draw what this returns, so it is testable here.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const SLOT_LABELS = Object.freeze({ main: 'Main hand', off: 'Off hand', focus: 'Focus' });

/** Kinds an item can be, for a "Kind" list. Tools list the tool kinds; weapons the weapon kinds. */
export function kindChoices(rules, { tool = false } = {}) {
    if (tool) return rules.tools.map(t => ({ id: t.id, label: t.label }));
    return rules.kinds.map(k => ({ id: k.id, label: k.label, slot: k.slot }));
}

/** The tiers a kind's items can have, lowest first, and what the world calls the ladder. */
export function tierChoices(rules, kindId) {
    const ladder = ladderFor(rules, kindOf(rules, kindId));
    return { label: ladder.label || 'Tier', defaultTier: ladder.defaultTier, tiers: ladder.tiers };
}

/** Which slots an item can be equipped in right now. Tools have none (they go on the belt). */
export function slotsFor(rules, item) {
    return ['main', 'off', 'focus'].filter(slot => fitsSlot(rules, item, slot).ok);
}

/** The slot an item is equipped in, or '' when it is carried but not held. */
export function equippedSlot(gear, itemId) {
    for (const slot of ['main', 'off', 'focus']) if (gear?.equipped?.[slot] === itemId) return slot;
    return '';
}

/** A tier's badge: its words and colour, with a readable text colour on top of it. */
export function tierBadge(rules, item) {
    const kind = kindOf(rules, item?.kind);
    if (!kind || item.tool) return null;
    const tier = tierOf(ladderFor(rules, kind), item.tier);
    if (!tier) return null;
    return { id: tier.id, label: tier.label, color: tier.color, icon: tier.icon, text: readableOn(tier.color), signature: Boolean(tier.signature) };
}

/** Black or white, whichever reads better on the colour (WCAG relative luminance). */
export function readableOn(hex) {
    const m = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(String(hex || ''));
    if (!m) return '#1a1a1a';
    let h = m[1];
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Contrast against black is (lum + 0.05) / 0.05; against white it is 1.05 / (lum + 0.05).
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#111111' : '#ffffff';
}

/** One line about an item: "Hero Relic Sword, pair" or "Smoke bomb, 1 of 1 left". */
export function itemSummary(rules, item) {
    if (item.tool) {
        const kind = toolKindOf(rules, item.kind);
        return `${kind?.label || item.kind}, ${item.uses} of ${item.maxUses} left`;
    }
    const kind = kindOf(rules, item.kind);
    const badge = tierBadge(rules, item);
    return [badge ? `${badge.label} ${kind?.label || item.kind}` : (kind?.label || item.kind), item.pair ? 'pair' : ''].filter(Boolean).join(', ');
}

/** Slots as a sentence for the loadout row: "Main hand: Falcon Blade". */
export function loadoutLine(gear) {
    const items = new Map((gear?.items || []).map(i => [i.id, i]));
    const parts = [];
    for (const slot of ['main', 'off', 'focus']) {
        const item = items.get(gear?.equipped?.[slot]);
        if (item) parts.push(`${SLOT_LABELS[slot]}: ${item.name}`);
    }
    return parts.join(' / ') || 'Nothing held: they fight with their fists or their basic attacks.';
}

/** Can this tool be added to the belt? (Three at most.) */
export function canTakeTool(gear, itemId) {
    const belt = gear?.belt || [];
    return belt.includes(itemId) || belt.length < MAX_BELT;
}

/**
 * Which tools the equipment screen lists, and whether they can be used. A spar is practice: the
 * tools on the belt are still shown (so you can see what is carried) but none can be used or
 * changed. In a real fight every tool is listed and up to three can be picked.
 * @param {{ items: object[], belt: string[] }} gear
 * @param {'spar'|'fight'} mode
 */
export function toolsForFight(gear, mode) {
    const tools = (gear?.items || []).filter(i => i.tool);
    const spar = mode === 'spar';
    return { spar, usable: !spar, shown: spar ? tools.filter(t => (gear.belt || []).includes(t.id)) : tools };
}

/** Abilities a weapon can carry as its special: the world's passives, by label. */
export function specialChoices(type) {
    return (type?.abilities || []).filter(a => a.kind === 'passive').map(a => ({ id: a.id, label: a.label }));
}

/** Plain words for a tool's effect, for its list entry. */
export function effectLine(tool) {
    const e = tool?.effect || {};
    const turns = e.turns ? ` for ${e.turns} turn${e.turns === 1 ? '' : 's'}` : '';
    switch (e.type) {
        case 'damage': return `${e.area === 'all' ? 'Hurts everyone' : 'Hurts one'} (power ${e.power ?? 0})${turns}`;
        case 'smoke': return `Helps a side escape${turns}`;
        case 'blind': return `Blinds one target${turns}`;
        case 'stun': return `Stuns one target${turns}`;
        case 'heal': return `Heals ${Math.round((e.share || 0) * 100)}%`;
        default: return '';
    }
}
