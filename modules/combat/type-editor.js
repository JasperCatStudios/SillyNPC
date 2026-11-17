import { getSettings, saveSettings } from '../../src/settings.js';
import { PRODUCT_NAME } from '../../src/constants.js';
import { STAT_ROLES, POOL_ROLES } from '../../src/combat-roles.js';
import { listTypes, getType, parseTypeFile, typeToFile } from '../../src/combat-types.js';
import { offerDownload } from '../../src/utils.js';
import { BUILTIN_IDS } from '../../src/combat-builtins.js';
import {
    blankDraft, draftFromType, buildType, POOL_KEYS, ROLE_KEYS,
} from '../../src/combat-type-draft.js';
import { buildDataSections, COVERED_KEYS } from './type-editor-sections.js';

/**
 * The world type editor (fork): a guided form for making your own combat world, or copying a
 * built-in or custom one and changing it. Every field has a plain-words note and a placeholder
 * that shows what to type. The form covers everything a type holds: stats, damage channels, roles, pools,
 * the modifier, the roll and damage formulas, sheet fields, ranks, proficiencies, moves, advantage rules,
 * abilities, weapons, tiers, tools, elements, the roll extras and the artwork. Anything a file adds beyond
 * those is kept untouched, so a copy of a rich world keeps everything.
 *
 * Saves into settings.combatTypes. Never touches built-ins or any character.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** A labelled field: a title, a one-line note saying what it does, then the control. */
function field(title, help, control) {
    const wrap = el('div', 'sillynpc-te-field');
    wrap.append(el('label', 'sillynpc-te-title', title));
    if (help) wrap.append(el('small', 'notes sillynpc-te-help', help));
    wrap.append(control);
    return wrap;
}

function input(value, placeholder, onInput, type = 'text') {
    const box = el('input', 'text_pole');
    box.type = type;
    box.value = value ?? '';
    box.placeholder = placeholder || '';
    box.addEventListener('input', () => onInput(box.value));
    return box;
}

function area(value, placeholder, onInput, rows = 6) {
    const box = el('textarea', 'text_pole sillynpc-te-area');
    box.rows = rows;
    box.value = value ?? '';
    box.placeholder = placeholder || '';
    box.addEventListener('input', () => onInput(box.value));
    return box;
}

function section(title, intro) {
    const box = el('div', 'sillynpc-te-section');
    box.append(el('h4', 'sillynpc-combat-heading', title));
    if (intro) box.append(el('p', 'notes', intro));
    return box;
}

const FORMULA_NOTE = 'A formula can use stat.<id> (for example stat.strength), numbers, + - * / ( ), and max(), min(), round(), clamp().';

/** The names a formula may use, from the stats as they stand now. */
const statNames = (draft) => draft.stats.map(s => s.id || s.label).filter(Boolean);

/**
 * Draws the editor into `host`.
 * @param {HTMLElement} host
 * @param {{ start: object, editing: boolean, onDone: () => void }} opts start is a draft
 */
