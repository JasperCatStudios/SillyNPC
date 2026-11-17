import { getSettings, saveSettings } from './settings.js';
import { normalizeLeveling } from './combat-level.js';

/**
 * The leveling rules in the settings (fork): XP for the first level, how much more each later level takes, XP per
 * enemy in a fight, and the highest level. The numbers and how they combine are in combat-level.js; this only keeps
 * them in the saved settings.
 */

/** The saved leveling rules, repaired in place so the object a screen holds is the saved one. */
export function levelingSettings() {
    const settings = getSettings();
    if (!settings.leveling || typeof settings.leveling !== 'object' || Array.isArray(settings.leveling)) settings.leveling = {};
    Object.assign(settings.leveling, normalizeLeveling(settings.leveling));
    return settings.leveling;
}

export function saveLevelingSettings() {
    levelingSettings();
    saveSettings();
}
