import { getSettings } from './settings.js';
import { speakNamed } from './tts.js';

/**
 * Lines a character says out loud during a fight or a game (fork).
 *
 * One definition for both, so they behave the same: the model is told to give speech only,
 * whatever it returns is stripped back to speech, and the line is read aloud in that
 * character's voice when auto-speak is on.
 */

/** Appended to the prompt wherever a character is asked for a line. */
export const DIALOGUE_RULE = 'Reply with ONLY the words you say out loud: one or two short sentences of plain speech. '
    + 'No narration, no actions, no stage directions, no asterisks, no parentheses, no quotation marks, no description. '
    + 'Never mention numbers, percentages or game terms.';

/** Only what is said aloud: no *actions*, (asides), [directions], quotes or a leading name. */
export function dialogueOnly(text, name) {
    let t = String(text || '')
        .replace(/\*[^*]*\*/g, ' ')
        .replace(/_[^_]*_/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    t = t.replace(new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    t = t.replace(/^["“«]+|["”»]+$/g, '').trim();
    return t.slice(0, 300);
}

/** Reads a spoken line aloud when auto-speak is on. Never blocks, never throws. */
export function speakLine(name, text) {
    try {
        if (!getSettings().ttsEnabled || !getSettings().ttsAutoSpeak || !text) return;
        Promise.resolve(speakNamed(name, text)).catch(() => {});
    } catch { /* speech is optional */ }
}
