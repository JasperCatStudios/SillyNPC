import { getSettings } from './settings.js';
import { DEFAULT_MARKER_OPEN, DEFAULT_MARKER_CLOSE } from './constants.js';
import { escapeRegExp } from './utils.js';

/**
 * Custom speaker detection (fork).
 *
 * Upstream finds speakers by looking for bold or italic text followed by a colon, and by
 * matching character names anywhere in the prose. Both collide with other extensions and
 * presets that format the same text, and the second one decorates a name wherever it is
 * merely mentioned.
 *
 * This reads one thing instead: a tag the model writes at the start of a line, by default
 * a name between mathematical white square brackets. Nothing else in SillyTavern writes
 * that, so nothing else can be mistaken for it or copy it by accident.
 *
 *     ⟦Vesper⟧ "Sit down before you fall down."
 *     ⟦Vesper⟧ (He is going to ruin this for both of us.)
 *
 * A thought is the same line with the words in parentheses.
 *
 * Nothing here reaches into the chat or the character list. The decorator hands in what
 * it already knows how to do - find a card, build a portrait - so this file can be
 * imported from anywhere without creating a cycle through chat.js.
 */

/** 'marker' reads only the tag, 'both' also reads upstream's styles, 'legacy' is upstream. */
export function getDetectionMode() {
    const mode = getSettings().speakerDetection;
    return mode === 'both' || mode === 'legacy' ? mode : 'marker';
}

/** Whether the tag is read at all. */
export function markerDetectionOn() {
    return getDetectionMode() !== 'legacy';
}

/** Whether upstream's bold-colon and plain-name matching still runs. */
export function legacyDetectionOn() {
    return getDetectionMode() !== 'marker';
}

/** The pair in force, falling back to the defaults for a blank or one-sided setting. */
export function getMarkerPair() {
    const settings = getSettings();
    const open = String(settings.speakerMarkerOpen ?? '').trim();
    const close = String(settings.speakerMarkerClose ?? '').trim();
    if (!open || !close) return { open: DEFAULT_MARKER_OPEN, close: DEFAULT_MARKER_CLOSE };
    return { open, close };
}

/**
 * A fresh pattern for the pair in force.
 *
 * Fresh because a global pattern carries lastIndex between uses, and the pair can change
 * between two messages. The name is anything short that does not contain the closing
 * bracket or a line break.
 *
 * @returns {RegExp} Group 1 is the name.
 */
export function buildMarkerRegex() {
    const { open, close } = getMarkerPair();
    const o = escapeRegExp(open);
    const c = escapeRegExp(close);
    return new RegExp(`${o}\\s*((?:(?!${c})[^\\n]){1,60}?)\\s*${c}[ \\t]*`, 'gu');
}

/**
 * Splits raw message text into lines with a speaker, for anything that has no DOM to read.
 *
 * @param {string} text A message's raw text.
 * @returns {{ speaker: string, body: string, thought: boolean }[]}
 */
export function parseMarkedLines(text) {
    const out = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const regex = buildMarkerRegex();
        const m = regex.exec(line);
        if (!m) continue;
        const body = line.slice(m.index + m[0].length).trim();
        out.push({
            speaker: m[1].trim(),
            body,
            thought: /^\(.*\)$/s.test(body) || body.startsWith('('),
        });
    }
    return out;
}

/**
 * Replaces every tag in a rendered message with the speaker's portrait and name.
 *
 * Markdown leaves the tag as ordinary text, so this walks text nodes. Code is skipped, so
 * a message explaining the format is not decorated by it.
 *
 * @param {Element} container The message's text element.
 * @param {object} hooks
 * @param {(name: string) => object|null} hooks.findChar Resolves a card by exact name or alias.
 * @param {(char: object|null, name: string) => HTMLElement} hooks.makeAvatar The portrait.
 * @param {boolean} hooks.hideNames Whether a carded speaker's name is replaced by their portrait.
 * @returns {number} How many tags were replaced.
 */
export function injectAtMarkers(container, hooks) {
    const { findChar, makeAvatar, hideNames } = hooks;
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            if (node.parentElement?.closest('code, pre, .sillynpc-speaker-name')) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    let count = 0;
    for (const node of nodes) {
        const text = node.nodeValue;
        const regex = buildMarkerRegex();
        const matches = [...text.matchAll(regex)];
        if (!matches.length) continue;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const m of matches) {
            if (m.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, m.index)));

            const name = m[1].trim();
            const char = findChar(name);
            const after = text.slice(m.index + m[0].length).trimStart();

            fragment.appendChild(makeAvatar(char, name));

            const span = document.createElement('span');
            span.className = 'sillynpc-speaker-name';
            span.dataset.marker = '1';
            span.dataset.kind = after.startsWith('(') ? 'thought' : 'speech';
            span.textContent = name;
            if (hideNames && char) span.style.display = 'none';
            fragment.appendChild(span);
            // The tag's trailing space, kept as one so the words do not touch the name.
            fragment.appendChild(document.createTextNode(' '));

            cursor = m.index + m[0].length;
            count++;
        }
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
    }
    return count;
}
