import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { isPersonaChar } from './combat-access.js';
import { getPlayerCard } from './status-logic.js';
import { personaDuplicates, personaWarningText } from './persona-warning.js';

/**
 * The persona warning, drawn (fork). Shown at the top of every screen that lists scene members or characters (the
 * combat menu and pane, the games, the phone's roster) when one of your Worldkit character cards has your persona's
 * name but is not ticked as Persona. Nothing is shown when everything is marked right. The rules are in
 * persona-warning.js.
 */

/** The warning text for right now, or ''. */
export function currentPersonaWarning() {
    try {
        const names = [];
        const ctx = getContext();
        if (ctx?.name1) names.push(ctx.name1);
        // The player card (the persona as Worldkit holds it) can carry a different spelling.
        try { const card = getPlayerCard(); if (card?.name) names.push(card.name); } catch { /* no persona yet */ }
        return personaWarningText(personaDuplicates(getSettings().characters || [], names, isPersonaChar));
    } catch {
        return '';
    }
}

/** A small notice element, or null when there is nothing to warn about. */
export function buildPersonaWarning() {
    const text = currentPersonaWarning();
    if (!text) return null;
    const note = document.createElement('div');
    note.className = 'sillynpc-persona-warning notes';
    note.setAttribute('role', 'note');
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-triangle-exclamation';
    note.append(icon, document.createTextNode(` ${text}`));
    return note;
}