export function renderTypeEditor(host, { start, editing, onDone }) {
    const draft = start;
    // The forms edit draft.extra in place. Anything else a file carried that no form covers is kept as it is and saved
    // back with the type, so editing never drops data.
    const leftover = {};
    for (const key of Object.keys(draft.extra || {})) {
        if (!COVERED_KEYS.includes(key)) { leftover[key] = draft.extra[key]; delete draft.extra[key]; }
    }
    host.replaceChildren();

    const status = el('div', 'sillynpc-te-status');
    const saveButton = el('button', 'menu_button', editing ? 'Save changes' : 'Save world type');
    saveButton.type = 'button';

    const take = () => {
        const merged = { ...draft, extra: { ...draft.extra, ...leftover } };
        const all = listTypes(getSettings().combatTypes);
        const takenIds = all.map(t => t.id).filter(id => !(editing && id === draft.id));
        const out = buildType(merged, {
            takenIds, builtinIds: BUILTIN_IDS, editingId: editing ? draft.id : '',
        });
        return out;
    };

    const refresh = () => {
        const out = take();
        status.replaceChildren();
        if (!out.errors.length) status.append(el('div', 'sillynpc-combat-badge is-good', 'Ready to save'));
        for (const message of out.errors) status.append(el('small', 'sillynpc-combat-problem', message));
        for (const message of out.warnings) status.append(el('small', 'notes', message));
        saveButton.disabled = out.errors.length > 0;
    };
    const touch = () => refresh();

    host.append(el('h4', 'sillynpc-combat-heading', editing ? `Editing ${draft.name}` : 'New world type'));
    host.append(el('p', 'notes',
        'A world type is a rulebook for fights: which stats a character has, how an attack is rolled and how much damage it does. '
        + 'Fields marked with an example are safe to change one at a time; the box at the bottom checks your work live. '
        + 'Nothing is saved until you press Save, and built-in worlds are never changed.'));

    /* -------------------------------------------------------------- basics */
    const basics = section('1. The world', 'Its name and a line to remind you what it is.');
    basics.append(field('Name', 'Shown in the world type list and on every combat screen.',
        input(draft.name, 'e.g. Lantern Coast Skirmishes', (v) => { draft.name = v; touch(); })));
    basics.append(field('Description', 'Optional. One or two sentences about what kind of fights this world is for.',
        input(draft.description, 'e.g. Quick sword and spell duels, d20 rolls, stats from 0 to 100', (v) => { draft.description = v; touch(); })));
    host.append(basics);

    /* --------------------------------------------------------------- stats */
    const stats = section('2. Stats',
        'The numbers on every character sheet. Their ids are made from the label and stay the same if you rename the label later, so saved characters keep their numbers.');
    const statRows = el('div', 'sillynpc-te-rows');
    const drawStats = () => {
        statRows.replaceChildren();
        const head = el('div', 'sillynpc-te-row sillynpc-te-row-head');
        for (const t of ['Label', 'Short', 'Lowest', 'Highest', 'New character starts at', '']) head.append(el('small', 'notes', t));
        statRows.append(head);
        draft.stats.forEach((s, i) => {
            const row = el('div', 'sillynpc-te-row');
            row.append(
                input(s.label, 'Strength', (v) => { s.label = v; touch(); }),
                input(s.abbr, 'STR', (v) => { s.abbr = v; touch(); }),
                input(s.min, '0', (v) => { s.min = v; touch(); }, 'number'),
                input(s.max, '100', (v) => { s.max = v; touch(); }, 'number'),
                input(s.default, '30', (v) => { s.default = v; touch(); }, 'number'),
            );
            const del = el('button', 'menu_button', 'Remove');
            del.type = 'button';
            del.title = 'Remove this stat. Formulas that use it will need fixing.';
            del.addEventListener('click', () => { draft.stats.splice(i, 1); drawStats(); touch(); });
            row.append(del);
            statRows.append(row);
        });
    };
    drawStats();
    stats.append(statRows);
    const addStat = el('button', 'menu_button', 'Add a stat');
    addStat.type = 'button';
    addStat.addEventListener('click', () => { draft.stats.push({ id: '', label: '', abbr: '', min: 0, max: 100, default: 30 }); drawStats(); touch(); });
    stats.append(addStat);
    stats.append(el('small', 'notes',
        'Health needs a stat too (usually one called Health) because the Health pool below reads it. '
        + 'A new stat has no id until it has a label; formulas then call it stat.<label in lower case, spaces as underscores>.'));
    host.append(stats);

    /* ------------------------------------------------------------ channels */
    const channelBox = section('3. Damage channels',
        'The kinds of damage in this world. Each attack uses one channel: the attacker\'s Attack for that channel against the target\'s Defense for the same channel.');
    const channelInput = input(draft.channels.map(c => c.label).join(', '), 'e.g. Physical, Magic',
        (v) => {
            const labels = v.split(',').map(s => s.trim()).filter(Boolean);
            const old = new Map(draft.channels.map(c => [c.label.toLowerCase(), c]));
            draft.channels = labels.map(l => old.get(l.toLowerCase()) || { id: '', label: l });
            touch();
        });
    channelBox.append(field('Channels, separated by commas', 'One is enough (just "Damage"). Two is typical: a body channel and a magic channel. Renaming keeps the old one if the spelling matches.', channelInput));
    host.append(channelBox);

    /* --------------------------------------------------------------- roles */
    const roleBox = section('4. Which stat fills each role',
        'The engine reads roles, not stat names. Each role is a short formula over your stats. Leave a role empty if your world does not use it.');
    roleBox.append(el('small', 'notes', FORMULA_NOTE));
    const roleHost = el('div', 'sillynpc-te-rows');
    const ROLE_EXAMPLES = {
        attack: 'stat.strength', defense: 'stat.defense', initiative: 'stat.speed*0.8 + stat.luck*0.2', speed: 'stat.speed',
        accuracy: 'stat.dexterity', evasion: 'stat.speed*0.7 + stat.luck*0.3', luck: 'stat.luck', endurance: 'stat.health*0.5 + stat.defense*0.5',
        presence: 'stat.charm', awareness: 'stat.magic*0.5 + stat.dexterity*0.5',
    };
    const ROLE_USE = {
        attack: 'Adds to damage. Needed for at least one channel, or nobody can hurt anybody.',
        defense: 'Takes damage away. Bind it per channel, or leave a channel with none for unblockable damage.',
        initiative: 'Who acts first each round. Falls back to Speed if empty.',
        speed: 'Chance to act twice, and the speed gap used by some formulas. Empty turns follow-up blows off.',
        accuracy: 'Bonus to hit.', evasion: 'Makes the attacker miss more.', luck: 'Critical and dodge tweaks.',
        endurance: 'Resistance to injury.', presence: 'Intimidation and morale.', awareness: 'Ambush and reading feints.',
    };
    const drawRoles = () => {
        roleHost.replaceChildren();
        for (const key of ROLE_KEYS) {
            const def = STAT_ROLES[key];
            const help = `${ROLE_USE[key] || def.help} Example: ${ROLE_EXAMPLES[key]}`;
            if (def.channeled) {
                for (const channel of draft.channels.filter(c => c.label)) {
                    const cid = channel.id || channel.label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                    draft.roles[key] = draft.roles[key] || {};
                    roleHost.append(field(`${def.label} (${channel.label})`, help,
                        input(draft.roles[key][channel.id || cid], ROLE_EXAMPLES[key], (v) => { draft.roles[key][channel.id || cid] = v; touch(); })));
                }
            } else {
                roleHost.append(field(def.label, help, input(draft.roles[key], ROLE_EXAMPLES[key], (v) => { draft.roles[key] = v; touch(); })));
            }
        }
    };
    drawRoles();
    channelInput.addEventListener('change', drawRoles);
    roleBox.append(roleHost);
    host.append(roleBox);

    /* --------------------------------------------------------------- pools */
    const poolBox = section('5. Pools',
        'Bars that go down in a fight. Health is required: reaching 0 means defeat. The others are optional extras.');
    const POOL_HELP = {
        health: 'Reaching 0 means defeat. Max is a formula, for example stat.health.',
        guard: 'Stamina that takes the damage in friendly sparring, in place of Health. Example max: 20 + stat.health*0.3',
        resource: 'Mana, reiatsu or focus: what abilities spend. Example max: 20 + stat.magic*0.8',
        armor: 'Absorbs damage before Health does. Example max: stat.defense',
    };
    for (const key of POOL_KEYS) {
        const p = draft.pools[key];
        const row = el('div', 'sillynpc-te-pool');
        const toggle = el('label', 'sillynpc-te-title');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(p.on);
        box.disabled = key === 'health';
        box.addEventListener('change', () => { p.on = box.checked; touch(); });
        toggle.append(box, ` ${POOL_ROLES[key].label}${key === 'health' ? ' (required)' : ''}`);
        row.append(toggle, el('small', 'notes sillynpc-te-help', POOL_HELP[key]));
        const line = el('div', 'sillynpc-te-row');
        line.append(
            input(p.label, 'Name on screen', (v) => { p.label = v; touch(); }),
            input(p.abbr, 'Short, e.g. HP', (v) => { p.abbr = v; touch(); }),
            input(p.max, 'Max, a formula: stat.health', (v) => { p.max = v; touch(); }),
            input(p.color, '#c0392b', (v) => { p.color = v; touch(); }),
        );
        row.append(line);
        poolBox.append(row);
    }
    host.append(poolBox);

    /* ------------------------------------------------------------ modifier */
    const modBox = section('6. Stat to bonus',
        'Turns a stat into the small bonus or penalty used when rolling. Two ways: a table you write, or a straight line.');
    const modType = el('select', 'text_pole');
    modType.append(new Option('A table of cut-offs', 'table'), new Option('A straight line', 'linear'));
    modType.value = draft.modifier.type;
    const modTable = input(draft.modifier.table, '10:-3, 25:-2, 40:-1, 60:0, 75:1, 85:2, 95:3, 1000000:4', (v) => { draft.modifier.table = v; touch(); });
    const modLine = el('div', 'sillynpc-te-row');
    modLine.append(
        input(draft.modifier.center, 'centre, e.g. 50', (v) => { draft.modifier.center = v; touch(); }, 'number'),
        input(draft.modifier.per, 'points per +1, e.g. 10', (v) => { draft.modifier.per = v; touch(); }, 'number'));
    const showMod = () => { modTable.parentElement.style.display = draft.modifier.type === 'table' ? '' : 'none'; modLine.parentElement.style.display = draft.modifier.type === 'linear' ? '' : 'none'; };
    modType.addEventListener('change', () => { draft.modifier.type = modType.value; showMod(); touch(); });
    modBox.append(field('Style', 'Table: each pair is "below this number : bonus", read in order, so 25:-2 means under 25 is -2. Line: bonus = (stat - centre) / points per step, rounded toward zero.', modType));
    modBox.append(field('Table', 'Pairs separated by commas. The last pair catches everything higher.', modTable));
    modBox.append(field('Line', 'Centre first, then points per +1 bonus.', modLine));
    host.append(modBox);
    showMod();

    /* ---------------------------------------------------------- resolution */
    const resBox = section('7. How a fight is rolled',
        'The attack roll, the result bands it falls into, and the damage formula.');
    const r = draft.resolution;
    const mode = el('select', 'text_pole');
    mode.append(new Option('Opposed: attacker\'s roll against the defender\'s roll', 'opposed'), new Option('Threshold: attacker\'s roll against fixed numbers', 'threshold'));
    mode.value = r.mode;
    mode.addEventListener('change', () => { r.mode = mode.value; touch(); });
    resBox.append(field('Roll style', 'Opposed: both fighters roll and the gap decides the band (0 or less is a stalemate or miss). Threshold: one roll, and the band is picked from its total.', mode));
    resBox.append(field('Attack roll', 'Names you can use: d20, d10, d6; diff (difficulty bonus); a.mod.roll (the attacker\'s stat bonus); a.prof.bonus (the attacker\'s skill grade bonus); d.* for the defender. ' + FORMULA_NOTE,
        input(r.roll, 'd20 + diff + a.mod.roll + a.prof.bonus', (v) => { r.roll = v; touch(); })));
    resBox.append(field('Damage', 'band.base is the damage of the result band; act.power is the move\'s power; a.attack and d.defense are your Attack and Defense roles. Always at least 1 with max(1, ...).',
        input(r.damage, 'max(1, round(band.base + act.power + a.attack*0.25 - d.defense*0.15))', (v) => { r.damage = v; touch(); })));
    resBox.append(field('Who acts first', 'Optional. Roll for initiative. a.initiative is your Initiative role.',
        input(r.initiative, 'a.initiative + d10', (v) => { r.initiative = v; touch(); })));
    resBox.append(field('Chance of a second blow', 'Optional, a percentage 0 to 100. Empty means no follow-up blows.',
        input(r.followUpChance, 'clamp((a.speed - d.speed) * 0.8, 0, 50)', (v) => { r.followUpChance = v; touch(); })));

    const bandRows = el('div', 'sillynpc-te-rows');
    const drawBands = () => {
        bandRows.replaceChildren();
        const head = el('div', 'sillynpc-te-row sillynpc-te-row-head');
        for (const t of ['Up to (roll or gap)', 'Result name', '']) head.append(el('small', 'notes', t));
        bandRows.append(head);
        r.bands.forEach((b, i) => {
            const row = el('div', 'sillynpc-te-row');
            row.append(input(b.upTo, 'e.g. 4', (v) => { b.upTo = v; touch(); }, 'number'), input(b.result, 'miss, hit, strong or crit', (v) => { b.result = v; touch(); }));
            const del = el('button', 'menu_button', 'Remove');
            del.type = 'button';
            del.addEventListener('click', () => { r.bands.splice(i, 1); drawBands(); touch(); });
            row.append(del);
            bandRows.append(row);
        });
    };
    drawBands();
    const bandsField = field('Result bands', 'Read from lowest to highest: a roll up to the first number is the first result, and so on. Use 999 for "anything higher". Result names the engine knows: miss, stalemate, hit, strong, crit.', bandRows);
    const addBand = el('button', 'menu_button', 'Add a band');
    addBand.type = 'button';
    addBand.addEventListener('click', () => { r.bands.push({ upTo: '', result: '' }); drawBands(); touch(); });
    bandsField.append(addBand);
    resBox.append(bandsField);
    host.append(resBox);

    /* ------------------------------------------- everything else, as forms */
    for (const sectionBox of buildDataSections(draft, touch)) host.append(sectionBox);

    /* ---------------------------------------------- colours and artwork */
    const artBox = section('16. Factions, colours and artwork (optional)',
        'Everything here is presentation only: it never changes how a fight is rolled. A faction is a group of characters (their category). '
        + 'Give each faction its own colours and banner. Pictures for weapons, skills and abilities are set inside their own forms above. Picture paths are relative to the artwork folder set in '
        + 'Appearance (for example fire-emblem/banners/golden-deer.png); that folder lives at data/<your user>/user/images/worldkit-art/. Leave any field empty to use the built-in look, and turn "Use world artwork" off in Appearance to hide every picture.');
    const art = draft.art;
    art.kinds = art.kinds || {};
    art.profs = art.profs || {};
    art.factions = art.factions || {};
    artBox.append(field('Default banner', 'Used at the top of a character whose faction has no banner of its own.',
        input(art.banner, 'e.g. my-world/banner.png', (v) => { art.banner = v; touch(); })));
    artBox.append(field('Ability icons folder', 'Optional. A folder of pictures named after the ability, lower case (for example macuil.png for Crest of Macuil). An ability with no picture shows nothing. '
        + 'You can also give any ability, weapon kind or proficiency its own picture inside its form above.',
        input(art.abilityIconsDir || art.crestsDir, 'e.g. my-world/ability-icons/', (v) => { art.abilityIconsDir = v; art.crestsDir = v; touch(); })));

    // Factions: a colour theme per group of characters.
    const factionRows = el('div', 'sillynpc-te-rows');
    const COLOURS = [['bg', 'Background', '#171A19'], ['panel', 'Panels', '#29312D'], ['accent', 'Highlights', '#8EAA94'], ['accent2', 'Second accent', '#BFC7BF'], ['text', 'Main text', '#EAECE5'], ['tab', 'Selected tabs', '#3B4A40'], ['border', 'Borders and icons', '#BFC7BF'], ['muted', 'Secondary text', '#B9BFB8']];
    const drawFactions = () => {
        factionRows.replaceChildren();
        const names = Object.keys(art.factions);
        if (!names.length) factionRows.append(el('small', 'notes', 'No factions yet. Add one for each category of characters that should look different.'));
        names.forEach((name) => {
            const f = art.factions[name];
            const box = el('div', 'sillynpc-te-pool');
            const head = el('div', 'sillynpc-te-row');
            const nameBox = input(name, 'Faction name, e.g. Harbour Guild', (v) => {
                const next = String(v);
                if (next === name || !next.trim() || next in art.factions) return;
                const entries = Object.entries(art.factions).map(([k, val]) => [k === name ? next : k, val]);
                art.factions = Object.fromEntries(entries);
                name = next;
                touch();
            });
            const remove = el('button', 'menu_button', 'Remove');
            remove.type = 'button';
            remove.addEventListener('click', () => { delete art.factions[name]; drawFactions(); touch(); });
            head.append(nameBox, remove);
            box.append(head);
            const grid = el('div', 'sillynpc-te-row');
            for (const [key, label, fallback] of COLOURS) {
                const wrap = el('label', 'sillynpc-fx-colour');
                const pick = el('input');
                pick.type = 'color';
                pick.value = /^#[0-9a-f]{6}$/i.test(f[key] || '') ? f[key] : fallback;
                pick.addEventListener('input', () => { f[key] = pick.value; touch(); });
                wrap.append(el('span', '', label), pick);
                grid.append(wrap);
            }
            box.append(grid);
            box.append(input(f.banner || '', 'Banner picture, e.g. my-world/guild.png (optional)', (v) => { f.banner = v; touch(); }));
            factionRows.append(box);
        });
    };
    drawFactions();
    const addFaction = el('button', 'menu_button', 'Add a faction');
    addFaction.type = 'button';
    addFaction.addEventListener('click', () => {
        let n = Object.keys(art.factions).length + 1;
        while (`Faction ${n}` in art.factions) n++;
        art.factions[`Faction ${n}`] = { bg: '#171A19', panel: '#29312D', accent: '#8EAA94', accent2: '#BFC7BF', text: '#EAECE5', banner: '' };
        drawFactions();
        touch();
    });
    artBox.append(field('Factions and colour themes', 'The colours of a character\'s page follow their faction. A faction with no entry here uses the shipped look or Neutral.', factionRows), addFaction);
    host.append(artBox);

    /* ------------------------------------------------------------- footer */
    host.append(status);
    const footer = el('div', 'sillynpc-actions');
    saveButton.addEventListener('click', () => {
        const out = take();
        if (out.errors.length) return;
        const settings = getSettings();
        settings.combatTypes = settings.combatTypes && typeof settings.combatTypes === 'object' ? settings.combatTypes : {};
        settings.combatTypes[out.type.id] = out.type;
        saveSettings();
        toastr.success(`${out.type.name} saved. Pick it under World type.`, PRODUCT_NAME);
        onDone();
    });
    const cancel = el('button', 'menu_button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', onDone);
    footer.append(saveButton, cancel);
    host.append(footer);
    refresh();
}

