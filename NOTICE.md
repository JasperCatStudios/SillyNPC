# Notice

This repository is a combined work licensed under the **GNU Affero General Public License v3.0** (see `LICENSE`).

It contains:

| Part | Origin | Licence |
| :--- | :--- | :--- |
| `src/`, `index.js`, `style.css`, `index.html`, `manage.html` | [SillyNPC](https://github.com/BrutalKoala/SillyNPC) by BrutalKoala | MIT (original text in `LICENSE-MIT-SillyNPC`) |
| Fork changes: speaker tag, Internal States, voices, image prompts, module loader | JasperCatStudios | AGPL-3.0 |
| `modules/phone/` | adapted from [RPG-Phone](https://github.com/tavern-rpg-suite/RPG-Phone) by Arkana8 | AGPL-3.0 |
| `modules/games/` | adapted from [RPG-Game-Companion](https://github.com/tavern-rpg-suite/RPG-Game-Companion) by Arkana8 | AGPL-3.0 |
| `modules/games/chess.js` | [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 by Jeff Hlywa | BSD-2-Clause (notice kept in the file) |
| `src/phone-image-requests.js` and the Phone's picture-request wiring and gallery | request handling and gallery ideas adapted from [EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) by mattjaybe | MIT (original text in `LICENSE-MIT-EchoText`), rewritten under AGPL-3.0 here |

| `src/weather-fx-canvas.js`, `src/weather-fx-core.js` | weather and sky effects (canvas particle engine; sun, moon, lens flare, sunrise, sunset, night and lightning overlays; time-of-day bands) adapted from [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite), Copyright (C) 2026 Jordan (DangerDaza), itself forked from the RPG Companion extension, Copyright (C) 2024 Marysia (marinara_spaghetti) | AGPL-3.0-or-later, used here under AGPL-3.0 (notice kept in the file) |

The adapted modules were changed to use Worldkit's characters in place of SillyTavern character cards, to send requests through a SillyTavern connection profile, and to read Worldkit's speaker tags. Their original licence texts are kept beside them.

The weather files were modified for Worldkit: the particle engine was renamed and its Doom's Enhancement Suite hooks removed, the DOM sky overlays were redrawn on the canvas, and wind, intensity, density, cross-fades, random lightning with a thunder callback, reduced-motion and low-power handling, an indoor rule, sky tints for every weather and new effects (sleet, hail, leaves, petals, ash, embers, sand, heat haze, fog banks, clouds, aurora, rain on a window) were added. The planning code in `src/weather-fx-core.js` is Worldkit's own, built on the same effect set.
