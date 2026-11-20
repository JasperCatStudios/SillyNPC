# Development

Everything SillyTavern loads is in this repository. `manifest.json` names `index.js` and `style.css`, and those pull in the rest. There is no build step: clone it into `public/scripts/extensions/third-party/` and reload.

| Folder | Role |
|---|---|
| `index.js` | Entry point and event wiring |
| `src/` | Settings, speaker detection, trackers, the menu pages and the rules for each feature |
| `modules/` | The five modules: `phone/`, `games/`, `combat/`, `activities/`, `scene/` |
| `regex/` | Looks for the tracker blocks |
| `docs/` | Guides and examples |
| `licenses/` | Notices and licence texts of the projects Worldkit builds on |

To add another borrowed extension as a module, put it in `modules/<name>/`, keep its licence text in `licenses/`, add a line to `licenses/NOTICE.md`, and add the name to the module list in `index.js`.

Verbose logging is off by default. Turn it on in **Advanced, Log Requests To The Console**.

To report a problem, see [REPORTING-BUGS.md](REPORTING-BUGS.md).
