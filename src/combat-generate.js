import { readLoreEntry } from './character-fill.js';
import { requestOnConnection } from './connections.js';
import { setStat, setMeta, setRank, setWeapon, setAbilities } from './combat-edit.js';
import { MAX_ABILITIES } from './combat-abilities.js';
import { ladderOf } from './combat-roles.js';

/**
 * Generate a character's combat sheet from their lorebook entry (fork).
 *
 * The lore entry is the character's profile. With no linked entry (or an empty one) there is
 * nothing to go on, and nothing happens. The model is told exactly which stat, meta and
 * proficiency ids the world type has and what range they usually sit in; whatever it returns
 * is checked against the type before anything is written, so a stray key or a rank that is not
 * on the ladder is dropped rather than stored.
 */

const SYSTEM = 'You convert a character description into game stats. Reply with one JSON object and nothing else. '
    + 'Use only the ids you are given. Base every number on what the description says about the character; '
    + 'where it is silent, choose modest values that fit them. Never invent powers the description does not suggest.';

function describeType(type) {
    const lines = [];
    lines.push('Stats (id: label, usual range):');
    for (const s of type.stats) {
        const r = s.scale ? `${s.scale.min} to ${s.scale.max}` : 'any number';
        lines.push(`- ${s.id}: ${s.label}, ${r}`);
    }
    if (type.meta.length) {
        lines.push('Details (id: label):');
        for (const m of type.meta) {
            const opts = m.type === 'choice' && m.options?.length ? `, one of: ${m.options.join(', ')}` : (m.type === 'number' ? ', a number' : ', text');
            lines.push(`- ${m.id}: ${m.label}${opts}`);
        }
    }
    const profs = type.proficiencies.filter(p => (p.roles || []).some(r => r === 'weapon' || r === 'magic'));
    if (profs.length) {
        lines.push('Proficiencies (id: label, ranks from lowest to highest). Include only those the character plausibly has:');
        for (const p of profs) lines.push(`- ${p.id}: ${p.label}, ranks ${ladderOf(type, p.ladder)?.rungs?.join(' < ') || ''}`);
    }
    if ((type.abilities || []).length) {
        lines.push(`Abilities (id: label, kind). Choose at most ${MAX_ABILITIES}, only those the description clearly supports:`);
        for (const a of type.abilities) lines.push(`- ${a.id}: ${a.label}, ${a.kind}${a.desc ? `. ${a.desc}` : ''}`);
    }
    return lines.join('\n');
}

function buildPrompt(name, lore, type) {
    return [
        `Character: ${name}`,
        `World type: ${type.name}`,
        '',
        describeType(type),
        '',
        'Description:',
        lore,
        '',
        'Reply as JSON: {"stats":{"<stat id>":number},"meta":{"<detail id>":value},"profs":{"<proficiency id>":"<rank>"},"weapon":{"name":"<what they fight with, or empty>","prof":"<proficiency id or empty>","power":0},"abilities":["<ability id>"]}',
    ].join('\n');
}

function parseJson(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string, applied?: number }>}
 */
export async function generateCombatSheet(record, type) {
    const lore = String(await readLoreEntry(record) || '').trim();
    if (!lore) return { ok: false, reason: 'no-lore' };

    const reply = await requestOnConnection('combatProfileId', SYSTEM, buildPrompt(record.name, lore, type), 1500);
    const data = parseJson(reply);
    if (!data || typeof data !== 'object') return { ok: false, reason: 'The model did not return usable stats. Try again.' };

    let applied = 0;
    for (const [id, v] of Object.entries(data.stats || {})) {
        if (setStat(record, type, id, v).ok && v !== '' && v !== null) applied++;
    }
    for (const [id, v] of Object.entries(data.meta || {})) {
        if (setMeta(record, type, id, v).ok && v !== '' && v !== null) applied++;
    }
    for (const [id, rank] of Object.entries(data.profs || {})) {
        if (setRank(record, type, id, rank).ok && rank) applied++;
    }
    if (data.weapon && typeof data.weapon === 'object') {
        const w = data.weapon;
        const known = type.proficiencies.some(p => p.id === w.prof);
        if (setWeapon(record, type, { name: w.name, prof: known ? w.prof : '', power: 0 }).ok && w.name) applied++;
    }
    if (Array.isArray(data.abilities) && (type.abilities || []).length) {
        const out = setAbilities(record, type, data.abilities.slice(0, MAX_ABILITIES));
        applied += out.to.length;
    }
    return { ok: applied > 0, applied, reason: applied ? undefined : 'Nothing in the reply matched this world type.' };
}
