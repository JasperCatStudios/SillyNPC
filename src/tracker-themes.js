/**
 * Looks for the tracker blocks: Cozy Parchment and Persona HUD.
 *
 * Pure, so node can test it and a script can write the same regexes out as SillyTavern regex
 * files (tools/export-theme-regexes.mjs). One definition feeds both: the extension applies these
 * itself when a theme is chosen in a tracker's menu, and the exported files give the identical
 * look to anyone who prefers to import regexes.
 *
 * The visual style comes from the owner's two HTML mock-ups; the structure of each block is
 * ours (a bond line is Affection / Trust / Respect / Desire / Level, not the mock-up's single
 * bond bar), so only colours, fonts, borders and bars were taken.
 *
 * A block is a <details> whose <summary> names it. One regex restyles the opening tag and
 * summary (so the details itself becomes the card), and the line regexes turn each line into a
 * row. Lines that match nothing are left alone, so a block that does not fit still reads.
 */

import { DEFAULT_REGEXES } from './default-regexes.js';

export const THEME_PLAIN = 'plain';
export const THEME_PARCHMENT = 'parchment';
export const THEME_PERSONA = 'persona';
export const THEME_TACTICAL = 'tactical';
export const TRACKER_THEMES = Object.freeze({
    [THEME_PLAIN]: 'Default - Freaky Frankenstein',
    [THEME_PARCHMENT]: 'Cozy Parchment',
    [THEME_PERSONA]: 'Persona HUD',
    [THEME_TACTICAL]: 'Tactical Glass Telemetry',
});
/** The trackers that have a look. `states` is the Internal States template, the rest are regex-dressed. */
export const THEMED_TRACKERS = Object.freeze(['states', 'bonds', 'vitals', 'inventory']);

export const THEME_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Anton&family=Crimson+Pro:ital,wght@0,500;0,700;1,500&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap';

/* ------------------------------------------------------------------------ palettes */

const PA = { // parchment
    paper: '#f4ebd8', row: '#ece0c8', ink: '#2c1d11', edge: '#7a5c3c', track: '#d8c6a5', soft: '#694e32',
    red: '#8c2d19', green: '#2f5d3a', gold: '#9a6700', plum: '#6b3f7a', serif: "'Crimson Pro','Georgia',serif", mono: "'JetBrains Mono',monospace",
};
const PE = { // persona
    ink: '#0d0d10', row: '#17171c', edge: '#3f3f46', track: '#52525b', red: '#e60012', yellow: '#ffea00', white: '#ffffff',
    rose: '#fb7185', sky: '#38bdf8', violet: '#a855f7', mute: '#a1a1aa', sans: "'Inter',sans-serif", head: "'Anton',sans-serif",
};

const TG = { // tactical glass
    from: '#0f172a', to: '#1e293b', edge: '#334155', text: '#f8fafc', mute: '#94a3b8', dim: '#64748b',
    rose: '#f43f5e', sky: '#38bdf8', green: '#10b981', amber: '#f59e0b', mono: "'JetBrains Mono',monospace", sans: "'Inter',sans-serif",
};
const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');

const skew = (inner, style) => `<span style="${style}transform:skewX(-8deg);display:inline-block;"><span style="display:inline-block;transform:skewX(8deg);">${inner}</span></span>`;

/* -------------------------------------------------------------------------- parts */

/** The card: the <details> itself. `accent` colours the title. */
function card(theme, accent) {
    if (theme === THEME_PARCHMENT) {
        return {
            open: `<details open style="font-family:${PA.serif};background:${PA.paper};color:${PA.ink};border:2px solid ${PA.edge};border-radius:10px;padding:12px;margin:8px 0;max-width:440px;box-shadow:0 8px 20px rgba(0,0,0,.45),inset 0 0 28px rgba(122,92,60,.22);">`,
            summary: (t) => `<summary style="cursor:pointer;font-weight:700;font-size:1.05em;color:${accent};border-bottom:2px double ${PA.edge};padding-bottom:4px;margin-bottom:8px;">${t}</summary>`,
        };
    }
    if (theme === THEME_TACTICAL) {
        return {
            open: `<details open style="font-family:${TG.sans};background:linear-gradient(165deg,${TG.from} 0%,${TG.to} 100%);color:${TG.text};border:1px solid ${TG.edge};border-radius:12px;padding:12px;margin:8px 0;max-width:440px;box-shadow:0 10px 25px rgba(0,0,0,.45);">`,
            summary: (t) => `<summary style="cursor:pointer;font-weight:700;font-size:.92em;letter-spacing:.06em;color:${accent};border-bottom:1px solid ${TG.edge};padding-bottom:5px;margin-bottom:8px;">${t}</summary>`,
        };
    }
    return {
        open: `<details open style="font-family:${PE.sans};background:${PE.ink};color:${PE.white};border:3px solid ${PE.red};padding:12px;margin:8px 0;max-width:440px;box-shadow:5px 5px 0 ${PE.red};">`,
        summary: (t) => `<summary style="cursor:pointer;font-family:${PE.head};font-size:1.1em;letter-spacing:1px;background:${accent.bg};color:${accent.fg};padding:3px 12px;transform:skewX(-8deg);list-style:none;margin-bottom:8px;border-left:6px solid ${accent.edge};"><span style="display:inline-block;transform:skewX(8deg);">${t}</span></summary>`,
    };
}

