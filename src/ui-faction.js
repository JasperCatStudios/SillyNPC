import { getSettings, saveSettings } from './settings.js';
import {
    NEUTRAL_ICON, gameArtUrl, normalizeFactionSettings, paletteFor, themeStyle, artworkUrl, iconFor, crestPicture, BUILTIN_FACTIONS, foldFaction,
} from './faction-theme.js';

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

const gameArtFound = new Map();

/**
 * Puts a table or combat background on a node as a CSS variable, but only when game backgrounds are
 * switched on and the file really exists (checked once per file; a missing download changes nothing).
 * Called every time a game screen is drawn, so switching the setting takes effect on the next screen.
 */
export function applyGameArt(node, game) {
    if (!node) return;
    const url = gameArtUrl(game, factionSettings());
    if (!url) { node.style.removeProperty('--worldkit-game-image'); node.classList.remove('has-felt'); return; }
    const set = () => {
        node.style.setProperty('--worldkit-game-image', `url("${url}")`);
        // The felt table is dark: the game screens switch to light text while it is showing.
        node.classList.toggle('has-felt', /felt-table.webp$/.test(url));
    };
    if (gameArtFound.get(url) === true) { set(); return; }
    if (gameArtFound.get(url) === false) { node.style.removeProperty('--worldkit-game-image'); node.classList.remove('has-felt'); return; }
    node.style.removeProperty('--worldkit-game-image');
    node.classList.remove('has-felt');
    const probe = new Image();
    probe.onload = () => { gameArtFound.set(url, true); set(); };
    probe.onerror = () => gameArtFound.set(url, false);
    probe.src = url;
}

/** The palette a character's faction (category) gets. */
export function factionPalette(category, world = null) {
    return paletteFor(category, factionSettings(), world);
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

/** A crest's picture, or a built-in icon when the world has none. */
export function buildCrestIcon(worldId, name) {
    const wrap = el('span', 'sillynpc-art-icon sillynpc-art-crest');
    wrap.title = name;
    const fallback = el('i', 'fa-solid fa-shield');
    wrap.append(fallback);
    const url = artworkUrl(crestPicture(worldId, name), factionSettings());
    if (url) {
        const img = pictureOrNothing(url, 'sillynpc-art-icon-img');
        img.addEventListener('load', () => fallback.remove(), { once: true });
        wrap.append(img);
    }
    return wrap;
}

/** Every faction name worth offering: the shipped ones, the user's, and the roster's categories. */
export function knownFactions() {
    const names = new Map();
    for (const f of Object.values(BUILTIN_FACTIONS)) if (f.label !== 'Neutral') names.set(foldFaction(f.label), f.label);
    for (const c of getSettings().characters || []) if (c?.category) names.set(foldFaction(c.category), c.category);
    for (const [id, t] of Object.entries(factionSettings().themes)) names.set(id, t.label || id);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
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

    const gameRow = el('label', 'checkbox_label sillynpc-setting-row');
    const gameToggle = el('input');
    gameToggle.type = 'checkbox';
    gameToggle.checked = settings.gameArt;
    gameToggle.disabled = !settings.useArtwork;
    gameToggle.addEventListener('change', () => { settings.gameArt = gameToggle.checked; gameArtFound.clear(); saveFactionSettings(); });
    gameRow.append(el('span', 'sillynpc-setting-label', 'Game and combat backgrounds'), gameToggle);
    wrap.append(gameRow);
    wrap.append(el('small', 'notes',
        'Off by default. Table and combat backgrounds are a small extra download (about 350 KB as WebP, in the Worldkit-Content art/games folder). '
        + 'Put that folder at data/<your user>/user/images/worldkit-art/games/. Without it, or with this off, games and combat use their built-in look.'));
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

    for (const name of knownFactions()) {
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
        wrap.append(box);
    }
    view.append(wrap);
}
