<p align="center">
  <img src="img/SillyNPCLogo.jpg" alt="Worldkit" width="420">
</p>

# Worldkit

[![SillyTavern Compatible](https://img.shields.io/badge/SillyTavern-Extension-crimson?style=for-the-badge&logo=electron&logoColor=white)](https://github.com/SillyTavern/SillyTavern)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](https://github.com/JasperCatStudios/WorldKit/pulls)

---

## Overview

Worldkit is made of a few parts that work together:

1. **Character Stylist** - detects speaker names in chat messages and injects character portraits, dialogue colours (solid or gradient) and speech dividers.
2. **Trackers** - Internal States, Bonds, Vitals, Inventory and Threads, each read from the story on a connection of your choosing and shown under each reply.
3. **Phone, Games and Combat** - a phone for texting characters, table games, and a combat system, each with its own window.

---

## Key Features

### Dialogue & Speaker Stylist
* **Automatic Speaker Detection:** Parses speaker prefixes (e.g., `**Character**: Dialogue`) directly from LLM output.
* **Per-Character Visuals:** Configurable avatars, custom accent colors, and speech block borders per character card.
* **Auto-Coloring for Minor NPCs:** Generates consistent, deterministic color shades for unrecognized or minor speakers without dedicated cards.
* **Faces for Strangers:** Speakers without a card draw from a pool of fallback portraits, tagged so a guard draws from the guards. A stranger keeps the same face for as long as they keep appearing.

### Trackers
* **Internal States:** what the characters think and feel, written after each reply and shown in its own section under the message.
* **Bonds:** how close each person is to you, with levels, gates and milestones the model can only propose changes to.
* **Vitals:** health, hunger, energy and mood for the people you choose, with bars.
* **Inventory:** what you carry and your money (only you by default; other characters are optional), with a currency name of your choosing.
* **Looks:** a **Look** choice at the top of the Internal States, Bonds, Vitals and Inventory menus: Default - Freaky Frankenstein (the regexes you have imported), Cozy Parchment, Persona HUD or Tactical Glass Telemetry. Picking one picks it for all four. The same looks are in the Worldkit-Content regex folder.
* **Content Kit:** a tab in the Worldkit menu that fetches the [Worldkit-Content](https://github.com/JasperCatStudios/Worldkit-Content) repository with git (the way Extensions, Install extension works; the address is pre-filled) and imports its worlds, character packs, lorebook and regex scripts with one press each.
* **Open Threads:** promises, threats, debts, secrets, deadlines and plans are caught as they are made and sent with each message until they are settled. Each thread keeps the line it came from.
* **Their own connections and prompts:** every tracker has its own entry in Connections, and its instructions are in Prompts under Tracker prompts.

### Character & World Management
* **Roster Categories:** Organize characters into distinct worlds, factions, or scenes — and limit a chat to only the categories it needs.
* **Import / Export:** Share individual character cards and system configurations between installs. Portraits and lorebook entries travel with the card.
* **Lorebook Links:** Link each character to a lorebook entry; the profile and everything else read who they are from it.

### Look
* **One Look:** a dark frame shared by the menus, the Games window and the Combat window, with a gold accent.
* **Dialogue Gradients:** a gradient editor per character (linear, radial or conic, 2 to 5 colour stops, 15 presets, optional slow drift) that paints their dialogue text. Gradients are adapted from the Dialogue Colors extension (MIT).
* **Faction Colours:** characters take their faction's colours, grouped by world.
* **Recommended for Better Visuals:** the [Moonlit Echoes](https://github.com/RivelleDays/SillyTavern-MoonlitEchoesTheme) theme.

---

## Screenshots

| In-Chat Formatting | Character Profile |
| :---: | :---: |
| ![Chat Formatting](img/chatexmp.png) | ![Character Profile](img/charcterexmp.png) |

| Character Roster / Worlds | Appearance & Themes |
| :---: | :---: |
| ![Roster](img/charactersexmp.png) | ![Themes](img/styleexmp.png) |

| Player Sheet | Token Costs |
| :---: | :---: |
| ![Player Sheet](img/playerexmp.png) | ![Stats](img/stats.png) |

---

## Installation

### Method 1: SillyTavern Extension Installer
1. Open SillyTavern and click **Extensions** (stacked blocks icon) -> **Install Extension**.
2. Paste the repository URL:
   ```text
   https://github.com/JasperCatStudios/WorldKit
   ```
3. Click **Save / Install** and refresh the page.

### Method 2: Manual Clone
Clone the repository directly into your SillyTavern installation directory:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/JasperCatStudios/WorldKit.git
```
Reload SillyTavern.

---

## Quick Start

1. **Dialogue Formatting:**
   * **Ask The Model To Format Dialogue** is on out of the box — it asks for the `**Name**:` speaker line that everything else reads.
   * If your chat is not being decorated, check it is still enabled under **Extensions -> Worldkit -> Manage Worldkit -> Writing Rules**. A persona or preset asking for a different layout is the usual cause.
2. **Assigning Avatars:**
   * When a character speaks in chat, click their name or placeholder portrait to create/open their card.
   * Upload an image, assign an accent color, and save.
3. **Enabling Trackers:**
   * Internal States, Bonds, Vitals and Threads are each switched on under the **Trackers** and **Threads** tabs.
   * Pick a connection for each one under **Connections**; left empty, they use your main API.

---

## Optional sample content

Sample worlds, character packs, a lorebook, regex scripts and Fire Emblem artwork live in a separate repository so that installing the extension does not download them: **[Worldkit-Content](https://github.com/JasperCatStudios/Worldkit-Content)**. Download it from that page only if you want it and import the files you like. The extension works fully without it.

---

## Menu Layout

Advanced settings and fine-tuning parameters remain hidden until **Show Every Setting** is enabled in the **Advanced** tab. Every page has a search box above it, so a setting can be found without knowing which tab it is on.

| Tab | Contents |
| :--- | :--- |
| **Characters** | Character cards, profiles, portraits, colours and gradients, and roster factions (with a panel to turn factions on or off per chat) |
| **Modules** | Phone, Games and Combat |
| **Appearance** | Faction themes, speech dividers, spacing, avatar shapes, and fallback faces |
| **Writing Rules** | Dialogue format, ban list, and how replies are parsed |
| **Threads** | Active plotlines, promises, debts, secrets, and deadlines |
| **Trackers** | Internal States, Bonds, Vitals and Inventory |
| **World Management** | Your worlds, the characters each one holds, saved states and import/export |
| **Connections** | The connection profile each part of Worldkit uses |
| **Vectors** | Optional vector search over the story |
| **Prompts** | Every prompt Worldkit sends, with token budgets (Phone prompts and Tracker prompts are grouped) |
| **Advanced** | Master switches, console logging, backups, and UI sizing |

---

## Development

Everything SillyTavern loads is here: `manifest.json` names `index.js` and `style.css`,
and those pull in `src/`. There is no build step — clone it into
`public/scripts/extensions/third-party/` and reload.

Verbose logging is off by default. Turn it on in **Advanced -> Log Requests To The
Console**, or from DevTools:

```js
window.SILLYNPC_DEBUG = true;
```

### Layout

| File | Role |
|---|---|
| `index.js` | Entry point, event wiring |
| `src/constants.js` | Version, theme list, prompts, debug logger |
| `src/settings.js` | Defaults and migrations (`normalizeSettings`) |
| `src/utils.js` | Escaping, JSON repair, image picking, stat-bar maths |
| `src/chat.js` | Speaker detection and avatar injection |
| `src/characters.js` | Character cards and categories |
| `src/character-transfer.js` | Sending one character to somebody else, and taking one in |
| `src/default-portraits.js` | Faces for speakers who have none |
| `src/status-logic.js` | Persona sync, worlds (systems) and saved states |
| `src/status-snapshots.js` | Per-message records, and the state as of a message |
| `src/threads.js` | What is not finished with |
| `src/ui-grid-filter.js` · `src/ui-settings-search.js` | Finding a character, and finding a setting |
| `src/banlist.js` · `src/dialogue-format.js` | Text placed into the prompt |
| `src/lorebook.js` · `src/api.js` | Lorebook linking, generation, portraits |
| `src/usage.js` | What each generator has cost |
| `src/ui-*.js` | One module per page of the menu, plus the player sheet |
| `src/scene-cast.js` | Who is in the scene |
| `src/threads-runtime.js` | Threads: their store, reading and prompt |
| `src/gradient-style.js` | Dialogue gradients (adapted from Dialogue Colors, MIT) |

---

## License

[MIT](LICENSE)

## Credits

The dialogue gradient model and its shipped gradients (`src/gradient-style.js`) are adapted from the **Dialogue Colors** SillyTavern extension (`sillytavern-character-colors`), which is MIT licensed.

---

Worldkit began as a fork of [SillyNPC](https://github.com/BrutalKoala/SillyNPC) by BrutalKoala (MIT) and includes adapted code from RPG-Phone and RPG-Game-Companion by Arkana8 (AGPL-3.0). See `NOTICE.md` for the licences. Worldkit was built from SillyNPC and keeps its credit.
