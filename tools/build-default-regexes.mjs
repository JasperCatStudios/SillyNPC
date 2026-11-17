/**
 * Builds the default look: the regex files in regex/<tracker>/ and src/default-regexes.js, which holds the same scripts so the
 * extension can apply them itself, with nothing imported into SillyTavern's Regex menu.
 *
 *   node tools/build-default-regexes.mjs
 *
 * The bond, vitals and inventory line scripts are kept as the JSON files they already are. The frames (the card around a block),
 * the Internal States menus and the context savers are written here, so there is one place to change how the default look is drawn.
 * Only display scripts go into default-regexes.js; context savers are SillyTavern regexes and stay files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const regexDir = path.join(root, 'regex');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(regexDir, rel), 'utf8'));
const idFor = (name) => { const h = crypto.createHash('sha1').update(`worldkit-default:${name}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

const display = (name, find, replace) => ({
    id: idFor(name), scriptName: name, findRegex: find, replaceString: replace, trimStrings: [], placement: [2],
    disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
});

/** A collapsed menu row: a tinted bar with the name in the accent colour, and the block's text inside when opened. */
const menu = (name, words, accent, rgb) => display(
    name,
    `/<details>\\s{0,100}<summary>([^<]{0,200}?)(${words})([^<]{0,200}?)<\\/summary>((?:(?!<\\/details>)[\\s\\S])*)<\\/details>/g`,
    `<details style="background:rgba(24,24,37,0.6);border:1px solid #313244;border-left:4px solid ${accent};border-radius:4px;margin:3px 0;"><summary style="background:linear-gradient(90deg, rgba(${rgb},0.25), rgba(${rgb},0.04));padding:10px 14px;font-weight:bold;color:${accent};cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;list-style:none;">$1$2$3</summary><div style="padding:8px 14px 10px;font-size:0.9em;line-height:1.5;color:#cdd6f4;">$4</div></details>`);

const TEAL = ['#94e2d5', '148,226,213'];
const PURPLE = ['#cba6f7', '203,166,247'];
const ORANGE = ['#fab387', '250,179,135'];
const PINK = ['#f5c2e7', '245,194,231'];
const ROSE = ['#f38ba8', '243,139,168'];

const bondsFrame = menu('Worldkit - Bonds Frame', 'BOND TRACKER', ...TEAL);
const vitalsFrame = menu('Worldkit - Vitals Frame', 'VITALS', ...ROSE);

const states = [
    // the header: a navy bar with a blue rule under it
    display('Worldkit - Internal States Frame',
        '/<details>\\s{0,100}<summary>([^<]{0,200}?INTERNAL STATES[^<]{0,200}?)<\\/summary>/g',
        '<details open style="margin:8px 0;"><summary style="background:linear-gradient(90deg,#2b2b40,#1e1e2e);border-radius:8px 8px 0 0;padding:14px 16px;border-bottom:2px solid #89b4fa;margin-bottom:6px;cursor:pointer;font-weight:bold;color:#cdd6f4;text-transform:uppercase;letter-spacing:1px;list-style:none;">$1</summary>'),
    menu('Worldkit - Internal States Menu Agendas and Locations', 'NPC AGENDAS|NPC LOCATIONS|FACTIONS|BONDS', ...TEAL),
    menu('Worldkit - Internal States Menu Chekhov and Thoughts', "QUESTS|CHEKHOV'S GUN|CHEKHOV SEEDS|INTERNAL THOUGHTS|GM'S NOTEBOOK", ...PURPLE),
    menu('Worldkit - Internal States Menu Notebook World Sim and Physics', 'WORLD SIM|PLOT MOMENTUM|DND TASK SIM|PHYSICS, ENGINE &(?:amp;)? WORLD', ...ORANGE),
    menu('Worldkit - Internal States Menu Body Scale', 'BODY SCALE', ...PINK),
    display('Worldkit - Internal States Collapse Spacing', '/<\\/details>(?:\\s|<br\\s?\\/?>|<p>|<\\/p>|[\\r\\n]){1,100}<details/g', '</details><details'),
];

const files = {
    'bonds/Worldkit-Bonds-Frame.json': bondsFrame,
    'vitals/Worldkit-Vitals-Frame.json': vitalsFrame,
};
for (const s of states) files[`internal-states/${s.scriptName.replace(/^Worldkit - /, 'Worldkit-').replace(/[^A-Za-z0-9-]+/g, '-')}.json`] = s;
// the notebook menu moved into the purple group, so its old file goes
const stale = ['internal-states/Worldkit-Internal-States-Menu-Notebook-World-Sim-and-Physics.json'];
for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(regexDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(regexDir, rel), `${JSON.stringify(data, null, 2)}\n`);
}
// the notebook menu file keeps its name, now holding the orange group
for (const rel of stale) if (!files[rel]) fs.rmSync(path.join(regexDir, rel), { force: true });

// the order each tracker's display scripts run in
const order = {
    bonds: ['bonds/Worldkit-Bonds-Frame.json', 'bonds/Worldkit-Bond-Bars-Positive.json', 'bonds/Worldkit-Bond-Bars-Negative.json'],
    vitals: ['vitals/Worldkit-Vitals-Frame.json', 'vitals/Worldkit-Vitals-Bars.json'],
    inventory: ['inventory/Worldkit-Inventory-Frame.json', 'inventory/Worldkit-Inventory-Person.json', 'inventory/Worldkit-Inventory-Item.json'],
    states: Object.keys(files).filter(f => f.startsWith('internal-states/') && !f.includes('Context-Saver')),
};
const out = {};
for (const [tracker, list] of Object.entries(order)) {
    out[tracker] = list.map(rel => {
        const s = read(rel);
        if (!s.markdownOnly) throw new Error(`${rel} is not a display script`);
        return { name: s.scriptName, find: s.findRegex, replace: s.replaceString };
    });
}
const header = `// Generated by tools/build-default-regexes.mjs from regex/<tracker>/*.json. Do not edit by hand.
// The default look: display scripts per tracker, in the order they run. Applied by the extension itself (see tracker-themes.js),
// so nothing has to be imported into SillyTavern's Regex menu.
`;
fs.writeFileSync(path.join(root, 'src', 'default-regexes.js'), `${header}export const DEFAULT_REGEXES = Object.freeze(${JSON.stringify(out, null, 4)});\n`);
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.length} scripts`).join('\n'));
