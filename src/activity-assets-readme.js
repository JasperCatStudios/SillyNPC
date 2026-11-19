import { ASSET_MANIFEST, SOUND_TAGS, soundFileOf } from './activity-assets-manifest.js';
import { fillPattern } from './activity-assets.js';

/**
 * The asset README, written from the manifest (fork). docs/ASSETS-README.md is this function's output; a test fails when the
 * file and the manifest disagree, and `node tools/build-assets-readme.mjs` rewrites it. Pure.
 */

/** Every file name a pattern stands for, in order (one per combination of its placeholders' values). */
export function expandPattern(pattern, values = {}) {
    const keys = [...new Set([...String(pattern).matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
    if (!keys.length) return [pattern];
    let rows = [{}];
    for (const k of keys) {
        const list = values[k] || [];
        rows = rows.flatMap(r => list.map(v => ({ ...r, [k]: v })));
    }
    return rows.map(r => fillPattern(pattern, r)).filter(Boolean);
}

const names = (e, pattern) => {
    const list = expandPattern(pattern, e.values);
    return list.length ? list.map(f => `\`${f}\``).join(', ') : `\`${pattern}\``;
};

export function buildAssetsReadme(manifest = ASSET_MANIFEST) {
    const out = [];
    out.push('# Customize activity art and sounds');
    out.push('');
    out.push('> Generated from `src/activity-assets-manifest.js` by `node tools/build-assets-readme.mjs`. Do not edit by hand; change the manifest.');
    out.push('');
    out.push('You change what an activity looks like by dropping a picture with the right file name into the right folder. There is nothing to edit and nothing to restart but a page refresh. If a picture is missing, the screen shows a plain icon instead.');
    out.push('');
    out.push('## Where to put the files');
    out.push('');
    out.push('Pictures go in your SillyTavern user folder, under `user/images/worldkit-art/`:');
    out.push('');
    out.push('| For | Folder |');
    out.push('|---|---|');
    out.push('| One world only (use the preset\'s id, for example `fire-emblem`) | `user/images/worldkit-art/<world>/activities/<file>` |');
    out.push('| Every world | `user/images/worldkit-art/activities/<file>` |');
    out.push('');
    out.push('A picture is looked for in your world folder first, then in the all-worlds folder, then in the art of the installed Content Kit. `.webp` is tried first, then `.png`. The "older names" listed below still work, so art you already have keeps working.');
    out.push('');
    out.push('File names are lower case with dashes. "Roast Fish" becomes `roast-fish`.');
    out.push('');
    out.push('Pieces marked **reserved** are not used by the program yet. Their names are fixed now so art you make today will be picked up when the activity that uses it arrives.');
    out.push('');
    const groups = [...new Set(manifest.map(e => e.group))];
    for (const g of groups) {
        out.push(`## ${g}`);
        out.push('');
        for (const e of manifest.filter(x => x.group === g)) {
            out.push(`### \`${e.key}\`${e.used ? '' : ' (reserved)'}`);
            out.push('');
            out.push(e.desc);
            out.push('');
            out.push(`- Size: ${e.size}, ${e.transparent ? 'transparent background' : 'opaque'}.`);
            out.push(`- File: ${names(e, e.file)}`);
            if (e.legacy?.length) out.push(`- Older names that also work: ${e.legacy.map(l => names(e, l)).join('; ')}`);
            out.push('');
        }
    }
    out.push('## Sounds');
    out.push('');
    out.push('Sounds come from your sound map today: set its address under Activities settings. Each sound has a tag, and the tag is also its file name (`activity_tea_pour` is `activity-tea-pour.mp3`). A tag with no file is silent.');
    out.push('');
    out.push('| Tag | File |');
    out.push('|---|---|');
    for (const t of SOUND_TAGS) out.push(`| \`${t}\` | \`${soundFileOf(t)}\` |`);
    out.push('');
    return out.join('\n');
}
