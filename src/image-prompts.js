import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { getActiveCharacters } from './characters.js';
import { charactersMentionedIn } from './mentions.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';

/**
 * One image-generation prompt per character (fork).
 *
 * Stored on the card as plain text - the tags that make a picture of this person look like
 * them, in whatever dialect the image model takes. Two uses.
 *
 * It can be sent to SillyTavern's image generation straight from the card, so a portrait is
 * one press away.
 *
 * And it can be sent to the story model. A preset that asks the model to write an image
 * prompt every reply has no memory of how it described somebody last time, so the same
 * character is a different person in every picture. Listing the tags of whoever is in the
 * scene, with an instruction to reuse them, is what stops that.
 *
 * Deliberately not one of the profile fields: those are read by the tracker, written by
 * Fill and sent to the story model on every message, and none of that is wanted here.
 */

export const IMAGE_PROMPT_INJECT_KEY = 'sillynpc-image-prompts';

export const DEFAULT_IMAGE_INJECT_TEMPLATE = [
    '### CHARACTER IMAGE TAGS',
    'Whenever you write an image prompt, describe these characters with exactly these tags.',
    'Keep their looks fixed; change only their pose, expression, clothing and setting as the scene requires.',
    '{{list}}',
].join('\n');

/** Characters with a prompt who are in the scene: who spoke or was named in the last few messages. */
export function charactersInScene(depth = 4) {
    const chat = getContext()?.chat;
    if (!Array.isArray(chat) || !chat.length) return [];

    const recent = chat.slice(-depth).map(m => String(m?.mes ?? '')).join('\n');
    const withPrompt = getActiveCharacters().filter(c => String(c.imagePrompt ?? '').trim());
    return charactersMentionedIn(recent, withPrompt);
}

/** The block sent to the story model, or '' when there is nothing to say. */
export function buildImagePromptBlock() {
    const settings = getSettings();
    const lines = charactersInScene()
        .map(char => `- ${char.name}: ${String(char.imagePrompt).trim().replace(/\s+/g, ' ')}`);
    if (!lines.length) return '';

    const template = String(settings.imagePromptInjectTemplate || '').trim()
        || DEFAULT_IMAGE_INJECT_TEMPLATE;
    return template.includes('{{list}}')
        ? template.replace('{{list}}', lines.join('\n'))
        : `${template}\n${lines.join('\n')}`;
}

/** Puts the block in front of the story model, or takes it away. */
export function applyImagePromptInjection() {
    const settings = getSettings();
    const on = settings.enabled && settings.imagePromptInject;
    placeWritingPrompt(IMAGE_PROMPT_INJECT_KEY, on ? buildImagePromptBlock() : '', {
        depth: Number(settings.imagePromptInjectDepth ?? 1),
        name: 'SillyNPC - Character Image Tags',
    });
}

export function initImagePromptInjection() {
    eventSource.on(event_types.GENERATION_STARTED, (_type, _options, dryRun) => {
        if (dryRun) return;
        try {
            applyImagePromptInjection();
        } catch (err) {
            debugLog('Could not place the character image tags', err);
        }
    });
}

/**
 * Sends a character's prompt to SillyTavern's image generation.
 *
 * @param {object} char
 * @returns {Promise<boolean>} Whether the command was issued.
 */
export async function generateFromCard(char) {
    const prompt = String(char?.imagePrompt ?? '').trim();
    if (!prompt) {
        toastr.info('This character has no image prompt yet.', PRODUCT_NAME);
        return false;
    }
    const negative = String(char.imageNegative ?? '').trim();
    const quote = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const args = negative ? ` negative="${quote(negative)}"` : '';
    try {
        await getContext().executeSlashCommandsWithOptions(
            `/sd${args} ${prompt}`,
            { displayCommand: false, showOutput: true },
        );
        return true;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Image generation from the card failed', err);
        toastr.error('Could not start image generation. Is the Image Generation extension set up?', PRODUCT_NAME);
        return false;
    }
}
