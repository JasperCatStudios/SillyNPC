/**
 * The views of the drawing and stamping mechanics (fork): trace and stamp, drawn as plain SVG shapes on the same 160 x 100 stage
 * the kitchen uses. Nothing here names a world: the surface (paper or a circuit board), the colours and the words come from the
 * step's data. Each view is `(svg, step) => { update(view, dt) }`, like the kitchen's views in views.js.
 *
 * Pure browser code: no SillyTavern imports.
 */

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (parent) parent.append(n);
    return n;
};
const set = (n, attrs) => { for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); };
const X = (x) => x * 160;
const Y = (y) => y * 100;

const GRADE_FILL = { perfect: '#e8b84a', good: '#c0504d', miss: '#6b6b70' };

/** The surface under the work: a sheet of paper on a desk, or a dark board. Chosen by the step's art.surface. */
function surface(svg, kind) {
    S('rect', { x: 0, y: 0, width: 160, height: 100, fill: kind === 'board' ? '#1d2a24' : '#3a2f27' }, svg);
    if (kind === 'none') return;
    if (kind === 'board') {
        S('rect', { x: 8, y: 6, width: 144, height: 88, rx: 4, fill: '#24382f', stroke: '#3d5a4b', 'stroke-width': 1 }, svg);
        return;
    }
    S('rect', { x: 14, y: 6, width: 132, height: 88, rx: 3, fill: '#f4ecd8', stroke: '#cdbf9c', 'stroke-width': 0.8 }, svg);
}

/* ------------------------------------------------------------------ trace */

