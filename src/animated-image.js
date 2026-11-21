/**
 * Telling an animated WebP or GIF from a still one, from the file's own bytes (fork).
 *
 * Worldkit shrinks a picked picture by drawing it on a canvas, which keeps only the first frame. An animated picture has to be
 * stored as it came, so the picker asks this first. Pure, no imports.
 */

/** The biggest animated file kept as it is; a larger one is flattened like any other picture rather than stored whole. */
export const ANIMATED_MAX_BYTES = 8 * 1024 * 1024;

const ascii = (bytes, at, text) => {
    for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
    return true;
};

/** An animated WebP: a RIFF/WEBP file whose first chunk is VP8X with the animation flag (bit 1 of its flags byte) set. */
export function isAnimatedWebp(bytes) {
    if (!bytes || bytes.length < 30) return false;
    if (!ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return false;
    if (!ascii(bytes, 12, 'VP8X')) return false;
    return (bytes[20] & 0x02) !== 0;
}

/** An animated GIF: a GIF file with more than one frame, counted by its graphic control extensions (21 F9 04). */
export function isAnimatedGif(bytes) {
    if (!bytes || bytes.length < 14 || !ascii(bytes, 0, 'GIF8')) return false;
    let frames = 0;
    for (let i = 13; i < bytes.length - 2; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
    }
    return false;
}

/** Whether the bytes are an animated picture of a kind a canvas would flatten. */
export const isAnimatedImage = (bytes) => isAnimatedWebp(bytes) || isAnimatedGif(bytes);
