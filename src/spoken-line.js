import { getSettings } from './settings.js';
import { speakNamed } from './tts.js';
import { toneTable } from './alltalk.js';
import { engineReadsAudioTags } from './tts-engines.js';
import { allowedTones, splitLeadingTone, toneRule, rememberTone, takeTone, toneFromCaption, phoneToneRule } from './tone-line.js';

/**
 * Lines a character says out loud during a fight, a game or an activity (fork).
 *
 * One definition for all of them, so they behave the same: the model is told to give speech only,
 * whatever it returns is stripped back to speech, and the line is read aloud in that
 * character's voice when auto-speak is on.
 *
 * Delivery tags: with ElevenLabs audio tags on (and voices on), the model may also start a line with ONE
 * delivery tag from the owner's own tone list, such as "[softly] That was close." The tag never stays in
 * the text (so it is not shown or logged); it is remembered and used as the way the line is spoken. With any
 * other engine, or tags off, nothing changes: the rule is not mentioned and a bracket is removed as before.
 * The rules are in tone-line.js.
 */

/** Whether delivery tags apply right now: voices on, tags on, and an ElevenLabs model that reads them. */
function tonesOn() {
    try {
        const s = getSettings();
        return Boolean(s.ttsEnabled && s.ttsToneTags !== false && engineReadsAudioTags(s));
    } catch {
        return false;
    }
}

/** The delivery tags the owner has set up, as plain names. */
export const allowedToneNames = () => allowedTones(toneTable());

/** For the Phone: the sentence that tells the model it may pick a tone from the list for a voice message, or '' when tags do not apply. */
export function phoneToneRuleText() {
    return tonesOn() ? phoneToneRule(allowedToneNames()) : '';
}

/** For the Phone: the delivery tag a voice message's tone caption means, or '' (none, or tags do not apply). */
export function toneForCaption(caption) {
    return tonesOn() ? toneFromCaption(caption, allowedToneNames()) : '';
}

const BASE_RULE = 'Reply with ONLY the words you say out loud: one or two short sentences of plain speech. '
    + 'No narration, no actions, no stage directions, no asterisks, no parentheses, no quotation marks, no description. '
    + 'Never mention numbers, percentages or game terms.';

/**
 * Appended to the prompt wherever a character is asked for a line. It reads as a string wherever it is joined into a prompt, and is
 * worked out when it is read, so it follows the voice settings at that moment (the delivery tag sentence is added only when it applies).
 */
export const DIALOGUE_RULE = Object.freeze({
    toString() {
        const extra = tonesOn() ? toneRule(allowedTones(toneTable())) : '';
        return extra ? `${BASE_RULE} ${extra}` : BASE_RULE;
    },
});

const escapeName = (name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only what is said aloud: no *actions*, (asides), [directions], quotes or a leading name. A leading delivery tag is kept aside for the voice. */
export function dialogueOnly(text, name) {
    let source = String(text || '');
    let tone = '';
    if (tonesOn()) {
        // The tag may follow the speaker's name ("Ada: [softly] ...") or open the line.
        const bare = source.replace(new RegExp(`^\\s*${escapeName(name)}\\s*:\\s*`, 'i'), '');
        const split = splitLeadingTone(bare, allowedTones(toneTable()));
        if (split.tone) { source = split.text; tone = split.tone; }
    }
    let t = source
        .replace(/\*[^*]*\*/g, ' ')
        .replace(/_[^_]*_/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    t = t.replace(new RegExp(`^${escapeName(name)}\\s*:\\s*`, 'i'), '');
    t = t.replace(/^["“«]+|["”»]+$/g, '').trim();
    const line = t.slice(0, 300);
    if (tone && line) rememberTone(name, line, tone);
    return line;
}

/**
 * Reads a spoken line aloud when auto-speak is on. Never blocks, never throws. `save: false` plays it without keeping the audio.
 * The delivery tag the line came with (see dialogueOnly) is used as its tone unless `tone` is given.
 */
export function speakLine(name, text, { save = true, tone } = {}) {
    try {
        // Taken even when nothing is spoken, so an unspoken line does not leave its tone behind.
        const remembered = takeTone(name, text);
        if (!getSettings().ttsEnabled || getSettings().ttsSpeakModules === false || !text) return;
        Promise.resolve(speakNamed(name, text, { save, tone: tone ?? remembered })).catch(() => {});
    } catch { /* speech is optional */ }
}
