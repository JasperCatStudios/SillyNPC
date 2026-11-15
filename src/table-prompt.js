/**
 * The prompt for the characters at a game table (fork): who is here, who is being spoken to, what
 * has been said and what just happened, and the rules that keep them from answering for each
 * other. One request voices all of them (see group-talk.js), so the prompt has to make clear who
 * says what to whom, or they all answer everything at once.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { groupInstruction } from './group-talk.js';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who a message is spoken to, by what it says: the people at the table whose name (or first name,
 * when that is unambiguous) appears in it as a whole word. "So Ben, the date? What time?" is
 * for Ben. No name at all means it is for the whole table.
 * @param {string} text
 * @param {string[]} names the characters at the table
 * @returns {string[]} the people named, in the order they are named
 */
export function addressees(text, names) {
    const said = clean(text);
    if (!said) return [];
    const firsts = names.map(n => clean(n).split(' ')[0].toLowerCase());
    const found = [];
    names.forEach((full, i) => {
        const aliases = [clean(full)];
        const first = firsts[i];
        if (first && first !== clean(full).toLowerCase() && firsts.filter(f => f === first).length === 1) aliases.push(first);
        let at = -1;
        for (const a of aliases) {
            const m = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a)}(?=$|[^\\p{L}\\p{N}])`, 'iu').exec(said);
            if (m && (at < 0 || m.index < at)) at = m.index;
        }
        if (at >= 0) found.push({ name: full, at });
    });
    return found.sort((a, b) => a.at - b.at).map(f => f.name);
}

/** The table chat as the model should read it: who said it, and what the table itself reported. */
export function tableTranscript(chatLog, user, limit = 14) {
    const lines = [];
    for (const m of (chatLog || []).slice(-limit * 2)) {
        if (!m || !m.text) continue;
        if (m.sender === 'user') lines.push(`${user} (the player): ${m.text}`);
        else if (m.sender === 'bot') lines.push(`${m.who || '?'}: ${m.text}`);
        else if (m.sender === 'system') lines.push(`[table] ${m.text}`);
    }
    return lines.slice(-limit).join('\n');
}

/**
 * The system prompt for one round of table talk.
 * @param {object} p
 * @param {string} p.user the player's name
 * @param {string} p.game what is being played ("21 (Blackjack)")
 * @param {{ name: string, role?: string, hint?: string, about?: string }[]} p.people the characters at the table, with a role (dealer, partner...) and their personality
 * @param {string[]} p.speakers who may speak this round
 * @param {string[]} [p.directed] who the player's last words were for (empty: everyone or nothing in particular)
 * @param {string} p.event what just happened or was said
 * @param {string} [p.standing] where the game stands
 * @param {string} [p.transcript] the table chat so far (see tableTranscript)
 * @param {string} [p.story] a little of the main story, for context
 * @param {string} [p.rules] the language / dialogue rules to add
 */
export function tableSystem({ user, game, people, speakers, directed = [], event, standing = '', transcript = '', story = '', rules = '' }) {
    const roster = people.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}${p.hint || ''}${p.about ? `: ${clean(p.about).slice(0, 250)}` : ''}`).join('\n');
    const parts = [
        `You write the spoken lines of characters sitting around a table playing ${game} with ${user}. It is a casual game among people who know each other, and they talk the way people do at a table.`,
        `WHO IS AT THE TABLE:\n- ${user} (the player: a real person at the table, whose words are given to you and who you NEVER write for)\n${roster}`,
    ];
    if (story) parts.push(`STORY SO FAR (background only):\n${story}`);
    if (standing) parts.push(`WHERE THE GAME STANDS:\n${standing}`);
    if (transcript) parts.push(`THE TABLE CHAT SO FAR (oldest first):\n${transcript}`);
    parts.push(`WHAT JUST HAPPENED:\n${event}`);
    const asked = directed.join(' and ');
    const reactors = speakers.filter(n => !directed.includes(n));
    const answer = `a question gets an answer (a time, a place, a yes or no), an offer, bet or challenge is accepted, refused or haggled over, a compliment is taken or deflected`;
    let who;
    if (!directed.length) {
        who = 'Anyone may answer if they would, but each only for themselves and with something different from the others. If the event concerns only some of them, only those react.';
    } else if (!reactors.length) {
        who = `${user} was speaking to ${asked}. ONLY ${asked} answer${directed.length === 1 ? 's' : ''}, and answer${directed.length === 1 ? 's' : ''} what was actually said: ${answer}. Everyone else at the table stays quiet.`;
    } else {
        who = `${user} was speaking to ${asked}. ${asked} answer${directed.length === 1 ? 's' : ''} FIRST, directly and in full, to what was actually said: ${answer}. That answer is the first line of your reply. `
            + `Only after it may ${joinOr(reactors)} react, each with at most one short line and only if they have something to say (staying quiet is fine). `
            + `A reaction is to BOTH what ${user} said AND what ${asked} just answered, in the reactor's own voice. It is never an answer given on ${asked}'s behalf and never a repeat of the answer.`;
    }
    parts.push([
        'HOW TO ANSWER:',
        `1. Every line is spoken by ONE of ${joinOr(speakers)}, as themselves, to the person who is actually being addressed. Never put one character's words in another's mouth and never speak for ${user}.`,
        `2. ${who}`,
        '3. Remember what was said and promised at this table (bets, dares, dates, teasing) and keep to it: if someone said they would pay up, owe a favour or lose something, a later line can bring it up.',
        '4. Do not repeat a line already said in the chat. Stay on what was just said; do not change the subject or fall back on empty small talk.',
        '5. Keep each line short, one or two sentences, in the character\'s own voice and manner.',
        rules,
    ].filter(Boolean).join('\n'));
    if (directed.length && reactors.length) {
        parts.push(`FORMAT: one line per speaker, each written exactly as "Name: what they say". The first line is ${directed[0]}'s answer to ${user}. After it come the reactions, if any, from ${joinOr(reactors)}. Never write a line for ${user}.`);
    } else {
        parts.push(groupInstruction(speakers, user));
    }
    return parts.join('\n\n');
}

function joinOr(names) {
    if (names.length < 2) return names[0] || 'the characters';
    return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
