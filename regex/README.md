# SillyNPC Bond Tracker regex

Import both files in SillyTavern: Extensions -> Regex -> Import (the arrow icon). Keep them enabled.

They dress the Bond Tracker block the same way your Internal States regexes dress theirs. The block is a
`<details>` whose summary says `BOND TRACKER`; your existing **FF5 UI - Menu Teal** regex already styles that
summary (it lists BOND TRACKER). Each line inside it looks like:

    - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | LEVEL: Friend

and, while that character's romance is switched on, with a desire field before the level:

    - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | DESIRE: 40 | LEVEL: Friend · Courting

- `SillyNPC-Bond-Bars-Positive.json` matches lines where AFFECTION is zero or positive.
- `SillyNPC-Bond-Bars-Negative.json` matches lines where AFFECTION starts with `-` (red bar).
- Trust and Respect show their sign in the label; the bar length is the size of the number (0-100).
- DESIRE is optional: when present a small pink bar is added under Respect; lines without it (older
  replies, or romance off) render exactly as before. Re-import both files to get the desire bar.
- Both run as markdown-only display regexes (placement: AI output), so they never touch the prompt.

The block is written under each reply by the Bond Tracker (Bonds tab).
