/**
 * How each delivery looks (fork): size, weight, case, letter spacing, opacity, font and an optional
 * effect, written as CSS for the <span data-tone="..."> the display regex leaves in the message.
 *
 * Deliberately no colour and no tilt: a character's own dialogue keeps the colour chosen for the
 * character, and nothing here rotates or skews text. The effects move no layout: Tremble and Glow
 * are text-shadow, Fade is opacity, so a long line wraps as it always did. Pure, so it is tested
 * without a browser.
 */

/** Font choices. `css` is the font-family; `google` is the Google Fonts family spec when it must be loaded. */
export const DELIVERY_FONTS = Object.freeze({
    '': { label: 'Same as the text', css: '' },
    serif: { label: 'Serif (system)', css: 'Georgia, "Times New Roman", serif' },
    sans: { label: 'Sans (system)', css: 'system-ui, "Segoe UI", Arial, sans-serif' },
    mono: { label: 'Monospace (system)', css: 'ui-monospace, Consolas, "Courier New", monospace' },
    cormorant: { label: 'Cormorant Garamond', css: '"Cormorant Garamond", Georgia, serif', google: 'Cormorant+Garamond:wght@400;600;700' },
    cinzel: { label: 'Cinzel', css: 'Cinzel, Georgia, serif', google: 'Cinzel:wght@400;600;700' },
    lora: { label: 'Lora', css: 'Lora, Georgia, serif', google: 'Lora:wght@400;600;700' },
    caveat: { label: 'Caveat (handwriting)', css: 'Caveat, "Comic Sans MS", cursive', google: 'Caveat:wght@400;600;700' },
    special: { label: 'Special Elite (typewriter)', css: '"Special Elite", "Courier New", monospace', google: 'Special+Elite' },
    courier: { label: 'Courier Prime', css: '"Courier Prime", "Courier New", monospace', google: 'Courier+Prime:wght@400;700' },
    bebas: { label: 'Bebas Neue (tall caps)', css: '"Bebas Neue", Impact, sans-serif', google: 'Bebas+Neue' },
});

export const DELIVERY_EFFECTS = Object.freeze({
    none: 'None',
    tremble: 'Tremble',
    fade: 'Fade',
    glow: 'Glow',
});

export const DELIVERY_CASES = Object.freeze({
    none: 'As written',
    upper: 'CAPITALS',
    lower: 'lowercase',
    smallcaps: 'Small caps',
});

const BASE = Object.freeze({ size: 100, bold: false, italic: false, case: 'none', spacing: 0, opacity: 100, font: '', effect: 'none' });

/** The starting look of each delivery. Subtle on purpose; every value can be changed in Appearance. */
export const DEFAULT_DELIVERY_STYLES = Object.freeze({
    whisper: { ...BASE, size: 90, opacity: 72, spacing: 0.03 },
    shout: { ...BASE, size: 116, bold: true, case: 'upper' },
    sigh: { ...BASE, size: 95, opacity: 68, effect: 'fade' },
    laugh: { ...BASE, bold: true, size: 104 },
    cry: { ...BASE, size: 96, opacity: 82, effect: 'tremble' },
    excited: { ...BASE, size: 108, bold: true },
    playful: { ...BASE, spacing: 0.02, size: 102 },
    curious: { ...BASE },
    nervous: { ...BASE, size: 95, effect: 'tremble' },
    scared: { ...BASE, size: 92, opacity: 80, effect: 'tremble' },
    angry: { ...BASE, bold: true, size: 106 },
    tired: { ...BASE, size: 92, opacity: 66, spacing: 0.05 },
});

const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);

/** One style with every field in range and of the right kind; anything unknown falls back to plain. */
export function cleanStyle(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        size: Math.round(clamp(r.size, 50, 200, BASE.size)),
        bold: r.bold === true,
        italic: r.italic === true,
        case: Object.prototype.hasOwnProperty.call(DELIVERY_CASES, r.case) ? r.case : BASE.case,
        spacing: Math.round(clamp(r.spacing, 0, 0.5, BASE.spacing) * 100) / 100,
        opacity: Math.round(clamp(r.opacity, 20, 100, BASE.opacity)),
        font: Object.prototype.hasOwnProperty.call(DELIVERY_FONTS, r.font) ? r.font : BASE.font,
        effect: Object.prototype.hasOwnProperty.call(DELIVERY_EFFECTS, r.effect) ? r.effect : BASE.effect,
    };
}

/** The style for a tag: the owner's, else the starting one for that name, else plain. */
export function styleFor(styles, name) {
    const own = styles && typeof styles === 'object' ? styles[name] : null;
    return cleanStyle(own ?? DEFAULT_DELIVERY_STYLES[name] ?? BASE);
}

const selector = (name) => `.wk-tone[data-tone="${String(name).replace(/[^a-z0-9_-]/gi, '')}" i]`;

/** The CSS for the given tag names. */
export function deliveryCss(styles, names) {
    const out = [
        '@keyframes wk-tone-tremble { 0%, 100% { text-shadow: 0.03em 0 0 currentColor; } 25% { text-shadow: -0.03em 0.02em 0 currentColor; } 50% { text-shadow: 0.02em -0.03em 0 currentColor; } 75% { text-shadow: -0.02em 0 0 currentColor; } }',
        '@keyframes wk-tone-fade { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }',
        '@keyframes wk-tone-glow { 0%, 100% { text-shadow: 0 0 0 currentColor; } 50% { text-shadow: 0 0 0.45em currentColor; } }',
    ];
    for (const name of names) {
        const s = styleFor(styles, name);
        const rules = [];
        if (s.size !== 100) rules.push(`font-size: ${s.size}%`);
        if (s.bold) rules.push('font-weight: 700');
        if (s.italic) rules.push('font-style: italic');
        if (s.case === 'upper') rules.push('text-transform: uppercase');
        if (s.case === 'lower') rules.push('text-transform: lowercase');
        if (s.case === 'smallcaps') rules.push('font-variant: small-caps');
        if (s.spacing) rules.push(`letter-spacing: ${s.spacing}em`);
        if (s.opacity !== 100) rules.push(`opacity: ${s.opacity / 100}`);
        const font = DELIVERY_FONTS[s.font]?.css;
        if (font) rules.push(`font-family: ${font}`);
        if (s.effect === 'tremble') rules.push('animation: wk-tone-tremble 0.18s linear infinite');
        if (s.effect === 'fade') rules.push('animation: wk-tone-fade 3.2s ease-in-out infinite');
        if (s.effect === 'glow') rules.push('animation: wk-tone-glow 2.6s ease-in-out infinite');
        if (rules.length) out.push(`${selector(name)} { ${rules.join('; ')}; }`);
    }
    out.push('@media (prefers-reduced-motion: reduce) { .wk-tone[data-tone] { animation: none !important; } }');
    return out.join('\n');
}

/** The Google Fonts address for the fonts the given tags use, or '' when none needs loading. */
export function fontsUrl(styles, names) {
    const wanted = new Set();
    for (const name of names) {
        const spec = DELIVERY_FONTS[styleFor(styles, name).font]?.google;
        if (spec) wanted.add(spec);
    }
    if (!wanted.size) return '';
    return `https://fonts.googleapis.com/css2?${[...wanted].map(f => `family=${f}`).join('&')}&display=swap`;
}
