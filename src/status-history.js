import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { debugLog } from './constants.js';
import { parseMessageForUpdates } from './status-logic.js';

/**
 * Keeping tracker data out of the transcript.
 *
 * The extension used to hide its status blocks in the DOM only - nothing ever wrote back
 * to message.mes - so every block was saved to the chat file and re-sent to the model on
 * every later turn. On a real 317-message chat that came to ~179,000 tokens, 71% of the
 * whole transcript.
 *
 * It also taught the model to keep producing them: with 157 previous messages ending in a
 * status block, the pattern is overwhelming in-context evidence, which is why blocks kept
 * appearing even after the instructions were removed from the prompt.
 *
 * The removed text is kept on message.extra, which SillyTavern does not put in the prompt
 * (only extra.reasoning and extra.bias are read), so nothing is lost and nothing is spent.
 */

/** Where the removed block is preserved on a message. */
export const RAW_STATUS_KEY = 'sillynpc_status_raw';

/** Rough token estimate. Good enough for reporting a saving, not for budgeting. */
export function estimateTokens(chars) {
    return Math.round(chars / 4);
}


/**
 * The raw block previously removed from a message, if any.
 * Lets "re-sync from this message" keep working once the text has been cleaned.
 */
export function getPreservedStatusRaw(message) {
    return message?.extra?.[RAW_STATUS_KEY] || '';
}


