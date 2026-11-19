/**
 * The "Customize an activity" helpers (fork): the pure side of the editor in the Activities tab.
 *
 * Customizing changes an activity's CONTENT (names, words, lists), never its rules. Fire Emblem is the worked example
 * for every field: its value is shown beside yours, so a Bleach or Black Clover world can see what to replace.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { DEFAULT_TERMS } from './activity-terms.js';

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clean = (v, max) => String(v ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const intIn = (v, lo, hi, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** A preset id not in `taken`: base, then base-2, base-3. */
export function uniquePresetId(base, taken = []) {
    const root = String(base || 'my-preset').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'my-preset';
    const used = new Set((taken || []).map(t => String(t).toLowerCase()));
    if (!used.has(root)) return root;
    let n = 2;
    while (used.has(`${root}-${n}`)) n += 1;
    return `${root}-${n}`;
}

/**
 * An editable copy of a preset (a plain JSON clone) under a new id and name, so a built-in one is never changed.
 * @param {object} source the preset to copy (raw or normalized)
 * @param {string[]} takenIds ids already in use
 */
export function copyForEditing(source, takenIds = []) {
    const clone = JSON.parse(JSON.stringify(obj(source)));
    const baseName = String(clone.name || clone.id || 'Preset').slice(0, 50);
    clone.id = uniquePresetId(`my-${clone.id || 'preset'}`, takenIds);
    clone.name = `My ${baseName}`.slice(0, 60);
    delete clone.extra;
    delete clone.newer;
    return clone;
}

/** The kinds this build knows, with what Fire Emblem uses each for (shown for a kind that is not known). */
export const KIND_EXAMPLES = Object.freeze({
    memory: 'matching game (Fire Emblem: Study)',
    mastermind: 'clue puzzle (Fire Emblem: Brewing)',
    tea: 'host a guest (Fire Emblem: Tea Time)',
    harvest: 'timing and growing (Fire Emblem: Cooking, Fishing, Gardening)',
    drill: 'skill drill',
    exam: 'certification exam',
});

/** What to tell a person about an activity whose kind this version does not know. */
export function unknownKindHelp(kind) {
    const list = Object.entries(KIND_EXAMPLES).map(([k, v]) => `${k} = ${v}`).join('; ');
    return `"${kind}" is not a kind this version knows. In the Fire Emblem preset the kinds are: ${list}. Pick one to treat it as under Customize an activity, or leave it as it is.`;
}

/**
 * The words an activity shows, where each appears, and how Fire Emblem fills it. \`group\` sets the card on the editor.
 * The Fire Emblem values come from the preset itself; this only describes them.
 */
export const TERM_GUIDE = Object.freeze([
    { key: 'examiner', group: 'People and exams', label: 'The person who examines', where: 'Exam and class change screens' },
    { key: 'examinerPlural', group: 'People and exams', label: 'The same, plural', where: 'Lists of examiners' },
    { key: 'exam', group: 'People and exams', label: 'The exam', where: 'Exam title and results' },
    { key: 'examVerb', group: 'People and exams', label: 'Taking the exam', where: 'The button that starts it' },
    { key: 'passed', group: 'People and exams', label: 'Passed', where: 'The result word' },
    { key: 'credential', group: 'People and exams', label: 'What an exam awards', where: 'Items given for a pass' },
    { key: 'credentialPlural', group: 'People and exams', label: 'The same, plural', where: 'Lists of them' },
    { key: 'classWord', group: 'People and exams', label: 'Class (a role or rank path)', where: 'Class change text' },
    { key: 'changeClass', group: 'People and exams', label: 'Changing class', where: 'The button and its dialog' },
    { key: 'knowledge', group: 'Study', label: 'What studying builds', where: 'Study results and the class gate' },
    { key: 'tile', group: 'Study', label: 'A matching piece', where: 'Study help and the screen reader' },
    { key: 'cursedTile', group: 'Study', label: 'The trick piece', where: 'Study help and messages' },
    { key: 'studyPlace', group: 'Places', label: 'Where study happens', where: 'Setup text' },
    { key: 'gardenPlace', group: 'Places', label: 'Where plants grow', where: 'Gardening title and help' },
    { key: 'fishingPlace', group: 'Places', label: 'Where fish are', where: 'Fishing text' },
    { key: 'tea', group: 'Tea Time', label: 'The drink', where: 'Tea Time text' },
    { key: 'guest', group: 'Tea Time', label: 'The visitor', where: 'Tea Time text' },
]);

