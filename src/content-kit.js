/**
 * The Content Kit's rules: the saved address, what the catalog file may hold, and how regex scripts are merged.
 *
 * Pure, so it is tested in node. The Content Kit is the Worldkit-Content repository (worlds, character packs,
 * lorebooks, regex scripts, workflows). It is fetched with git the same way SillyTavern installs an extension, and
 * read through the catalog.json file the repository carries, so the extension never has to guess what is in it.
 */

export const DEFAULT_KIT_URL = 'https://github.com/JasperCatStudios/Worldkit-Content.git';

/** What a catalog entry may be. `art` is listed for information; it is copied by hand, not imported. */
export const KIT_TYPES = Object.freeze({
    world: 'Worlds',
    characters: 'Character packs',
    lorebook: 'Lorebooks',
    regex: 'Regex scripts',
    workflow: 'Workflows (Phone pictures)',
    art: 'Artwork',
});

/** Whether the text is an http(s) address SillyTavern's installer would accept. */
export function isKitUrl(text) {
    try {
        const url = new URL(String(text ?? '').trim());
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname.length > 1;
    } catch {
        return false;
    }
}

/**
 * The folder SillyTavern clones into: the last part of the address without `.git`, the same name its installer
 * works out. Returns '' for an address that has none.
 */
export function kitFolderName(address) {
    try {
        const parts = new URL(String(address).trim()).pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        return last.replace(/\.git$/i, '').replace(/[^A-Za-z0-9._-]/g, '');
    } catch {
        return '';
    }
}

/** Where a file of the installed kit is served from. */
export function kitFileUrl(folder, file) {
    return `/scripts/extensions/third-party/${encodeURIComponent(folder)}/${String(file).split('/').map(encodeURIComponent).join('/')}`;
}

/** A path inside the kit: relative, forward slashes, no way out of the folder. */
function safePath(file) {
    const f = String(file ?? '');
    if (!f || f.startsWith('/') || f.includes('\\') || f.includes(':')) return false;
    return !f.split('/').some(part => part === '..' || part === '' || part === '.');
}

/**
 * Reads the catalog file and keeps only entries that are usable: a known type, a name, a safe path.
 * @returns {{ version: number, items: { type: string, name: string, file: string, description: string, group: string }[] }}
 */
export function normalizeCatalog(raw) {
    const items = [];
    for (const it of Array.isArray(raw?.items) ? raw.items : []) {
        if (!it || typeof it !== 'object') continue;
        const type = Object.prototype.hasOwnProperty.call(KIT_TYPES, it.type) ? it.type : '';
        const name = String(it.name ?? '').trim().slice(0, 120);
        if (!type || !name || !safePath(it.file)) continue;
        items.push({
            type,
            name,
            file: String(it.file),
            description: String(it.description ?? '').trim().slice(0, 300),
            group: String(it.group ?? '').trim().slice(0, 80),
        });
    }
    return { version: Number(raw?.version) || 1, items };
}

/** The catalog arranged for the screen: one section per type in KIT_TYPES order, with sub-groups (regex looks). */
export function groupCatalog(catalog) {
    const sections = [];
    for (const type of Object.keys(KIT_TYPES)) {
        const items = catalog.items.filter(i => i.type === type);
        if (!items.length) continue;
        const groups = new Map();
        for (const item of items) {
            if (!groups.has(item.group)) groups.set(item.group, []);
            groups.get(item.group).push(item);
        }
        sections.push({ type, label: KIT_TYPES[type], groups: [...groups.entries()].map(([name, list]) => ({ name, items: list })) });
    }
    return sections;
}

/** A regex file may hold one script or a list of them. */
export function scriptsFromFile(data) {
    const list = Array.isArray(data) ? data : [data];
    return list.filter(s => s && typeof s === 'object' && typeof s.scriptName === 'string' && typeof s.findRegex === 'string');
}

/**
 * Adds regex scripts to SillyTavern's list. A script that is already there (same id) is replaced in place so its
 * position and the order it runs in stay as they were; a new one goes on the end. Nothing is ever removed.
 *
 * @returns {{ merged: object[], added: number, replaced: number }}
 */
export function mergeRegexScripts(existing, incoming) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    let added = 0;
    let replaced = 0;
    for (const script of incoming) {
        const at = script.id ? merged.findIndex(s => s?.id === script.id) : -1;
        if (at >= 0) { merged[at] = script; replaced++; } else { merged.push(script); added++; }
    }
    return { merged, added, replaced };
}
