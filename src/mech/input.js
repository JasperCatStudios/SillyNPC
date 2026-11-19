/**
 * Gesture maths for the hands-on mechanics (fork): small pure helpers the screen uses to turn pointer samples into things a mechanic
 * understands. Pointer samples are [t (ms), x, y] in stage units (the stage is 16:10, y grows downward).
 * Pure: no DOM, no SillyTavern imports.
 */

/** The last `windowMs` of a path ending at its last sample. */
export function recent(path, windowMs = 150) {
    if (!Array.isArray(path) || !path.length) return [];
    const end = path[path.length - 1][0];
    return path.filter(p => end - p[0] <= windowMs);
}

/**
 * A quick flick upward: the pointer moved up fast in the last moments. Returns { speed } (stage units per second, upward) or null.
 * @param {number[][]} path samples
 * @param {{ minSpeed?: number, windowMs?: number, minTravel?: number }} [opts]
 */
export function flickUp(path, { minSpeed = 1.5, windowMs = 160, minTravel = 0.06 } = {}) {
    const pts = recent(path, windowMs);
    if (pts.length < 2) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dt = (last[0] - first[0]) / 1000;
    const up = first[2] - last[2];
    if (dt <= 0 || up < minTravel) return null;
    const speed = up / dt;
    const sideways = Math.abs(last[1] - first[1]);
    return speed >= minSpeed && sideways < up * 1.2 ? { speed } : null;
}

/** Whether a stage point is inside a rectangle { x0, y0, x1, y1 }. */
export const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** A pointer position over a vertical control as 0 (bottom) to 1 (top). */
export const knobValue = (y, { top = 0.2, bottom = 0.8 } = {}) => Math.min(1, Math.max(0, (bottom - y) / (bottom - top)));

/** Keeps the samples of a frame, converting a DOM point (px in a box) to stage units. */
export function toStage(clientX, clientY, box) {
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    return [Math.min(1, Math.max(0, (clientX - box.left) / w)), Math.min(1, Math.max(0, (clientY - box.top) / h))];
}
