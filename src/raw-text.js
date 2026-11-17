/**
 * The text of an answer from SillyTavern's generateRawData.
 *
 * generateRawData answers the provider's raw JSON (choices[0].message.content for OpenAI-style
 * backends, results[0].text for others, a content array for Claude), not a string and not a
 * { content } object. Reading `.content` off it gave '' on any install that sends through the
 * main API with no connection profile chosen, which showed up as "the reply was empty" in every
 * tracker, the lore generator and the games. A connection profile answers a string or
 * { content }, which is returned as it is.
 *
 * Pure: the context is passed in, so node can test it.
 *
 * @param {{ extractMessageFromData?: (data: any) => any }} context
 * @param {any} raw
 * @returns {string}
 */
export function textFromRaw(context, raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw.content === 'string') return raw.content;
    try {
        const text = context?.extractMessageFromData?.(raw);
        return typeof text === 'string' ? text : '';
    } catch {
        return '';
    }
}
