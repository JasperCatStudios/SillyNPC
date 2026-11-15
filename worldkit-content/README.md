# Worldkit sample content

Ready-to-import files for trying Worldkit's combat without making anything first. None of it is built in: you import it yourself, the same way you would import something a friend sent you. There are no pictures, no personal characters and no lorebook entries for the three franchise packs.

```
worldkit-content/
  worlds/        a world type (the rules of a fight)
  lorebooks/     a SillyTavern lorebook for the sample world
  characters/    character packs, each with combat sheets filled in
```

## 1. The sample world: Lantern Coast Skirmishes

A harbour-town world, made with the **Create a world type** editor (Combat tab, Settings, World types) and then exported. It shows what a custom world looks like: seven stats on 0 to 100, a Physical and a Spirit damage channel, three skills graded Novice to Master (Blades, Charms, Tactics), six abilities, a Health / Wind / Resolve set of pools, and a straight-line stat bonus.

| File | What it is |
| --- | --- |
| `worlds/lantern-coast.world.json` | the world type |
| `lorebooks/Lantern_Coast.lorebook.json` | a lorebook: one entry for the world and one for each of the five people, written in the "Attributes {...}" format the lore importer reads |
| `characters/lantern-coast.characters.json` | five invented people: Marlow Reed, Sable Quill, Tobias Fenn, Ilsa Thorne and Corvin Ashby |

**To use it**

1. Combat tab, Settings, World types: **Import a world type file**, and pick `lantern-coast.world.json`. Then choose *Lantern Coast Skirmishes* under **World type**.
2. In SillyTavern, open World Info and **Import World Info** with `Lantern_Coast.lorebook.json`.
3. Open the Worldkit menu, Characters: **Import characters** and pick `lantern-coast.characters.json`. Their combat sheets come with them. Link each to its lorebook entry by name if you want their profile text in the story.
4. Open Combat, pick two of them, and fight.

## 2. Franchise cast packs

Combat sheets for a cast from each of the built-in worlds. Import the pack, then pick the matching world type in the Combat tab.

| File | World type | Who |
| --- | --- | --- |
| `characters/fire-emblem-three-houses.characters.json` | Fire Emblem | 47 characters across the Houses, the Church, the Ashen Wolves and the Enemy |
| `characters/bleach-arrancar-arc.characters.json` | Bleach | 15 characters (Soul Society, Vizards, Karakura, Espada) as they stand in the Arrancar arc |
| `characters/black-clover.characters.json` | Black Clover | 10 Magic Knights, with grimoires and the elemental wheel set |

Things to know:

- The numbers are one fan's reading of the canon, not official stats. Change anything in the Combat tab roster.
- The Bleach sheets are converted from nine-stat tables to the eight stats of the Bleach world type (for example Reiatsu is the average of Magic and Resistance). Treat them as a starting point.
- A pack carries sheets and gear only. There are no portraits and no lore, so add your own.

## Sharing your own

- **A world:** Combat, Settings, World types, **Export** on a custom world gives a `.json` file anyone can import with **Import a world type file**.
- **Characters:** the character export now includes combat sheets. Importing a file from somebody else adds the people next to yours; names already in use are renamed unless you choose otherwise.
