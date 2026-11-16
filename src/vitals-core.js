/**
 * The Vitals Tracker's rules (fork): health, hunger and mood for the people in a story.
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node. vitals.js is the SillyTavern
 * side, and it is built the way bonds.js is: the numbers are kept per chat, a separate request
 * reads each reply and only PROPOSES values, and the limits below decide how much of a
 * proposal happens.
 *
 *   health  0 to 100. 0 is dead, 100 is healthy.
 *   hunger  0 to 100. 0 is starving, 100 is full.
 *   mood    a word ("Anxious", "Content") and how strongly it holds, 0 to 100. The tracker can
 *           also be pointed at stress: the word names it, the level says how much.
 *
 *   energy  0 to 100. 0 is exhausted, 100 is rested.
 *
 * These four are the whole of a person's body-and-mind state; the default status tracker's HP and
 * Energy are no longer used by the Status card.
 */

export const VITAL_KEYS = Object.freeze(['health', 'hunger', 'energy', 'mood']);
export const VITAL_LABELS = Object.freeze({ health: 'Health', hunger: 'Hunger', energy: 'Energy', mood: 'Mood' });
export const VITALS_TIMINGS = Object.freeze({ request: 'After The Reply', manual: 'Only When I Press Update' });
export const VITALS_POSITIONS = Object.freeze({ chat: 'In the chat', prompt: 'In the prompt', before: 'Before the prompt' });
export const VITALS_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
export const VITALS_TRIGGERS = Object.freeze({
    scene: 'People in the scene', mentioned: 'People mentioned lately', always: 'Everyone tracked',
});

/** What a fresh person, and a reset, is: healthy, fed and calm. */
export const VITAL_DEFAULTS = Object.freeze({ health: 100, hunger: 100, energy: 100, mood: Object.freeze({ word: 'Calm', level: 0 }) });

export const VITALS_SETTINGS_DEFAULTS = Object.freeze({
    enabled: false,
    timing: 'request',
    contextMessages: 4,
    maxTokens: 600,
    prompt: '',
    includePlayer: true,
    track: Object.freeze({ health: true, hunger: true, energy: true, mood: true }),
    // The most one reply may move each value, in points. Health and hunger are physical and
    // change slowly; a mood can swing in a moment.
    limits: Object.freeze({ health: 30, hunger: 15, energy: 25, mood: 40 }),
    inject: Object.freeze({ position: 'chat', depth: 1, role: 'system', trigger: 'scene', scanDepth: 6 }),
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const int = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);
const text = (v, d = '') => (typeof v === 'string' ? v : d);
const percent = (v) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), 0, 100) : null);

/* ------------------------------------------------------------------------ words */

const HEALTH_WORDS = [[0, 'Dead'], [10, 'Dying'], [30, 'Critical'], [50, 'Badly hurt'], [70, 'Wounded'], [89, 'Bruised'], [100, 'Healthy']];
const HUNGER_WORDS = [[10, 'Starving'], [30, 'Famished'], [50, 'Hungry'], [70, 'Peckish'], [89, 'Satisfied'], [100, 'Full']];

function wordFor(table, value) {
    const v = clamp(Number(value) || 0, 0, 100);
    for (const [upTo, word] of table) if (v <= upTo) return word;
    return table[table.length - 1][1];
}

const ENERGY_WORDS = [[10, 'Exhausted'], [30, 'Drained'], [50, 'Tired'], [70, 'Weary'], [89, 'Rested'], [100, 'Energised']];
export const energyWord = (value) => wordFor(ENERGY_WORDS, value);
export const healthWord = (value) => wordFor(HEALTH_WORDS, value);
export const hungerWord = (value) => wordFor(HUNGER_WORDS, value);

/** "Anxious (60%)", or just the word when it barely holds. */
export function moodText(mood) {
    const m = normalizeMood(mood);
    return m.level >= 5 ? `${m.word} (${m.level}%)` : m.word;
}

/* --------------------------------------------------------------------- settings */

