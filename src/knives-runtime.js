import { getSettings, saveSettings } from './settings.js';
import { sceneNames } from './scene-cast.js';
import { requestOnConnection } from './connections.js';
import { profileText } from './profile-text.js';
import {
    pickKnife, buildKnifeReport, setKnifeUsed, buildKnivesRequest, parseKnifeList, KNIVES_SYSTEM,
} from './knives-core.js';

/**
 * Knives, the SillyTavern side (fork): drawing one for the story and asking the model for suggestions. The
 * rules and wording are in knives-core.js; the trigger options (mode, chance, cooldown, placement) are the shared
 * result injection of result-runtime.js, id 'knives'.
 */

/** One knife that could go to the story now (a random character in the scene, a random unused knife), not yet spent. */
export function drawKnife(rng = Math.random) {
    const hit = pickKnife(getSettings().characters || [], sceneNames(), rng);
    if (!hit) return null;
    return { ...hit, report: buildKnifeReport(hit.name, hit.knife) };
}

/** Marks the drawn knife used (it has gone to the story). */
export function spendKnife(drawn) {
    const char = (getSettings().characters || []).find(c => c.id === drawn?.charId && c.name === drawn.name)
        || (getSettings().characters || []).find(c => c.name === drawn?.name);
    if (!char) return;
    char.knives = setKnifeUsed(char.knives, drawn.knife.id, true);
    saveSettings();
}

/**
 * Asks the model for knives for one character. Returns the texts only; the caller adds them for review.
 * @param {object} char
 * @param {{ theme?: string, count?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function suggestKnives(char, { theme = '', count = 5 } = {}) {
    const settings = getSettings();
    const { system, user } = buildKnivesRequest({
        name: char.name,
        theme,
        count,
        profile: profileText(char),
        existing: (char.knives || []).map(k => k.text),
        system: settings.knivesPrompt || KNIVES_SYSTEM,
    });
    const raw = await requestOnConnection('knivesProfileId', system, user, 1500);
    return parseKnifeList(raw, count);
}
