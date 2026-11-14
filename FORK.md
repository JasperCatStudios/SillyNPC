# Fork notes

- **Speaker tag**: replies are read for `⟦Name⟧ "line"` / `⟦Name⟧ (thought)`. Writing Rules tab → Speaker Detection (set "Tag and legacy" for old chats). Press *Restore Recommended* on Dialogue Format after changing brackets.
- **Tracker**: system "Mimostein Internal States" installs and activates on first start (Manage → Systems). Chekhov and GM notebook are player-target collections.
- **Voices**: needs `patches/st-tts-voice-names.diff` applied to SillyTavern's `public/scripts/extensions/tts/index.js` (`git apply`). Pick voices in ST's TTS voice map.
- **Image prompts**: per character on the card; optional injection under Writing Rules.
- Point `origin` at your GitHub fork: `git remote set-url origin <url>`.
