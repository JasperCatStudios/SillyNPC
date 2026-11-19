import { artUrls } from '../../activities-runtime.js';

/**
 * The views of the hands-on mechanics (fork): each draws the mechanic's state on a 160 x 100 stage (stage units x 160 and y 100).
 * Every piece is first a plain SVG shape, so every game is playable with NO art. When a picture for a piece is found (see
 * docs/ASSETS-README.md: the 'mech.*' keys, in your world folder, the shared folder, the preset's art or the Content Kit) it is drawn
 * over the shape, and the shape is hidden. A missing picture changes nothing.
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
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ pictures */

const found = new Map();                   // key + vars -> url | null (settled)
const pending = new Map();                 // key + vars -> Promise

/** The first address for a manifest key that really loads, or null. Settled answers are remembered for the session. */
export function firstArt(key, vars = {}) {
    const id = `${key}|${JSON.stringify(vars)}`;
    if (found.has(id)) return Promise.resolve(found.get(id));
    if (pending.has(id)) return pending.get(id);
    const urls = artUrls(key, vars);
    const p = new Promise((resolve) => {
        let at = 0;
        const next = () => {
            if (at >= urls.length) { found.set(id, null); resolve(null); return; }
            const probe = new Image();
            probe.onload = () => { found.set(id, urls[at]); resolve(urls[at]); };
            probe.onerror = () => { at += 1; next(); };
            probe.src = urls[at];
        };
        next();
    }).finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
}

/**
 * Adds an SVG <image> for a manifest key, invisible until its picture loads. `onLoad` runs then (hide the plain shape there).
 * Returns { el, loaded }.
 */
function artImage(parent, key, vars, attrs, onLoad) {
    const el = S('image', { ...attrs, opacity: 0, 'pointer-events': 'none' }, parent);
    const handle = { el, loaded: false };
    firstArt(key, vars).then((url) => {
        if (!url || !el.isConnected) return;
        el.setAttribute('href', url);
        el.setAttribute('opacity', attrs.opacity ?? 1);
        handle.loaded = true;
        onLoad?.();
    });
    return handle;
}

const prop = (part, parent, attrs, onLoad) => artImage(parent, 'mech.prop', { set: 'kitchen', part }, { preserveAspectRatio: 'xMidYMid meet', ...attrs }, onLoad);
const food = (item, parent, attrs, onLoad) => artImage(parent, 'mech.food', { item }, { preserveAspectRatio: 'xMidYMid meet', ...attrs }, onLoad);

/** Puts the kitchen background behind a stage element when its picture is there. */
export function paintBench(stageEl) {
    firstArt('mech.bench', {}).then((url) => { if (url && stageEl.isConnected) stageEl.style.background = `#23262b url("${url}") center / cover`; });
}

const COLORS = { board: '#a8794a', herb: '#6aa84f', cut: '#3b2a1a', pot: '#3a3f4a', pan: '#2a2a2e', dish: '#f4efe6', hand: '#e8b4a0' };

/* ------------------------------------------------------------------ slice */

function sliceView(svg) {
    const g = S('g', {}, svg);
    const boardRect = S('rect', { x: 4, y: 12, width: 152, height: 80, rx: 6, fill: COLORS.board }, g);
    prop('board', g, { x: 2, y: 8, width: 156, height: 88, preserveAspectRatio: 'none' }, () => set(boardRect, { opacity: 0 }));
    const hand = S('g', {}, g);
    S('rect', { x: 6, y: 28, width: 28, height: 44, rx: 12, fill: COLORS.hand, opacity: 0.85 }, hand);
    const handLabel = S('text', { x: 20, y: 52, 'text-anchor': 'middle', 'font-size': 5, fill: '#5a3a2a' }, hand);
    handLabel.textContent = 'hold here';
    let ingredient = null;
    let lines = [];
    return {
        update(v) {
            if (!ingredient) {
                const b = v.board;
                ingredient = S('rect', { x: X(b.x0), y: Y(b.y0), width: X(b.x1 - b.x0), height: Y(b.y1 - b.y0), rx: 5, fill: COLORS.herb }, g);
                food('herbs', g, { x: X(b.x0) - 2, y: Y(b.y0) - 3, width: X(b.x1 - b.x0) + 4, height: Y(b.y1 - b.y0) + 6 }, () => set(ingredient, { opacity: 0.25 }));
                lines = v.lines.map(() => S('line', { stroke: '#fff', 'stroke-dasharray': '2 2', 'stroke-width': 0.8, y1: Y(b.y0) - 2, y2: Y(b.y1) + 2 }, g));
                if (v.controls === 'button') {
                    const knife = S('g', {}, g);
                    const blade = S('rect', { x: X(b.knifeX) - 1, y: 6, width: 2, height: 88, fill: '#cfd4da' }, knife);
                    const grip = S('rect', { x: X(b.knifeX) - 4, y: 4, width: 8, height: 6, rx: 2, fill: '#555' }, knife);
                    prop('knife', knife, { x: X(b.knifeX) - 14, y: -2, width: 28, height: 26 }, () => set(grip, { opacity: 0 }));
                    void blade;
                }
            }
            v.lines.forEach((l, i) => {
                set(lines[i], { x1: X(l.x), x2: X(l.x), stroke: l.cut ? COLORS.cut : l.half ? '#e69138' : '#fff', 'stroke-width': l.cut ? 2.4 : l.half ? 1.6 : 0.8, 'stroke-dasharray': l.cut ? '' : '2 2' });
            });
            set(hand, { transform: v.flinch ? 'translate(-2 0)' : '' });
        },
    };
}