/** Draft for the "New" button: the starter, or a copy of any world type. */
export function startDraft(fromId) {
    if (!fromId) return blankDraft();
    const type = getType(getSettings().combatTypes, fromId);
    return type ? draftFromType(type) : blankDraft();
}

/** Deletes a custom type. Characters keep their numbers under it in case it is re-created. */
export function deleteCustomType(id) {
    const settings = getSettings();
    if (!settings.combatTypes || !(id in settings.combatTypes)) return false;
    delete settings.combatTypes[id];
    saveSettings();
    return true;
}

/**
 * Adds the world types in some file text to the custom library and says what happened. Shared by the file picker below
 * and the Content Kit, so both import the same way. Returns the names added.
 */
export async function importTypeText(text, onDone) {
    const found = parseTypeFile(text);
    for (const message of found.errors) toastr.error(message, PRODUCT_NAME);
    if (!found.types.length) return [];
    const settings = getSettings();
    settings.combatTypes = settings.combatTypes && typeof settings.combatTypes === 'object' ? settings.combatTypes : {};
    const replaced = found.types.filter(t => t.id in settings.combatTypes).map(t => t.name);
    for (const t of found.types) settings.combatTypes[t.id] = t;
    saveSettings();
    toastr.success(`Imported ${found.types.map(t => t.name).join(', ')}.${replaced.length ? ` Replaced the existing ${replaced.join(', ')}.` : ''} Pick it under World type.`, PRODUCT_NAME);
    for (const message of found.warnings) toastr.info(message, PRODUCT_NAME);
    onDone?.();
    return found.types.map(t => t.name);
}