function headerRegex(word) {
    return `/<details>\\s{0,8}<summary>([^<]{0,20}${word}[^<]{0,40})<\\/summary>/gi`;
}

/** A labelled bar. `label` and `value` may hold $n references. */
function bar(theme, { label, value, color, width, thin = false }) {
    if (theme === THEME_PARCHMENT) {
        return `<div style="margin-bottom:5px;"><div style="display:flex;justify-content:space-between;font-family:${PA.mono};font-size:.74em;font-weight:700;color:${color};margin-bottom:2px;"><span>${label}</span><span>${value}</span></div><div style="background:${PA.track};height:${thin ? 5 : 6}px;border-radius:3px;border:1px solid ${PA.edge};overflow:hidden;"><div style="background:${color};width:min(${width}%,100%);height:100%;"></div></div></div>`;
    }
    if (theme === THEME_TACTICAL) {
        return `<div style="margin-bottom:5px;"><div style="display:flex;justify-content:space-between;font-family:${TG.mono};font-size:.71em;color:${color};margin-bottom:2px;"><span>${label}</span><strong>${value}</strong></div><div style="background:${TG.from};height:5px;border-radius:999px;overflow:hidden;"><div style="background:${color};width:min(${width}%,100%);height:100%;border-radius:999px;"></div></div></div>`;
    }
    return `<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;font-size:.72em;font-weight:900;color:${PE.white};margin-bottom:2px;"><span style="color:${color};">${label}</span><span>${value}</span></div><div style="background:${PE.ink};height:${thin ? 5 : 7}px;border:1px solid ${PE.track};transform:skewX(-8deg);overflow:hidden;"><div style="background:${color};width:min(${width}%,100%);height:100%;"></div></div></div>`;
}

const rowBox = (theme, edge, body) => (theme === THEME_TACTICAL
    ? `<div style="background:rgba(30,41,59,.65);border:1px solid rgba(${hexRgb(edge)},.24);border-left:3px solid ${edge};border-radius:8px;padding:7px 10px;margin-bottom:7px;font-family:${TG.sans};color:${TG.text};">${body}</div>`
    : theme === THEME_PARCHMENT
    ? `<div style="background:${PA.row};border:1px solid ${PA.edge};border-left:4px solid ${edge};border-radius:6px;padding:7px 10px;margin-bottom:7px;font-family:${PA.serif};color:${PA.ink};">${body}</div>`
    : `<div style="background:${PE.row};border:1px solid ${PE.edge};border-left:5px solid ${edge};padding:7px 10px;margin-bottom:7px;font-family:${PE.sans};color:${PE.white};">${body}</div>`);

const nameTag = (theme, text) => (theme === THEME_TACTICAL
    ? `<span style="font-weight:700;font-size:.9em;color:${TG.text};">${text}</span>`
    : theme === THEME_PARCHMENT
    ? `<span style="font-weight:700;font-size:1.02em;color:${PA.ink};">${text}</span>`
    : skew(text, `font-family:${PE.head};font-size:1.02em;letter-spacing:.8px;background:${PE.white};color:${PE.ink};padding:0 9px;`));

const pill = (theme, text, color) => (theme === THEME_TACTICAL
    ? `<span style="font-family:${TG.mono};font-size:.69em;color:${color || '#fda4af'};background:rgba(${hexRgb(color || TG.rose)},.12);border:1px solid rgba(${hexRgb(color || TG.rose)},.3);padding:1px 7px;border-radius:999px;">${text}</span>`
    : theme === THEME_PARCHMENT
    ? `<span style="font-style:italic;font-size:.78em;color:${PA.soft};background:${PA.paper};border:1px solid #bfa47c;padding:1px 7px;border-radius:999px;">${text}</span>`
    : `<span style="background:#27272a;border:1px solid ${PE.track};color:${color || PE.yellow};font-size:.7em;font-weight:800;padding:1px 7px;text-transform:uppercase;letter-spacing:.4px;">${text}</span>`);

const topLine = (left, right) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;">${left}${right}</div>`;

/* ---------------------------------------------------------------------- the lines */

const NAME = '(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\u2192\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?';
const sp = '\\s{0,8}';

const BOND_FIND = (sign) => `/-?[ \\t]{0,8}(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\u2192\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?\\s{0,8}\\u2192\\s{0,8}(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?\\s{0,8}\\|\\s{0,8}AFFECTION:\\s{0,8}(${sign})(\\d{1,6})\\s{0,8}\\|\\s{0,8}TRUST:\\s{0,8}(-?)(\\d{1,6})\\s{0,8}\\|\\s{0,8}RESPECT:\\s{0,8}(-?)(\\d{1,6})(?:\\s{0,8}\\|\\s{0,8}DESIRE:\\s{0,8}(\\d{1,6}))?\\s{0,8}\\|\\s{0,8}LEVEL:\\s{0,8}([^|\\n<]{1,60}?)\\s{0,8}(?=\\n|$|<)/gi`;

