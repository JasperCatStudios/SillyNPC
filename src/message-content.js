/**
 * Whether a message has anything in it to read. The trackers (bonds, vitals, internal states, the
 * status tracker) read a reply to see what changed; an empty one, such as a blank greeting or a message
 * still being written when a chat opens, has nothing to read, and asking a model about it only costs a
 * request and fails.
 *
 * @param {{ mes?: any } | null | undefined} message
 */
export function hasReadableText(message) {
    return String(message?.mes ?? '').trim().length > 0;
}
