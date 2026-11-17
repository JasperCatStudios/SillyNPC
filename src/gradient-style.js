/**
 * Gradients for character profiles (fork).
 *
 * The model (linear, radial and conic gradients with 2 to 5 stops, optional drifting animation) and the
 * preset gradients are adapted from the "Dialogue Colors" SillyTavern extension (sillytavern-character-colors,
 * MIT licence). Here they colour a character's profile page: the banner, the name, the section labels and the
 * frame around the portrait. Chat dialogue has its own, simpler two-colour gradient and does not use this.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const GRADIENT_TYPES = Object.freeze(['linear', 'radial', 'conic']);
export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 5;
export const DEFAULT_GRADIENT_DURATION = 8;

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, d, lo, hi) => {
    if (v === null || v === undefined || v === '') return d;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/**
 * A gradient, repaired, or null when there is nothing usable in it.
 * @returns {{ type: string, angle: number, x: number, y: number, stops: { color: string, position: number }[],
 *   animation: { enabled: boolean, duration: number, reverse: boolean } } | null}
 */
export function normalizeGradient(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!GRADIENT_TYPES.includes(value.type)) return null;
    const stops = (Array.isArray(value.stops) ? value.stops : [])
        .filter(s => s && typeof s === 'object' && HEX.test(String(s.color ?? '').trim()))
        .map(s => ({ color: String(s.color).trim().toLowerCase(), position: num(s.position, 50, 0, 100) }))
        .slice(0, MAX_GRADIENT_STOPS);
    if (stops.length < MIN_GRADIENT_STOPS) return null;
    stops.sort((a, b) => a.position - b.position);
    const animation = value.animation && typeof value.animation === 'object' ? value.animation : {};
    return {
        type: value.type,
        angle: num(value.angle, 90, 0, 360),
        x: num(value.x, 50, 0, 100),
        y: num(value.y, 50, 0, 100),
        stops,
        animation: {
            enabled: animation.enabled === true,
            duration: num(animation.duration, DEFAULT_GRADIENT_DURATION, 0.5, 120),
            reverse: animation.reverse === true,
        },
    };
}

const fmt = (n) => String(Math.round(n * 100) / 100);

/** The CSS image for a gradient, or an empty string when there is none. */
export function gradientCss(value) {
    const g = normalizeGradient(value);
    if (!g) return '';
    const stops = g.stops.map(s => `${s.color} ${fmt(s.position)}%`).join(', ');
    if (g.type === 'radial') return `radial-gradient(circle at ${fmt(g.x)}% ${fmt(g.y)}%, ${stops})`;
    if (g.type === 'conic') return `conic-gradient(from ${fmt(g.angle)}deg at ${fmt(g.x)}% ${fmt(g.y)}%, ${stops})`;
    return `linear-gradient(${fmt(g.angle)}deg, ${stops})`;
}

/** A solid colour to fall back on: the first stop. */
export function gradientFallback(value) {
    return normalizeGradient(value)?.stops[0]?.color || '';
}