function bondRow(theme, negative) {
    const P = theme === THEME_PARCHMENT;
    const T = theme === THEME_TACTICAL;
    const aff = negative ? (P ? PA.red : T ? TG.rose : PE.rose) : (P ? PA.green : T ? TG.green : '#22c55e');
    const trust = P ? PA.edge : T ? TG.sky : PE.sky;
    const resp = P ? PA.gold : T ? TG.amber : PE.yellow;
    const desire = P ? PA.plum : T ? '#c084fc' : PE.violet;
    const arrow = `<span style="color:${P ? PA.red : T ? TG.green : PE.red};">&#8596;</span>`;
    const head = topLine(
        `<span style="${P ? `font-weight:700;color:${PA.ink};` : T ? `font-weight:700;font-size:.86em;color:${TG.text};` : `font-family:${PE.head};letter-spacing:.6px;color:${PE.white};`}">$1 ${arrow} $2</span>`,
        pill(theme, '$10', P ? undefined : T ? '#6ee7b7' : PE.yellow),
    );
    const bars = bar(theme, { label: 'AFFECTION', value: '$3$4', color: aff, width: '$4' })
        + bar(theme, { label: 'TRUST', value: '$5$6', color: trust, width: '$6' })
        + bar(theme, { label: 'RESPECT', value: '$7$8', color: resp, width: '$8' })
        // DESIRE is optional: with no number the wrapper is 1 - 1 = 0 tall, so the line shows nothing.
        + `<div style="overflow:hidden;max-height:calc((1$9 - 1) * 100px);">${bar(theme, { label: 'DESIRE', value: '$9', color: desire, width: '0$9', thin: true })}</div>`;
    return rowBox(theme, P ? PA.green : T ? TG.green : PE.yellow, head + bars);
}

const VITALS_FIND = '/-?[ \\t]{0,8}(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?\\s{0,8}\\|\\s{0,8}HEALTH:\\s{0,8}(\\d{1,3}|--)\\s{0,8}\\|\\s{0,8}HUNGER:\\s{0,8}(\\d{1,3}|--)\\s{0,8}\\|\\s{0,8}MOOD:\\s{0,8}([^|\\n<]{1,40}?)\\s{0,8}\\|\\s{0,8}MOODLEVEL:\\s{0,8}(\\d{1,3})\\s{0,8}\\|\\s{0,8}ENERGY:\\s{0,8}(\\d{1,3}|--)(?:\\s{0,8}\\|\\s{0,8}NOTE:\\s{0,8}([^\\n<]{0,160}?))?\\s{0,8}(?=\\n|$|<)/gi';

function vitalsRow(theme) {
    const P = theme === THEME_PARCHMENT;
    const T = theme === THEME_TACTICAL;
    const head = topLine(nameTag(theme, '$1'), pill(theme, '$7'));
    const grid = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;">`
        + bar(theme, { label: 'HEALTH', value: '$2', color: P ? PA.red : T ? TG.rose : PE.red, width: '$2' })
        + bar(theme, { label: 'ENERGY', value: '$6', color: P ? PA.green : T ? TG.sky : PE.yellow, width: '$6' })
        + bar(theme, { label: 'HUNGER', value: '$3', color: P ? PA.gold : T ? TG.amber : PE.sky, width: '$3' })
        + bar(theme, { label: 'MOOD $4', value: '$5', color: P ? PA.plum : T ? '#c084fc' : PE.violet, width: '$5' })
        + '</div>';
    return rowBox(theme, P ? PA.red : T ? TG.rose : PE.red, head + grid);
}

// Inventory: one header line per person, then one line per item underneath it.
const INV_HEAD_FIND = '/-?[ \\t]{0,8}(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?\\s{0,8}\\|\\s{0,8}MONEY:\\s{0,8}(\\d{1,9}|--)\\s{0,8}\\|\\s{0,8}UNIT:\\s{0,8}([^|\\n<]{0,30}?)\\s{0,8}\\|\\s{0,8}ITEMS:\\s{0,8}(\\d{1,4})(?:\\s{0,8}\\|\\s{0,8}NOTE:\\s{0,8}([^\\n<]{0,160}?))?\\s{0,8}(?=\\n|$|<)/gi';
const INV_ITEM_FIND = '/-?[ \\t]{0,8}ITEM:\\s{0,8}([^|\\n<]{1,80}?)\\s{0,8}\\|\\s{0,8}QTY:\\s{0,8}(\\d{1,6})\\s{0,8}\\|\\s{0,8}KIND:\\s{0,8}([^|\\n<]{0,40}?)\\s{0,8}\\|\\s{0,8}NOTE:\\s{0,8}([^\\n<]{0,160}?)\\s{0,8}(?=\\n|$|<)/gi';

