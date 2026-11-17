/**
 * Values at a dotted path ("effect.dmgMult") inside a record, with empty parents cleaned up when a value is removed.
 * Pure: no DOM, no SillyTavern imports.
 */

export function getPath(obj, path) {
    let cur = obj;
    for (const key of String(path).split('.')) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[key];
    }
    return cur;
}

export function setPath(obj, path, value) {
    const keys = String(path).split('.');
    const trail = [obj];
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (cur[keys[i]] === null || typeof cur[keys[i]] !== 'object') {
            if (value === undefined) return;
            cur[keys[i]] = {};
        }
        cur = cur[keys[i]];
        trail.push(cur);
    }
    const last = keys[keys.length - 1];
    if (value === undefined) {
        delete cur[last];
        // an object left empty is removed from its parent
        for (let i = trail.length - 1; i > 0; i--) {
            if (Object.keys(trail[i]).length) break;
            delete trail[i - 1][keys[i - 1]];
        }
    } else cur[last] = value;
}

