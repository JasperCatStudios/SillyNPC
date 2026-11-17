import { getSettings, saveSettings } from './settings.js';
import {
    NEUTRAL_ICON, normalizeFactionSettings, paletteFor, themeStyle, artworkUrl, iconFor, abilityPicture, BUILTIN_FACTIONS, foldFaction,
    FACTION_WORLDS, worldGroupOf,
} from './faction-theme.js';
import { Popup } from '../../../../popup.js';

/**
 * Faction colours, banners and icons on screen (fork). The rules are in faction-theme.js; this
 * file draws them. Nothing here is needed for a control to work: a missing picture, or artwork
 * switched off, leaves a plain gradient banner and built-in icons.
 */

export function factionSettings() {
    const settings = getSettings();
    const fixed = normalizeFactionSettings(settings.factions);
    // Repair in place. Handing back a new object each call meant edits made to an earlier copy
    // (the "Use world artwork" switch, the folder, a palette) were thrown away on the next save.
    if (settings.factions && typeof settings.factions === 'object') {
        for (const key of Object.keys(settings.factions)) delete settings.factions[key];
        Object.assign(settings.factions, fixed);
    } else settings.factions = fixed;
    return settings.factions;
}

export function saveFactionSettings() {
    factionSettings();
    saveSettings();
}

/** The palette a character's faction (category) gets. */
export function factionPalette(category, world = null) {
    return paletteFor(category, factionSettings(), world);
}

/**
 * The world whose factions may colour a profile, or null. Never throws: a world that fails to
 * load must cost the profile its world banner, not the faction colours altogether (which is
 * how a profile came up in the plain menu look on some opens).
 */
export function safeWorld(read) {
    try { return read() || null; } catch (err) { console.warn('[Worldkit] could not read the active world', err); return null; }
}

/** Gives an element the faction's colours as CSS variables, so everything inside can use them. */
export function applyFactionTheme(node, category, world = null) {
    if (!node) return null;
    const palette = factionPalette(category, world);
    node.classList.add('sillynpc-fx');
    node.dataset.faction = palette.id;
    node.style.cssText += `;${themeStyle(palette)}`;
    return palette;
}

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** A picture that removes itself if it cannot load, leaving whatever is behind it. */
function pictureOrNothing(src, className, alt = '') {
    const img = document.createElement('img');
    img.className = className;
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = src;
    return img;
}

/**
 * The faction banner across the top of a character: a gradient in the faction's colours with the
 * faction's name, and, when artwork is on and the file exists, its picture over the top.
 * @returns {HTMLElement}
 */
export function buildFactionBanner(category, world = null) {
    const palette = factionPalette(category, world);
    const banner = el('div', 'sillynpc-fx-banner');
    banner.style.cssText = `background:linear-gradient(135deg, ${palette.panel}, ${palette.bg});border-color:${palette.accent}`;
    const url = artworkUrl(palette.banner, factionSettings());
    if (url) banner.append(pictureOrNothing(url, 'sillynpc-fx-banner-img'));
    const label = el('span', 'sillynpc-fx-banner-label', category || palette.label);
    label.style.color = palette.text;
    banner.append(label);
    return banner;
}

/**
 * A small picture for a weapon kind or a skill: the world's own icon when there is one and artwork
 * is on, otherwise a built-in icon.
 * @param {object|string} world the combat world type (or its id)
 * @param {string} id a gear kind id or a proficiency id
 * @param {{ kind?: 'kind'|'prof', title?: string, quiet?: boolean }} [opts] quiet returns null when there is
 *   neither a picture nor a meaningful built-in icon, so a list is not covered in identical dots.
 */
export function buildArtIcon(worldId, id, { kind = 'prof', title = '', quiet = false } = {}) {
    const found = iconFor(worldId, id, { kind });
    if (quiet && !found.src && found.icon === NEUTRAL_ICON) return null;
    const wrap = el('span', 'sillynpc-art-icon');
    if (title) wrap.title = title;
    const fallback = el('i', `fa-solid ${found.icon}`);
    wrap.append(fallback);
    const url = artworkUrl(found.src, factionSettings());
    if (url) {
        const img = pictureOrNothing(url, 'sillynpc-art-icon-img');
        img.addEventListener('load', () => fallback.remove(), { once: true });
        wrap.append(img);
    }
    return wrap;
}

