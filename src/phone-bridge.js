/**
 * The phone in the story (fork): now and then, when someone you have been texting is in the main
 * chat, what you texted is put in front of the story model so they can bring it up, react to it or
 * act on it. This is the decision and the wording; the phone module supplies the threads, the
 * scene and the prompt slot.
 *
 * Modes: off (never), manual (one time, when you ask: "bring the texts into the next reply"), and
 * random (hidden: by chance, with a cooldown, without being asked). Nothing is ever shown in the
 * chat itself: it only goes to the model.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const BRIDGE_MODES = Object.freeze(['off', 'manual', 'random', 'always']);
export const BRIDGE_ROLES = Object.freeze(['system', 'user', 'assistant']);

export const DEFAULT_BRIDGE_INSTRUCTION = 'Let this colour the scene if it fits: <<contact>> may mention or react to these texts, or act on what was said in them, in their own way. Do not recite the texts word for word, and do not treat them as read aloud in the room unless <<user>> brings them up.';

export const BRIDGE_DEFAULTS = Object.freeze({
    mode: 'off',            // 'off' | 'manual' | 'random' | 'always'
    chance: 5,              // random mode: percent of replies that carry the texts (rare). 100 = every reply, for testing
    cooldown: 3,            // random mode: at least this many replies between two times
    messages: 6,            // how many of the latest texts are given
    onlyNew: true,          // only texts not given before
    arrive: false,          // when the texts of someone who is NOT in the scene go to the story, also tell it to bring them to the player
    onlyScene: true,        // random mode: only people who are in the scene
    maxContacts: 1,         // how many conversations at once
    depth: 0,               // how far back in the chat the block sits (0: with the latest message)
    role: 'system',
    order: 500,             // injection order in SillyTavern's prompt list (same-depth blocks go by it)
    inList: true,           // placed through the prompt list (Chat Completion), so it can be moved there
    notify: false,          // a small notice when it happens (the block itself is never shown)
    instruction: DEFAULT_BRIDGE_INSTRUCTION,
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

/** The settings, repaired: unknown values fall back to the defaults. */
export function normalizeBridge(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = BRIDGE_DEFAULTS;
    return {
        mode: BRIDGE_MODES.includes(r.mode) ? r.mode : d.mode,
        chance: clamp(r.chance, 0, 100, d.chance),
        cooldown: clamp(r.cooldown, 0, 50, d.cooldown),
        messages: clamp(r.messages, 1, 30, d.messages),
        onlyNew: r.onlyNew === undefined ? d.onlyNew : Boolean(r.onlyNew),
        arrive: Boolean(r.arrive),
        onlyScene: r.onlyScene === undefined ? d.onlyScene : Boolean(r.onlyScene),
        maxContacts: clamp(r.maxContacts, 1, 4, d.maxContacts),
        depth: clamp(r.depth, 0, 20, d.depth),
        role: BRIDGE_ROLES.includes(r.role) ? r.role : d.role,
        order: clamp(r.order, 0, 1000, d.order),
        inList: r.inList === undefined ? d.inList : Boolean(r.inList),
        notify: Boolean(r.notify),
        instruction: typeof r.instruction === 'string' && r.instruction.trim() ? r.instruction.slice(0, 800) : d.instruction,
    };
}

const clip = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const textOf = (m) => (m && (m.img || m.imgKey) && !m.text ? '[photo]' : clip(m?.text));

/**
 * Whether this reply carries the phone texts, and which conversations.
 *
 * @param {object} p
 * @param {object} p.bridge normalized settings
 * @param {{ id: string, name: string, inScene: boolean, messages: object[] }[]} p.contacts the conversations
 *   (id: the thread id, name: who it is with, inScene: whether they are in the scene now, messages: the thread)
 * @param {Record<string, number>} [p.shown] per thread id, the time of the last text already given
 * @param {boolean} [p.armed] manual mode: the player has asked for it this time
 * @param {number} [p.since] replies since it last happened (random mode's cooldown)
 * @param {() => number} [p.rng]
 * @returns {{ fire: boolean, reason: string, picks: { id: string, name: string, messages: object[] }[] }}
 */