/* ------------------------------------------------------------------ stir */

function stirView(svg) {
    const g = S('g', {}, svg);
    const cx = 80;
    const cy = 50;
    const r = 34;
    const ring = S('circle', { cx, cy, r: r + 4, fill: '#8d8d94' }, g);
    const pot = S('circle', { cx, cy, r, fill: COLORS.pot }, g);
    // The saucepan picture replaces the plain ring; the contents are drawn over its inside.
    prop('saucepan', g, { x: cx - r - 14, y: cy - r - 14, width: (r + 14) * 2 + 34, height: (r + 14) * 2 }, () => {
        set(ring, { opacity: 0 });
        set(pot, { r: r * 0.78, opacity: 0.6, cx: cx - 1 });
        g.append(pot);
        dots.forEach(d => g.append(d));
        g.append(scorch);
    });
    const scorch = S('circle', { cx: cx + r * 0.45, cy: cy + r * 0.35, r: 2, fill: '#120d08', opacity: 0 }, g);
    const dots = Array.from({ length: 7 }, (_, i) => S('circle', { r: 3.2, fill: ['#e06666', '#f1c232', '#6aa84f', '#4fa3d1', '#b4a7d6', '#f6b26b', '#76a5af'][i] }, g));
    let angle = 0;
    const meter = S('g', {}, svg);
    S('rect', { x: 30, y: 92, width: 100, height: 4, rx: 2, fill: '#555' }, meter);
    const band = S('rect', { y: 92, height: 4, rx: 2, fill: '#6aa84f' }, meter);
    const needle = S('rect', { y: 90, width: 2, height: 8, fill: '#fff' }, meter);
    const cue = S('text', { x: 80, y: 10, 'text-anchor': 'middle', 'font-size': 7, fill: '#e69138', opacity: 0, 'font-weight': 'bold' }, svg);
    cue.textContent = 'Other way!';
    return {
        update(v, dt) {
            angle += v.speed * 360 * (dt / 1000) * (v.dir || 1);
            const blend = v.progress;
            dots.forEach((d, i) => {
                const a = (angle + (i * 360) / dots.length) * (Math.PI / 180);
                const rad = (r - 8) * (1 - 0.7 * blend) * (0.55 + 0.45 * ((i % 3) / 2));
                set(d, { cx: cx + Math.cos(a) * rad, cy: cy + Math.sin(a) * rad });
            });
            set(pot, { fill: v.thick ? '#4a3f33' : COLORS.pot });
            set(scorch, { r: 2 + v.scorch * 14, opacity: v.scorch > 0.02 ? 0.4 + v.scorch * 0.5 : 0 });
            const max = 3;
            set(band, { x: 30 + (v.band[0] / max) * 100, width: ((v.band[1] - v.band[0]) / max) * 100 });
            set(needle, { x: 30 + Math.min(1, v.speed / max) * 100 - 1 });
            set(cue, { opacity: v.cue ? 1 : 0 });
        },
    };
}

/* ------------------------------------------------------------------ sear */

const DONE_COLOR = { pale: '#e8dcc8', 'almost golden': '#e5c27a', golden: '#d9a441', dark: '#8b5a1e', burnt: '#1d1b19' };

