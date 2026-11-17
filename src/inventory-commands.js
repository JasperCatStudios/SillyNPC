import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { LOG_PREFIX } from './constants.js';
import {
    inventorySettings, inventoryStore, editInventory, playerName, getInventory, databaseItems, databasePresets, givePresetFor,
} from './inventory.js';
import { giveItem, takeItem, setGold, clean } from './inventory-core.js';
import { toInventoryItem, findPreset } from './item-database.js';

/**
 * Slash commands that change an inventory by hand, by character name:
 *
 *   /inventory-add    name=Ana amount=2 kind=Consumable Healing Potion
 *   /inventory-remove name=Ana amount=1 Healing Potion        (amount=all takes the whole stack)
 *   /inventory-preset name=Ana times=1 Adventurer Pack         (a bundle from the Item Database)
 *   /inventory-presets                                          (lists the presets)
 *   /gold-add         name=Ana 30
 *   /gold-remove      name=Ana 15
 *
 * `name` defaults to you. They work whether or not the tracker is switched on, and change only
 * what is recorded in this chat's inventory.
 */

const named = (name, description, { required = false, type = ARGUMENT_TYPE.STRING } = {}) => SlashCommandNamedArgument.fromProps({
    name, description, typeList: [type], isRequired: required,
});
const unnamed = (description, { type = ARGUMENT_TYPE.STRING } = {}) => [SlashCommandArgument.fromProps({
    description, typeList: [type], isRequired: true,
})];

const who = (args) => clean(args?.name, 80) || playerName();

function needChat() {
    if (!inventoryStore()) throw new Error('Open a chat first: the inventory is kept per chat.');
}

