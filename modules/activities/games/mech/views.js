import { artUrls } from '../../activities-runtime.js';

/**
 * The views of the hands-on mechanics (fork): each draws the mechanic's state on a 160 x 100 stage (stage units x 160 and y 100).
 * Every piece is first a plain SVG shape, so every game is playable with NO art. When a picture for a piece is found (see
 * docs/ASSETS-README.md: the 'mech.*' keys, in your world folder, the shared folder, the preset's art or the Content Kit) it is drawn
 * over the shape, and the shape is hidden. A missing picture changes nothing.
 *
 * Pictures are placed by where the thing in them is: the inside of the saucepan, the middle of the pan, the plate. ART below says
 * where each sits in its own picture (as fractions of the picture), measured from the generated art, so the contents of the game
 * line up with the pictures. A replacement picture should keep those spots (see the notes in ASSETS-README).
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

/** Where the round part of each picture is: its size in pixels, the middle of the round part and its half-size, as picture fractions. */
export const ART = Object.freeze({
    saucepan: { w: 270, h: 268, cx: 0.37, cy: 0.5, rx: 0.235, ry: 0.145 },       // the inside of the pan, an ellipse seen from slightly above
    pan: { w: 300, h: 268, cx: 0.46, cy: 0.6, rx: 0.27, ry: 0.23 },             // the inside of the frying pan
    stove: { w: 242, h: 268, cx: 0.49, cy: 0.5, rx: 0.385, ry: 0.35 },          // the burner ring
    plate: { w: 260, h: 268, cx: 0.42, cy: 0.5, rx: 0.37, ry: 0.37 },
    board: { w: 270, h: 268, cx: 0.565, cy: 0.575, rx: 0.4, ry: 0.36 },
    fish: { w: 270, h: 270, cx: 0.585, cy: 0.465 },                             // the middle of the fillet
});

/** The box { x, y, width, height } that puts a picture's anchor at (atX, atY) when drawn at `scale` stage units per pixel. */
export function place(key, atX, atY, scale) {
    const a = ART[key];
    const width = a.w * scale;
    const height = a.h * scale;
    return { x: atX - a.cx * width, y: atY - a.cy * height, width, height };
}

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
    // A plain cutting board (a picture of one is diagonal and does not frame a cutting area, so none is used here).
    S('rect', { x: 40, y: 12, width: 116, height: 82, rx: 8, fill: '#8a5f36' }, g);
    S('rect', { x: 43, y: 15, width: 110, height: 76, rx: 6, fill: COLORS.board }, g);
    for (const y of [28, 44, 60, 76]) S('line', { x1: 48, x2: 148, y1: y, y2: y + 1.5, stroke: '#94683a', 'stroke-width': 0.6, opacity: 0.6 }, g);
    const hand = S('g', { opacity: 0 }, g);
    S('rect', { x: 6, y: 28, width: 28, height: 44, rx: 12, fill: COLORS.hand, opacity: 0.85 }, hand);
    const handLabel = S('text', { x: 20, y: 52, 'text-anchor': 'middle', 'font-size': 5, fill: '#5a3a2a' }, hand);
    handLabel.textContent = 'hold here';
    let ingredient = null;
    let lines = [];
    return {
        update(v) {
            if (!ingredient) {
                const b = v.board;
                const w = X(b.x1 - b.x0);
                const h = Y(b.y1 - b.y0);
                ingredient = S('rect', { x: X(b.x0), y: Y(b.y0), width: w, height: h, rx: 5, fill: COLORS.herb }, g);
                // The herbs are a row of bunches tiled across the cutting area, so the cut lines are on the herbs.
                const id = `herbs-${Math.random().toString(36).slice(2, 7)}`;
                const defs = S('defs', {}, g);
                const pat = S('pattern', { id, patternUnits: 'userSpaceOnUse', x: X(b.x0), y: Y(b.y0), width: h, height: h }, defs);
                food('herbs', pat, { x: 1, y: 1, width: h - 2, height: h - 2 }, () => set(ingredient, { fill: `url(#${id})` }));
                lines = v.lines.map(() => S('line', { stroke: '#fff', 'stroke-dasharray': '2 2', 'stroke-width': 0.8, y1: Y(b.y0) - 2, y2: Y(b.y1) + 2 }, g));
                if (v.controls === 'button') {
                    S('rect', { x: X(b.knifeX) - 1, y: 6, width: 2, height: 88, fill: '#cfd4da' }, g);
                    S('rect', { x: X(b.knifeX) - 4, y: 4, width: 8, height: 6, rx: 2, fill: '#555' }, g);
                }
            }
            v.lines.forEach((l, i) => {
                set(lines[i], { x1: X(l.x), x2: X(l.x), stroke: l.cut ? COLORS.cut : l.half ? '#e69138' : '#fff', 'stroke-width': l.cut ? 2.4 : l.half ? 1.6 : 0.8, 'stroke-dasharray': l.cut ? '' : '2 2' });
            });
            set(hand, { opacity: v.guard ? 1 : 0, transform: v.flinch ? 'translate(-2 0)' : '' });
        },
    };
}

