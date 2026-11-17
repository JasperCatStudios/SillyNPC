import { getSettings, saveSettings } from './settings.js';
import { getContext } from '../../../../st-context.js';

/**
 * Which connection answers which request.
 *
 * Shared rather than owned by a tab: every picker is the same control over a different
 * top-level setting, named by its key.
 */

/** The profile currently chosen for one setting. */
export function readProfileSetting(key) {
    return getSettings()[key] || '';
}

/** Records the profile chosen for one setting, and only that one. */
export function writeProfileSetting(key, value) {
    getSettings()[key] = value;
    saveSettings();
}

/**
 * A "which connection runs this" dropdown.
 *
 * @param {Function} onChange
 * @param {{ key?: string, labelText?: string,
 *           fallbackLabel?: string, noteText?: string, unavailableText?: string }} options
 */
export function buildConnectionProfilePicker(onChange, options = {}) {
    const {
        key = 'imageProfileId',
        labelText = 'Connection',
        fallbackLabel = 'Main API (same as chat)',
        noteText = 'Which connection runs this. A small fast model is usually '
            + 'enough, and keeps this off the budget of your main model.',
        unavailableText = 'Connection Manager is not available, so the main API is used. '
            + 'Enable the Connection Manager extension to run this on a '
            + 'separate, cheaper model.',
    } = options;

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = labelText;

    const note = document.createElement('small');
    note.className = 'notes';
    note.style.cssText = 'margin-top:4px; display:block;';

    let profiles = null;
    try {
        profiles = getContext().ConnectionManagerRequestService.getSupportedProfiles();
    } catch (err) {
        debugLogSafe('Connection Manager unavailable for a connection picker', err);
    }

    if (!profiles) {
        note.textContent = unavailableText;
        row.append(label);
        wrap.append(row, note);
        return wrap;
    }

    const select = document.createElement('select');
    select.className = 'text_pole';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = fallbackLabel;
    select.append(none);
    for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name || profile.id;
        select.append(option);
    }
    select.value = readProfileSetting(key);
    select.addEventListener('change', () => {
        writeProfileSetting(key, select.value);
        onChange?.();
    });

    note.textContent = noteText;
    row.append(label, select);
    wrap.append(row, note);
    return wrap;
}

/** Console noise from an optional integration is not worth a hard failure. */
function debugLogSafe(message, err) {
    try { console.debug('[Worldkit]', message, err); } catch { /* ignore */ }
}