function invHead(theme) {
    const P = theme === THEME_PARCHMENT;
    if (theme === THEME_TACTICAL) {
        return `<div style="background:rgba(30,41,59,.65);border:1px solid rgba(56,189,248,.22);border-left:3px solid ${TG.sky};border-radius:8px 8px 0 0;padding:7px 10px;margin-top:7px;font-family:${TG.sans};color:${TG.text};display:flex;justify-content:space-between;align-items:center;gap:6px;"><span style="font-weight:700;font-size:.9em;">$1 <span style="font-size:.78em;font-weight:400;color:${TG.dim};">$5</span></span><span style="font-family:${TG.mono};font-size:.72em;display:flex;gap:8px;"><span style="color:${TG.mute};">ITEMS <strong style="color:#e2e8f0;">$4</strong></span><span style="color:${TG.amber};font-weight:700;">$2 <span style="text-transform:uppercase;">$3</span></span></span></div>`;
    }
    if (P) {
        return `<div style="background:${PA.row};border:1px solid ${PA.edge};border-left:4px solid ${PA.gold};border-radius:6px 6px 0 0;padding:7px 10px;margin-top:7px;font-family:${PA.serif};color:${PA.ink};display:flex;justify-content:space-between;align-items:center;gap:6px;border-bottom:1px solid ${PA.edge};"><span style="font-weight:700;">$1 <span style="font-style:italic;font-size:.78em;color:${PA.soft};">$5</span></span><span style="font-family:${PA.mono};font-size:.74em;color:#5c4328;">ITEMS <strong>$4</strong> &bull; <span style="color:${PA.gold};font-weight:700;">$2 <span style="text-transform:uppercase;">$3</span></span></span></div>`;
    }
    return `<div style="background:${PE.row};border:1px solid ${PE.edge};border-left:5px solid ${PE.white};padding:7px 10px;margin-top:7px;font-family:${PE.sans};color:${PE.white};display:flex;justify-content:space-between;align-items:center;gap:6px;"><span style="font-family:${PE.head};letter-spacing:.8px;">$1 <span style="font-family:${PE.sans};font-size:.7em;color:${PE.mute};">$5</span></span><span style="display:flex;gap:6px;font-size:.7em;font-weight:900;">${skew('ITEMS $4', `background:#27272a;color:${PE.white};padding:1px 7px;`)}${skew('<span style="text-transform:uppercase;">$2 $3</span>', `background:${PE.yellow};color:${PE.ink};padding:1px 7px;`)}</span></div>`;
}

function invItem(theme) {
    if (theme === THEME_TACTICAL) {
        return `<div style="background:rgba(15,23,42,.75);border:1px solid rgba(56,189,248,.14);border-top:none;border-radius:0 0 5px 5px;padding:3px 8px;display:flex;justify-content:space-between;align-items:center;gap:6px;font-family:${TG.sans};font-size:.76em;color:${TG.text};"><span style="display:flex;align-items:center;gap:5px;"><span style="font-weight:600;">$1</span><span style="font-family:${TG.mono};color:${TG.sky};font-size:.9em;">&times;$2</span><span style="font-family:${TG.mono};font-size:.78em;color:${TG.mute};background:${TG.to};padding:0 5px;border-radius:4px;">$3</span></span><span style="color:${TG.mute};font-size:.85em;font-style:italic;text-align:right;">$4</span></div>`;
    }
    if (theme === THEME_PARCHMENT) {
        return `<div style="background:${PA.row};border:1px solid ${PA.edge};border-top:none;border-left:4px solid ${PA.gold};padding:3px 10px;display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-family:${PA.serif};font-size:.84em;color:${PA.ink};"><span><strong>$1</strong> <span style="font-family:${PA.mono};font-size:.85em;color:${PA.edge};">&times;$2</span> <span style="font-size:.82em;color:${PA.red};font-weight:700;">[$3]</span></span><span style="font-style:italic;font-size:.82em;color:${PA.soft};text-align:right;">$4</span></div>`;
    }
    return `<div style="background:${PE.ink};border:1px solid ${PE.edge};border-top:none;border-left:5px solid ${PE.edge};padding:3px 8px;display:flex;justify-content:space-between;align-items:center;gap:6px;font-family:${PE.sans};font-size:.78em;color:${PE.white};"><span><strong>$1</strong> <span style="color:${PE.yellow};font-weight:800;font-size:.9em;">x$2</span> <span style="background:${PE.red};color:${PE.white};font-size:.74em;font-weight:800;padding:0 5px;margin-left:3px;text-transform:uppercase;">$3</span></span><span style="color:${PE.mute};font-style:italic;font-size:.85em;text-align:right;">$4</span></div>`;
}

/* --------------------------------------------------------------------- the registry */

const accents = {
    bonds: { [THEME_PARCHMENT]: PA.green, [THEME_TACTICAL]: TG.green, [THEME_PERSONA]: { bg: PE.yellow, fg: PE.ink, edge: PE.red } },
    vitals: { [THEME_PARCHMENT]: PA.red, [THEME_TACTICAL]: TG.rose, [THEME_PERSONA]: { bg: PE.red, fg: PE.white, edge: PE.yellow } },
    inventory: { [THEME_PARCHMENT]: PA.gold, [THEME_TACTICAL]: TG.sky, [THEME_PERSONA]: { bg: PE.white, fg: PE.ink, edge: PE.red } },
};
const WORD = { bonds: 'BOND TRACKER', vitals: 'VITALS', inventory: 'INVENTORY' };