/* ------------------------------------------------------------------ stir */

const POT_AT = { x: 80, y: 52 };       // the middle of the inside of the pan, on the stage
const POT_SCALE = 0.52;                // stage units per picture pixel

function stirView(svg) {
    const g = S('g', {}, svg);
    const cx = POT_AT.x;
    const cy = POT_AT.y;
    const r = 34;
    const ring = S('circle', { cx, cy, r: r + 4, fill: '#8d8d94' }, g);
    const pot = S('circle', { cx, cy, r, fill: COLORS.pot }, g);
    // The contents live in a group squashed to the pan's elliptical inside, centred where the picture's inside is.
    const inner = ART.saucepan;
    const rx = inner.rx * inner.w * POT_SCALE;
    const ry = inner.ry * inner.h * POT_SCALE;
    const contents = S('g', { transform: `translate(${cx} ${cy}) scale(1 ${ry / rx})` });
    const content = S('circle', { cx: 0, cy: 0, r: rx * 0.92, fill: COLORS.pot, opacity: 0 }, contents);
    const scorch = S('circle', { cx: rx * 0.5, cy: rx * 0.3, r: 2, fill: '#120d08', opacity: 0 }, contents);
    const dots = Array.from({ length: 7 }, (_, i) => S('circle', { r: 3.2, fill: ['#e06666', '#f1c232', '#6aa84f', '#4fa3d1', '#b4a7d6', '#f6b26b', '#76a5af'][i] }, contents));
    let withArt = false;
    prop('saucepan', g, place('saucepan', cx, cy, POT_SCALE), () => {
        withArt = true;
        set(ring, { opacity: 0 });
        set(pot, { opacity: 0 });
        content.setAttribute('opacity', 0.55);
        g.append(contents);                 // over the picture
    });
    g.append(contents);
    let angle = 0;
    const meter = S('g', {}, svg);
    S('rect', { x: 30, y: 94, width: 100, height: 4, rx: 2, fill: '#555' }, meter);
    const band = S('rect', { y: 94, height: 4, rx: 2, fill: '#6aa84f' }, meter);
    const needle = S('rect', { y: 92, width: 2, height: 8, fill: '#fff' }, meter);
    const cue = S('text', { x: 80, y: 8, 'text-anchor': 'middle', 'font-size': 7, fill: '#e69138', opacity: 0, 'font-weight': 'bold' }, svg);
    cue.textContent = 'Other way!';
    return {
        update(v, dt) {
            angle += v.speed * 360 * (dt / 1000) * (v.dir || 1);
            const blend = v.progress;
            const reach = rx * 0.78;
            dots.forEach((d, i) => {
                const a = (angle + (i * 360) / dots.length) * (Math.PI / 180);
                const rad = reach * (1 - 0.7 * blend) * (0.55 + 0.45 * ((i % 3) / 2));
                set(d, { cx: Math.cos(a) * rad, cy: Math.sin(a) * rad });
            });
            const tone = v.thick ? '#4a3f33' : COLORS.pot;
            set(pot, { fill: tone });
            set(content, { fill: tone });
            set(scorch, { r: 2 + v.scorch * 12, opacity: v.scorch > 0.02 ? 0.4 + v.scorch * 0.5 : 0 });
            const max = 3;
            set(band, { x: 30 + (v.band[0] / max) * 100, width: ((v.band[1] - v.band[0]) / max) * 100 });
            set(needle, { x: 30 + Math.min(1, v.speed / max) * 100 - 1 });
            set(cue, { opacity: v.cue ? 1 : 0 });
            void withArt;
        },
    };
}

/* ------------------------------------------------------------------ sear */

const DONE_COLOR = { pale: '#e8dcc8', 'almost golden': '#e5c27a', golden: '#d9a441', dark: '#8b5a1e', burnt: '#1d1b19' };
const PAN_AT = { x: 70, y: 66 };       // the middle of the inside of the frying pan, on the stage
const PAN_SCALE = 0.46;
const FISH_SCALE = 62 / 270;