export function normalizeVitalsSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = VITALS_SETTINGS_DEFAULTS;
    return {
        enabled: Boolean(r.enabled),
        timing: pick(r.timing, VITALS_TIMINGS, d.timing),
        contextMessages: int(r.contextMessages, d.contextMessages, 0, 20),
        maxTokens: int(r.maxTokens, d.maxTokens, 100, 4000),
        prompt: text(r.prompt),
        includePlayer: r.includePlayer === undefined ? d.includePlayer : Boolean(r.includePlayer),
        track: {
            health: r.track?.health === undefined ? true : Boolean(r.track.health),
            hunger: r.track?.hunger === undefined ? true : Boolean(r.track.hunger),
            energy: r.track?.energy === undefined ? true : Boolean(r.track.energy),
            mood: r.track?.mood === undefined ? true : Boolean(r.track.mood),
        },
        limits: {
            health: int(r.limits?.health, d.limits.health, 1, 100),
            hunger: int(r.limits?.hunger, d.limits.hunger, 1, 100),
            energy: int(r.limits?.energy, d.limits.energy, 1, 100),
            mood: int(r.limits?.mood, d.limits.mood, 1, 100),
        },
        inject: {
            position: pick(r.inject?.position, VITALS_POSITIONS, d.inject.position),
            depth: int(r.inject?.depth, d.inject.depth, 0, 50),
            role: pick(r.inject?.role, VITALS_ROLES, d.inject.role),
            trigger: pick(r.inject?.trigger, VITALS_TRIGGERS, d.inject.trigger),
            scanDepth: int(r.inject?.scanDepth, d.inject.scanDepth, 1, 50),
        },
    };
}

/* ------------------------------------------------------------------------ store */

export function normalizeMood(raw) {
    if (typeof raw === 'string') return { word: raw.trim().slice(0, 40) || VITAL_DEFAULTS.mood.word, level: 50 };
    const word = text(raw?.word).trim().slice(0, 40) || VITAL_DEFAULTS.mood.word;
    return { word, level: percent(raw?.level) ?? 0 };
}

export function newPerson(name, { player = false } = {}) {
    return {
        name: String(name).trim(),
        player: Boolean(player),
        tracked: true,
        health: VITAL_DEFAULTS.health,
        hunger: VITAL_DEFAULTS.hunger,
        energy: VITAL_DEFAULTS.energy,
        mood: { ...VITAL_DEFAULTS.mood },
        history: [],
        updated: 0,
    };
}

export function normalizePerson(raw) {
    const p = newPerson(text(raw?.name) || 'Unknown', { player: raw?.player });
    p.tracked = raw?.tracked === undefined ? true : Boolean(raw.tracked);
    p.health = percent(raw?.health) ?? VITAL_DEFAULTS.health;
    p.hunger = percent(raw?.hunger) ?? VITAL_DEFAULTS.hunger;
    p.energy = percent(raw?.energy) ?? VITAL_DEFAULTS.energy;
    p.mood = normalizeMood(raw?.mood);
    p.history = (Array.isArray(raw?.history) ? raw.history : []).filter(h => h && typeof h === 'object').slice(-40);
    p.updated = Number(raw?.updated) || 0;
    return p;
}

export function normalizeStore(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        people: (Array.isArray(r.people) ? r.people : []).filter(p => p && p.name).map(normalizePerson),
        turns: (Array.isArray(r.turns) ? r.turns : []).filter(t => t && typeof t === 'object').slice(-60),
    };
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const findPerson = (store, name) => store.people.find(p => same(p.name, name)) || null;

export function ensurePerson(store, name, opts) {
    let p = findPerson(store, name);
    if (!p) { p = newPerson(name, opts); store.people.push(p); }
    return p;
}

/* ---------------------------------------------------------------- hand and resets */

const HISTORY_CAP = 40;
function note(person, stat, from, to, why, now) {
    person.history.push({ at: now, stat, from, to, why });
    if (person.history.length > HISTORY_CAP) person.history.splice(0, person.history.length - HISTORY_CAP);
    person.updated = now;
}

/** Sets one vital by hand, with no limit. Returns false when the value is unusable. */
export function setVital(person, stat, value, { now = Date.now(), why = 'edited' } = {}) {
    if (stat === 'mood') {
        const next = normalizeMood(value);
        const from = person.mood;
        person.mood = next;
        note(person, 'mood', moodText(from), moodText(next), why, now);
        return true;
    }
    if (stat !== 'health' && stat !== 'hunger' && stat !== 'energy') return false;
    const next = percent(value);
    if (next === null) return false;
    const from = person[stat];
    person[stat] = next;
    note(person, stat, from, next, why, now);
    return true;
}

/** Health, hunger and energy back to 100, mood back to calm. */
export function resetVital(person, stat, now = Date.now()) {
    if (!VITAL_KEYS.includes(stat)) return false;
    const target = stat === 'mood' ? { ...VITAL_DEFAULTS.mood } : VITAL_DEFAULTS[stat];
    return setVital(person, stat, target, { now, why: 'reset' });
}

