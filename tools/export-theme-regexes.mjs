/**
 * Writes the tracker looks out as SillyTavern regex files.
 *
 *   node tools/export-theme-regexes.mjs <output folder>
 *
 * The folder gets themes/<look>/ with one regex file per script (import them all, keep them
 * enabled), the Internal States template for each look as an .html file, and the default-look
 * Inventory regex (Worldkit-Inventory.json) at its top level. The scripts come from
 * src/tracker-themes.js, the same definitions the extension applies itself, so an imported
 * look and the built-in one cannot drift apart.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { themeRegexes, THEME_PARCHMENT, THEME_PERSONA, THEME_TACTICAL } from '../src/tracker-themes.js';

const out = process.argv[2];
if (!out) {
    console.error('Usage: node tools/export-theme-regexes.mjs <output folder>');
    process.exit(1);
}

/** The same name always gives the same id, so re-exporting replaces a script instead of adding a copy. */
function idFor(name) {
    const h = crypto.createHash('sha1').update(`worldkit-theme:${name}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function script(name, find, replace) {
    return {
        id: idFor(name),
        scriptName: name,
        findRegex: find,
        replaceString: replace,
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
}

const slug = (name) => name.replace(/^Worldkit - /, 'Worldkit-').replace(/[^A-Za-z0-9()]+/g, '-').replace(/-+$/, '');
const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};

let count = 0;
for (const theme of [THEME_PARCHMENT, THEME_PERSONA, THEME_TACTICAL]) {
    for (const tracker of ['states', 'bonds', 'vitals', 'inventory']) {
        for (const r of themeRegexes(tracker, theme)) {
            write(path.join(out, 'themes', theme, `${slug(r.name)}.json`), script(r.name, r.find, r.replace));
            count++;
        }
    }
}

// The default look for Inventory, in the same dark palette as the Vitals and Bond bars.
const INV_HEAD = '/-?[ \\t]{0,8}(?:<b[^>]{0,120}>)?\\s{0,8}([^<|\\n]{1,80}?)\\s{0,8}(?:<\\/b>)?\\s{0,8}\\|\\s{0,8}MONEY:\\s{0,8}(\\d{1,9}|--)\\s{0,8}\\|\\s{0,8}UNIT:\\s{0,8}([^|\\n<]{0,30}?)\\s{0,8}\\|\\s{0,8}ITEMS:\\s{0,8}(\\d{1,4})(?:\\s{0,8}\\|\\s{0,8}NOTE:\\s{0,8}([^\\n<]{0,160}?))?\\s{0,8}(?=\\n|$|<)/gi';
const INV_ITEM = '/-?[ \\t]{0,8}ITEM:\\s{0,8}([^|\\n<]{1,80}?)\\s{0,8}\\|\\s{0,8}QTY:\\s{0,8}(\\d{1,6})\\s{0,8}\\|\\s{0,8}KIND:\\s{0,8}([^|\\n<]{0,40}?)\\s{0,8}\\|\\s{0,8}NOTE:\\s{0,8}([^\\n<]{0,160}?)\\s{0,8}(?=\\n|$|<)/gi';
const head = '<div style="background:rgba(24,24,37,0.8);border:1px solid #45475a;border-radius:6px 6px 0 0;padding:12px 14px;margin-top:12px;box-shadow:0 4px 10px rgba(0,0,0,0.3);display:flex;justify-content:space-between;align-items:baseline;gap:10px;"><span style="font-weight:bold;color:#cdd6f4;text-transform:uppercase;letter-spacing:1px;">$1 <span style="font-weight:normal;font-size:0.8em;color:#a6adc8;text-transform:none;letter-spacing:0;">$5</span></span><span style="font-size:0.85em;"><span style="color:#a6adc8;">ITEMS $4</span> <span style="color:#f9e2af;font-weight:bold;margin-left:10px;text-shadow:1px 1px 2px #000;">$2 $3</span></span></div>';
const item = '<div style="background:rgba(24,24,37,0.8);border:1px solid #45475a;border-top:none;padding:6px 14px;display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:0.9em;"><span><b style="color:#cdd6f4;">$1</b> <span style="color:#89b4fa;">x$2</span> <span style="font-size:0.8em;color:#fab387;">$3</span></span><span style="color:#a6adc8;font-style:italic;font-size:0.85em;text-align:right;">$4</span></div>';
write(path.join(out, 'Worldkit-Inventory-Person.json'), script('Worldkit - Inventory Person', INV_HEAD, head));
write(path.join(out, 'Worldkit-Inventory-Item.json'), script('Worldkit - Inventory Item', INV_ITEM, item));

console.log(`Wrote ${count + 2} regex files to ${out}`);
