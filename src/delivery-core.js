import { DEFAULT_TONE_TAGS, cleanToneTable } from './tts-text.js';

/**
 * Delivery tags, the writing side (fork): what the story model is told, and the regex scripts that
 * turn the tags into something to style. Pure, so it can be tested without SillyTavern.
 *
 * The model writes [whisper]"I know."[/whisper]. The saved text keeps the tags. Two regex scripts
 * (SillyTavern's own, shown in its Regex list) do the rest:
 *   - the display script wraps the pair in <span class="wk-tone wk-tone-whisper" data-tone="whisper">,
 *     for display only. The look of each delivery is CSS, set in Appearance; the model is never asked
 *     for styling, and no colour or slant comes from here.
 *   - the saver script removes the tags from what is sent back to the model. It starts switched off.
 */

/** What each delivery means, in the words the story model is given. */
export const DELIVERY_MEANINGS = Object.freeze({
    whisper: 'quiet, intimate, secret or breathy',
    shout: 'loud, forceful, urgent or furious',
    sigh: 'weary, resigned, wistful or relieved',
    laugh: 'said while laughing, amused or giddy',
    cry: 'voice breaking, tearful or choked up',
    excited: 'eager, thrilled, fast and bright',
    playful: 'teasing, light, mischievous',
    curious: 'questioning, interested, leaning in',
    nervous: 'anxious, unsteady, hesitant',
    scared: 'frightened, shaky, small',
    angry: 'sharp, hard, barely held in',
    tired: 'worn out, slow, flat',
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tag names in force, longest first so one name never swallows another. */
export function deliveryNames(table) {
    const clean = cleanToneTable(table);
    const names = Object.keys(Object.keys(clean).length ? clean : DEFAULT_TONE_TAGS);
    return names.sort((a, b) => b.length - a.length);
}

/**
 * The instruction sent to the story model.
 *
 * @param {Record<string,string>} [table] Delivery tag to ElevenLabs word; only the names are used here.
 * @param {Record<string,string>} [meanings] The owner's own wording per tag; the built-in one is used where there is none.
 * @returns {string}
 */
export function buildDeliveryPrompt(table, meanings) {
    const names = deliveryNames(table);
    const own = meanings && typeof meanings === 'object' ? meanings : {};
    const said = (n) => String(own[n] ?? '').replace(/\s+/g, ' ').trim() || DELIVERY_MEANINGS[n] || n;
    const lines = names.map(n => `  ${n}: ${said(n)}`);
    return [
        '### DELIVERY TAGS',
        '- When a line of speech is delivered in a clearly different way from normal talking, wrap its quoted words in a delivery tag:',
        `  [${names[0] || 'whisper'}]"I know."[/${names[0] || 'whisper'}]`,
        '- Available tags:',
        ...lines,
        '- Use only these tags, one per line of speech. Ordinary speech needs no tag, but never skip one when a line is clearly whispered, shouted, laughed, cried or otherwise marked; if the scene or the line calls for it, tag it.',
        '- The tag goes around the quoted words of one speaker, inside that speaker\'s own paragraph. Never wrap narration, actions or several speakers.',
        '- Tags are plain text. Do not describe sounds or delivery in the tag, and never use colour, bold or italics to show delivery.',
    ].join('\n');
}

export const DELIVERY_SCRIPT_IDS = Object.freeze({
    display: '5b0e6d1c-6c2e-4a52-9d1e-77a1f0a0de11',
    saver: '5b0e6d1c-6c2e-4a52-9d1e-77a1f0a0de12',
});

/**
 * The two SillyTavern regex scripts for the current tag names.
 *
 * @param {Record<string,string>} [table]
 * @param {{ enabled?: boolean, saverOn?: boolean, saverDepth?: number }} [options]
 * @returns {object[]} Regex script objects in SillyTavern's own format.
 */
export function deliveryScripts(table, { enabled = true, saverOn = false, saverDepth = 2 } = {}) {
    const alt = deliveryNames(table).map(escapeRe).join('|');
    // An opening tag may carry extra words ([whisper, soft]); the closing tag must match the opening one.
    const open = `\\[(${alt})(?:\\s{0,3},[^\\]\\[]{0,40})?\\]`;
    return [
        {
            id: DELIVERY_SCRIPT_IDS.display,
            scriptName: 'Worldkit - Delivery Tags (display)',
            findRegex: `/${open}([\\s\\S]{1,2000}?)\\[\\/\\1\\]/gi`,
            replaceString: '<span class="wk-tone wk-tone-$1" data-tone="$1">$2</span>',
            trimStrings: [],
            placement: [2],
            disabled: !enabled,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
        },
        {
            id: DELIVERY_SCRIPT_IDS.saver,
            scriptName: 'Worldkit - Delivery Tags Context Saver',
            findRegex: `/\\[\\/?(?:${alt})(?:\\s{0,3},[^\\]\\[]{0,40})?\\]/gi`,
            replaceString: '',
            trimStrings: [],
            placement: [2],
            disabled: !(enabled && saverOn),
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: Math.max(0, Math.round(Number(saverDepth) || 0)),
            maxDepth: null,
        },
    ];
}