function searView(svg) {
    const g = S('g', {}, svg);
    const panShapes = [
        S('ellipse', { cx: PAN_AT.x, cy: PAN_AT.y + 2, rx: 52, ry: 28, fill: '#bfc3c8' }, g),
        S('ellipse', { cx: PAN_AT.x, cy: PAN_AT.y, rx: 46, ry: 23, fill: COLORS.pan }, g),
        S('rect', { x: 112, y: PAN_AT.y - 2, width: 40, height: 6, rx: 3, fill: '#555' }, g),
    ];
    const flames = Array.from({ length: 5 }, (_, i) => S('ellipse', { cx: 40 + i * 15, cy: 94, rx: 4, ry: 6, fill: '#f6b26b' }, g));
    // The burner picture sits under the pan and its flame brightens with the heat; the plain flames hide when it is there.
    const stove = prop('stove', g, place('stove', PAN_AT.x, PAN_AT.y - 1, 0.62), () => flames.forEach(f => set(f, { opacity: 0 })));
    prop('pan', g, place('pan', PAN_AT.x, PAN_AT.y, PAN_SCALE), () => panShapes.forEach(p => set(p, { opacity: 0 })));
    const fish = S('g', {}, g);
    const body = S('rect', { x: -22, y: -7, width: 44, height: 14, rx: 7, fill: DONE_COLOR.pale }, fish);
    const tail = S('polygon', { points: '22,0 30,-7 30,7', fill: '#d9a441', opacity: 0.8 }, fish);
    const eye = S('circle', { cx: -15, cy: -1, r: 1.4, fill: '#333' }, fish);
    const hideFish = () => [body, tail, eye].forEach(n => set(n, { opacity: 0 }));
    // The fillet: raw underneath, cooked fading in on top as it browns. The middle of the fillet is the middle of the group.
    const fishBox = place('fish', 0, 0, FISH_SCALE);
    const raw = food('fish-fillet', fish, fishBox, hideFish);
    const cooked = food('fish-fillet-cooked', fish, { ...fishBox, opacity: 0 });
    const smoke = Array.from({ length: 4 }, (_, i) => S('circle', { cx: 60 + i * 8, cy: 34 - i * 4, r: 3 + i, fill: '#ddd', opacity: 0 }, g));
    const ringEl = S('circle', { cx: PAN_AT.x, cy: PAN_AT.y, r: 14, fill: 'none', stroke: '#6aa84f', 'stroke-width': 1.4, opacity: 0 }, g);
    const knob = S('g', {}, svg);
    S('rect', { x: 146, y: 18, width: 6, height: 64, rx: 3, fill: '#555' }, knob);
    const win = S('rect', { x: 146, width: 6, rx: 3, fill: '#6aa84f' }, knob);
    const handle = S('circle', { cx: 149, r: 6, fill: '#e69138' }, knob);
    const label = S('text', { x: 70, y: 10, 'text-anchor': 'middle', 'font-size': 6, fill: '#fff' }, svg);
    const hint = S('text', { x: 70, y: 98, 'text-anchor': 'middle', 'font-size': 5, fill: '#fff', opacity: 0.9 }, svg);
    return {
        update(v) {
            const f = v.fillets[0];
            const flight = f.flight ? f.flight.progress : null;
            const lift = flight === null ? 0 : Math.sin(flight * Math.PI) * 38;
            const flip = flight === null ? 0 : flight * 360;
            set(fish, { transform: `translate(${PAN_AT.x} ${PAN_AT.y - lift}) rotate(${flip})` });
            set(body, { fill: DONE_COLOR[f.word] || DONE_COLOR.pale });
            if (cooked.loaded) {
                const done = clamp((f.d[f.side] - (v.window[0] - 0.3)) / 0.3, 0, 1);
                set(cooked.el, { opacity: done });
                cooked.el.style.filter = `brightness(${f.word === 'burnt' ? 0.3 : f.word === 'dark' ? 0.6 : 1})`;
                if (raw.loaded) raw.el.style.filter = f.word === 'burnt' ? 'brightness(0.3)' : '';
            }
            if (stove.loaded) stove.el.style.filter = `brightness(${0.7 + v.heat * 0.6}) saturate(${0.8 + v.heat * 0.6})`;
            flames.forEach((fl, i) => set(fl, { ry: 3 + v.heat * 9, opacity: 0.4 + v.heat * 0.6, cy: 94 - v.heat * 3 + (i % 2) }));
            smoke.forEach((sm, i) => set(sm, { opacity: Math.max(0, f.smoke * 0.8 - i * 0.1), fill: f.smoke > 0.6 ? '#555' : '#ddd', cy: 38 - i * 4 - (f.smoke * 4) }));
            set(ringEl, { opacity: flight !== null && flight > 0.6 ? 1 : 0, r: 14 - Math.max(0, (flight || 0) - 0.6) * 20 });
            const top = 18 + (1 - v.window[1]) * 64;
            const h = (v.window[1] - v.window[0]) * 64;
            set(win, { y: top, height: h });
            set(handle, { cy: 82 - v.heat * 64 });
            const last = f.side >= 1;
            label.textContent = `Side ${f.side + 1} of 2: ${f.word}`;
            hint.textContent = flight !== null ? (flight > 0.5 ? 'Catch it now! (tap)' : '') : last ? (f.word === 'golden' ? 'Golden! Tap the fish to serve it.' : 'Tap the fish when it is golden to serve it.') : (v.controls === 'button' ? 'Hold to heat. Double-tap to flip.' : 'Drag the knob. Tap the fish or flick it up to flip.');
        },
    };
}

