import { getSettings, saveSettings } from './settings.js';
import { getRegexScripts, runRegexScript } from '../../../regex/engine.js';
import { TRACKER_THEMES, THEMED_TRACKERS, THEME_PLAIN, THEME_CUSTOM, THEME_FONTS_URL, CUSTOM_REGEX_PREFIX_DEFAULT, applyThemeRegexes, dressDefault, customScripts, applyCustomScripts } from './tracker-themes.js';

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
    if (pick !== THEME_PLAIN && pick !== THEME_CUSTOM) ensureThemeFonts();
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

/** The custom look's scripts, found in SillyTavern's regex list by the name prefix in the settings. */
export function customRegexScripts() {
    let all = [];
    try { all = getRegexScripts(); } catch { /* regex extension not available */ }
    return customScripts(all, getSettings().customRegexPrefix || CUSTOM_REGEX_PREFIX_DEFAULT);
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
    if (theme === THEME_PLAIN) return dressDefault(html, tracker, fallback);
    // Custom: only the person's own scripts. SillyTavern's regexes (the Freaky Frankenstein set) and the built-in default stay out of it.
    if (theme === THEME_CUSTOM) return applyCustomScripts(html, customRegexScripts(), runRegexScript);
    ensureThemeFonts();
    return applyThemeRegexes(html, tracker, theme);
}