export function traceView(svg, step) {
    const kind = step?.art?.surface === 'board' ? 'board' : step?.art?.surface === 'none' ? 'none' : 'paper';
    surface(svg, kind);
    const guideColor = kind === 'board' ? '#7fb59a' : '#a99a78';
    const inkColor = kind === 'board' ? '#e8f0a8' : '#1d1a22';
    const paleColor = kind === 'board' ? '#8a9a70' : '#8c8498';
    const guides = S('g', {}, svg);
    const laidG = S('g', {}, svg);
    const hud = S('g', {}, svg);
    let built = false;
    const guideEls = [];
    const startDots = [];
    const labels = [];
    const drawn = [];                       // how many laid points of each stroke are in the picture
    let well = null;
    let inkBar = null;
    let inkFill = null;
    let bead = null;

    const build = (v) => {
        built = true;
        v.strokes.forEach((st, i) => {
            const d = st.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(2)} ${Y(p[1]).toFixed(2)}`).join(' ');
            guideEls.push(S('path', { d, fill: 'none', stroke: guideColor, 'stroke-width': Math.max(1.2, v.width * 100 * 1.6), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.3 }, guides));
            guideEls.push(S('path', { d, fill: 'none', stroke: guideColor, 'stroke-width': 0.7, 'stroke-dasharray': '2 2', opacity: 0.9 }, guides));
            const start = st.pts[0];
            startDots.push(S('circle', { cx: X(start[0]), cy: Y(start[1]), r: Math.max(2, v.width * 100 * 0.9), fill: '#6aa84f', opacity: 0 }, guides));
            const label = S('text', { x: X(start[0]) - 1.5, y: Y(start[1]) - 3.5, 'font-size': 4.5, fill: kind === 'board' ? '#cfe' : '#5a4b2f', 'font-weight': 'bold' }, guides);
            label.textContent = String(i + 1);
            labels.push(label);
            drawn.push(0);
        });
        if (v.inkOn) {
            v.wells.forEach((w) => {
                well = S('g', {}, hud);
                S('circle', { cx: X(w.x), cy: Y(w.y), r: w.r * 100, fill: '#16131a', stroke: '#6b5f80', 'stroke-width': 0.8 }, well);
                S('circle', { cx: X(w.x), cy: Y(w.y), r: w.r * 100 * 0.6, fill: '#2b2535' }, well);
                const t = S('text', { x: X(w.x), y: Y(w.y) + w.r * 100 + 5, 'text-anchor': 'middle', 'font-size': 3.6, fill: kind === 'board' ? '#cfe' : '#5a4b2f' }, hud);
                t.textContent = 'dip';
            });
            inkBar = S('rect', { x: 20, y: 9, width: 30, height: 3.2, rx: 1.6, fill: '#00000033', stroke: '#6b5f80', 'stroke-width': 0.4 }, hud);
            inkFill = S('rect', { x: 20, y: 9, width: 30, height: 3.2, rx: 1.6, fill: inkColor }, hud);
        }
        bead = S('circle', { cx: -10, cy: -10, r: 2.4, fill: '#e69138', stroke: '#fff', 'stroke-width': 0.5, opacity: 0 }, hud);
    };

    return {
        update(v) {
            if (!built) build(v);
            v.strokes.forEach((st, i) => {
                set(startDots[i], { opacity: st.active && st.reach < 0.02 ? 0.9 : 0 });
                set(labels[i], { opacity: st.done ? 0 : 1 });
                guideEls[i * 2].setAttribute('opacity', st.done ? 0.12 : st.active ? 0.5 : 0.3);
                const base = v.width * 100 * 0.5;
                // New laid points since the last frame become round blobs (the thickness is the speed: slow is fat).
                if (st.laid.length < drawn[i]) { drawn[i] = 0; }
                for (let k = drawn[i]; k < st.laid.length; k++) {
                    const [x, y, thick, dry] = st.laid[k];
                    S('circle', { cx: X(x).toFixed(2), cy: Y(y).toFixed(2), r: (base * thick).toFixed(2), fill: dry ? paleColor : inkColor }, laidG);
                }
                drawn[i] = st.laid.length;
            });
            // Keep the picture light: a long drawing does not keep every blob.
            while (laidG.childNodes.length > 1800) laidG.removeChild(laidG.firstChild);
            if (inkFill) { set(inkFill, { width: 30 * Math.max(0, v.ink) }); inkFill.setAttribute('fill', v.dry ? paleColor : inkColor); }
            if (bead) {
                if (v.bead) set(bead, { cx: X(v.bead[0]), cy: Y(v.bead[1]), opacity: 1 }); else set(bead, { opacity: 0 });
            }
        },
    };
}

/* ------------------------------------------------------------------ stamp */

export function stampView(svg, step) {
    const kind = step?.art?.surface === 'board' ? 'board' : step?.art?.surface === 'none' ? 'none' : 'paper';
    surface(svg, kind);
    const g = S('g', {}, svg);
    let built = false;
    const marks = [];
    let ring = null;
    const build = (v) => {
        built = true;
        v.marks.forEach((m) => {
            const mg = S('g', {}, g);
            S('circle', { cx: X(m.x), cy: Y(m.y), r: v.markR * 100, fill: 'none', stroke: kind === 'board' ? '#7fb59a' : '#a99a78', 'stroke-width': 0.9, 'stroke-dasharray': '2 2' }, mg);
            const fill = S('circle', { cx: X(m.x), cy: Y(m.y), r: v.markR * 100 * 0.92, fill: '#c0504d', opacity: 0 }, mg);
            marks.push({ fill, g: mg });
        });
        ring = S('circle', { cx: 0, cy: 0, r: 0, fill: 'none', stroke: '#e69138', 'stroke-width': 1.6, opacity: 0 }, g);
    };
    return {
        update(v) {
            if (!built) build(v);
            v.marks.forEach((m, i) => {
                const mk = marks[i];
                set(mk.fill, { opacity: m.grade ? 0.85 : i === v.current ? 0.12 : 0, fill: GRADE_FILL[m.grade] || '#c0504d' });
                set(mk.g, { opacity: m.grade || i === v.current ? 1 : 0.35 });
            });
            if (v.over || v.gap || !(v.ringR > 0)) set(ring, { opacity: 0 });
            else set(ring, { cx: X(v.x), cy: Y(v.y), r: v.ringR * 100, opacity: 1 });
        },
    };
}

export const CRAFT_VIEWS = Object.freeze({ trace: traceView, stamp: stampView });
