import { getSettings, saveSettings } from './settings.js';
import { TRACKER_THEMES, THEMED_TRACKERS, THEME_PLAIN, THEME_FONTS_URL, applyThemeRegexes, internalStatesTemplate } from './tracker-themes.js';

/**
 * Which look each tracker uses, kept in the settings as { states, bonds, vitals, inventory }.
 *
 * Choosing a look in one tracker's menu chooses it for all of them, so the blocks under a reply
 * always match; each can be changed back on its own afterwards.
 */

export function getTrackerTheme(tracker) {
    const stored = getSettings().trackerThemes?.[tracker];
    return Object.prototype.hasOwnProperty.call(TRACKER_THEMES, stored) ? stored : THEME_PLAIN;
}

/** Sets the look for every tracker. */
export function setAllTrackerThemes(theme) {
    const settings = getSettings();
    const pick = Object.prototype.hasOwnProperty.call(TRACKER_THEMES, theme) ? theme : THEME_PLAIN;
    settings.trackerThemes = Object.fromEntries(THEMED_TRACKERS.map(t => [t, pick]));
    saveSettings();
    if (pick !== THEME_PLAIN) ensureThemeFonts();
}

let fontsAdded = false;
/** The looks use Anton, Crimson Pro, Inter and JetBrains Mono; they fall back to system fonts without them. */
export function ensureThemeFonts() {
    if (fontsAdded || typeof document === 'undefined') return;
    fontsAdded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = THEME_FONTS_URL;
    document.head.append(link);
}

/**
 * Dresses a tracker block in its chosen look. `fallback` handles the plain look (SillyTavern's own
 * regexes), so a person who never picks one sees exactly what they saw before.
 *
 * @param {string} html
 * @param {'bonds'|'vitals'|'inventory'} tracker
 * @param {(html: string) => string} fallback
 */
export function dressWithTheme(html, tracker, fallback) {
    const theme = getTrackerTheme(tracker);
    if (theme === THEME_PLAIN) return fallback(html);
    ensureThemeFonts();
    return applyThemeRegexes(html, tracker, theme);
}