/**
 * The regexes of one tracker in one theme, in the order they must run:
 * [{ name, find: '/pattern/flags', replace }]. Empty for the plain theme or an unknown one.
 */
export function themeRegexes(tracker, theme) {
    if (theme !== THEME_PARCHMENT && theme !== THEME_PERSONA && theme !== THEME_TACTICAL) return [];
    const label = { [THEME_PARCHMENT]: 'Parchment', [THEME_PERSONA]: 'Persona', [THEME_TACTICAL]: 'Tactical' }[theme];
    const c = card(theme, accents[tracker]?.[theme]);
    const nice = { bonds: 'Bonds', vitals: 'Vitals', inventory: 'Inventory' }[tracker];
    if (!nice) return [];
    const frame = { name: `Worldkit - ${nice} ${label} Frame`, find: headerRegex(WORD[tracker]), replace: `${c.open}${c.summary('$1')}` };
    if (tracker === 'bonds') {
        return [
            frame,
            { name: `Worldkit - ${nice} ${label} (Positive)`, find: BOND_FIND('\\+?'), replace: bondRow(theme, false) },
            { name: `Worldkit - ${nice} ${label} (Negative)`, find: BOND_FIND('-'), replace: bondRow(theme, true) },
        ];
    }
    if (tracker === 'vitals') return [frame, { name: `Worldkit - ${nice} ${label}`, find: VITALS_FIND, replace: vitalsRow(theme) }];
    return [
        frame,
        { name: `Worldkit - ${nice} ${label} Person`, find: INV_HEAD_FIND, replace: invHead(theme) },
        { name: `Worldkit - ${nice} ${label} Item`, find: INV_ITEM_FIND, replace: invItem(theme) },
    ];
}

/** Turns '/pattern/flags' into a RegExp. */
export function toRegExp(find) {
    const cut = find.lastIndexOf('/');
    return new RegExp(find.slice(1, cut), find.slice(cut + 1));
}

/**
 * Dresses a tracker block in a theme. The plain theme returns the html untouched (the extension
 * hands that one to SillyTavern's own regexes).
 */
export function applyThemeRegexes(html, tracker, theme) {
    let out = String(html ?? '');
    for (const r of themeRegexes(tracker, theme)) {
        try { out = out.replace(toRegExp(r.find), r.replace); } catch { /* a bad pattern leaves the block as it was */ }
    }
    return out;
}

/**
 * The default look (Default - Freaky Frankenstein): the scripts in regex/<tracker>/, applied by the extension itself. Used when no
 * look is chosen and SillyTavern's own regexes left the block untouched, so a person who has imported a set of their own keeps
 * exactly that, and a person who has imported nothing still sees a styled block.
 *
 * @param {string} html
 * @param {'states'|'bonds'|'vitals'|'inventory'} tracker
 */
export function applyDefaultRegexes(html, tracker) {
    let out = String(html ?? '');
    for (const r of DEFAULT_REGEXES[tracker] || []) {
        try { out = out.replace(toRegExp(r.find), r.replace); } catch { /* a bad pattern leaves the block as it was */ }
    }
    return out;
}

/* ---------------------------------------------------------------- Internal States */

/**
 * The Internal States template in a theme: the HTML the writing model fills in. Parchment and
 * Persona are inline-styled, so no regex is needed to dress them. Every entry is on its own line
 * ending in <br>, so several NPCs never run together. Plain is not built here (it is the
 * original template, kept in internal-states.js).
 */