/** Reads a world type file and adds what it holds to the custom library. */
export function importTypeFile(onDone) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
            await importTypeText(await file.text(), onDone);
        } catch (err) {
            console.error('[Worldkit] world type import failed', err);
            toastr.error(String(err.message || err), PRODUCT_NAME);
        }
    };
    picker.click();
}

/**
 * A template file for editing outside the app: a copy of a world (built-in or custom) or the blank starter, with a new
 * id and name so importing it adds a world of its own and never touches the original. Edit it, then import it.
 */
export function exportTemplateFile(fromId) {
    let type;
    if (fromId) {
        const source = getType(getSettings().combatTypes, fromId);
        if (!source) { toastr.error('That world type was not found.', PRODUCT_NAME); return; }
        type = typeToFile(source);
    } else {
        const draft = blankDraft();
        draft.name = 'My world';
        const out = buildType(draft, { takenIds: [], builtinIds: BUILTIN_IDS, editingId: '' });
        type = typeToFile(out.type || draft);
    }
    const base = String(type.id || 'my_world').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const id = fromId ? `${base}_template` : 'my_world_template';
    type.id = id;
    type.dataKey = id;
    type.name = fromId ? `${type.name} (template)` : 'My world (template)';
    type.builtin = false;
    offerDownload(type, `worldkit-world-${id}.json`);
    toastr.success(`Saved the ${fromId ? type.name : 'blank'} template. Edit the file, then use Import a world type file.`, PRODUCT_NAME);
}

/** Saves a custom type as a file anybody can import. */
export function exportTypeFile(type) {
    offerDownload(typeToFile(type), `worldkit-world-${type.id}.json`);
    toastr.success(`Exported ${type.name}.`, PRODUCT_NAME);
}
