/**
 * Faction themes and world artwork (fork): the menu's colours follow a character's faction.
 *
 * A faction is a character's category. Each has a palette (background, panel, accent, text) and
 * optionally a banner and an emblem. Palettes are presentation data, never rules: the combat
 * world does not know about them, and any faction can be given any palette. A faction with no
 * palette of its own falls back to the world default and then to Neutral, so nothing is ever
 * left unstyled.
 *
 * Artwork is optional. Paths are relative to an artwork folder the user supplies (the
 * Worldkit-Content download), nothing is bundled, and a missing image falls back to a plain
 * built-in icon, so a world with no artwork looks right and no control ever depends on a picture.
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node.
 */

/** Shipped palettes: the five Fire Emblem house looks and the neutral fallback. Owner factions live in settings. */
export const BUILTIN_FACTIONS = Object.freeze({
    neutral: { label: 'Neutral', bg: '#171A19', panel: '#29312D', accent: '#8EAA94', accent2: '#BFC7BF', text: '#EAECE5', banner: 'fire-emblem/banners/neutral.png' },
    golden_deer: { label: 'Golden Deer', bg: '#171611', panel: '#29251B', accent: '#D8A92D', accent2: '#D8A92D', text: '#F4E8CB', banner: 'fire-emblem/banners/golden-deer.png' },
    black_eagles: { label: 'Black Eagles', bg: '#170E10', panel: '#35151A', accent: '#A92F3A', accent2: '#C79B55', text: '#F3E2D3', banner: 'fire-emblem/banners/black-eagles.png' },
    blue_lions: { label: 'Blue Lions', bg: '#101827', panel: '#1C3456', accent: '#88B7D8', accent2: '#C3CED6', text: '#EDF3F7', banner: 'fire-emblem/banners/blue-lions.png' },
    knights_of_seiros: { label: 'Knights of Seiros', bg: '#1B2025', panel: '#343C42', accent: '#C8D0CF', accent2: '#C3AA72', text: '#F2EEE2', banner: 'fire-emblem/banners/knights-of-seiros.png' },
});

/** Other names a faction goes by, folded the way foldFaction folds. */
const ALIASES = Object.freeze({
    church_of_seiros: 'knights_of_seiros',
    knights_of_seiros: 'knights_of_seiros',
    seiros: 'knights_of_seiros',
    golden_deer: 'golden_deer',
    black_eagles: 'black_eagles',
    blue_lions: 'blue_lions',
});

export const DEFAULT_ARTWORK_BASE = '/user/worldkit-art/';

/** "Church of Seiros" -> "church_of_seiros". */
export function foldFaction(name) {
    return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (HEX.test(String(v)) ? String(v) : d);

/** A palette with every colour present and valid. */
export function normalizePalette(raw, fallback = BUILTIN_FACTIONS.neutral) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return {
        label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : fallback.label,
        bg: hex(p.bg, fallback.bg),
        panel: hex(p.panel, fallback.panel),
        accent: hex(p.accent, fallback.accent),
        accent2: hex(p.accent2, hex(p.accent, fallback.accent2)),
        text: hex(p.text, fallback.text),
        banner: typeof p.banner === 'string' ? p.banner.trim() : (fallback.banner || ''),
        emblem: typeof p.emblem === 'string' ? p.emblem.trim() : (fallback.emblem || ''),
    };
}

/** The settings this feature reads, repaired. */
export function normalizeFactionSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const themes = {};
    for (const [key, value] of Object.entries(r.themes && typeof r.themes === 'object' ? r.themes : {})) {
        const id = foldFaction(key);
        if (id && value && typeof value === 'object') themes[id] = { ...normalizePalette(value), label: String(value.label || key) };
    }
    const base = typeof r.artworkBase === 'string' && r.artworkBase.trim() ? r.artworkBase.trim() : DEFAULT_ARTWORK_BASE;
    return {
        // Presentation only. Off means no pictures are requested at all, only built-in icons.
        useArtwork: r.useArtwork === undefined ? true : Boolean(r.useArtwork),
        artworkBase: base.endsWith('/') ? base : `${base}/`,
        defaultFaction: typeof r.defaultFaction === 'string' ? foldFaction(r.defaultFaction) : '',
        themes,
    };
}

/**
 * The palette for a faction: the user's own for that name, then a shipped one (by name or alias),
 * then the world's default faction, then Neutral.
 * @param {string} faction a category name
 * @param {object} settings normalizeFactionSettings output
 */
export function paletteFor(faction, settings = normalizeFactionSettings()) {
    const id = foldFaction(faction);
    if (id && settings.themes[id]) return { id, ...settings.themes[id] };
    const builtinId = ALIASES[id] || (BUILTIN_FACTIONS[id] ? id : '');
    if (builtinId) return { id: builtinId, ...normalizePalette(BUILTIN_FACTIONS[builtinId]) };
    const def = settings.defaultFaction;
    if (def && settings.themes[def]) return { id: def, ...settings.themes[def] };
    if (def && BUILTIN_FACTIONS[def]) return { id: def, ...normalizePalette(BUILTIN_FACTIONS[def]) };
    return { id: 'neutral', ...normalizePalette(BUILTIN_FACTIONS.neutral) };
}

