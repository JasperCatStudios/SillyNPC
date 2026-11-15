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
    if (names.length === 1) {
        return `Reply as ${names[0]} only, with one or two short lines written as "${names[0]}: what they say". `
            + `Write nothing for anyone else (not ${speaker}, not anyone else at the table), even if they would normally join in.`;
    }
    return `Several people are being spoken to at once: ${names.join(', ')}. `
        + 'Reply with one short line for each person who would actually say something, each on its own line written exactly as '
        + '"Name: what they say". Leave out anyone with nothing to say, and never write a line for '
        + `${speaker}. Each person answers only for themselves and does not repeat what another just said.`;
}

const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits a reply into { who, text } lines. Only the people asked count; the first line for a person
 * is kept. Names are matched ignoring case, asterisks and quotes, and a first name stands for a full
 * name when it is unambiguous.
 *
 * `also` names everyone else who could be mistaken for a speaker (the other people at the table,
 * the player). A line they "speak" is thrown away instead of being glued onto the line before it,
 * which is what happened when a model wrote "Felix: ... Sylvain: ..." for a message meant only for
 * Felix. A speaker's tag in the middle of a line starts a new line too.
 *
 * @param {string} raw
 * @param {string[]} names who may speak
 * @param {{ also?: string[] }} [opts]
 */
export function parseGroupReply(raw, names, { also = [] } = {}) {
    const allowed = new Map();
    const known = new Map();
    const add = (map, list) => {
        const firsts = list.map(n => clean(n).split(' ')[0].toLowerCase());
        list.forEach((n, i) => {
            map.set(key(n), n);
            const first = firsts[i];
            if (first && first !== key(n) && firsts.filter(f => f === first).length === 1) map.set(first, n);
        });
    };
    add(allowed, names || []);
    // everyone who might write a tag: the allowed first, so a name in both counts as allowed
    add(known, [...(also || []).filter(n => !allowed.has(key(n)))]);
    const tags = [...new Set([...allowed.keys(), ...known.keys()])].filter(Boolean).sort((a, b) => b.length - a.length);
    const inline = tags.length
        // a new speaker starts after the end of a sentence (or a closing quote or bracket), not after a comma
        ? new RegExp(`(?<=[.!?…"”'’)\\]])\\s+(?=(?:\\*\\*|__)?\\s*(?:${tags.map(escapeRe).join('|')})\\s*(?:\\*\\*|__)?\\s*:)`, 'iu')
        : null;
    const out = [];
    let current = null;
    for (const rawLine of String(raw ?? '').split(/\r?\n/)) {
        const segments = inline ? rawLine.split(inline) : [rawLine];
        for (const line of segments) {
            // groups: 1 opening bold of the name, 2 the name, 3 closing bold before the colon, 4 closing bold after it ("**Name:** text"), 5 the words
            const m = /^\s*(?:[-•]\s*|\*\s+)?(\*\*|__)?\s*([^:\n]{1,60}?)\s*(\*\*|__)?\s*:\s*(\*\*|__)?\s*(.*)$/.exec(line);
            const label = m ? key(m[2]) : '';
            if (m && allowed.has(label)) {
                const who = allowed.get(label);
                // a bold after the colon closes the name's bold when the name opened one; otherwise it is the words' own
                const words = (m[4] && !m[1] && !m[3] ? m[4] : '') + m[5];
                if (out.some(x => x.who === who)) current = { skip: true };
                else { current = { who, text: words.trim() }; out.push(current); }
                continue;
            }
            if (m && known.has(label)) { current = { skip: true }; continue; }
            // not a name tag at all: the bold of the previous line's words may start here, so keep the line as it was
            if (current && !current.skip && line.trim()) current.text = `${current.text} ${line.trim()}`.trim();
        }
    }
    return out.filter(x => x.text);
}
