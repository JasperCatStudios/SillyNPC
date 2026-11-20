/**
 * Phones and tablets: timing games are played with a thumb, which is slower and less exact than a mouse,
 * so on a touch screen the "assist" help (wider zones, slower markers, a longer bite window) is always on.
 * Pure browser code, no SillyTavern imports.
 */

/** Whether the main pointer is a finger, or the screen is phone-sized. */
export function touchDevice() {
    try {
        if (window.matchMedia?.('(pointer: coarse)').matches) return true;
        return window.innerWidth <= 900;
    } catch {
        return false;
    }
}

/** The assist setting, switched on for touch screens. Pass the activity settings object (or anything with `assist`). */
export function assistOn(settings) {
    return Boolean(settings?.assist) || touchDevice();
}
