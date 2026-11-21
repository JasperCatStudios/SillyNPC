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
            const label = S('text', { x: X(start[0]) + 3, y: Y(start[1]) - 3, 'font-size': 6.5, fill: kind === 'board' ? '#cfe' : '#5a4b2f', 'font-weight': 'bold' }, guides);
            label.textContent = String(i + 1);
            labels.push(label);
            drawn.push(0);
        });
        if (v.inkOn) {
            v.wells.forEach((w) => {
                well = S('g', {}, hud);
                S('circle', { cx: X(w.x), cy: Y(w.y), r: w.r * 100, fill: '#16131a', stroke: '#6b5f80', 'stroke-width': 0.8 }, well);
                S('circle', { cx: X(w.x), cy: Y(w.y), r: w.r * 100 * 0.6, fill: '#2b2535' }, well);
                const t = S('text', { x: X(w.x), y: Y(w.y) - w.r * 100 - 1.6, 'text-anchor': 'middle', 'font-size': 4.2, fill: kind === 'board' ? '#cfe' : '#5a4b2f' }, hud);
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

/* ------------------------------------------------------------------ assemble */

const PART_GRADE = { perfect: '#6aa84f', good: '#e8b84a', miss: '#c0504d' };

export function assembleView(svg, step) {
    S('rect', { x: 0, y: 0, width: 160, height: 100, fill: '#2b2622' }, svg);
    S('rect', { x: 6, y: 5, width: 148, height: 90, rx: 4, fill: '#3a322b', stroke: '#5a4d40', 'stroke-width': 0.8 }, svg);
    const g = S('g', {}, svg);
    const cross = S('g', { opacity: 0 }, svg);
    const vline = S('line', { y1: 5, y2: 95, stroke: '#fff', 'stroke-width': 0.7, opacity: 0.85 }, cross);
    const hline = S('line', { x1: 6, x2: 154, stroke: '#fff', 'stroke-width': 0.7, opacity: 0.85 }, cross);
    const name = S('text', { x: 80, y: 11, 'text-anchor': 'middle', 'font-size': 5, fill: '#e8d6b9' }, svg);
    const spots = [];
    const pieces = [];
    let built = false;
    // On a touch screen the pieces and their outlines are drawn bigger (a thin arm was about a third of a fingertip wide).
    let touchK = 1;
    const shape = (parent, part, attrs) => {
        const w = touchK > 1 ? Math.max(part.w * touchK, 0.08) : part.w;
        const h = touchK > 1 ? Math.max(part.h * touchK, 0.1) : part.h;
        return S('rect', { x: -w * 80, y: -h * 50, width: w * 160, height: h * 100, rx: Math.min(w * 80, h * 50, 3), ...attrs }, parent);
    };
    return {
        update(v) {
            if (!built) {
                built = true;
                touchK = v.touch ? 1.8 : 1;
                v.parts.forEach((part) => {
                    const spot = S('g', { transform: `translate(${X(part.x)} ${Y(part.y)})`, opacity: 0.35 }, g);
                    shape(spot, part, { fill: 'rgba(255,255,255,0.05)', stroke: '#e8d6b9', 'stroke-width': 0.8, 'stroke-dasharray': '2 2' });
                    spots.push(spot);
                    const piece = S('g', { opacity: 0 }, g);
                    shape(piece, part, { fill: '#b9b2a4', stroke: '#6b6458', 'stroke-width': 0.8 });
                    pieces.push(piece);
                });
            }
            v.parts.forEach((part, i) => {
                const current = i === v.index && !v.over;
                set(spots[i], { opacity: part.at ? 0.15 : current ? 1 : 0.35 });
                const rect = spots[i].firstChild;
                set(rect, { stroke: current ? '#f1c232' : '#e8d6b9', 'stroke-width': current ? 1.4 : 0.8 });
                const piece = pieces[i];
                if (part.at) {
                    set(piece, { opacity: 1, transform: `translate(${X(part.at.x)} ${Y(part.at.y)})` });
                    piece.firstChild.setAttribute('stroke', PART_GRADE[part.grade] || '#6b6458');
                    piece.firstChild.setAttribute('stroke-width', 1.4);
                } else if (current) {
                    // The next part: waiting at the left edge until it is picked up, then following the pointer.
                    const at = v.carrying || v.controls === 'button' ? v.pos : { x: 0.07, y: 0.5 };
                    set(piece, { opacity: 1, transform: `translate(${X(at.x)} ${Y(at.y)})` });
                    piece.firstChild.setAttribute('stroke', '#f1c232');
                    piece.firstChild.setAttribute('stroke-width', 1.2);
                } else set(piece, { opacity: 0 });
            });
            const next = v.parts[v.index];
            name.textContent = next && !v.over ? next.id.replace(/-/g, ' ') : '';
            if (v.controls === 'button' && !v.over) {
                set(cross, { opacity: 1 });
                if (v.phase === 'x') { set(vline, { x1: X(v.pos.x), x2: X(v.pos.x) }); set(hline, { opacity: 0 }); } else { set(vline, { x1: X(v.lockX), x2: X(v.lockX) }); set(hline, { y1: Y(v.pos.y), y2: Y(v.pos.y), opacity: 0.85 }); }
            } else set(cross, { opacity: 0 });
        },
    };
}

/* ------------------------------------------------------------------ tune */

export function tuneView(svg, step) {
    S('rect', { x: 0, y: 0, width: 160, height: 100, fill: '#1d2a24' }, svg);
    const frame = S('rect', { x: 8, y: 14, width: 144, height: 80, rx: 4, fill: '#24382f', stroke: '#3d5a4b', 'stroke-width': 1 }, svg);
    const prog = S('rect', { x: 8, y: 6, width: 144, height: 3, rx: 1.5, fill: '#00000044' }, svg);
    const progFill = S('rect', { x: 8, y: 6, width: 0, height: 3, rx: 1.5, fill: '#8fd3c9' }, svg);
    const trail = S('g', {}, svg);
    // The target is drawn a good size (a fingertip covers about 9 units of this stage on a phone), without changing how the game is scored.
    const blob = S('circle', { cx: 80, cy: 50, r: 5.5, fill: '#8fd3c9', stroke: '#e8fff9', 'stroke-width': 1 }, svg);
    const halo = S('circle', { cx: 80, cy: 50, r: 9, fill: 'none', stroke: '#8fd3c9', 'stroke-width': 0.8, opacity: 0.4 }, svg);
    const ring = S('circle', { cx: 80, cy: 72, r: 8, fill: 'none', stroke: '#fff', 'stroke-width': 1.4 }, svg);
    const dot = S('circle', { cx: 80, cy: 72, r: 0.9, fill: '#fff' }, svg);
    let wobble = 0;
    return {
        update(v, dt) {
            wobble += (dt || 16) / 180;
            // The soul is bigger still on a touch screen, in step with the bigger ring.
            const grow = v.touch ? 1.4 : 1;
            set(blob, { cx: X(v.blob.x), cy: Y(v.blob.y), r: (5.5 + Math.sin(wobble) * 0.6) * grow });
            set(halo, { cx: X(v.blob.x), cy: Y(v.blob.y), r: (9 + Math.sin(wobble * 0.7) * 1.4) * grow + (v.surge ? 4 : 0), opacity: v.surge ? 0.9 : 0.4 });
            set(ring, { cx: X(v.ring.x), cy: Y(v.ring.y), r: v.band * 100, stroke: v.inBand ? '#6aa84f' : '#e69138' });
            set(dot, { cx: X(v.ring.x), cy: Y(v.ring.y) });
            set(progFill, { width: 144 * v.progress });
            set(frame, { stroke: v.surge ? '#e69138' : '#3d5a4b' });
            // Sparks when the ring is off the target, a few short lines from the blob.
            if (!v.inBand && Math.random() < 0.12 && trail.childNodes.length < 24) {
                const sp = S('line', { x1: X(v.blob.x), y1: Y(v.blob.y), x2: X(v.blob.x) + (Math.random() - 0.5) * 8, y2: Y(v.blob.y) + (Math.random() - 0.5) * 8, stroke: '#f1c232', 'stroke-width': 0.6 }, trail);
                setTimeout(() => sp.remove(), 220);
            }
        },
    };
}

export const CRAFT_VIEWS = Object.freeze({ trace: traceView, stamp: stampView, assemble: assembleView, tune: tuneView });
