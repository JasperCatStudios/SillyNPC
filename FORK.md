# Fork notes

- **Speaker tag**: replies are read for `⟦Name⟧ "line"` / `⟦Name⟧ (thought)`. Writing Rules tab → Speaker Detection (set "Tag and legacy" for old chats). Press *Restore Recommended* on Dialogue Format after changing brackets.
- **Internal States**: Tracker tab → Internal States. "After the reply" writes the preset block with a second request (own connection) and shows it under each message with the preset display regexes; "In the reply" leaves it to the preset.
- **Voices**: spoken straight to AllTalk (no SillyTavern TTS, no patch). Set the address and voices under Modules → Voices; each character's voice is on their page.
- **Image prompts**: per character on the card; optional injection under Writing Rules.
- Point `origin` at your GitHub fork: `git remote set-url origin <url>`.
- **Licence**: this fork is AGPL-3.0 because it includes adapted code from RPG-Phone and RPG-Game-Companion (Arkana8). See `NOTICE.md`; SillyNPC's original MIT text is in `LICENSE-MIT-SillyNPC`.
- **Modules** (`modules/`): `phone/` (messenger) and `games/` (mini-games) load on their own from `index.js` and share `modules/shim.js`, which presents SillyNPC's characters as the character cards they expect. Both send requests through a connection profile (or the main API) and read SillyNPC's speaker tags. To add another borrowed extension: copy it to `modules/<name>/<name>.js` + `<name>.css`, keep its licence file, import `characters` from `../shim.js`, and add the name to the list in `index.js`.
- **Modules tab**: Phone and Games get a card each with a switch and their own settings inside; Voices is built in. Profile text for them (text on the character page, else the linked lorebook entry, else profile fields) comes from `src/profile-text.js`.