export function chooseBridge({ bridge, contacts, shown = {}, armed = false, since = Infinity, rng = Math.random }) {
    const b = normalizeBridge(bridge);
    const none = (reason) => ({ fire: false, reason, picks: [] });
    if (b.mode === 'off') return none('off');
    // asked for by hand (the button or /phonetexts): it happens on the next reply, in either mode
    const asked = Boolean(armed);
    if (b.mode === 'manual' && !asked) return none('not asked for');
    if (b.mode === 'random' && !asked) {
        // at 100% (testing) it is every reply: the cooldown is not waited for
        if (b.chance < 100 && since < b.cooldown) return none('cooling down');
        if (!(rng() * 100 < b.chance)) return none('not this time');
    }
    // asked for by hand: anyone with texts; at random: only the people in the scene (when set)
    // always: every reply, anyone you have texted (not only the people in the scene), the one texted most recently first
    const wantScene = b.mode === 'random' && b.onlyScene && !asked;
    const picks = [];
    let anyTexts = false;
    for (const c of contacts || []) {
        const all = (c.messages || []).filter(m => m && (m.text || m.img || m.imgKey));
        if (!all.length) continue;
        anyTexts = true;
        if (wantScene && !c.inScene) continue;
        // always: the latest texts go with every reply, not only the ones never given before
        const fresh = (b.onlyNew && b.mode !== 'always') ? all.filter(m => (Number(m.ts) || 0) > (Number(shown[c.id]) || 0)) : all;
        if (!fresh.length) continue;
        picks.push({ id: c.id, name: c.name, inScene: Boolean(c.inScene), messages: fresh.slice(-b.messages), last: Math.max(Number(all[all.length - 1].ts) || 0, Number(fresh[fresh.length - 1].ts) || 0) });
    }
    if (!picks.length) return none(anyTexts ? (wantScene ? 'nobody texted is in the scene, or nothing new' : 'nothing new to give') : 'no texts yet');
    picks.sort((x, y) => y.last - x.last);
    return { fire: true, reason: asked ? 'asked for' : b.mode, picks: picks.slice(0, b.maxContacts).map(({ id, name, inScene, messages }) => ({ id, name, inScene, messages })) };
}

/**
 * How long ago a text was, in words. The story's own clock first (the scene time the text was sent
 * at against the scene time now); the real clock when there is none.
 * @param {{ ts?: number, sc?: number|null }} msg
 * @param {{ clock?: { ms: number } | null, nowMs?: number }} [time]
 * @returns {string} "just now", "25 minutes ago", "3 hours ago", "2 days ago"... or '' when it cannot be told
 */
export function agoText(msg, { clock = null, nowMs = Date.now() } = {}) {
    let minutes;
    if (clock && Number.isFinite(Number(clock.ms)) && msg && msg.sc !== undefined && msg.sc !== null && Number.isFinite(Number(msg.sc))) {
        minutes = (Number(clock.ms) - Number(msg.sc)) / 60000;
    } else if (msg && Number.isFinite(Number(msg.ts)) && Number(msg.ts) > 0) {
        minutes = (Number(nowMs) - Number(msg.ts)) / 60000;
    } else return '';
    const m = Math.floor(Math.max(0, minutes));
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
    if (m < 2) return 'just now';
    if (m < 60) return plural(m, 'minute');
    if (m < 60 * 24) return plural(Math.floor(m / 60), 'hour');
    if (m < 60 * 24 * 14) return plural(Math.floor(m / 1440), 'day');
    if (m < 60 * 24 * 60) return plural(Math.floor(m / 10080), 'week');
    return plural(Math.floor(m / 43200), 'month');
}

/** "It is now ...": the story's date and time, or the real ones when the story has none. */
export function nowLine({ clock = null, nowMs = Date.now() } = {}) {
    if (clock && (clock.dateText || clock.timeText)) return `It is now ${[clock.dateText, clock.timeText].filter(Boolean).join(', ')} (story time).`;
    const d = new Date(nowMs);
    return `It is now ${d.toLocaleDateString()}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (real time).`;
}

/**
 * The block that goes to the story model. With `time` ({ clock, nowMs }) every text says how long
 * ago it was sent and the block says what time it is now; without it, no times are written.
 * These words are only for the model: nothing here is ever shown in the phone.
 */
export function bridgeText({ picks, user = 'the player', instruction = DEFAULT_BRIDGE_INSTRUCTION, time = null, arrive = false }) {
    if (!picks || !picks.length) return '';
    return picks.map((p) => {
        const lines = p.messages.map((m) => {
            const ago = time ? agoText(m, time) : '';
            return `- ${m.who === 'user' ? user : (m.name || p.name)}${ago ? ` (${ago})` : ''}: ${textOf(m)}`;
        });
        let how = String(instruction || DEFAULT_BRIDGE_INSTRUCTION).replace(/<<contact>>/gi, p.name).replace(/<<user>>/gi, user);
        // texted, but not here: the story is told to bring them over
        if (arrive && p.inScene === false) how += ` ${p.name} is not with ${user} right now. In this reply, have ${p.name} come to ${user} and arrive in the scene, as these texts suggest.`;
        const last = time ? agoText(p.messages[p.messages.length - 1], time) : '';
        const when = time ? `${nowLine(time)}${last ? ` The last text was sent ${last}.` : ''}\n` : '';
        return `[PHONE TEXTS between ${p.name} and ${user}, newest last:\n${when}${lines.join('\n')}\n${how}]`;
    }).join('\n\n');
}

/** Remembers how far each conversation has been given, so the same texts are not given twice. Mutates and returns `shown`. */
export function markShown(shown, picks) {
    for (const p of picks || []) {
        const last = Math.max(0, ...p.messages.map(m => Number(m.ts) || 0));
        if (last > (Number(shown[p.id]) || 0)) shown[p.id] = last;
    }
    return shown;
}
