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


console.log(`Wrote ${count + 2} regex files to ${out}`);