/* ------------------------------------------------------------------ sprinkle */

const CELL = { bare: '#f4efe6', some: '#ead9b8', good: '#cdb27a', over: '#b45a3c' };
const PLATE_SCALE = 0.344;

function sprinkleView(svg, step) {
    const g = S('g', {}, svg);
    let cells = [];
    let shaker = null;
    let made = false;
    return {
        update(v) {
            if (!made) {
                made = true;
                const d = v.dish;
                const mx = X((d.x0 + d.x1) / 2);
                const my = Y((d.y0 + d.y1) / 2);
                const rim = S('ellipse', { cx: mx, cy: my, rx: X((d.x1 - d.x0) / 2) + 3, ry: Y((d.y1 - d.y0) / 2) + 3, fill: '#d8d2c6' }, g);
                // The plate picture is centred on the dish, so the grid of cells sits on the plate.
                prop('plate', g, place('plate', mx, my, PLATE_SCALE), () => set(rim, { opacity: 0 }));
                // The food being seasoned is on the plate (the step's item; a plain shape when there is no picture of it).
                const dish = S('g', {}, g);
                const plain = S('rect', { x: mx - 22, y: my - 11, width: 44, height: 22, rx: 11, fill: '#d9b061' }, dish);
                const item = step?.art?.item;
                const itemBox = place('fish', mx, my, 0.2);
                if (item) food(`${item}-cooked`, dish, itemBox, () => set(plain, { opacity: 0 })); else set(plain, { opacity: 0.9 });
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
                set(cells[i], { fill: CELL[c.state] || CELL.bare, opacity: c.state === 'bare' ? (v.heatmap ? 0.45 : 0.1) : 0.8, 'stroke-dasharray': c.state === 'over' ? '1 1' : '', stroke: c.state === 'over' ? '#5a2a1a' : show && c.state === 'good' ? '#8b6b2a' : 'none' });
            });
            set(shaker, { transform: `translate(${X(v.shaker.x)} ${Y(v.shaker.y) - 10})` });
        },
    };
}

/** A view is `(svg, step) => { update(view, dtMs) }`; `step` is the script step (its art names the food or tool). */
export const VIEWS = Object.freeze({ slice: sliceView, stir: stirView, sear: searView, sprinkle: sprinkleView });

/** A plain dish drawing for the serve reveal: a plate with a shape coloured by how well it went (the cooked fillet picture when it exists). */
export function dishDrawing(parent, grade) {
    const svg = S('svg', { viewBox: '0 0 160 100', width: '100%', role: 'img', 'aria-label': `The finished dish, ${grade}` }, parent);
    const plate = S('g', {}, svg);
    S('ellipse', { cx: 80, cy: 52, rx: 40, ry: 40, fill: '#e9e4da' }, plate);
    S('ellipse', { cx: 80, cy: 52, rx: 31, ry: 31, fill: '#f8f5ee' }, plate);
    prop('plate', svg, place('plate', 80, 52, 0.4), () => plate.childNodes.forEach(n => n.setAttribute?.('opacity', 0)));
    const color = { perfect: '#d9a441', good: '#d9b061', fair: '#cfa06a', poor: '#9a6a3a', failed: '#222' }[grade] || '#d9a441';
    const shape = S('g', {}, svg);
    S('rect', { x: 52, y: 44, width: 56, height: 18, rx: 9, fill: color }, shape);
    S('circle', { cx: 60, cy: 50, r: 1.6, fill: '#333' }, shape);
    if (grade === 'perfect' || grade === 'good') for (const [dx, dy] of [[-30, -8], [32, -6], [10, 14], [-20, 12]]) S('circle', { cx: 80 + dx, cy: 52 + dy, r: 2.4, fill: '#6aa84f' }, svg);
    if (grade !== 'failed') food('fish-fillet-cooked', svg, place('fish', 80, 52, 0.23), () => shape.setAttribute('opacity', 0));
    return svg;
}
