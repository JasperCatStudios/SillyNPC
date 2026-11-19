/**
 * The partner's talk during an activity (fork): the prompt and the fallback lines, without the I/O.
 *
 * The engine decides what happened; the model only voices it. A prompt holds the story context, the persona and
 * memory blocks, the rivalry line, what the partner likes (one short line), the activity state in plain words,
 * and the beat to react to. With talk switched off, or when the model fails, CANNED lines are used so the game
 * is never silent by accident. See docs/ACTIVITIES-PLAN.md section 3.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/** Used when the caller does not pass spoken-line.js's DIALOGUE_RULE (that file needs the browser). */
const DEFAULT_RULE = 'Reply with ONLY the words you say out loud: one or two short sentences of plain speech. No narration, no actions, no asterisks, no parentheses, no quotation marks. Never mention numbers or game terms.';

/** The moments the partner may speak at. */
export const BEATS = Object.freeze(['start', 'curse', 'halfway', 'end', 'chat', 'moment']);

/** Beats that are never held back by the cooldown: the opening, the ending and a reply to what the player typed. */
export const FREE_BEATS = Object.freeze(['start', 'end', 'chat']);

/** Whether a beat has a built-in line to fall back on. A 'moment' (something that just happened) has none: it is spoken by the model or not at all. */
export const hasBuiltIn = (beat) => beat !== 'moment';

/** Whether enough time has passed since the last one. No limit (0 or less) or nothing before it always passes. */
export function cooldownOk(lastAt, now, seconds) {
    const gap = Number(seconds);
    if (!(gap > 0) || !(Number(lastAt) > 0)) return true;
    return Number(now) - Number(lastAt) >= gap * 1000;
}

/**
 * What to do about one line of table talk: ask the model ('model'), use a built-in line ('canned'), or say nothing ('skip').
 * Nobody sees the panel with the table talk off, so nothing is asked. The cooldown holds back every beat except the free ones. With the
 * partner's talk off a beat uses its built-in line when the setting allows it, and a moment has none.
 */
export function talkDecision({ beat, talkOn = true, showTalk = true, cannedLines = true, cooldownSec = 0, lastAskAt = 0, now = Date.now() }) {
    if (!showTalk) return 'skip';
    if (!FREE_BEATS.includes(beat) && !cooldownOk(lastAskAt, now, cooldownSec)) return 'skip';
    if (!talkOn) return cannedLines && hasBuiltIn(beat) ? 'canned' : 'skip';
    return 'model';
}

const REACTIONS = Object.freeze({
    start: 'The activity is just beginning. Say something short to start it.',
    curse: 'A cursed rune just turned up and the tiles were shuffled. React to the setback.',
    halfway: 'You are about halfway through. Say something about how it is going.',
    end: 'It is over. React to how it went.',
    chat: 'Answer what was just said.',
    moment: 'Something just happened. React to it briefly, in a line.',
});

/**
 * A few plain lines to use when there is no model reply. Keyed by beat, then by outcome for the end.
 * Neutral on purpose: they must read right for any character.
 */
export const CANNED = Object.freeze({
    start: ['Shall we begin?', 'Let us see how this goes.', 'Ready when you are.'],
    curse: ['Hm, that did not go as planned.', 'Everything moved. Keep calm.', 'A trap. Start again from what you remember.'],
    halfway: ['We are getting there.', 'Keep your focus.', 'Slow and steady.'],
    end: {
        perfect: ['Flawless. I could not have done better.', 'Well done, truly.'],
        good: ['That went well.', 'Good work today.'],
        fair: ['We got some of it. Not bad.', 'A fair effort. Again another day.'],
        poor: ['That was a hard one. We will do better.', 'It slipped away from us.'],
    },
    chat: ['Hm.', 'Is that so?', 'I see.'],
});

/** A canned line, chosen by the injected rng. Always returns text. */
export function cannedLine(beat, outcome = '', rng = Math.random) {
    const pool = beat === 'end' ? (CANNED.end[outcome] || CANNED.end.fair) : (CANNED[beat] || CANNED.chat);
    return pool[Math.floor(rng() * pool.length) % pool.length];
}

const clip = (s, n) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);

/**
 * The request for one line.
 * @param {{
 *   partner: string, user: string, activity: string, beat: string, stateText?: string, playerText?: string, event?: string, rule?: string,
 *   story?: string, blocks?: string[], rivalry?: string, likes?: string, talkSoFar?: {who:string,text:string}[], language?: string
 * }} a
 * @returns {{ system: string, user: string }}
 */
export function buildTalkRequest(a) {
    const beat = BEATS.includes(a.beat) ? a.beat : 'chat';
    const sections = [
        `You are the character "${a.partner}", spending time with ${a.user}: ${a.activity}.`,
        a.story ? `Story context:\n${clip(a.story, 4000)}` : '',
        ...(a.blocks || []).map(b => clip(b, 1500)).filter(Boolean),
        a.rivalry ? clip(a.rivalry, 800) : '',
        a.likes ? `About you: ${clip(a.likes, 400)}` : '',
        a.stateText ? `How it stands: ${clip(a.stateText, 300)}.` : '',
        (a.talkSoFar || []).length ? `What was said so far:\n${a.talkSoFar.slice(-6).map(l => `${l.who}: ${clip(l.text, 200)}`).join('\n')}` : '',
        `Task: ${REACTIONS[beat]}${beat === 'moment' && a.event ? `\nWhat happened: ${clip(a.event, 200)}.` : ''}${a.playerText ? `\n${a.user} said: ${clip(a.playerText, 300)}` : ''}`,
        `Rules:\n1. Speak as "${a.partner}"${a.language ? `, in ${a.language}` : ''}, in character.\n2. Very short (1-2 sentences).\n3. ${a.rule || DEFAULT_RULE}`,
    ];
    return { system: sections.filter(Boolean).join('\n\n'), user: beat === 'chat' && a.playerText ? clip(a.playerText, 300) : `(${beat})` };
}