export function internalStatesTemplate(theme) {
    if (theme === THEME_TACTICAL) return tacticalStatesTemplate();
    const P = theme === THEME_PARCHMENT;
    if (!P && theme !== THEME_PERSONA) return null;

    const outer = P
        ? `font-family:${PA.serif};background:#f5ebd6;color:#3b2818;border:2px solid #b89f7d;border-radius:10px;padding:18px;width:100%;max-width:580px;box-shadow:0 8px 24px rgba(0,0,0,.45),inset 0 0 40px rgba(184,159,125,.35);`
        : `font-family:${PE.sans};background:#09090b;color:#ffffff;border:3px solid #e11d48;padding:16px;width:100%;max-width:580px;position:relative;overflow:hidden;box-shadow:6px 6px 0 #e11d48;`;

    const title = P
        ? `<summary style="cursor:pointer;font-weight:700;font-size:1.15em;color:#5c3a21;border-bottom:2px double #b89f7d;padding-bottom:5px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;"><span>🎬 INTERNAL STATES (Turn: <span style="background:#e6d5b3;border:1px solid #a88b63;padding:0 6px;border-radius:4px;font-family:monospace;font-size:.85em;">[ct]</span>)</span><span style="font-size:.72em;color:#7c583a;font-style:italic;">Chronicle Ledger</span></summary>`
        : `<summary style="cursor:pointer;font-family:'Anton',sans-serif;font-size:1.25em;letter-spacing:1px;color:#09090b;background:#ffffff;padding:4px 14px;transform:skewX(-8deg);list-style:none;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;border-left:6px solid #e11d48;"><span style="transform:skewX(8deg);">🎬 INTERNAL STATES (Turn: <span style="background:#e11d48;color:#ffffff;padding:0 7px;font-family:'Inter',sans-serif;font-size:.78em;font-weight:900;">[ct]</span>)</span><span style="transform:skewX(8deg);font-family:'Inter',sans-serif;font-size:.58em;font-weight:900;background:#09090b;color:#facc15;padding:2px 7px;">LIVE TELEMETRY</span></summary>`;

    // A section box. `edge` is the persona accent colour; parchment boxes are all one colour.
    const box = (open, edge, name, body, { size = 1, bodyStyle = '', head } = {}) => {
        const o = open ? ' open' : '';
        if (P) {
            return `<details${o} style="background:#ede0c4;border:1px solid #cbb38f;border-radius:8px;padding:8px 12px;"><summary style="cursor:pointer;font-weight:700;color:#5c3a21;font-size:${size === 1 ? '.98' : '.95'}em;">${name}</summary><div style="margin-top:8px;padding-top:8px;border-top:1px dashed #b89f7d;font-size:.88em;line-height:1.45;${bodyStyle}">${body}</div></details>`;
        }
        return `<details${o} style="background:#18181b;border:1px solid #3f3f46;border-left:5px solid ${edge};padding:8px 12px;"><summary style="cursor:pointer;font-family:'Anton',sans-serif;letter-spacing:.8px;font-size:${size === 1 ? '1' : '.95'}em;color:${head || '#ffffff'};">${name}</summary><div style="margin-top:8px;padding-top:8px;border-top:1px solid #27272a;font-size:.8em;line-height:1.5;color:#e4e4e7;${bodyStyle}">${body}</div></details>`;
    };

    const nm = (t) => (P ? `<b style="color:#7f1d1d;">${t}</b>` : `<b style="color:#ffffff;background:#e11d48;padding:0 5px;">${t}</b>`);
    const nm2 = (t) => (P ? `<b style="color:#7f1d1d;">${t}</b>` : `<b style="color:#38bdf8;">${t}</b>`);
    const hi = (t) => (P ? `<span style="color:#4a3520;">${t}</span>` : `<span style="color:#facc15;font-weight:700;">${t}</span>`);
    const chip = (t) => (P
        ? `<span style="background:#f5ebd6;border:1px solid #b89f7d;padding:0 6px;border-radius:999px;font-size:.85em;font-weight:700;">${t}</span>`
        : `<span style="background:#ffffff;color:#09090b;font-weight:900;padding:0 6px;font-size:.9em;">${t}</span>`);
    const tier = (t) => (P ? `<span style="background:#e6d5b3;padding:0 5px;border-radius:4px;">${t}</span>` : `<span style="background:#e11d48;color:#fff;font-weight:800;padding:0 5px;">${t}</span>`);
    const gun = (edgeP, edgeE, label, colorP, colorE, text) => (P
        ? `<div style="background:#f5ebd6;border-left:3px solid ${edgeP};padding:4px 8px;border-radius:4px;margin-bottom:4px;">- <b style="color:${colorP};">${label}:</b> ${text}</div>`
        : `<div style="background:#09090b;border-left:4px solid ${edgeE};padding:4px 8px;margin-bottom:5px;">- <b style="color:${colorE};">${label}:</b> ${text}</div>`);

    const agendas = box(true, '#e11d48', '👤 NPC AGENDAS', `- ${nm('[NPC Name]')} | Agenda: ${hi('[task]')} | ${chip('(Step [current]/[max])')} | Aware: <i>[secrets]</i> | Fibs: <i>[lies_told]</i> | Circle: <span>[allies]</span><br>`);
    const locations = box(true, '#38bdf8', '👤 NPC LOCATIONS', `- ${nm2('[NPC Name]')} | Location: ${hi('[coords/scene, current activity]')}<br>`);
    const chekhov = box(true, '#facc15', "🔫 CHEKHOV'S GUN",
        gun('#15803d', '#22c55e', 'Active', '#14532d', '#4ade80', '[active bullets or None]')
        + gun('#b45309', '#facc15', 'Locked', '#78350f', '#facc15', '[locked bullets or None]')
        + gun('#991b1b', '#e11d48', 'Fired', '#7f1d1d', '#fb7185', '[fired bullets or None]'), { head: '#facc15' });
    const body = box(false, '#ffffff', '🧍 BODY SCALE',
        `- <b style="font-size:1.05em;">[Character Name]</b><br>`
        + `&nbsp;&nbsp;&bull; <b>🧍🏻‍♀️ Frame &amp; Stature:</b> ${tier('[S1–S5]')} [Height cm / Weight kg] — [Direct physical &amp; eye-level contrast to {{user}}]<br>`
        + `&nbsp;&nbsp;&bull; <b>🤝 Tactile &amp; Contact Scale:</b> [Hand size, wrist/waist span, shoulder width &amp; weight feel against {{user}}]<br>`
        + `&nbsp;&nbsp;&bull; <b>📐 Proportions &amp; Kinetics:</b> Bust/Chest: ${tier('[S1–S5]')} / Hips &amp; Ass: ${tier('[S1–S5]')} — [Softness vs. muscle tone, sway &amp; bounce]<br>`
        + `&nbsp;&nbsp;&bull; <b>👗 Attire Fit &amp; Posture:</b> [Current clothes, fabric tension/drape over frame, footwear &amp; exact stance]<br>`);
    const thoughts = P
        ? box(true, '', '🧠 INTERNAL THOUGHTS', `- ${nm('[NPC Name]')} <span style="background:#f5ebd6;border:1px solid #a88b63;padding:1px 7px;border-radius:999px;font-size:.82em;font-weight:700;">([In Sync / Mild Rub / Friction / Clash])</span> — <b>Body/Mood:</b> [Somatic load &amp; VAD] — <b>Thought:</b> <em style="color:#4a3520;background:#f5ebd6;padding:1px 5px;border-radius:4px;">"[Raw 1st-person thought]"</em> — <b>Stance Lock:</b> [Sustained demeanor &amp; unspoken carryover]<br>`)
        : `<details open style="background:#ffffff;color:#09090b;border-left:6px solid #e11d48;padding:8px 12px;"><summary style="cursor:pointer;font-family:'Anton',sans-serif;letter-spacing:.8px;font-size:1em;color:#09090b;">🧠 INTERNAL THOUGHTS</summary><div style="margin-top:6px;padding-top:6px;border-top:2px solid #09090b;font-size:.82em;line-height:1.45;font-weight:600;">- <b style="background:#09090b;color:#ffffff;padding:1px 6px;">[NPC Name]</b> <span style="background:#e11d48;color:#ffffff;padding:1px 6px;font-weight:800;">([In Sync / Mild Rub / Friction / Clash])</span> — <b>Body/Mood:</b> [Somatic load &amp; VAD] — <b>Thought:</b> <span style="color:#be123c;font-style:italic;font-weight:800;">"[Raw 1st-person thought]"</span> — <b>Stance Lock:</b> [Sustained demeanor &amp; unspoken carryover]<br></div></details>`;
    const notebook = box(true, '#a1a1aa', "📓 GM'S NOTEBOOK", '- [R] No active notes.<br>', { size: 2, head: '#e4e4e7' });
    const sim = box(true, '#38bdf8', '🌎 WORLD SIM',
        `- <b>Scene Mode:</b> ${P ? '<span style="background:#5c3a21;color:#f5ebd6;padding:0 6px;border-radius:4px;font-size:.85em;">[LOCKED / ACTIVE / TRANSITION]</span>' : '<span style="background:#38bdf8;color:#09090b;font-weight:900;padding:0 5px;">[LOCKED / ACTIVE / TRANSITION]</span>'}<br>`
        + '- <b>Event:</b> [Brief description of ambient detail or off-screen shift]<br>', { size: 2, head: '#38bdf8' });
    const physics = box(false, '#a855f7', '🌌 PHYSICS, ENGINE &amp; WORLD', '- <b>Env:</b> [hazards/magic/weather]<br>- <b>Physics:</b> [spatial positioning, distances, line-of-sight]<br>', { head: '#d8b4fe' });

    const row2 = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;">${notebook}${sim}</div>`;
    const gap = '<div style="display:flex;flex-direction:column;gap:8px;">';
    return [
        '<!-- GFX_START -->',
        `<div style="${outer}">`,
        '<internal_states>',
        `<details open style="margin-bottom:14px;">${title}`,
        gap,
        agendas, locations, chekhov, body, thoughts, row2, physics,
        '</div>',
        '</details>',
        '</internal_states>',
        '</div>',
        '<!-- GFX_END -->',
    ].join('\n');
}

