/**
 * Plain stroke sets for the trace mechanic (fork): shapes to be drawn, as lists of strokes, each a polyline in stage units
 * (x across 0..1, y down 0..1 on a 16:10 stage). They are neutral shapes with plain names; a world gives them its own meaning through
 * the recipe's words and art.
 *
 * Pure data and small generators: no DOM, no SillyTavern imports.
 */

const wave = (from, to, y, amp, steps) => Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [from + (to - from) * t, y + Math.sin(t * Math.PI * 2) * amp];
});

const spiral = (cx, cy, turns, r1, steps) => Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = r1 * t;
    // The stage is wider than it is tall, so the horizontal radius is shrunk to keep the spiral round.
    return [cx + (Math.cos(a) * r) / 1.6, cy + Math.sin(a) * r];
});

export const GLYPHS = Object.freeze({
    bar: [[[0.3, 0.5], [0.7, 0.5]]],
    cross: [[[0.5, 0.2], [0.5, 0.8]], [[0.34, 0.5], [0.66, 0.5]]],
    peak: [[[0.5, 0.2], [0.36, 0.8]], [[0.5, 0.2], [0.64, 0.8]], [[0.41, 0.58], [0.59, 0.58]]],
    star: [[[0.5, 0.18], [0.5, 0.82]], [[0.34, 0.5], [0.66, 0.5]], [[0.38, 0.28], [0.62, 0.72]], [[0.62, 0.28], [0.38, 0.72]]],
    box: [[[0.37, 0.25], [0.63, 0.25], [0.63, 0.75], [0.37, 0.75], [0.37, 0.25]], [[0.37, 0.25], [0.63, 0.75]], [[0.63, 0.25], [0.37, 0.75]]],
    wave: [wave(0.24, 0.76, 0.5, 0.18, 12)],
    spiral: [spiral(0.5, 0.5, 1.75, 0.3, 28)],
});

export const GLYPH_IDS = Object.freeze(Object.keys(GLYPHS));

/** The strokes of a glyph by id, copied, or null. */
export function glyphStrokes(id) {
    const g = GLYPHS[String(id ?? '')];
    return g ? g.map(stroke => stroke.map(p => [...p])) : null;
}