/* ------------------------------------------------------------------ applying a read */

/** Moves `from` toward `to`, by at most `limit`. */
export function step(from, to, limit) {
    const d = to - from;
    return from + clamp(d, -limit, limit);
}

/**
 * Applies what one reply produced. Proposed values are absolute; each moves at most its limit
 * from where it stands. Unknown people are only added when they are in `known` or are the player.
 * The prior values are kept in a turn record so a swipe, regenerate or delete can take them back.
 *
 * @returns {{ applied: boolean, record: { changes: object[] } }}
 */
export function applyTurn(store, update, settings, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const known = new Set((ctx.known || []).map(n => String(n).toLowerCase()));
    const changes = [];
    const before = {};
    for (const row of update?.people || []) {
        const name = text(row?.name).trim();
        if (!name) continue;
        const isPlayer = ctx.player && same(name, ctx.player);
        let person = findPerson(store, name);
        if (!person) {
            if (!(known.has(name.toLowerCase()) || (isPlayer && settings.includePlayer))) continue;
            person = newPerson(name, { player: isPlayer });
            store.people.push(person);
        }
        if (!person.tracked || (isPlayer && !settings.includePlayer)) continue;
        const snap = { health: person.health, hunger: person.hunger, energy: person.energy, mood: { ...person.mood }, existed: true };
        let touched = false;
        for (const stat of ['health', 'hunger', 'energy']) {
            if (!settings.track[stat]) continue;
            const wanted = percent(row[stat]);
            if (wanted === null) continue;
            const next = Math.round(step(person[stat], wanted, settings.limits[stat]));
            if (next === person[stat]) continue;
            changes.push({ name: person.name, stat, from: person[stat], to: next, proposed: wanted, why: text(row.reason) });
            note(person, stat, person[stat], next, text(row.reason) || 'story', now);
            person[stat] = next;
            touched = true;
        }
        if (settings.track.mood && (row.mood !== undefined)) {
            const wanted = normalizeMood(row.mood);
            const level = Math.round(step(person.mood.level, wanted.level, settings.limits.mood));
            if (wanted.word !== person.mood.word || level !== person.mood.level) {
                const next = { word: wanted.word, level };
                changes.push({ name: person.name, stat: 'mood', from: moodText(person.mood), to: moodText(next), why: text(row.reason) });
                note(person, 'mood', moodText(person.mood), moodText(next), text(row.reason) || 'story', now);
                person.mood = next;
                touched = true;
            }
        }
        if (touched) before[person.name] = snap;
    }
    if (ctx.key !== undefined) {
        store.turns = store.turns.filter(t => !(t.key === String(ctx.key)));
        store.turns.push({ key: String(ctx.key), swipeId: ctx.swipeId ?? 0, messageId: ctx.messageId, before, changes, at: now });
        if (store.turns.length > 60) store.turns.splice(0, store.turns.length - 60);
    }
    return { applied: changes.length > 0, record: { changes } };
}

/** Takes back everything one reply did. Returns whether anything was undone. */
export function revertTurn(store, key) {
    const turn = store.turns.find(t => t.key === String(key));
    if (!turn) return false;
    let any = false;
    for (const [name, snap] of Object.entries(turn.before || {})) {
        const person = findPerson(store, name);
        if (!person) continue;
        person.health = snap.health;
        person.hunger = snap.hunger;
        if (snap.energy !== undefined) person.energy = snap.energy;
        person.mood = normalizeMood(snap.mood);
        any = true;
    }
    store.turns = store.turns.filter(t => t !== turn);
    return any;
}

/* --------------------------------------------------------------------- the reader */

/** Pulls the people array out of whatever the reader model answered. */
export function parseUpdate(raw) {
    const src = String(raw ?? '');
    const start = src.indexOf('{');
    const end = src.lastIndexOf('}');
    if (start < 0 || end <= start) return { people: [] };
    try {
        const data = JSON.parse(src.slice(start, end + 1));
        const people = (Array.isArray(data.people) ? data.people : []).filter(p => p && typeof p === 'object' && p.name);
        return { people: people.map(p => ({ ...p, name: String(p.name).trim() })) };
    } catch {
        return { people: [] };
    }
}