/** The extra rule the themed templates ask for, so entries do not run together. */
export const INTERNAL_STATES_LINE_BREAK_RULE = '- Line breaks: every entry is its own line ending in <br> (every NPC under Agendas, Locations and Internal Thoughts, and each character under Body Scale), repeating the example line once per entry, so entries never run together. Keep the inline styles exactly as the template gives them.';

/**
 * Internal States in the tactical glass look. The owner's mock-up had no Internal States version
 * of this theme, so it is built here from the same palette as the other three tactical blocks.
 */
function tacticalStatesTemplate() {
    const box = (open, edge, name, body, color = TG.text) => `<details${open ? ' open' : ''} style="background:rgba(30,41,59,.65);border:1px solid rgba(${hexRgb(edge)},.24);border-left:3px solid ${edge};border-radius:8px;padding:8px 12px;"><summary style="cursor:pointer;font-weight:700;font-size:.92em;letter-spacing:.06em;color:${color};">${name}</summary><div style="margin-top:6px;padding-top:6px;border-top:1px solid ${TG.edge};font-size:.8em;line-height:1.5;color:#e2e8f0;">${body}</div></details>`;
    const nm = (t) => `<b style="color:#fda4af;">${t}</b>`;
    const mono = (t) => `<span style="font-family:${TG.mono};color:${TG.sky};">${t}</span>`;
    const chip = (t, c = TG.sky) => `<span style="font-family:${TG.mono};font-size:.85em;color:${c};background:rgba(${hexRgb(c)},.12);border:1px solid rgba(${hexRgb(c)},.3);padding:0 6px;border-radius:999px;">${t}</span>`;
    const gun = (c, label, text) => `<div style="border-left:3px solid ${c};padding:3px 8px;background:rgba(15,23,42,.75);border-radius:4px;margin-bottom:4px;">- <b style="color:${c};">${label}:</b> ${text}</div>`;
    const agendas = box(true, TG.rose, '👤 NPC AGENDAS', `- ${nm('[NPC Name]')} | Agenda: ${mono('[task]')} | ${chip('(Step [current]/[max])')} | Aware: <i>[secrets]</i> | Fibs: <i>[lies_told]</i> | Circle: <span>[allies]</span><br>`, '#fda4af');
    const locations = box(true, TG.sky, '👤 NPC LOCATIONS', `- ${nm('[NPC Name]')} | Location: ${mono('[coords/scene, current activity]')}<br>`, '#7dd3fc');
    const chekhov = box(true, TG.amber, "🔫 CHEKHOV'S GUN", gun(TG.green, 'Active', '[active bullets or None]') + gun(TG.amber, 'Locked', '[locked bullets or None]') + gun(TG.rose, 'Fired', '[fired bullets or None]'), '#fbbf24');
    const body = box(false, TG.green, '🧍 BODY SCALE',
        `- <b style="font-size:1.05em;">[Character Name]</b><br>`
        + `&nbsp;&nbsp;&bull; <b>🧍🏻‍♀️ Frame &amp; Stature:</b> ${chip('[S1–S5]')} [Height cm / Weight kg] — [Direct physical &amp; eye-level contrast to {{user}}]<br>`
        + `&nbsp;&nbsp;&bull; <b>🤝 Tactile &amp; Contact Scale:</b> [Hand size, wrist/waist span, shoulder width &amp; weight feel against {{user}}]<br>`
        + `&nbsp;&nbsp;&bull; <b>📐 Proportions &amp; Kinetics:</b> Bust/Chest: ${chip('[S1–S5]')} / Hips &amp; Ass: ${chip('[S1–S5]')} — [Softness vs. muscle tone, sway &amp; bounce]<br>`
        + `&nbsp;&nbsp;&bull; <b>👗 Attire Fit &amp; Posture:</b> [Current clothes, fabric tension/drape over frame, footwear &amp; exact stance]<br>`, '#6ee7b7');
    const thoughts = box(true, '#c084fc', '🧠 INTERNAL THOUGHTS', `- ${nm('[NPC Name]')} ${chip('([In Sync / Mild Rub / Friction / Clash])', '#c084fc')} — <b>Body/Mood:</b> [Somatic load &amp; VAD] — <b>Thought:</b> <em style="color:#e9d5ff;">"[Raw 1st-person thought]"</em> — <b>Stance Lock:</b> [Sustained demeanor &amp; unspoken carryover]<br>`, '#d8b4fe');
    const notebook = box(true, TG.mute, "📓 GM'S NOTEBOOK", '- [R] No active notes.<br>', '#cbd5e1');
    const sim = box(true, TG.sky, '🌎 WORLD SIM', `- <b>Scene Mode:</b> ${chip('[LOCKED / ACTIVE / TRANSITION]')}<br>- <b>Event:</b> [Brief description of ambient detail or off-screen shift]<br>`, '#7dd3fc');
    const physics = box(false, '#a855f7', '🌌 PHYSICS, ENGINE &amp; WORLD', '- <b>Env:</b> [hazards/magic/weather]<br>- <b>Physics:</b> [spatial positioning, distances, line-of-sight]<br>', '#d8b4fe');
    const row2 = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;">${notebook}${sim}</div>`;
    return [
        '<!-- GFX_START -->',
        `<div style="font-family:${TG.sans};background:linear-gradient(165deg,${TG.from} 0%,${TG.to} 100%);color:${TG.text};border:1px solid ${TG.edge};border-radius:12px;padding:16px;width:100%;max-width:580px;box-shadow:0 10px 25px rgba(0,0,0,.45);">`,
        '<internal_states>',
        `<details open style="margin-bottom:14px;"><summary style="cursor:pointer;font-weight:700;font-size:1.05em;letter-spacing:.06em;color:#f43f5e;border-bottom:1px solid ${TG.edge};padding-bottom:5px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;"><span>🎬 INTERNAL STATES (Turn: ${chip('[ct]', '#f43f5e')})</span><span style="font-family:${TG.mono};font-size:.7em;color:${TG.dim};">TELEMETRY</span></summary>`,
        '<div style="display:flex;flex-direction:column;gap:8px;">',
        agendas, locations, chekhov, body, thoughts, row2, physics,
        '</div>',
        '</details>',
        '</internal_states>',
        '</div>',
        '<!-- GFX_END -->',
    ].join('\n');
}
