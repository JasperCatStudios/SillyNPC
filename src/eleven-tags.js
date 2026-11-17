import { ELEVEN_EMOTION_GROUPS } from './eleven-emotions.js';

/**
 * Every ElevenLabs audio tag Worldkit can add (fork), as one catalog of groups. Each group has a KIND:
 *   wrap   - written around the words it affects: [whisper]"I know."[/whisper]
 *   inline - stands alone, no closing tag, right before the words it affects: "Well. [pause] [sighs] Fine."
 *
 * Each entry is [name the story model writes, the ElevenLabs word the voice is sent, a meaning for the story model].
 * Names match /^[a-z][a-z0-9_-]{0,24}$/; the word may hold spaces (letdown -> "let down").
 *
 * None are in the starting list on purpose: every tag is described to the story model on every message, so they are
 * added by one button in Appearance, Tonal Typography. Sound-effect tags ([thunder rumbling], [footsteps]) are not here:
 * they belong to a separate sound module. Pure data and logic.
 */

const emotionGroups = ELEVEN_EMOTION_GROUPS.map(([group, list]) => [group, 'wrap', list]);

export const ELEVEN_TAG_GROUPS = Object.freeze([
    ...emotionGroups,
    ['Delivery and volume', 'wrap', [
        ['barelyaudible', 'barely audible', 'almost too quiet to hear, trailing off to nothing'],
        ['booming', 'booming', 'huge, resonant, filling the room'],
        ['disbelief', 'disbelief', 'unable to accept what was just said, stunned and questioning'],
    ]],
    ['Accents and characters', 'wrap', [
        ['british', 'British accent', 'spoken in a British accent'],
        ['french', 'French accent', 'spoken in a French accent'],
        ['australian', 'Australian accent', 'spoken in an Australian accent'],
        ['irish', 'Irish accent', 'spoken in an Irish accent'],
        ['pirate', 'pirate voice', 'spoken in a gruff, rolling pirate voice'],
    ]],
    ['More emotions', 'wrap', [
        ['frazzled', 'frazzled', 'rattled, scattered, frayed at the edges'],
        ['smug', 'smug', 'self-satisfied, pleased to be right'],
        ['puzzled', 'puzzled', 'trying to work something out, a frown in the voice'],
        ['intrigued', 'intrigued', 'interest caught, wanting to know more'],
        ['jittery', 'jittery', 'wired, restless, too much energy'],
        ['disgusted', 'disgusted', 'sickened, a curl of revulsion'],
        ['hopeful', 'hopeful', 'wanting it to be true, tentatively bright'],
        ['triumphant', 'triumphant', 'victorious, savouring a win'],
        ['mischievous', 'mischievous', 'up to something, sly and amused'],
    ]],
    ['Pacing', 'inline', [
        ['slowly', 'slowly', 'the words after it are said slowly and deliberately'],
        ['rushed', 'rushed', 'the words after it tumble out hurriedly'],
        ['pause', 'pause', 'a short beat of silence before the next words'],
        ['drawnout', 'drawn out', 'the next word is stretched long'],
        ['snappy', 'snappy', 'the words after it are quick and clipped'],
        ['speedy', 'speedy', 'the words after it are said fast'],
        ['longpause', 'long pause', 'a long, heavy silence before the next words'],
    ]],
    ['Reactions', 'inline', [
        ['laughs', 'laughs', 'a laugh sound at that point in the speech'],
        ['sighs', 'sighs', 'an audible sigh at that point in the speech'],
        ['gasps', 'gasps', 'a sharp intake of breath at that point'],
        ['clearthroat', 'clears throat', 'a throat-clearing sound at that point'],
        ['gulp', 'gulp', 'a nervous swallow at that point'],
    ]],
]);

/** Every tag as { group, kind, inline, name, word, meaning }. */
export const ELEVEN_TAGS = Object.freeze(ELEVEN_TAG_GROUPS.flatMap(([group, kind, list]) => list.map(([name, word, meaning]) => Object.freeze({
    group, kind, inline: kind === 'inline', name, word, meaning,
}))));

/** The tags whose name is not in the table yet. A name already there is never touched. */
export function missingTags(table) {
    const have = new Set(Object.keys(table && typeof table === 'object' ? table : {}));
    return ELEVEN_TAGS.filter(t => !have.has(t.name));
}

/**
 * Adds every missing tag: its table entry (name to ElevenLabs word), a meaning where there is none, and for a standalone
 * tag the inline flag in the kind overrides. Returns new copies and how many were added; the inputs are not changed.
 *
 * @param {Record<string,string>} table
 * @param {Record<string,string>} [meanings]
 * @param {Record<string,boolean>} [inline] settings.deliveryInline
 */
export function withAllTags(table, meanings, inline) {
    const nextTable = { ...(table || {}) };
    const nextMeanings = { ...(meanings || {}) };
    const nextInline = { ...(inline || {}) };
    let added = 0;
    for (const t of missingTags(nextTable)) {
        nextTable[t.name] = t.word;
        if (!String(nextMeanings[t.name] ?? '').trim()) nextMeanings[t.name] = t.meaning;
        if (t.inline) nextInline[t.name] = true;
        added++;
    }
    return { table: nextTable, meanings: nextMeanings, inline: nextInline, added };
}
