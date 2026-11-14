# Fork notes

- **Speaker tag**: replies are read for `⟦Name⟧ "line"` / `⟦Name⟧ (thought)`. Writing Rules tab → Speaker Detection (set "Tag and legacy" for old chats). Press *Restore Recommended* on Dialogue Format after changing brackets.
- **Internal States**: Tracker tab → Internal States. "After the reply" writes the preset block with a second request (own connection) and shows it under each message with the preset display regexes; "In the reply" leaves it to the preset.
- **Voices**: needs `patches/st-tts-voice-names.diff` applied to SillyTavern's `public/scripts/extensions/tts/index.js` (`git apply`). Pick voices in ST's TTS voice map.
- **Image prompts**: per character on the card; optional injection under Writing Rules.
- Point `origin` at your GitHub fork: `git remote set-url origin <url>`.