/** A whole number of at least 1, or null when it is not one. `all` is reported as Infinity. */
function amountOf(raw, { allowAll = false } = {}) {
    const text = String(raw ?? '').trim().toLowerCase();
    if (allowAll && text === 'all') return Infinity;
    if (text === '') return 1;
    const n = Number(text);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

function addItemCommand(args, value) {
    needChat();
    const itemName = clean(value);
    if (!itemName) throw new Error('Say which item: /inventory-add name=Ana amount=2 Healing Potion');
    const amount = amountOf(args?.amount);
    if (amount === null) throw new Error('amount must be a whole number of 1 or more.');
    const name = who(args);
    // An exact match in the Item Database fills in the kind and note unless they were typed.
    const known = databaseItems().find(i => i.name.toLowerCase() === itemName.toLowerCase());
    const fromDb = known ? toInventoryItem(known, amount) : null;
    const given = editInventory(name, (p) => {
        giveItem(p, {
            name: fromDb?.name || itemName, qty: amount, kind: args?.kind || fromDb?.kind, note: args?.note || fromDb?.note,
        }, { why: 'command' });
    });
    const held = given?.items.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (!held) throw new Error(`Could not add ${itemName}.`);
    return `${name} now has ${held.name} x${held.qty}.`;
}

/** The typed name without brackets or quotes around it, which people add out of habit. */
function stripWrapping(text) {
    let t = String(text ?? '').trim();
    while (t.length > 1 && /^[(\[{"'`].*[)\]}"'`]$/.test(t)) t = t.slice(1, -1).trim();
    return t;
}

/** The item a typed name means: the exact one, else the only item that contains it (or it contains). */
export function matchItem(items, typed) {
    const want = clean(stripWrapping(typed)).toLowerCase();
    if (!want) return null;
    const exact = items.find(i => i.name.toLowerCase() === want);
    if (exact) return exact;
    const near = items.filter(i => i.name.toLowerCase().includes(want) || want.includes(i.name.toLowerCase()));
    return near.length === 1 ? near[0] : null;
}

function removeItemCommand(args, value) {
    needChat();
    if (!clean(stripWrapping(value))) throw new Error('Say which item: /inventory-remove name=Ana amount=1 Healing Potion');
    const amount = amountOf(args?.amount, { allowAll: true });
    if (amount === null) throw new Error('amount must be a whole number of 1 or more, or all.');
    const name = who(args);
    const items = getInventory(name)?.items || [];
    const before = matchItem(items, value);
    if (!before) {
        const have = items.map(i => i.name).join(', ');
        throw new Error(`${name} has no "${stripWrapping(value)}".${have ? ` They have: ${have}.` : ' They carry nothing.'}`);
    }
    editInventory(name, (p) => { takeItem(p, before.name, amount === Infinity ? null : amount, { why: 'command' }); });
    const left = getInventory(name)?.items.find(i => i.name === before.name);
    return left ? `${name} now has ${left.name} x${left.qty}.` : `${name} no longer has ${before.name}.`;
}

function changeGold(args, value, sign) {
    needChat();
    const amount = amountOf(value);
    if (amount === null || amount === Infinity) throw new Error('Give a whole amount of 1 or more: /gold-add name=Ana 30');
    const name = who(args);
    const unit = inventorySettings().currencyName;
    const person = editInventory(name, (p) => { setGold(p, p.gold + sign * amount, { why: 'command' }); });
    return `${name} now has ${person.gold} ${unit}.`;
}

function presetCommand(args, value) {
    needChat();
    const typed = clean(stripWrapping(value));
    if (!typed) throw new Error(`Say which preset: /inventory-preset name=Ana Adventurer Pack. Presets: ${databasePresets().map(p => p.name).join(', ')}.`);
    const times = amountOf(args?.times);
    if (times === null || times === Infinity) throw new Error('times must be a whole number of 1 or more.');
    const preset = findPreset(databasePresets(), typed);
    if (!preset) {
        throw new Error(`No single preset matches "${typed}". Presets: ${databasePresets().map(p => p.name).join(', ')}.`);
    }
    const name = who(args);
    const result = givePresetFor(name, preset, times);
    if (!result) throw new Error('Could not give the preset.');
    const unit = inventorySettings().currencyName;
    return `${name} received ${preset.name}${times > 1 ? ` x${times}` : ''}: ${result.count} item${result.count === 1 ? '' : 's'}${result.gold ? ` and ${result.gold} ${unit}` : ''}.`;
}

function presetListCommand() {
    const list = databasePresets();
    return list.length ? list.map(p => `${p.name} (${p.items.length} item${p.items.length === 1 ? '' : 's'}${p.gold ? `, ${p.gold} gold` : ''})`).join('; ') : 'No presets yet.';
}

/** Registers the commands. Called once at startup; a failure only costs the commands. */
export function registerInventoryCommands() {
    const amountArg = named('amount', 'How many (default 1). For removing, all takes the whole stack.');
    const nameArg = named('name', 'Whose inventory (default: you).');
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'inventory-add',
            aliases: ['inv-add'],
            callback: async (args, value) => addItemCommand(args, value),
            returns: 'a short summary of the new stack',
            namedArgumentList: [nameArg, amountArg, named('kind', 'A short kind such as Weapon or Consumable.'), named('note', 'A short note shown beside the item.')],
            unnamedArgumentList: unnamed('The item name.'),
            helpString: 'Adds an item to a character\'s inventory in this chat. Example: /inventory-add name=Ana amount=2 kind=Consumable Healing Potion. The name defaults to you.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'inventory-remove',
            aliases: ['inv-remove'],
            callback: async (args, value) => removeItemCommand(args, value),
            returns: 'a short summary of what is left',
            namedArgumentList: [nameArg, amountArg],
            unnamedArgumentList: unnamed('The item name.'),
            helpString: 'Takes an item out of a character\'s inventory in this chat. Example: /inventory-remove name=Ana amount=1 Healing Potion. amount=all removes the whole stack. The name defaults to you.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'inventory-preset',
            aliases: ['inv-preset'],
            callback: async (args, value) => presetCommand(args, value),
            returns: 'a short summary of what was given',
            namedArgumentList: [nameArg, named('times', 'How many copies of the preset to give (default 1).')],
            unnamedArgumentList: unnamed('The preset name (or enough of it to be unique).'),
            helpString: 'Gives a character every item (and the money) in an item preset, from the Item Database in the Inventory tab. Example: /inventory-preset name=Ana Adventurer Pack. The name defaults to you.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'inventory-presets',
            aliases: ['inv-presets'],
            callback: async () => presetListCommand(),
            returns: 'the preset names',
            helpString: 'Lists the item presets you can give with /inventory-preset.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'gold-add',
            aliases: ['money-add'],
            callback: async (args, value) => changeGold(args, value, +1),
            returns: 'the new total',
            namedArgumentList: [nameArg],
            unnamedArgumentList: unnamed('How much to add.', { type: ARGUMENT_TYPE.NUMBER }),
            helpString: 'Adds money to a character\'s purse in this chat. Example: /gold-add name=Ana 30. The name defaults to you; the currency name is set in the Inventory tab.',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'gold-remove',
            aliases: ['money-remove'],
            callback: async (args, value) => changeGold(args, value, -1),
            returns: 'the new total',
            namedArgumentList: [nameArg],
            unnamedArgumentList: unnamed('How much to take away.', { type: ARGUMENT_TYPE.NUMBER }),
            helpString: 'Takes money out of a character\'s purse in this chat (never below zero). Example: /gold-remove name=Ana 15. The name defaults to you.',
        }));
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not register the inventory slash commands', err);
    }
}