/** Every key TERM_GUIDE describes is a real term, and every term has a guide entry. */
export const termGuideCovers = () => TERM_GUIDE.every(t => t.key in DEFAULT_TERMS) && Object.keys(DEFAULT_TERMS).every(k => TERM_GUIDE.some(t => t.key === k));

/* ------------------------------------------------------------------ list text, one entry per line */

/** A text box's lines: trimmed, empty ones dropped, capped. */
export const linesOf = (text, max = 40, width = 60) => String(text ?? '').split(/\r?\n/).map(l => clean(l, width)).filter(Boolean).slice(0, max);

/** Fish as lines: "name | weight | difficulty | size". Weight is how often it bites, difficulty 1 to 3, size 1 to 9. */
export const fishToLines = (fish) => (fish || []).map(f => `${f.name} | ${f.weight} | ${f.difficulty} | ${f.size}`).join('\n');
export function fishFromLines(text) {
    return String(text ?? '').split(/\r?\n/).map(line => {
        const [name, weight, difficulty, size] = line.split('|').map(p => p.trim());
        const n = clean(name, 50);
        return n ? { name: n, weight: intIn(weight, 1, 100, 10), difficulty: intIn(difficulty, 1, 3, 1), size: intIn(size, 1, 9, 2) } : null;
    }).filter(Boolean).slice(0, 40);
}

/** Seeds as lines: "seed | produce | days to grow | yield | kind | free". Kind is food or plant; "free" marks an endless bag. */
export const seedsToLines = (seeds) => (seeds || []).map(s => `${s.name} | ${s.produce} | ${s.needs} | ${s.yield} | ${s.kind || 'food'}${s.free ? ' | free' : ''}`).join('\n');
export function seedsFromLines(text) {
    return String(text ?? '').split(/\r?\n/).map(line => {
        const [name, produce, needs, yld, kind, free] = line.split('|').map(p => p.trim());
        const n = clean(name, 50);
        const p = clean(produce, 50);
        if (!n || !p) return null;
        return { name: n, produce: p, needs: intIn(needs, 1, 3, 2), yield: intIn(yld, 1, 5, 2), kind: clean(kind, 24).toLowerCase() || 'food', ...(/^free$/i.test(free || '') ? { free: true } : {}) };
    }).filter(Boolean).slice(0, 40);
}

/** Recipes as lines: "dish | description | wordsA, wordsB". Each group of words is one ingredient need (any word will do). */
export const recipesToLines = (recipes) => (recipes || []).map(r => `${r.name} | ${r.desc || ''} | ${(r.needs || []).map(n => (n.any || []).join(', ')).join(' ; ')}`).join('\n');
export function recipesFromLines(text) {
    return String(text ?? '').split(/\r?\n/).map(line => {
        const [name, desc, needs] = line.split('|').map(p => p.trim());
        const n = clean(name, 50);
        if (!n) return null;
        const list = String(needs || '').split(';').map(group => {
            const any = group.split(',').map(w => clean(w, 30).toLowerCase()).filter(Boolean).slice(0, 20);
            return any.length ? { label: any[0], any, qty: 1 } : null;
        }).filter(Boolean).slice(0, 4);
        return { name: n, desc: clean(desc, 90), needs: list };
    }).filter(Boolean).slice(0, 40);
}

/** Runes typed with spaces or commas: up to 12 symbols of at most 4 characters. */
export const runesFromText = (text) => String(text ?? '').split(/[\s,]+/).map(v => v.trim().slice(0, 4)).filter(Boolean).slice(0, 12);