/** CSS custom properties for a palette, as a style string. */
export function themeStyle(palette) {
    return [
        `--fx-bg:${palette.bg}`, `--fx-panel:${palette.panel}`, `--fx-accent:${palette.accent}`,
        `--fx-accent2:${palette.accent2}`, `--fx-text:${palette.text}`,
    ].join(';');
}

/** The URL of a picture under the artwork folder, or '' when artwork is off or the path is empty. */
export function artworkUrl(relative, settings = normalizeFactionSettings()) {
    if (!settings.useArtwork || !relative) return '';
    const path = String(relative).replace(/^\/+/, '');
    if (/^[a-z]+:/i.test(path) || path.includes('..')) return '';
    return `${settings.artworkBase}${path}`;
}

/* ------------------------------------------------------------------------ icons by world */

/**
 * Optional pictures for a world's weapon kinds and crests, relative to the artwork folder, and the
 * built-in icon each falls back to. A world with no entry here simply gets the fallback icons.
 */
export const WORLD_ART = Object.freeze({
    fe: {
        kinds: {
            axe: 'fire-emblem/weapon-icons/professor-axe.png',
            sword: 'fire-emblem/weapon-icons/professor-sword.png',
            lance: 'fire-emblem/weapon-icons/professor-lance.png',
            bow: 'fire-emblem/weapon-icons/professor-bow.png',
            dagger: 'fire-emblem/weapon-icons/professor-sword.png',
            tome: 'fire-emblem/weapon-icons/professor-reason.png',
            staff: 'fire-emblem/weapon-icons/professor-faith.png',
            gauntlets: 'fire-emblem/weapon-icons/professor-fighting.png',
            fists: 'fire-emblem/weapon-icons/professor-fighting.png',
        },
        // Proficiency ids use the same names as the kinds above in the Fire Emblem world.
        profs: {
            sword: 'fire-emblem/weapon-icons/professor-sword.png',
            lance: 'fire-emblem/weapon-icons/professor-lance.png',
            axe: 'fire-emblem/weapon-icons/professor-axe.png',
            bow: 'fire-emblem/weapon-icons/professor-bow.png',
            brawling: 'fire-emblem/weapon-icons/professor-fighting.png',
            reason: 'fire-emblem/weapon-icons/professor-reason.png',
            faith: 'fire-emblem/weapon-icons/professor-faith.png',
            authority: 'fire-emblem/weapon-icons/professor-authority.png',
            heavyarmor: 'fire-emblem/weapon-icons/professor-heavy.png',
            riding: 'fire-emblem/weapon-icons/professor-riding.png',
            flying: 'fire-emblem/weapon-icons/professor-flying.png',
        },
        crestsDir: 'fire-emblem/crests/',
    },
});

/** Built-in icons, by what a weapon kind or skill is, for when there is no picture. */
const FALLBACK_ICONS = Object.freeze({
    sword: 'fa-khanda', blade: 'fa-khanda', katana: 'fa-khanda', zanpakuto: 'fa-khanda',
    axe: 'fa-axe', lance: 'fa-location-arrow', spear: 'fa-location-arrow', bow: 'fa-bullseye', arrow: 'fa-bullseye',
    tome: 'fa-book', grimoire: 'fa-book', magic: 'fa-wand-sparkles', faith: 'fa-hands-praying', reason: 'fa-book',
    gauntlets: 'fa-hand-fist', fists: 'fa-hand-fist', brawling: 'fa-hand-fist', hakuda: 'fa-hand-fist',
    dagger: 'fa-dagger', riding: 'fa-horse', flying: 'fa-dove', heavyarmor: 'fa-shield-halved', authority: 'fa-crown',
});
export const NEUTRAL_ICON = 'fa-circle-dot';

/** { src, icon }: a picture path (relative, may be '') and the built-in icon to fall back to. */
export function iconFor(worldId, id, { kind = 'prof' } = {}) {
    const key = String(id ?? '').toLowerCase();
    const art = WORLD_ART[worldId];
    const table = art ? (kind === 'kind' ? art.kinds : art.profs) : null;
    const word = Object.keys(FALLBACK_ICONS).find(k => key === k || key.includes(k));
    return { src: table?.[key] || '', icon: (word && FALLBACK_ICONS[word]) || NEUTRAL_ICON };
}

/** The picture for a crest by name ("Crest of Macuil" or "macuil"), or '' when the world has none. */
export function crestPicture(worldId, name) {
    const dir = WORLD_ART[worldId]?.crestsDir;
    if (!dir) return '';
    const words = String(name ?? '').toLowerCase().replace(/crest of|crest|major|minor|the/g, '').trim().split(/[^a-z]+/).filter(Boolean);
    return words.length ? `${dir}${words[words.length - 1]}.png` : '';
}
