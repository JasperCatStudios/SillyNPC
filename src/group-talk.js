/**
 * Talking to several people with ONE model call (fork), the way the phone's group thread does it.
 *
 * Asking each person separately costs a request apiece (and sends the whole scene each time). Here
 * a single request is told who is in the group and answers as "Name: line" lines, which are split
 * back out per person. Used by the combat window's "Talk to everyone / a team".
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase().replace(/^[*_"'`\s]+|[*_"'`\s]+$/g, '');

/** The part of the prompt that tells the model it is voicing a group and how to answer. */
export function groupInstruction(names, speaker = 'the player') {
    return `Several people are being spoken to at once: ${names.join(', ')}. `
        + 'Reply with one short line for each person who would actually say something, each on its own line written exactly as '
        + '"Name: what they say". Leave out anyone with nothing to say, and never write a line for '
        + `${speaker}. Each person answers only for themselves and does not repeat what another just said.`;
}

/**
 * Splits a reply into { who, text } lines. Only the people asked count; the first line for a person
 * is kept (a line that does not start with a name continues the one before it). Names are matched
 * ignoring case, asterisks and quotes. Empty when nothing could be read.
 * @param {string} raw
 * @param {string[]} names
 */
export function parseGroupReply(raw, names) {
    const wanted = new Map((names || []).map(n => [key(n), n]));
    const out = [];
    let current = null;
    for (const line of String(raw ?? '').split(/\r?\n/)) {
        const m = /^\s*(?:[-•*]\s*)?(?:\*\*|__)?\s*([^:\n]{1,60}?)\s*(?:\*\*|__)?\s*:\s*(.*)$/.exec(line);
        const who = m ? wanted.get(key(m[1])) : null;
        if (who) {
            current = out.find(x => x.who === who) ? { who, text: '', skip: true } : { who, text: m[2].trim() };
            if (!current.skip) out.push(current);
            continue;
        }
        if (current && !current.skip && line.trim()) current.text = `${current.text} ${line.trim()}`.trim();
    }
    return out.filter(x => x.text);
}