function searView(svg) {
    const g = S('g', {}, svg);
    const panShapes = [
        S('ellipse', { cx: 70, cy: 62, rx: 52, ry: 28, fill: '#bfc3c8' }, g),
        S('ellipse', { cx: 70, cy: 60, rx: 46, ry: 23, fill: COLORS.pan }, g),
        S('rect', { x: 112, y: 58, width: 40, height: 6, rx: 3, fill: '#555' }, g),
    ];
    prop('stove', g, { x: 14, y: 14, width: 112, height: 92 });
    prop('pan', g, { x: 10, y: 20, width: 140, height: 80 }, () => panShapes.forEach(p => set(p, { opacity: 0 })));
    const flames = Array.from({ length: 5 }, (_, i) => S('ellipse', { cx: 40 + i * 15, cy: 92, rx: 4, ry: 6, fill: '#f6b26b' }, g));
    const fish = S('g', {}, g);
    const body = S('rect', { x: -22, y: -7, width: 44, height: 14, rx: 7, fill: DONE_COLOR.pale }, fish);
    const tail = S('polygon', { points: '22,0 30,-7 30,7', fill: '#d9a441', opacity: 0.8 }, fish);
    const eye = S('circle', { cx: -15, cy: -1, r: 1.4, fill: '#333' }, fish);
    const hideFish = () => [body, tail, eye].forEach(n => set(n, { opacity: 0 }));
    // The fillet: raw underneath, cooked fading in on top as it browns.
    const raw = food('fish-fillet', fish, { x: -24, y: -17, width: 48, height: 34 }, hideFish);
    const cooked = food('fish-fillet-cooked', fish, { x: -24, y: -17, width: 48, height: 34, opacity: 0 });
    const smoke = Array.from({ length: 4 }, (_, i) => S('circle', { cx: 60 + i * 8, cy: 34 - i * 4, r: 3 + i, fill: '#ddd', opacity: 0 }, g));
    const ringEl = S('circle', { cx: 70, cy: 60, r: 14, fill: 'none', stroke: '#6aa84f', 'stroke-width': 1.4, opacity: 0 }, g);
    const knob = S('g', {}, svg);
    S('rect', { x: 146, y: 18, width: 6, height: 64, rx: 3, fill: '#555' }, knob);
    const win = S('rect', { x: 146, width: 6, rx: 3, fill: '#6aa84f' }, knob);
    const handle = S('circle', { cx: 149, r: 6, fill: '#e69138' }, knob);
    const label = S('text', { x: 70, y: 12, 'text-anchor': 'middle', 'font-size': 6, fill: '#fff' }, svg);
    const hint = S('text', { x: 70, y: 97, 'text-anchor': 'middle', 'font-size': 5, fill: '#fff', opacity: 0.8 }, svg);
    return {
        update(v) {
            const f = v.fillets[0];
            const flight = f.flight ? f.flight.progress : null;
            const lift = flight === null ? 0 : Math.sin(flight * Math.PI) * 38;
            const flip = flight === null ? 0 : flight * 360;
            set(fish, { transform: `translate(70 ${60 - lift}) rotate(${flip})` });
            set(body, { fill: DONE_COLOR[f.word] || DONE_COLOR.pale });
            if (cooked.loaded) {
                const done = clamp((f.d[f.side] - (v.window[0] - 0.3)) / 0.3, 0, 1);
                const burnt = f.word === 'burnt' ? 0.3 : f.word === 'dark' ? 0.6 : 1;
                set(cooked.el, { opacity: done });
                const tone = `brightness(${burnt})`;
                cooked.el.style.filter = tone;
                if (raw.loaded) raw.el.style.filter = f.word === 'burnt' ? 'brightness(0.3)' : '';
            }
            flames.forEach((fl, i) => set(fl, { ry: 3 + v.heat * 9, opacity: 0.4 + v.heat * 0.6, cy: 94 - v.heat * 3 + (i % 2) }));
            smoke.forEach((sm, i) => set(sm, { opacity: Math.max(0, f.smoke * 0.8 - i * 0.1), fill: f.smoke > 0.6 ? '#555' : '#ddd', cy: 34 - i * 4 - (f.smoke * 4) }));
            set(ringEl, { opacity: flight !== null && flight > 0.6 ? 1 : 0, r: 14 - Math.max(0, (flight || 0) - 0.6) * 20 });
            const top = 18 + (1 - v.window[1]) * 64;
            const h = (v.window[1] - v.window[0]) * 64;
            set(win, { y: top, height: h });
            set(handle, { cy: 82 - v.heat * 64 });
            label.textContent = `Side ${f.side + 1} of 2: ${f.word}`;
            hint.textContent = flight !== null ? (flight > 0.5 ? 'Catch it now! (tap)' : '') : (v.controls === 'button' ? 'Hold to heat. Double-tap to flip.' : 'Drag the knob. Tap the fish or flick it up to flip.');
        },
    };
}

