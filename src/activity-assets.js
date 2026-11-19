/**
 * Activity art by file name (fork): where a picture may be found and what it is called.
 *
 * A person customizes an activity by dropping a file with the expected name into a folder; no code or settings are
 * edited. The expected names live in one manifest (activity-assets-manifest.js); this file turns a manifest entry into the
 * list of addresses to try, best first:
 *   1. the user's folder for this world      /user/images/worldkit-art/<world>/activities/<file>
 *   2. the user's folder for every world     /user/images/worldkit-art/activities/<file>
 *   3. the preset's own art base (a Content Kit folder), when it names one
 *   4. the installed Content Kit             art/activities/<file>
 * Each place is tried for the canonical name, then for the older names the entry lists (so files already in a folder keep
 * working), and for .webp then .png. A picture nobody has leaves the screen with its plain icon, never a broken image.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const USER_ART_BASE = '/user/images/worldkit-art/';
const IMAGE_EXTS = ['.webp', '.png'];

/** A file-name-safe key: lower case, accents removed, anything else a single dash. "Golden Carp" is golden-carp. */
export function assetSlug(name) {
    return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Fills {placeholder}s in a file pattern from vars (each value made file-safe). An unfilled one makes the pattern unusable (null). */
export function fillPattern(pattern, vars = {}) {
    let missing = false;
    const out = String(pattern).replace(/\{(\w+)\}/g, (whole, k) => {
        const v = vars[k] === undefined || vars[k] === null ? '' : assetSlug(vars[k]);
        if (!v) missing = true;
        return v;
    });
    return missing ? null : out;
}

/** The same file with each extension in turn. A pattern with no known extension is left alone. */
function withExtensions(file) {
    const m = /(\.[a-z0-9]+)$/i.exec(file);
    if (!m || !IMAGE_EXTS.includes(m[1].toLowerCase())) return [file];
    const stem = file.slice(0, -m[1].length);
    return [file, ...IMAGE_EXTS.filter(e => e !== m[1].toLowerCase()).map(e => `${stem}${e}`)];
}

/** A relative path that cannot climb out of its folder. */
const safeRelative = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.split('/').includes('..');

/**
 * The addresses to try for one manifest entry, best first, without repeats.
 * @param {{ file: string, legacy?: string[], fallbackKey?: string }} entry a manifest entry
 * @param {Record<string, string>} vars values for the pattern's placeholders (e.g. { sprite: 'berry' })
 * @param {{ world?: string, userArtBase?: string, presetBase?: string, kitFile?: (rel: string) => string }} ctx
 *   world is the preset's id (its folder name); presetBase is a Content Kit folder with a trailing slash; kitFile builds a
 *   Content Kit address from a path under art/activities/.
 */
export function assetCandidates(entry, vars = {}, ctx = {}) {
    const names = [entry?.file, ...(entry?.legacy || [])].map(p => fillPattern(p, vars)).filter(safeRelative);
    const base = ctx.userArtBase || USER_ART_BASE;
    const world = assetSlug(ctx.world);
    const places = [];
    if (world) places.push((f) => `${base}${world}/activities/${f}`);
    places.push((f) => `${base}activities/${f}`);
    if (ctx.presetBase && typeof ctx.kitFile === 'function') places.push((f) => ctx.kitFile(`${String(ctx.presetBase).replace(/\/?$/, '/')}${f}`));
    if (typeof ctx.kitFile === 'function') places.push((f) => ctx.kitFile(f));
    const out = [];
    for (const place of places) {
        for (const name of names) {
            for (const file of withExtensions(name)) {
                const url = place(file);
                if (!out.includes(url)) out.push(url);
            }
        }
    }
    return out;
}

/** The manifest entry with this key, or null. */
export const entryFor = (manifest, key) => (manifest || []).find(e => e.key === key) || null;
