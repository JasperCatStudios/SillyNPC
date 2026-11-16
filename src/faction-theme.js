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
    ashen_wolves: { label: 'Ashen Wolves', bg: '#17151C', panel: '#2A2831', accent: '#A98DBA', accent2: '#A8A6AD', text: '#EFEDF0', tab: '#50415D', border: '#A8A6AD', muted: '#B8B4BF', banner: 'fire-emblem/banners/ashen-wolves.png' },
    knights_of_seiros: { label: 'Knights of Seiros', bg: '#1B2025', panel: '#343C42', accent: '#C8D0CF', accent2: '#C3AA72', text: '#F2EEE2', banner: 'fire-emblem/banners/knights-of-seiros.png' },
});

/** Other names a faction goes by, folded the way foldFaction folds. */
const ALIASES = Object.freeze({
    church_of_seiros: 'knights_of_seiros',
    knights_of_seiros: 'knights_of_seiros',
    seiros: 'knights_of_seiros',
    ashen_wolves: 'ashen_wolves',
    cindered_shadows: 'ashen_wolves',
    golden_deer: 'golden_deer',
    black_eagles: 'black_eagles',
    blue_lions: 'blue_lions',
});

/*
 * SillyTavern serves only /user/images/ and /user/files/ out of a user's data folder, so the artwork folder lives under
 * images: data/<user>/user/images/worldkit-art/ is /user/images/worldkit-art/. The first version of this setting pointed
 * at /user/worldkit-art/, which nothing serves, so that value is read as the default.
 */
export const DEFAULT_ARTWORK_BASE = '/user/images/worldkit-art/';
const LEGACY_ARTWORK_BASES = Object.freeze(['/user/worldkit-art/', '/user/worldkit-art']);

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
        // Optional: the selected-tab colour, the border and icon colour, and the quieter text. Empty means derived.
        tab: hex(p.tab, ''),
        border: hex(p.border, ''),
        muted: hex(p.muted, ''),
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
    let base = typeof r.artworkBase === 'string' && r.artworkBase.trim() ? r.artworkBase.trim() : DEFAULT_ARTWORK_BASE;
    if (LEGACY_ARTWORK_BASES.includes(base)) base = DEFAULT_ARTWORK_BASE;
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
export function paletteFor(faction, settings = normalizeFactionSettings(), world = null) {
    const id = foldFaction(faction);
    if (id && settings.themes[id]) return { id, ...settings.themes[id] };
    // The world's own factions, as its author set them in the world editor.
    const worldFaction = id && artOf(world).factions[id];
    if (worldFaction) return { id, ...worldFaction };
    const builtinId = ALIASES[id] || (BUILTIN_FACTIONS[id] ? id : '');
    if (builtinId) return { id: builtinId, ...normalizePalette(BUILTIN_FACTIONS[builtinId]) };
    const def = settings.defaultFaction;
    if (def && settings.themes[def]) return { id: def, ...settings.themes[def] };
    if (def && BUILTIN_FACTIONS[def]) return { id: def, ...normalizePalette(BUILTIN_FACTIONS[def]) };
    // Neutral, wearing the world's own banner when it set one.
    const fallback = { id: 'neutral', ...normalizePalette(BUILTIN_FACTIONS.neutral) };
    const worldBanner = artOf(world).banner;
    if (worldBanner) fallback.banner = worldBanner;
    return fallback;
}

/** CSS custom properties for a palette, as a style string. */
export function themeStyle(palette) {
    const tab = palette.tab || `color-mix(in srgb, ${palette.accent} 30%, ${palette.panel})`;
    const border = palette.border || palette.accent2 || palette.accent;
    const muted = palette.muted || `color-mix(in srgb, ${palette.text} 70%, ${palette.bg})`;
    return [
        `--fx-bg:${palette.bg}`, `--fx-panel:${palette.panel}`, `--fx-accent:${palette.accent}`,
        `--fx-accent2:${palette.accent2}`, `--fx-text:${palette.text}`,
        `--fx-tab:${tab}`, `--fx-border:${border}`, `--fx-muted:${muted}`,
    ].join(';');
}

