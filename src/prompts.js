import { getSettings, defaultSettings } from './settings.js';
import { getMarkerPair } from './speaker-marker.js';
import { SYSTEM_PROMPT, buildDialogueFormatPrompt } from './constants.js';
import { TIME_PERIODS } from './phone-image-requests.js';
import { INTERNAL_STATES_SYSTEM } from './internal-states.js';
import { BOND_SYSTEM } from './bonds-core.js';
import { VITALS_SYSTEM } from './vitals-core.js';

/**
 * Every prompt the user can edit, in one list.
 *
 * The Prompts tab shows all of them together; each also stays where it has always been,
 * beside the settings it belongs with. Both render from this list rather than from two
 * copies of the same wording, so a help text corrected in one place is corrected in the
 * other - which is the failure a "just copy it over" mirror would have introduced on the
 * first edit.
 *
 * `available` decides whether an entry applies to the current setup at all: the negative
 * prompt is Stable Diffusion's, the reference instruction is Gemini's, and the system
 * rules only reach a model in inline mode. An entry that cannot be sent is not shown as
 * one that can.
 *
 * @type {Array<{
 *   id: string, key: string, label: string, help: string, home: string,
 *   recommended?: () => string, emptyNote?: string, available?: () => boolean,
 *   budget?: { key: string, label: string, help: string, kind: 'number'|'slider',
 *              min?: number, max?: number, step?: number, suffix?: string },
 * }>}
 */
