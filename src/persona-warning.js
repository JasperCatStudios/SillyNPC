/**
 * The "you forgot to mark your persona" check (fork). Pure, so node can test it.
 *
 * Your SillyTavern persona and a Worldkit character card can share a name. When that card is NOT ticked as
 * Persona (on its profile), Worldkit cannot tell the two are the same person, so the card is offered as a separate
 * character in the combat menu, the games, the phone and anywhere else scene members are listed: you appear twice.
 * Ticking Persona on that card makes it you, and the duplicate goes away.
 */

const fold = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The character cards that have a persona's name but are not marked as the persona.
 *
 * @param {{ name?: string }[]} characters every Worldkit character card
 * @param {string[]} personaNames the names the player goes by (SillyTavern's persona, the player card)
 * @param {(card: object) => boolean} isPersona whether a card is marked as a persona
 */
export function personaDuplicates(characters, personaNames, isPersona) {
    const names = new Set((personaNames || []).map(fold).filter(Boolean));
    if (!names.size) return [];
    return (characters || []).filter(c => c?.name && names.has(fold(c.name)) && !isPersona(c));
}

/** The warning's words, or '' when there is nothing to warn about. */
export function personaWarningText(duplicates) {
    const list = [...new Set((duplicates || []).map(c => String(c.name).trim()).filter(Boolean))];
    if (!list.length) return '';
    const quoted = list.map(n => `"${n}"`).join(', ');
    return `${quoted} ${list.length === 1 ? 'is' : 'are'} also your persona's name, but ${list.length === 1 ? 'that character is' : 'those characters are'} not marked as your persona, `
        + 'so you will appear twice (as yourself and as a separate character) wherever scene members are listed: combat, games, the phone and the scene. '
        + 'Open the card on the Characters tab and tick Persona. Once it is ticked there is no duplicate.';
}