// name: [type, angle, x, y, [[colour, position], ...], [animated, seconds, reverse]]
const PRESET_TABLE = {
    'sunset-ribbon': ['linear', 112, 50, 50, [['#ff6b6b', 0], ['#ff9f43', 34], ['#feca57', 67], ['#ee5a6f', 100]], [false, 8, false]],
    'aurora-drift': ['linear', 137.5, 50, 50, [['#5ee7df', 0], ['#7b61ff', 24], ['#b56cff', 50], ['#ff6ec7', 76], ['#5ee7df', 100]], [true, 10, true]],
    'moonlit-focus': ['radial', 90, 38, 30, [['#dbeafe', 0], ['#818cf8', 55], ['#312e81', 100]], [false, 8, false]],
    'ember-halo': ['radial', 90, 50, 55, [['#fde68a', 0], ['#fb923c', 42], ['#dc2626', 72], ['#450a0a', 100]], [true, 14, false]],
    'ocean-current': ['linear', 125, 50, 50, [['#67e8f9', 0], ['#22d3ee', 28], ['#2563eb', 66], ['#1e3a8a', 100]], [true, 12, true]],
    'forest-canopy': ['radial', 90, 42, 28, [['#d9f99d', 0], ['#4ade80', 38], ['#15803d', 70], ['#14532d', 100]], [false, 8, false]],
    'rose-gold': ['linear', 102, 50, 50, [['#fdf2f8', 0], ['#f9a8d4', 32], ['#d4a373', 68], ['#9f1239', 100]], [false, 8, false]],
    'cyber-pulse': ['linear', 145, 50, 50, [['#00f5d4', 0], ['#00bbf9', 24], ['#9b5de5', 50], ['#f15bb5', 76], ['#fee440', 100]], [true, 7, false]],
    'lavender-dusk': ['linear', 118, 50, 50, [['#ede9fe', 0], ['#c4b5fd', 34], ['#8b5cf6', 68], ['#4c1d95', 100]], [false, 8, false]],
    'citrus-bloom': ['radial', 90, 36, 34, [['#fef08a', 0], ['#facc15', 32], ['#f97316', 68], ['#ef4444', 100]], [true, 9, true]],
    'glacier-prism': ['linear', 72, 50, 50, [['#ecfeff', 0], ['#a5f3fc', 24], ['#67e8f9', 48], ['#38bdf8', 74], ['#6366f1', 100]], [false, 8, false]],
    'royal-velvet': ['radial', 90, 46, 35, [['#f5d0fe', 0], ['#d946ef', 40], ['#7e22ce', 72], ['#3b0764', 100]], [false, 8, false]],
    'cherry-cola': ['linear', 155, 50, 50, [['#fecdd3', 0], ['#fb7185', 35], ['#be123c', 70], ['#4c0519', 100]], [false, 8, false]],
    'desert-sky': ['linear', 128, 50, 50, [['#fde68a', 0], ['#fb923c', 34], ['#e879f9', 66], ['#7c3aed', 100]], [true, 16, false]],
    'mint-shadow': ['radial', 90, 32, 30, [['#d1fae5', 0], ['#6ee7b7', 36], ['#0f766e', 70], ['#134e4a', 100]], [true, 13, true]],
};

/** The shipped gradients, by name. */
export const GRADIENT_PRESETS = Object.freeze(Object.fromEntries(Object.entries(PRESET_TABLE).map(([name, row]) => {
    const [type, angle, x, y, stops, [enabled, duration, reverse]] = row;
    return [name, Object.freeze(normalizeGradient({
        type, angle, x, y,
        stops: stops.map(([color, position]) => ({ color, position })),
        animation: { enabled, duration, reverse },
    }))];
})));

export const GRADIENT_PRESET_NAMES = Object.freeze(Object.keys(GRADIENT_PRESETS));

/** A copy of a named preset the caller can edit, or null. */
export function presetGradient(name) {
    const preset = GRADIENT_PRESETS[name];
    return preset ? structuredClone(preset) : null;
}

/**
 * The old two-colour "Gradient dialogue text" setting (colorGradient with a text colour and a second colour) as a
 * gradient, so a character who had it keeps the same look. Null when it was not on or has no usable colours.
 */
export function legacyGradient(char) {
    if (!char || char.colorGradient !== true) return null;
    const from = HEX.test(String(char.colorText || '')) ? char.colorText : (HEX.test(String(char.color || '')) ? char.color : '');
    const to = HEX.test(String(char.colorText2 || '')) ? char.colorText2 : from;
    if (!from) return null;
    return normalizeGradient({ type: 'linear', angle: 90, stops: [{ color: from, position: 0 }, { color: to, position: 100 }] });
}

/** A plain two-colour gradient to start from. */
export function defaultGradient(color = '#d9b45a') {
    return normalizeGradient({
        type: 'linear', angle: 90,
        stops: [{ color: HEX.test(color) ? color : '#d9b45a', position: 0 }, { color: '#ffffff', position: 100 }],
    });
}
