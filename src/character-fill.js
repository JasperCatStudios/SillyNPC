import { loadWorldInfo } from '../../../../world-info.js';
import { getSettings, saveSettings } from './settings.js';
import { debugLog } from './constants.js';
import { describeTrackedFacts, buildLoreExcerpt, createLoreEntry, generateLoreContent, saveLoreContent } from './api.js';
import { tryAutoSyncLorebook, getChatLorebookName } from './lorebook.js';

/**
 * Filling in a character card that was created from a chat, or by hand, and is empty.
 *
 * Three things make a card useful, in this order, because each one feeds the next: a lore
 * entry describing who they are, the tracker fields that put them in the system, and a
 * portrait. Doing them one at a time meant three separate trips through three different
 * panels, and a character mentioned once in the story usually got none of them.
 */

/**
 * What this card is missing, and what filling it would do.
 *
 * Read before anything is sent, so the plan shown to the user is the plan that runs. A
 * stage already done is reported as done rather than quietly skipped, because "nothing
 * happened" and "there was nothing to do" look the same from outside.
 *
 * `checked` is what the plan ticks by default, and it is not simply the opposite of
 * `done`: belongings are offered on a character who already carries things, but not
 * ticked, because adding to a list somebody curated by hand is not what they asked for
 * when they pressed a button about empty fields.
 *
 * @param {object} char
 * @returns {{ lore: object, data: object, belongings: object, image: object, anything: boolean }}
 */
export function auditCharacter(char) {
    const lore = char?.lorebook
        ? { done: true, summary: 'Already linked to a lorebook entry.' }
        : { done: false, summary: 'No lorebook entry. Will look for one, and write it if there is none.' };

    const image = char?.imageUrl
        ? { done: true, summary: 'Already has a portrait.' }
        : { done: false, summary: 'No portrait. Will draw one.' };

    const wanted = (stage) => stage.checked ?? !stage.done;
    return {
        lore, image,
        anything: wanted(lore) || wanted(image),
    };
}

/** The linked entry's text, or an empty string. Read fresh: it may have just been written. */
export async function readLoreEntry(char) {
    if (!char?.lorebook?.world) return '';
    try {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData?.entries;
        const entry = Array.isArray(entries)
            ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid))
            : entries?.[char.lorebook.uid];
        return entry?.content || '';
    } catch (err) {
        debugLog('Could not read the linked lore entry', err);
        return '';
    }
}

/**
 * Gives the card a lore entry: the one that already exists, or a new one.
 *
 * Linking beats writing. A character named in a lorebook the user has curated by hand is
 * better described there than by anything generated, and writing a second entry for the
 * same person is how a lorebook fills up with duplicates.
 *
 * @returns {Promise<{ ok: boolean, action: string, reason?: string }>}
 */
export async function fillLore(char) {
    if (char.lorebook) return { ok: true, action: 'already linked' };

    if (await tryAutoSyncLorebook(char, { silent: true })) {
        return { ok: true, action: 'linked an existing entry' };
    }

    const world = getSettings().defaultLorebook || getChatLorebookName();
    if (!world) {
        return {
            ok: false, action: 'none',
            reason: 'No lorebook to write into. Choose a Default Target Lorebook in Generation, '
                + 'or open a chat that has one.',
        };
    }

    /* No test on whether there is anything to write from.

       An entry is worth having for a character who has not appeared yet - that is most of
       what somebody is doing when they make a card in advance - and the lore writer reads
       the Data Bank and its own configurable slice of the chat, which is a different and
       larger question than "is this name in the last fifteen messages". */
    const { uid } = await createLoreEntry(char, world, char.name);
    const { content, tags } = await generateLoreContent(char, world, uid);
    if (!String(content || '').trim()) {
        return { ok: false, action: 'none', reason: 'The lore writer returned nothing usable.' };
    }

    await saveLoreContent(char, world, uid, tags, content);
    return { ok: true, action: `wrote a new entry in "${world}"` };
}
