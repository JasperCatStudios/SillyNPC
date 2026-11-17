/**
 * The Eleven v4 emotion audio tags (fork), as ElevenLabs lists them on its Audio Tags page: 29 emotions in five
 * groups. Each one is a delivery tag Worldkit can add to the tag list (the tag the story model writes is the same
 * word, and it is also the word sent to the voice), with a short meaning for the story model.
 *
 * They are not in the starting list on purpose: every tag in the list is described to the story model on every
 * message, so the extras are added by a button in Appearance, Tonal Typography when you want them. Pure data.
 *
 * (ElevenLabs' own emotion wheel shows 48 slots, but they repeat six emotions; the page lists these 29.)
 */

export const ELEVEN_EMOTION_GROUPS = Object.freeze([
    ['High energy', [
        ['excited', 'excited', 'eager, thrilled, fast and bright'],
        ['playful', 'playful', 'teasing, light, mischievous'],
        ['amazed', 'amazed', 'astonished, wide-eyed, impressed'],
        ['powerful', 'powerful', 'strong, commanding, full of force'],
        ['proud', 'proud', 'satisfied, standing tall, pleased with something'],
        ['optimistic', 'optimistic', 'hopeful, upbeat, sure it will work out'],
        ['startled', 'startled', 'caught off guard, a sudden jolt of surprise'],
    ]],
    ['Heated', [
        ['mad', 'mad', 'angry, sharp, barely held in'],
        ['aggressive', 'aggressive', 'hostile, pushing, ready for a fight'],
        ['bitter', 'bitter', 'resentful, sour, an old grudge'],
        ['critical', 'critical', 'judging, fault-finding, cold disapproval'],
        ['repelled', 'repelled', 'disgusted, recoiling, wanting away'],
    ]],
    ['Tense', [
        ['anxious', 'anxious', 'worried, unsteady, hesitant'],
        ['stressed', 'stressed', 'overloaded, strained, short of patience'],
        ['scared', 'scared', 'frightened, shaky, small'],
        ['threatened', 'threatened', 'cornered, defensive, sensing danger'],
        ['vulnerable', 'vulnerable', 'exposed, open, easily hurt'],
        ['confused', 'confused', 'lost, puzzled, not following'],
        ['busy', 'busy', 'distracted, hurried, no time to talk'],
    ]],
    ['Low energy', [
        ['tired', 'tired', 'worn out, slow, flat'],
        ['bored', 'bored', 'uninterested, flat, waiting for it to end'],
        ['distant', 'distant', 'withdrawn, far away, not really present'],
        ['despair', 'despair', 'hopeless, crushed, nothing left'],
        ['letdown', 'let down', 'disappointed, deflated, expected better'],
    ]],
    ['Calm and reflective', [
        ['peaceful', 'peaceful', 'serene, at ease, unhurried'],
        ['content', 'content', 'quietly satisfied, settled'],
        ['curious', 'curious', 'questioning, interested, leaning in'],
        ['thoughtful', 'thoughtful', 'considering, slow, weighing the words'],
        ['trusting', 'trusting', 'open, sincere, relying on the listener'],
    ]],
]);

/** Every emotion as { group, name, word, meaning }. */
export const ELEVEN_EMOTIONS = Object.freeze(ELEVEN_EMOTION_GROUPS.flatMap(([group, list]) => list.map(([name, word, meaning]) => Object.freeze({ group, name, word, meaning }))));

/** The emotions whose tag name is not in the table yet. */
export function missingEmotions(table) {
    const have = new Set(Object.keys(table && typeof table === 'object' ? table : {}));
    return ELEVEN_EMOTIONS.filter(e => !have.has(e.name));
}

/** Adds the missing emotions to a tag table and to the meanings; returns the new copies and how many were added. */
export function withEmotions(table, meanings) {
    const nextTable = { ...(table || {}) };
    const nextMeanings = { ...(meanings || {}) };
    let added = 0;
    for (const e of missingEmotions(nextTable)) {
        nextTable[e.name] = e.word;
        if (!String(nextMeanings[e.name] ?? '').trim()) nextMeanings[e.name] = e.meaning;
        added++;
    }
    return { table: nextTable, meanings: nextMeanings, added };
}