export const PROMPTS = [
    {
        id: 'dialogueFormat',
        key: 'dialogueFormatPrompt',
        label: 'Dialogue Format',
        home: 'Settings',
        help: 'Sent with every message, telling the story model how to lay dialogue out. '
            + 'Avatars, speech blocks and character colours all read a speaker line - a '
            + 'name inside the speaker tag, then the words - so this is what makes them work. It asks '
            + 'for no colour tags on purpose: the extension colours dialogue itself, and a '
            + 'colour written into the reply would override the one you chose. '
            + "SillyTavern's own macros work here too - {{user}}, {{char}}, {{persona}}, "
            + '{{time}}, {{roll:d20}} and the rest. ',
        recommended: () => buildDialogueFormatPrompt(getMarkerPair().open, getMarkerPair().close),
        emptyNote: 'The built-in format is sent.',
        available: () => getSettings().dialogueFormatEnabled,
    },
    {
        id: 'systemRules',
        key: 'statusTracker.systemRules',
        label: 'System Rules & Logic',
        home: 'Tracker',
        help: 'Added to the story prompt, telling the narrator how your system works. '
            + 'Only used by the inline mode - the separate pass reads events rather '
            + 'than being told rules. '
            + "SillyTavern's own macros work here too - {{user}}, {{char}}, {{persona}}, "
            + '{{time}}, {{roll:d20}} and the rest. ',
        recommended: () => defaultSettings.statusTracker.systemRules,
        available: () => getSettings().statusTracker.extractionMode !== 'extract',
    },
    {
        id: 'internalStates',
        key: 'internalStatesPrompt',
        label: 'Internal States: Instructions And Template',
        home: 'Trackers',
        help: 'What the writer is told when it writes the Internal States block. Empty uses the built-in, '
            + 'which follows the Worldkit preset. Only used when Internal States writes the block after the reply.',
        recommended: () => INTERNAL_STATES_SYSTEM,
        emptyNote: 'The built-in instructions are sent.',
        available: () => getSettings().internalStatesMode === 'after',
    },
    {
        id: 'bondsReader',
        key: 'bonds.prompt',
        label: 'Bonds: Reader Instructions',
        home: 'Trackers',
        help: 'The system prompt of the separate request that reads each reply for bond changes. Empty uses '
            + 'the built-in. The rules, levels and milestones are always added after it.',
        recommended: () => BOND_SYSTEM,
        emptyNote: 'The built-in instructions are sent.',
    },
    {
        id: 'vitalsReader',
        key: 'vitals.prompt',
        label: 'Vitals: Reader Instructions',
        home: 'Trackers',
        help: 'The system prompt of the separate request that reads each reply for health, hunger, energy and '
            + 'mood. Empty uses the built-in.',
        recommended: () => VITALS_SYSTEM,
        emptyNote: 'The built-in instructions are sent.',
    },
    {
        id: 'phoneSelfie',
        key: 'phonePromptSelfie',
        label: 'Phone: Selfie Prompt',
        home: 'Phone',
        help: 'How a picture OF the contact is worded when you ask for one in plain words. A short request is enough '
            + '("a selfie in a black vest at the courtyard, smirking"): it is split into the pieces below, and anything '
            + 'you did not say is filled from the default written after the bar. Placeholders: {NAME}, {LOOK} (their look, '
            + 'from their gallery page), {OUTFIT} (a saved outfit when you name one, else the default outfit), {EXPRESSION}, {BACKGROUND} (from the request, else the chat or the scene), '
            + '{POSE}, {TIME} (the lighting for the time of day), e.g. {OUTFIT|their usual outfit}; '
            + 'also {REQUEST} (everything you asked, unsplit), {SCENE} (shot type) and {STYLE}. '
            + 'Pictures the contact sends on their own use the Photo prompt in the Phone settings instead.',
        recommended: () => 'A close-up, high-angle POV selfie illustration of {NAME}, {LOOK}. One arm extends directly toward the viewer '
            + 'to hold the out-of-frame camera, creating strong foreshortening on the sleeve and forearm; the phone itself is not visible. '
            + '{POSE|The rest of the body is angled slightly}. Looking straight into the lens with {EXPRESSION|a calm, confident expression '
            + 'and a subtle smirk}. Wearing {OUTFIT|their usual outfit}. Softly blurred {BACKGROUND|sunlit stone courtyard} in the background, '
            + '{TIME}. {STYLE|Clean anime art style with sharp linework and warm natural lighting.}',
        emptyNote: 'The built-in wording for your image connection is sent.',
    },
    {
        id: 'phoneDrawing',
        key: 'phonePromptDrawing',
        label: 'Phone: Drawing Prompt',
        home: 'Phone',
        help: 'How a drawing or painting of something else is worded ("draw me a dragon"). The contact is the '
            + 'artist, not the subject, so their look is not used. Placeholders: {NAME}, {REQUEST}, {SCENE}, {STYLE}.',
        recommended: () => '{REQUEST}, {STYLE}',
        emptyNote: 'The built-in wording for your image connection is sent.',
    },
    {
        id: 'phoneObject',
        key: 'phonePromptObject',
        label: 'Phone: Object Photo Prompt',
        home: 'Phone',
        help: 'How a photo of a thing or a place is worded ("show me the rug you described"). Their look is not '
            + 'used. Placeholders: {NAME}, {REQUEST}, {SCENE}, {STYLE}.',
        recommended: () => '{REQUEST}, {SCENE}, {STYLE}',
        emptyNote: 'The built-in wording for your image connection is sent.',
    },
    {
        id: 'phoneStyle',
        key: 'phonePictureStyle',
        label: 'Phone: Picture Style',
        home: 'Phone',
        help: 'The art style of pictures asked for in plain words, used as {STYLE} and added to the built-in wording, when you '
            + 'have saved no styles in the Phone photo settings (a saved, marked style is used instead). A style the request '
            + 'itself names ("a cartoon of", "a watercolor") wins for that picture. Empty means a plain photo style '
            + '(natural skin texture).',
        recommended: () => 'Clean anime art style with sharp linework and warm natural lighting.',
        emptyNote: 'Natural skin texture is sent for plain photos.',
    },
    ...TIME_PERIODS.map(p => ({
        id: `phoneTime${p.label}`,
        key: `phoneTime${p.label}`,
        label: `Phone: ${p.label} Light`,
        home: 'Phone',
        help: `The lighting and mood words for a picture set in the ${p.label.toLowerCase()} (${p.from}:00 to ${p.to}:00 in the story, or on your clock when the `
            + 'story has no clock). Used as {TIME} and added to the built-in wording. Empty means the built-in words.',
        recommended: () => p.text,
        emptyNote: 'The built-in words are sent.',
    })),

];

/**
 * @param {string} id
 * @returns {object} The entry, or throws - a typo naming a prompt that does not exist
 *   would otherwise render an empty box bound to nothing, which looks like a working
 *   setting that quietly discards what you type into it.
 */
export function promptById(id) {
    const found = PROMPTS.find(p => p.id === id);
    if (!found) throw new Error(`Unknown prompt: ${id}`);
    return found;
}

/** The entries that apply to the current setup. */
export function availablePrompts() {
    return PROMPTS.filter(p => !p.available || p.available());
}