/** The URL of a picture under the artwork folder, or '' when artwork is off or the path is empty. */
export function artworkUrl(relative, settings = normalizeFactionSettings()) {
    if (!settings.useArtwork || !relative) return '';
    const path = String(relative).replace(/^\/+/, '');
    if (/^[a-z]+:/i.test(path) || path.includes('..')) return '';
    return `${settings.artworkBase}${path}`;
}

/* ------------------------------------------------------------------ a world's own artwork */

const cleanPath = (v) => {
    const p = typeof v === 'string' ? v.trim().replace(/^\/+/, '') : '';
    return p && !p.includes('..') && !/^[a-z]+:/i.test(p) && p.length <= 200 ? p : '';
};

/**
 * The artwork a world type carries (type.art), repaired: a default banner, picture paths for gear
 * kinds and skills, a crest folder, and the world's own factions with their colours. All paths are
 * relative to the artwork folder, and everything is optional.
 */
export function normalizeWorldArt(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const map = (obj) => {
        const out = {};
        for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
            const key = String(k).toLowerCase().trim();
            const path = cleanPath(v);
            if (key && path) out[key] = path;
        }
        return out;
    };
    const factions = {};
    for (const [name, value] of Object.entries(r.factions && typeof r.factions === 'object' ? r.factions : {})) {
        const id = foldFaction(name);
        if (id && value && typeof value === 'object') {
            factions[id] = { ...normalizePalette({ ...value, banner: cleanPath(value.banner), emblem: cleanPath(value.emblem) }), label: String(value.label || name) };
        }
    }
    const crests = cleanPath(r.crestsDir);
    return {
        banner: cleanPath(r.banner),
        crestsDir: crests ? (crests.endsWith('/') ? crests : `${crests}/`) : '',
        kinds: map(r.kinds),
        profs: map(r.profs),
        factions,
    };
}

/** A world given as an id (built-in) or as a type object (which may carry its own art). */
function artOf(world) {
    if (world && typeof world === 'object') return normalizeWorldArt(world.art);
    return normalizeWorldArt(null);
}
const worldIdOf = (world) => (world && typeof world === 'object' ? String(world.dataKey || world.id || '') : String(world ?? ''));

/** Whether a world carries any art of its own. */
export const hasWorldArt = (world) => {
    const a = artOf(world);
    return Boolean(a.banner || a.crestsDir || Object.keys(a.kinds).length || Object.keys(a.profs).length || Object.keys(a.factions).length);
};

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
export function iconFor(world, id, { kind = 'prof' } = {}) {
    const key = String(id ?? '').toLowerCase();
    const own = artOf(world);
    const art = WORLD_ART[worldIdOf(world)];
    const table = { ...(art ? (kind === 'kind' ? art.kinds : art.profs) : {}), ...(kind === 'kind' ? own.kinds : own.profs) };
    const word = Object.keys(FALLBACK_ICONS).find(k => key === k || key.includes(k));
    return { src: table[key] || '', icon: (word && FALLBACK_ICONS[word]) || NEUTRAL_ICON };
}

/** The picture for a crest by name ("Crest of Macuil" or "macuil"), or '' when the world has none. */
/** Crest names whose picture is filed under another spelling. */
const CREST_FILES = Object.freeze({ ernest: 'earnest', beast: 'thebeast', flame: 'flames' });

export function crestPicture(world, name) {
    const dir = artOf(world).crestsDir || WORLD_ART[worldIdOf(world)]?.crestsDir;
    if (!dir) return '';
    const words = String(name ?? '').toLowerCase().replace(/\b(?:crest of|crest|major|minor|the|of)\b/g, '').trim().split(/[^a-z]+/).filter(Boolean);
    if (!words.length) return '';
    const last = words[words.length - 1];
    return `${dir}${CREST_FILES[last] || last}.png`;
}
