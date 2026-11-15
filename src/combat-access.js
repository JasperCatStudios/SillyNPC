import { getSettings, saveSettings } from './settings.js';
import { getType, listTypes, normalizeCombatPrefs, validateType } from './combat-types.js';
import { normalizeOverlay, mergeAbilities, saveInOverlay, removeFromOverlay, resetInOverlay } from './combat-ability-overlay.js';

/**
 * The combat module's view of the shared settings (fork).
 *
 * Preferences follow each System; the library of custom types is global. This is the only
 * combat file that touches settings, so the rest can be tested without them.
 */

export function combatPrefs() {
    const settings = getSettings();
    settings.combat = normalizeCombatPrefs(settings.combat);
    return settings.combat;
}

export function combatLibrary() {
    const settings = getSettings();
    if (!settings.combatTypes || typeof settings.combatTypes !== 'object') settings.combatTypes = {};
    return settings.combatTypes;
}

/** Your abilities and edits, per type id. */
function abilityStore() {
    const settings = getSettings();
    if (!settings.combatAbilities || typeof settings.combatAbilities !== 'object') settings.combatAbilities = {};
    return settings.combatAbilities;
}

/** The overlay for one world type. */
export function userOverlay(typeId) {
    return normalizeOverlay(abilityStore()[typeId]);
}

/** The abilities the type itself came with, before any of your changes. */
export function baseAbilities(typeId) {
    return getType(combatLibrary(), typeId)?.abilities || [];
}

/** A type with your abilities and edits applied. The same object when you have made none. */
export function withUserAbilities(type) {
    if (!type) return type;
    const ov = userOverlay(type.id);
    if (!ov.added.length && !Object.keys(ov.edited).length && !ov.removed.length) return type;
    return { ...type, abilities: mergeAbilities(type.abilities || [], ov) };
}

export function saveUserAbility(typeId, ability) {
    abilityStore()[typeId] = saveInOverlay(baseAbilities(typeId), userOverlay(typeId), ability);
    saveSettings();
}

export function deleteUserAbility(typeId, id) {
    abilityStore()[typeId] = removeFromOverlay(baseAbilities(typeId), userOverlay(typeId), id);
    saveSettings();
}

export function resetUserAbility(typeId, id) {
    abilityStore()[typeId] = resetInOverlay(userOverlay(typeId), id);
    saveSettings();
}

/** Every type, with its validation result: [{ type, errors, warnings }]. */
export function allTypes() {
    return listTypes(combatLibrary()).map(raw => {
        const type = withUserAbilities(raw);
        return { type, ...validateType(type) };
    });
}

/** The type picked for this System, or null if none is picked, it is gone, or it is invalid. */
export function activeCombatType() {
    const id = combatPrefs().activeType;
    if (!id) return null;
    const type = withUserAbilities(getType(combatLibrary(), id));
    if (!type || validateType(type).errors.length) return null;
    return type;
}

export function setActiveCombatType(id) {
    combatPrefs().activeType = String(id || '');
    saveSettings();
}

export function setCombatEnabled(on) {
    combatPrefs().enabled = Boolean(on);
    saveSettings();
}

/**
 * Persona characters (fork). A character is a persona if it was marked so in its profile, or,
 * when never marked either way, if it sits in the "OC" category. A persona whose name matches
 * the active persona IS the player in combat, so the two share one set of stats.
 */
export function isPersonaChar(char) {
    if (!char || char.isPlayer) return false;
    if (typeof char.isPersona === 'boolean') return char.isPersona;
    return String(char.category || '').trim().toLowerCase() === 'oc';
}

export function setPersonaChar(char, on) {
    char.isPersona = Boolean(on);
    saveSettings();
}

/** The persona character that stands in for the player called `name`, or null. */
export function personaRecordFor(name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    return (getSettings().characters || []).find(c => c?.name && isPersonaChar(c)
        && String(c.name).trim().toLowerCase() === want) || null;
}

/** Roster flags: disabled characters are not offered as opponents; hidden ones are not listed. */
export const isCombatDisabled = (char) => Boolean(char?.combatDisabled);
export const isCombatHidden = (char) => Boolean(char?.combatHidden);
