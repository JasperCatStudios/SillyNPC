/**
 * Your own group chats on the phone (fork): the rules, without the screen.
 *
 * The phone already runs a group thread for the open SillyTavern group. These are groups you make
 * yourself, from any characters: a thread id `#group:<name>` with a list of members. The phone's
 * normal group path does the rest: your text goes to the whole thread and the members answer in
 * the same conversation, each under their own name, and may talk to each other.
 *
 * groups: { [id]: { members: [character name] } }
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const GROUP_PREFIX = '#group:';
export const MAX_GROUP_MEMBERS = 8;
export const MAX_GROUP_NAME = 30;
export const MAX_GROUPS = 20;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** Groups as they are kept: only real ones, each with a tidy member list. */
export function normalizeGroups(raw) {
    const out = {};
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const [id, g] of Object.entries(src)) {
        if (!String(id).startsWith(GROUP_PREFIX) || !clean(String(id).slice(GROUP_PREFIX.length))) continue;
        const members = [];
        for (const m of Array.isArray(g?.members) ? g.members : []) {
            const n = clean(m);
            if (n && !members.some(x => same(x, n))) members.push(n);
        }
        out[id] = { members: members.slice(0, MAX_GROUP_MEMBERS) };
    }
    return out;
}

/**
 * Makes a group. Mutates `groups`.
 * @param {string[]} [taken] other thread ids the name must not collide with (the open group chat's)
 * @returns {{ ok: boolean, id?: string, reason?: string }}
 */
export function createGroup(groups, rawName, { taken = [] } = {}) {
    const name = clean(rawName).slice(0, MAX_GROUP_NAME);
    if (!name) return { ok: false, reason: 'Give the group a name.' };
    if (/[|]/.test(name)) return { ok: false, reason: 'The name cannot contain "|".' };
    const id = GROUP_PREFIX + name;
    if (Object.keys(groups).some(k => same(k, id)) || taken.some(k => same(k, id))) return { ok: false, reason: 'There is already a group with that name.' };
    if (Object.keys(groups).length >= MAX_GROUPS) return { ok: false, reason: `That is as many groups as the phone keeps (${MAX_GROUPS}).` };
    groups[id] = { members: [] };
    return { ok: true, id };
}

/** Adds a person. `known` (optional) is the names that exist; anyone else is refused. */
export function addMember(groups, id, rawName, known = null) {
    const g = groups[id];
    if (!g) return { ok: false, reason: 'That group is gone.' };
    const name = clean(rawName);
    if (!name) return { ok: false, reason: 'Pick someone to add.' };
    if (known && !known.some(k => same(k, name))) return { ok: false, reason: `${name} is not a character here.` };
    if (g.members.some(m => same(m, name))) return { ok: false, reason: `${name} is already in it.` };
    if (g.members.length >= MAX_GROUP_MEMBERS) return { ok: false, reason: `A group holds ${MAX_GROUP_MEMBERS} people at most.` };
    const exact = known ? known.find(k => same(k, name)) : name;
    g.members.push(exact);
    return { ok: true, name: exact };
}

export function removeMember(groups, id, rawName) {
    const g = groups[id];
    if (!g) return { ok: false, reason: 'That group is gone.' };
    const before = g.members.length;
    g.members = g.members.filter(m => !same(m, rawName));
    return { ok: g.members.length !== before, ...(g.members.length === before ? { reason: 'They are not in it.' } : {}) };
}

/** Who a group's messages go to: its members who still exist, in order. Null when it is not one of yours. */
export function membersOf(groups, id, known = null) {
    const g = groups?.[id];
    if (!g) return null;
    const out = [];
    for (const m of g.members) {
        const exact = known ? known.find(k => same(k, m)) : m;
        if (exact && !out.includes(exact)) out.push(exact);
    }
    return out.slice(0, MAX_GROUP_MEMBERS);
}

/** The people who could still be added: known names not already in the group. */
export function addable(groups, id, known) {
    const g = groups?.[id];
    if (!g) return [];
    return (known || []).filter(k => !g.members.some(m => same(m, k)));
}

/** The label shown for a group: its name. */
export const groupLabel = (id) => String(id || '').slice(GROUP_PREFIX.length);
