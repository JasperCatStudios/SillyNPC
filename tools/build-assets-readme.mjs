// Rewrites docs/ASSETS-README.md from the asset manifest. Run from the extension folder: node tools/build-assets-readme.mjs
import fs from 'node:fs';
import { buildAssetsReadme } from '../src/activity-assets-readme.js';

const target = new URL('../docs/ASSETS-README.md', import.meta.url);
fs.writeFileSync(target, `${buildAssetsReadme()}`);
console.log('wrote docs/ASSETS-README.md');