export const VITALS_SYSTEM = [
    'You read one reply of a story and report the physical and emotional state of the people in it.',
    'For each person, give: health (0 to 100: 0 is dead, 100 is perfectly healthy), hunger (0 to 100: 0 is starving, 100 is full), energy (0 to 100: 0 is exhausted, 100 is rested),',
    'and mood: a short word or two for how they feel, with a level from 0 to 100 for how strongly (0 is not at all, 100 is overwhelming).',
    'Report only what the story supports. Leave a field out when nothing in the reply changes it.',
    'Answer with one JSON object and nothing else:',
    '{"people":[{"name":"Name","health":85,"hunger":60,"energy":70,"mood":{"word":"Anxious","level":55},"reason":"one short sentence"}]}',
].join(' ');

/** The two prompts for the separate request. */
export function buildMonitorPrompt(settings, people, ctx = {}) {
    const wants = ['health', 'hunger', 'energy', 'mood'].filter(k => settings.track[k]).join(', ');
    const system = `${settings.prompt?.trim() || VITALS_SYSTEM}\n\nTrack only: ${wants}.`;
    const lines = people.map(p => `- ${p.name}: health ${p.health}, hunger ${p.hunger}, energy ${p.energy}, mood ${moodText(p.mood)}`);
    const user = [
        lines.length ? `Current state:\n${lines.join('\n')}` : 'Nobody is being tracked yet. Report anyone named in the reply.',
        ctx.recent ? `Earlier in the story:\n${ctx.recent}` : '',
        `The player is ${ctx.playerName || 'the player'}. Latest reply (from ${ctx.speaker || 'the narrator'}):\n${ctx.latest || ''}`,
    ].filter(Boolean).join('\n\n');
    return { system, user };
}

/** Who goes into the story prompt this turn. */
export function selectPeople(store, opts, { applies = () => true } = {}) {
    void opts;
    return store.people.filter(p => p.tracked).filter(p => applies(p.name)).map(p => p.name);
}

/** The text sent with the story: the current state of the chosen people, in words and numbers. */
export function buildInjection(store, names, settings, playerName = '') {
    const parts = [];
    for (const name of names) {
        const p = findPerson(store, name);
        if (!p || !p.tracked) continue;
        const bits = [];
        if (settings.track.health) bits.push(`health ${p.health}% (${healthWord(p.health)})`);
        if (settings.track.hunger) bits.push(`hunger ${p.hunger}% (${hungerWord(p.hunger)})`);
        if (settings.track.energy) bits.push(`energy ${p.energy}% (${energyWord(p.energy)})`);
        if (settings.track.mood) bits.push(`mood ${moodText(p.mood)}`);
        if (bits.length) parts.push(`- ${p.name}${p.player || same(p.name, playerName) ? ' (the player)' : ''}: ${bits.join(', ')}`);
    }
    if (!parts.length) return '';
    return `[Vitals: how each person is right now. 0% health is death; show it in how they act, never as a number.\n${parts.join('\n')}]`;
}

/* -------------------------------------------------------------- the block under a reply */

export const VITALS_SUMMARY = '🩺 VITALS';

/** One person's line, as the Worldkit Vitals regex expects it. A vital that is not tracked is "--". */
export function vitalsLine(person, settings, note = '') {
    const tracked = settings?.track || { health: true, hunger: true, energy: true, mood: true };
    const num = (key) => (tracked[key] ? String(person[key]) : '--');
    const mood = tracked.mood ? person.mood : { word: '--', level: 0 };
    const clean = String(note || '').replace(/[|<>\n]/g, ' ').trim();
    return `- <b>${person.name}</b> | HEALTH: ${num('health')} | HUNGER: ${num('hunger')} | MOOD: ${mood.word} | MOODLEVEL: ${tracked.mood ? mood.level : 0} | ENERGY: ${num('energy')}${clean ? ` | NOTE: ${clean}` : ''}`;
}

/**
 * The VITALS block shown under a reply: a <details> whose summary says VITALS and one line per
 * tracked person, with what this reply changed in the note. Empty when nobody is tracked.
 */
export function vitalsBlockHtml(store, record, settings) {
    const people = (store?.people || []).filter(p => p.tracked).slice(0, 12);
    if (!people.length) return '';
    const changes = record?.changes || [];
    const lines = people.map((person) => {
        const mine = changes.filter(c => c.name === person.name);
        const note = mine.map(c => (c.stat === 'mood' ? `mood ${c.to}` : `${c.stat} ${c.to - c.from > 0 ? '+' : ''}${c.to - c.from}`)).join(', ');
        return vitalsLine(person, settings, note);
    });
    return `<details><summary>${VITALS_SUMMARY}</summary>\n${lines.join('\n')}\n</details>`;
}
