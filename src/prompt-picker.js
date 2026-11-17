/**
 * The rules behind a prompt's template picker: Default, any extra templates, and your own.
 *
 * Pure, so it is tested in node. The control (ui-prompts.js) only reads and writes through it.
 *
 * What is stored for the prompt stays what it always was: empty means "send the built-in", so
 * a default that improves in a later version reaches everyone who never changed it. The box
 * shows the default text rather than staying blank, and your own text is kept aside, so
 * switching to a template and back loses nothing.
 */

export const MODE_DEFAULT = 'default';
export const MODE_CUSTOM = 'custom';

/** The choices in the dropdown, in order. */
export function modeChoices(presets = []) {
    return [
        { id: MODE_DEFAULT, label: 'Default' },
        ...presets.map(p => ({ id: p.id, label: p.label })),
        { id: MODE_CUSTOM, label: 'My own' },
    ];
}

const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * Which choice a prompt is on.
 *
 * A remembered choice wins when it is still a real one. Without one (a prompt saved before
 * there was a picker) it is worked out from the stored text: empty or equal to the default is
 * Default, equal to a template is that template, anything else is the person's own.
 */
export function currentMode({ stored, mode, defaultText, presets = [] }) {
    const ids = modeChoices(presets).map(c => c.id);
    if (mode && ids.includes(mode)) return mode;
    if (!String(stored ?? '').trim() || same(stored, defaultText)) return MODE_DEFAULT;
    const hit = presets.find(p => same(p.text, stored));
    return hit ? hit.id : MODE_CUSTOM;
}

/** The text the box shows for a choice. */
export function textForMode(mode, { stored, custom, defaultText, presets = [] }) {
    if (mode === MODE_DEFAULT) return defaultText ?? '';
    const hit = presets.find(p => p.id === mode);
    if (hit) return hit.text;
    return custom ?? stored ?? '';
}

/**
 * Switching to a choice. Returns what to store: the prompt text itself and the own-text kept
 * aside. `currentText` is what the box holds now, saved as the person's own when they were on
 * their own text.
 *
 * @param {{ storeDefault?: boolean }} [opts] A prompt that cannot be empty (the phone's) stores
 *   the default's full text instead of the empty marker.
 */
export function chooseMode(mode, { currentMode: from, currentText, custom, defaultText, presets = [] }, opts = {}) {
    const keptCustom = from === MODE_CUSTOM ? String(currentText ?? '') : (custom ?? '');
    const text = textForMode(mode, { custom: keptCustom, defaultText, presets });
    const stored = mode === MODE_DEFAULT && !opts.storeDefault ? '' : text;
    return { mode, stored, custom: keptCustom, text };
}

/**
 * Typing in the box. Anything typed is the person's own text from then on, whichever choice the
 * box was showing - an edited template is no longer the template.
 */
export function editText(text) {
    return { mode: MODE_CUSTOM, stored: String(text ?? ''), custom: String(text ?? '') };
}