/**
 * An ability's icon: its picture when it has one, and nothing at all when it has not (no placeholder). A picture that
 * cannot be loaded removes itself, so a missing file leaves no gap either.
 * @returns {HTMLElement|null}
 */
export function buildAbilityIcon(world, ability) {
    const url = artworkUrl(abilityPicture(world, ability), factionSettings());
    if (!url) return null;
    const wrap = el('span', 'sillynpc-art-icon sillynpc-art-ability');
    wrap.title = ability?.label || '';
    const img = pictureOrNothing(url, 'sillynpc-art-icon-img');
    img.addEventListener('error', () => wrap.remove(), { once: true });
    wrap.append(img);
    return wrap;
}

/** Every faction name worth offering: the shipped ones (minus any deleted), the user's, and the roster's categories. */
export function knownFactions() {
    const hidden = factionSettings().hidden;
    const names = new Map();
    for (const f of Object.values(BUILTIN_FACTIONS)) if (f.label !== 'Neutral') names.set(foldFaction(f.label), f.label);
    for (const c of getSettings().characters || []) if (c?.category) names.set(foldFaction(c.category), c.category);
    for (const [id, t] of Object.entries(factionSettings().themes)) names.set(id, t.label || id);
    for (const id of hidden) names.delete(id);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** The known factions sorted into their worlds, each group in the world's own order; the rest under "Other". */
export function factionGroups() {
    const byId = new Map(knownFactions().map(name => [foldFaction(name), name]));
    const groups = [];
    for (const world of FACTION_WORLDS) {
        const names = world.ids.filter(id => byId.has(id)).map(id => { const n = byId.get(id); byId.delete(id); return n; });
        if (names.length) groups.push({ id: world.id, label: world.label, names });
    }
    const rest = [...byId.entries()].filter(([id]) => !worldGroupOf(id)).map(([, name]) => name);
    const aliased = [...byId.entries()].filter(([id]) => worldGroupOf(id)).map(([, name]) => name);
    const other = [...rest, ...aliased].sort((a, b) => a.localeCompare(b));
    if (other.length) groups.push({ id: 'other', label: 'Other (your own and roster categories)', names: other });
    return groups;
}

/* ------------------------------------------------------------------ the settings section */

const COLOR_FIELDS = [['bg', 'Background'], ['panel', 'Panels'], ['accent', 'Highlights'], ['accent2', 'Second accent'], ['text', 'Main text'], ['tab', 'Selected tabs'], ['border', 'Borders and icons'], ['muted', 'Secondary text']];

/**
 * Appearance, Faction colours and artwork: whether pictures are used at all, where they are read
 * from, and a palette per faction. Switching artwork off is enough to need nothing from a content
 * pack: every picture is replaced by a built-in icon or a plain gradient.
 */
export function renderFactionSettings(view, rerender) {
    const wrap = el('div', 'sillynpc-setting-group sillynpc-fx-settings');
    wrap.append(el('h4', 'sillynpc-combat-heading', 'Faction colours and artwork'));
    wrap.append(el('p', 'notes',
        'A character\'s faction (their category) decides the colours of their page. Pictures are optional: banners, weapon icons and crests '
        + 'come from the Worldkit-Content download: put its art folder at data/<your user>/user/images/worldkit-art/. Turn artwork off to use only built-in icons.'));

    const settings = factionSettings();

    const toggleRow = el('label', 'checkbox_label sillynpc-setting-row');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = settings.useArtwork;
    toggle.addEventListener('change', () => { settings.useArtwork = toggle.checked; saveFactionSettings(); rerender?.(); });
    toggleRow.append(el('span', 'sillynpc-setting-label', 'Use world artwork'), toggle);
    wrap.append(toggleRow);

    wrap.append(el('small', 'notes', 'Off: no picture is ever requested. Faction banners become coloured gradients and icons become built-in ones.'));

    const baseRow = el('div', 'sillynpc-setting-row');
    const base = el('input', 'text_pole');
    base.type = 'text';
    base.value = settings.artworkBase;
    base.placeholder = '/user/images/worldkit-art/';
    base.title = 'The web path of the artwork folder. SillyTavern only serves /user/images/ and /user/files/, so put the folder at data/<your user>/user/images/worldkit-art/ and it is /user/images/worldkit-art/.';
    base.addEventListener('change', () => { settings.artworkBase = base.value; saveFactionSettings(); rerender?.(); });
    baseRow.append(el('span', 'sillynpc-setting-label', 'Artwork folder'), base);
    wrap.append(baseRow);

    const defRow = el('div', 'sillynpc-setting-row');
    const def = el('select', 'text_pole');
    def.append(new Option('Neutral', ''));
    for (const name of knownFactions()) def.append(new Option(name, foldFaction(name)));
    def.value = settings.defaultFaction;
    def.addEventListener('change', () => { settings.defaultFaction = def.value; saveFactionSettings(); });
    defRow.append(el('span', 'sillynpc-setting-label', 'Default faction'), def);
    wrap.append(defRow);
    wrap.append(el('small', 'notes', 'The look used for a character whose category has no palette of its own.'));

    const factionEditor = (name) => {
        const id = foldFaction(name);
        const palette = paletteFor(name, settings);
        const own = Boolean(settings.themes[id]);
        const box = el('details', 'sillynpc-fx-faction');
        const head = el('summary', '', `${name}${own ? ' (customised)' : ''}`);
        head.style.borderLeft = `10px solid ${palette.accent}`;
        head.style.paddingLeft = '8px';
        box.append(head);
        const grid = el('div', 'sillynpc-fx-grid');
        const edit = (key, value) => {
            const current = settings.themes[id] || { ...palette, label: name };
            settings.themes[id] = { ...current, label: name, [key]: value };
            saveFactionSettings();
        };
        for (const [key, label] of COLOR_FIELDS) {
            const row = el('label', 'sillynpc-fx-colour');
            const input = el('input');
            input.type = 'color';
            input.value = palette[key] || palette.accent;
            input.addEventListener('change', () => edit(key, input.value));
            row.append(el('span', '', label), input);
            grid.append(row);
        }
        const bannerRow = el('label', 'sillynpc-fx-colour');
        const banner = el('input', 'text_pole');
        banner.type = 'text';
        banner.value = palette.banner || '';
        banner.placeholder = 'fire-emblem/banners/golden-deer.png';
        banner.title = 'Banner picture, relative to the artwork folder. Empty uses a gradient.';
        banner.addEventListener('change', () => edit('banner', banner.value));
        bannerRow.append(el('span', '', 'Banner'), banner);
        grid.append(bannerRow);
        box.append(grid);
        if (own) {
            const reset = el('button', 'menu_button', 'Back to the shipped look');
            reset.type = 'button';
            reset.addEventListener('click', () => { delete settings.themes[id]; saveFactionSettings(); rerender?.(); });
            box.append(reset);
        }
        const shipped = Boolean(BUILTIN_FACTIONS[id]);
        const remove = el('button', 'menu_button', shipped ? 'Delete from the list' : 'Delete this theme');
        remove.type = 'button';
        remove.title = shipped
            ? 'Hides this shipped palette. Characters of this faction then use the default faction. You can bring deleted ones back at the bottom of the list.'
            : 'Removes the palette you made for this faction.';
        remove.addEventListener('click', async () => {
            const ok = await Popup.show.confirm(`${shipped ? 'Delete from the list' : 'Delete theme'}: ${name}`,
                shipped ? 'This palette is hidden and no longer used. You can restore it later.' : 'Your palette for this faction is removed.');
            if (!ok) return;
            delete settings.themes[id];
            if (shipped && !settings.hidden.includes(id)) settings.hidden.push(id);
            saveFactionSettings();
            rerender?.();
        });
        box.append(remove);
        return box;
    };

    for (const group of factionGroups()) {
        const section = el('details', 'sillynpc-fx-world');
        section.append(el('summary', '', `${group.label} (${group.names.length})`));
        for (const name of group.names) section.append(factionEditor(name));
        wrap.append(section);
    }
    if (settings.hidden.length) {
        const restore = el('button', 'menu_button', `Bring back ${settings.hidden.length} deleted theme${settings.hidden.length === 1 ? '' : 's'}`);
        restore.type = 'button';
        restore.addEventListener('click', () => { settings.hidden = []; saveFactionSettings(); rerender?.(); });
        wrap.append(restore);
    }
    view.append(wrap);
}
