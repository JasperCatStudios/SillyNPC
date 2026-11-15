# SillyNPC Bond Tracker regex

Import both files in SillyTavern: Extensions -> Regex -> Import (the arrow icon). Keep them enabled.

They dress the Bond Tracker block the same way your Internal States regexes dress theirs. The block is a
`<details>` whose summary says `BOND TRACKER`; your existing **FF5 UI - Menu Teal** regex already styles that
summary (it lists BOND TRACKER). Each line inside it looks like:

    - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | LEVEL: Friend

- `SillyNPC-Bond-Bars-Positive.json` matches lines where AFFECTION is zero or positive.
- `SillyNPC-Bond-Bars-Negative.json` matches lines where AFFECTION starts with `-` (red bar).
- Trust and Respect show their sign in the label; the bar length is the size of the number (0-100).
- Both run as markdown-only display regexes (placement: AI output), so they never touch the prompt.

The block itself is written by the extension (planned: Bonds phase 3). Until then the regex has nothing to match.
