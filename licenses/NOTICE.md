# Licence and third-party notices

**Worldkit is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).** The full text is in [`LICENSE`](../LICENSE) at the top of the repository. That is the only licence that applies to Worldkit as a whole.

This folder holds the original licence texts of the projects Worldkit builds on. They are kept because those licences require it. They do not change the licence of Worldkit.

| Part | Origin | Licence | Text |
| :--- | :--- | :--- | :--- |
| Base of `src/`, `index.js`, `style.css`, `index.html`, `manage.html` | [SillyNPC](https://github.com/BrutalKoala/SillyNPC) by BrutalKoala (Worldkit began as a fork) | MIT | [`SillyNPC-MIT.txt`](SillyNPC-MIT.txt) |
| `modules/phone/` | adapted from [RPG-Phone](https://github.com/tavern-rpg-suite/RPG-Phone) by Arkana8 | AGPL-3.0 | [`RPG-Phone.txt`](RPG-Phone.txt) |
| `modules/games/` | adapted from [RPG-Game-Companion](https://github.com/tavern-rpg-suite/RPG-Game-Companion) by Arkana8 | AGPL-3.0 | [`RPG-Game-Companion.txt`](RPG-Game-Companion.txt) |
| `modules/games/chess.js` | [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 by Jeff Hlywa | BSD-2-Clause | notice kept in the file |
| `src/phone-image-requests.js`, the Phone's picture requests and gallery | ideas and request handling adapted from [EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) by mattjaybe | MIT | [`EchoText-MIT.txt`](EchoText-MIT.txt) |
| `src/weather-fx-canvas.js`, `src/weather-fx-core.js` | weather and sky effects adapted from [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite) (Copyright (C) 2026 Jordan, DangerDaza), itself forked from the RPG Companion extension (Copyright (C) 2024 Marysia, marinara_spaghetti) | AGPL-3.0-or-later | notice kept in the files |
| `src/gradient-style.js` | dialogue gradient model adapted from the Dialogue Colors extension (`sillytavern-character-colors`) | MIT | |

## What was changed

The adapted Phone and Games modules were changed to use Worldkit's characters in place of SillyTavern character cards, to send requests through a SillyTavern connection profile, and to read Worldkit's speaker tags.

The weather files were modified for Worldkit: the particle engine was renamed and its Doom's Enhancement Suite hooks removed, the sky overlays were redrawn on the canvas, and wind, intensity, density, cross-fades, random lightning with a thunder callback, reduced-motion and low-power handling, an indoor rule, sky tints and many new effects were added. The planning code in `src/weather-fx-core.js` is Worldkit's own.

## Credits for ideas

Credits for ideas and inspiration (not code) are listed in the main [README](../README.md#credits).