/* ------------------------------------------------------------------ sprinkle */

const CELL = { bare: '#f4efe6', some: '#ead9b8', good: '#cdb27a', over: '#b45a3c' };

function sprinkleView(svg) {
    const g = S('g', {}, svg);
    let cells = [];
    let shaker = null;
    let made = false;
    return {
        update(v) {
            if (!made) {
                made = true;
                const d = v.dish;
                const rim = S('ellipse', { cx: X((d.x0 + d.x1) / 2), cy: Y((d.y0 + d.y1) / 2), rx: X((d.x1 - d.x0) / 2) + 3, ry: Y((d.y1 - d.y0) / 2) + 3, fill: '#d8d2c6' }, g);
                prop('plate', g, { x: X(d.x0) - 8, y: Y(d.y0) - 6, width: X(d.x1 - d.x0) + 16, height: Y(d.y1 - d.y0) + 12, preserveAspectRatio: 'none' }, () => set(rim, { opacity: 0 }));
                const w = X(d.x1 - d.x0) / v.grid;
                const h = Y(d.y1 - d.y0) / v.grid;
                cells = v.cells.map(c => (c.in ? S('rect', { x: X(d.x0) + c.i * w + 0.5, y: Y(d.y0) + c.j * h + 0.5, width: w - 1, height: h - 1, rx: 3, fill: CELL.bare, opacity: 0.85 }, g) : null));
                shaker = S('g', {}, g);
                const a = S('rect', { x: -4, y: -8, width: 8, height: 12, rx: 2, fill: '#cfd4da' }, shaker);
                const b = S('rect', { x: -5, y: -10, width: 10, height: 3, rx: 1, fill: '#555' }, shaker);
                prop('shaker', shaker, { x: -8, y: -16, width: 16, height: 20 }, () => { set(a, { opacity: 0 }); set(b, { opacity: 0 }); });
            }
            v.cells.forEach((c, i) => {
                if (!cells[i]) return;
                const show = c.state !== 'bare' || v.heatmap;
                set(cells[i], { fill: CELL[c.state] || CELL.bare, opacity: c.state === 'bare' ? (v.heatmap ? 0.45 : 0.12) : 0.8, 'stroke-dasharray': c.state === 'over' ? '1 1' : '', stroke: c.state === 'over' ? '#5a2a1a' : show && c.state === 'good' ? '#8b6b2a' : 'none' });
            });
            set(shaker, { transform: `translate(${X(v.shaker.x)} ${Y(v.shaker.y) - 10})` });
        },
    };
}

export const VIEWS = Object.freeze({ slice: sliceView, stir: stirView, sear: searView, sprinkle: sprinkleView });

/** A plain dish drawing for the serve reveal: a plate with a shape coloured by how well it went (the cooked fillet picture when it exists). */
export function dishDrawing(parent, grade) {
    const svg = S('svg', { viewBox: '0 0 160 100', width: '100%', role: 'img', 'aria-label': `The finished dish, ${grade}` }, parent);
    const plate = S('g', {}, svg);
    S('ellipse', { cx: 80, cy: 60, rx: 62, ry: 30, fill: '#e9e4da' }, plate);
    S('ellipse', { cx: 80, cy: 58, rx: 50, ry: 23, fill: '#f8f5ee' }, plate);
    const color = { perfect: '#d9a441', good: '#d9b061', fair: '#cfa06a', poor: '#9a6a3a', failed: '#222' }[grade] || '#d9a441';
    const shape = S('g', {}, svg);
    S('rect', { x: 52, y: 48, width: 56, height: 18, rx: 9, fill: color }, shape);
    S('circle', { cx: 60, cy: 54, r: 1.6, fill: '#333' }, shape);
    if (grade === 'perfect' || grade === 'good') for (const [dx, dy] of [[-30, -8], [32, -6], [10, 14], [-20, 12]]) S('circle', { cx: 80 + dx, cy: 58 + dy, r: 2.4, fill: '#6aa84f' }, svg);
    prop('plate', plate, { x: 10, y: 14, width: 140, height: 84 }, () => plate.childNodes.forEach(n => n.setAttribute?.('opacity', 0)));
    if (grade !== 'failed') food('fish-fillet-cooked', svg, { x: 44, y: 28, width: 72, height: 52 }, () => shape.setAttribute('opacity', 0));
    return svg;
}
