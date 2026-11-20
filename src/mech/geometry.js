/**
 * Path maths for the hands-on mechanics (fork): small pure helpers for drawing and following lines.
 *
 * The stage is 16:10 and points are in stage units (x across 0..1, y down 0..1). Distances are measured in "square" units, where one
 * unit is the stage height, so a circle is round: use `toSquare` on a stage point before measuring and `fromSquare` to go back.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const STAGE_ASPECT = 1.6;

/** A stage point (x across, y down, both 0..1) as a square-unit point. */
export const toSquare = ([x, y]) => [x * STAGE_ASPECT, y];

/** A square-unit point as a stage point. */
export const fromSquare = ([x, y]) => [x / STAGE_ASPECT, y];

/** The length of a polyline of square-unit points. */
export function pathLength(pts) {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return n;
}

/** The running length at each point of a polyline (the first is 0). */
export function cumulative(pts) {
    const out = [0];
    for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return out;
}

/**
 * The nearest point on a polyline to (x, y): { dist, s (the running length of that point), x, y }.
 * `cum` is `cumulative(pts)` when the caller has it (saves recomputing on every sample).
 */
export function nearestOnPath(pts, x, y, cum = cumulative(pts)) {
    let best = { dist: Infinity, s: 0, x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0 };
    for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const dist = Math.hypot(x - px, y - py);
        if (dist < best.dist) best = { dist, s: cum[i - 1] + Math.sqrt(len2) * t, x: px, y: py };
    }
    return best;
}

/** The point at running length `s` along a polyline (clamped to its ends). */
export function pointAt(pts, s, cum = cumulative(pts)) {
    if (!pts.length) return [0, 0];
    const total = cum[cum.length - 1];
    const at = Math.min(total, Math.max(0, s));
    for (let i = 1; i < pts.length; i++) {
        if (at <= cum[i] || i === pts.length - 1) {
            const span = cum[i] - cum[i - 1];
            const t = span > 0 ? (at - cum[i - 1]) / span : 0;
            return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        }
    }
    return [...pts[pts.length - 1]];
}

/** Whether a square-unit point is inside a circle { x, y, r } given in stage units. */
export function inCircle(point, circle) {
    const [cx, cy] = toSquare([circle.x, circle.y]);
    return Math.hypot(point[0] - cx, point[1] - cy) <= circle.r;
}
