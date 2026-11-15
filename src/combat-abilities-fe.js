/**
 * Fire Emblem ability library (fork). Pure data; the only import is the relic arts, which are data too.
 *
 * Costs are Energy (guard, about 33). Passives are free but rare (a few percent at middling stats),
 * attacks cost roughly 1.5 Energy for each point of power above the basic 5 (so a fighter holding
 * everything can only afford a couple), blocks about 8 Energy per full block, heals about 27 Energy
 * per whole health bar. The numbers are tuned so a character holding every ability still wins
 * only about two fights in three against an equal with none. See tests/combat/ability-library.test.mjs.
 */

import { FE_RELIC_ARTS } from './combat-abilities-fe-relics.js';

export const FE_ABILITIES = Object.freeze([
    // Crests: every crest of the game, as a rare passive flare of an inherited power. The chance follows the
    // game's own major-crest rate; effects the engine has no field for (counter-prevention, sparing spell uses)
    // are approximated and say so.
    { id: 'crest_ernest', label: 'Crest of Ernest', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.speed/39 + 1',
      effect: { dmgMult: 1.3 }, desc: 'The crest may press the attack so the foe cannot answer. Here it adds force to the blow (counter-prevention is approximated).' },
    { id: 'crest_macuil', label: 'Crest of Macuil', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/39 + 1',
      effect: { dmgMult: 1.3 }, desc: 'A crest may flare and add force to a spell.' },
    { id: 'crest_seiros', label: 'Crest of Seiros', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.presence/26 + 1',
      effect: { dmgMult: 1.4 }, desc: 'A crest may flare and add force to a combat art.' },
    { id: 'crest_dominic', label: 'Crest of Dominic', category: 'Crests', kind: 'passive', trigger: 'turnStart', chance: 'a.luck/39 + 1',
      effect: { heal: 0.08 }, desc: 'The crest may spare the cost of a spell. Here it returns some strength (resource sparing is approximated).' },
    { id: 'crest_fraldarius', label: 'Crest of Fraldarius', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/32 + 1',
      effect: { dmgMult: 1.3 }, desc: 'A crest may flare and add force to a weapon blow.' },
    { id: 'crest_noa', label: 'Crest of Noa', category: 'Crests', kind: 'passive', trigger: 'turnStart', chance: 'a.luck/39 + 1',
      effect: { heal: 0.08 }, desc: 'The crest may spare the cost of a spell. Here it returns some strength (resource sparing is approximated).' },
    { id: 'crest_cethleann', label: 'Crest of Cethleann', category: 'Crests', kind: 'passive', trigger: 'turnStart', chance: 'a.presence/32 + 1',
      effect: { heal: 0.15 }, desc: 'Recovery magic may flow stronger and mend more.' },
    { id: 'crest_daphnel', label: 'Crest of Daphnel', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.speed/26 + 1',
      effect: { dmgMult: 1.4 }, desc: 'A crest may flare and add force to a combat art.' },
    { id: 'crest_blaiddyd', label: 'Crest of Blaiddyd', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/39 + 1',
      effect: { dmgMult: 2 }, desc: 'A beast stirs in the blood and a combat art lands twice as hard.' },
    { id: 'crest_gloucester', label: 'Crest of Gloucester', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.luck/39 + 1',
      effect: { dmgMult: 1.3 }, desc: 'A crest may flare and add force to a spell.' },
    { id: 'crest_goneril', label: 'Crest of Goneril', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.speed/32 + 1',
      effect: { dmgMult: 1.3 }, desc: 'The crest may press the attack so the foe cannot answer. Here it adds force to the blow (counter-prevention is approximated).' },
    { id: 'crest_cichol', label: 'Crest of Cichol', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.presence/32 + 1',
      effect: { dmgMult: 1.3 }, desc: 'The crest may press the attack so the foe cannot answer. Here it adds force to the blow (counter-prevention is approximated).' },
    { id: 'crest_aubin', label: 'Crest of Aubin', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.speed/39 + 1',
      effect: { dmgMult: 1.3 }, desc: 'The crest may press the attack so the foe cannot answer. Here it adds force to the blow (counter-prevention is approximated).' },
    { id: 'crest_gautier', label: 'Crest of Gautier', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.accuracy/26 + 1',
      effect: { dmgMult: 1.4 }, desc: 'A crest may flare and add force to a combat art.' },
    { id: 'crest_indech', label: 'Crest of Indech', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.defense/39 + 1',
      effect: { dmgMult: 1.8 }, desc: 'The blow may come twice over.' },
    { id: 'crest_beast', label: 'Crest of The Beast', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/32 + 1',
      effect: { dmgMult: 1.3 }, desc: 'A crest may flare and add force to a weapon blow.' },
    { id: 'crest_charon', label: 'Crest of Charon', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/26 + 1',
      effect: { dmgMult: 1.4 }, desc: 'A crest may flare and add force to a combat art.' },
    { id: 'crest_timotheos', label: 'Crest of Timotheos', category: 'Crests', kind: 'passive', trigger: 'turnStart', chance: 'a.presence/39 + 1',
      effect: { heal: 0.08 }, desc: 'The crest may spare the cost of a spell. Here it returns some strength (resource sparing is approximated).' },
    { id: 'crest_riegan', label: 'Crest of Riegan', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.luck/32 + 1',
      effect: { drain: 0.3 }, desc: 'A combat art may return a third of the damage it deals as health. Not in a spar.' },
    { id: 'crest_chevalier', label: 'Crest of Chevalier', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.attack/32 + 1',
      effect: { drain: 0.3 }, desc: 'A combat art may return a third of the damage it deals as health. Not in a spar.' },
    { id: 'crest_lamine', label: 'Crest of Lamine', category: 'Crests', kind: 'passive', trigger: 'turnStart', chance: 'a.presence/39 + 1',
      effect: { heal: 0.08 }, desc: 'The crest may spare the cost of a spell. Here it returns some strength (resource sparing is approximated).' },
    { id: 'crest_flame', label: 'Crest of Flames', category: 'Crests', kind: 'passive', trigger: 'attack', chance: 'a.luck/22 + 1',
      effect: { dmgMult: 1.3, drain: 0.3 }, desc: 'Flames may flare as you strike: the blow lands harder and feeds you a share of what it deals. Not in a spar.' },

    // Combat Skills: passive skills that sharpen a blow. Chance rises with the stat they trade on.
    { id: 'wrath', label: 'Wrath', category: 'Combat Skills', kind: 'passive', trigger: 'attack', chance: 'a.attack/34 + 1',
      effect: { dmgMult: 1.1, missingBonus: 1.4 }, desc: 'The more battered you are, the harder the blow comes down.' },
    { id: 'luna', label: 'Luna', category: 'Combat Skills', kind: 'passive', trigger: 'attack', chance: 'a.accuracy/32 + 1',
      effect: { dmgMult: 1.4 }, desc: 'A cold, precise strike that slips past armour.' },
    { id: 'death_blow', label: 'Death Blow', category: 'Combat Skills', kind: 'passive', trigger: 'attack', chance: 'a.attack/34 + 1',
      effect: { dmgMult: 1.3 }, desc: 'Commit fully to the swing and trade guard for force.' },
    { id: 'quick_riposte', label: 'Quick Riposte', category: 'Combat Skills', kind: 'passive', trigger: 'attack', chance: 'a.speed/32 + 1',
      effect: { dmgMult: 1.3 }, desc: 'A swift opening turned into a stinging counter.' },
    { id: 'sol', label: 'Sol', category: 'Combat Skills', kind: 'passive', trigger: 'attack', chance: 'a.luck/32 + 1',
      effect: { drain: 0.5 }, desc: 'The blow draws the strength out of the foe and gives it to you. Not in a spar.' },
    { id: 'dauntless', label: 'Dauntless Stand', category: 'Combat Skills', kind: 'passive', trigger: 'defend', chance: 'a.presence/32 + 1',
      effect: { block: 0.3, heal: 0.15 }, desc: 'Refusing to yield, you shrug a blow off and catch your breath.' },

    // Fortune: luck-driven saves. The strongest are the rarest.
    { id: 'miracle', label: 'Miracle', category: 'Fortune', kind: 'passive', trigger: 'defend', chance: 'a.luck/19',
      effect: { block: 1 }, desc: 'Luck may turn a blow aside completely.' },
    { id: 'renewal', label: 'Renewal', category: 'Fortune', kind: 'passive', trigger: 'turnStart', chance: 'a.luck/25 + 1',
      effect: { heal: 0.15 }, desc: 'Wounds close a little each turn, as if by chance.' },

    // Defence: passive wards (rare, cost nothing) and the chosen stances below.
    { id: 'pavise', label: 'Pavise', category: 'Defence', kind: 'passive', trigger: 'defend', chance: 'a.defense/25 + 1',
      effect: { block: 0.4 }, desc: 'Raise a broad shield to blunt the worst of a blow.' },
    { id: 'aegis', label: 'Aegis', category: 'Defence', kind: 'passive', trigger: 'defend', chance: 'a.defense/32 + 1',
      effect: { block: 0.6 }, desc: 'Cover the line with a ward that nearly stops a strike.' },
    { id: 'guard_stance', label: 'Guard Stance', category: 'Defence', kind: 'defensive', cost: { pool: 'guard', amount: 2 },
      effect: { block: 0.25 }, desc: 'Tuck in behind your guard to soften the next blow.' },
    { id: 'brace', label: 'Brace', category: 'Defence', kind: 'defensive', cost: { pool: 'guard', amount: 4 },
      effect: { block: 0.5 }, desc: 'Brace to halve the next blow.' },
    { id: 'shield_wall', label: 'Shield Wall', category: 'Defence', kind: 'defensive', cost: { pool: 'guard', amount: 6 },
      effect: { block: 0.65 }, desc: 'Lock shields and let the blow break against them.' },
    { id: 'fortress_stance', label: 'Fortress Stance', category: 'Defence', kind: 'defensive', cost: { pool: 'guard', amount: 9 },
      effect: { block: 0.8 }, desc: 'Plant your feet like a fortress and take almost nothing.' },

    // Combat Arts: modest weapon arts. Cost 0.5 Energy for each point of power above basic (5).
    { id: 'smite', label: 'Smite', category: 'Combat Arts', kind: 'active', prof: 'brawling', power: 8,
      cost: { pool: 'guard', amount: 6 }, desc: 'A hard shoulder-charge that staggers the foe.' },
    { id: 'windsweep', label: 'Windsweep', category: 'Combat Arts', kind: 'active', prof: 'sword', power: 8,
      cost: { pool: 'guard', amount: 6 }, desc: 'A wide arc that cuts the air as much as the foe.' },
    { id: 'grounder', label: 'Grounder', category: 'Combat Arts', kind: 'active', prof: 'lance', power: 9,
      cost: { pool: 'guard', amount: 8 }, desc: 'A low, sweeping thrust that brings the foe down.' },
    { id: 'hunters_volley', label: "Hunter's Volley", category: 'Combat Arts', kind: 'active', prof: 'bow', power: 10,
      cost: { pool: 'guard', amount: 9 }, desc: 'Three arrows loosed before the first has landed.' },
    { id: 'tempest_lance', label: 'Tempest Lance', category: 'Combat Arts', kind: 'active', prof: 'lance', power: 12,
      cost: { pool: 'guard', amount: 12 }, desc: 'A whirling thrust that carries a gale behind it.' },
    { id: 'fiery_blast', label: 'Fiery Blast', category: 'Combat Arts', kind: 'active', prof: 'axe', power: 13,
      cost: { pool: 'guard', amount: 13 }, desc: 'The axe comes down in a burst of heat.' },
    { id: 'frenzied_slash', label: 'Frenzied Slash', category: 'Combat Arts', kind: 'active', prof: 'sword', power: 14,
      cost: { pool: 'guard', amount: 15 }, desc: 'A flurry of cuts with no thought for the return.' },
    { id: 'deadeye', label: 'Deadeye', category: 'Combat Arts', kind: 'active', prof: 'bow', power: 15,
      cost: { pool: 'guard', amount: 16 }, desc: 'One patient breath, one arrow, one clean line.' },

    // Tomes: spells. Reason is the offensive school, Faith the light school. Same pricing as Combat Arts.
    { id: 'wind', label: 'Wind', category: 'Tomes', kind: 'active', prof: 'reason', power: 7,
      cost: { pool: 'guard', amount: 4 }, desc: 'A sharp gust that cuts like a blade.' },
    { id: 'thunder', label: 'Thunder', category: 'Tomes', kind: 'active', prof: 'reason', power: 9,
      cost: { pool: 'guard', amount: 6 }, desc: 'A crack of lightning from a clear sky.' },
    { id: 'blizzard', label: 'Blizzard', category: 'Tomes', kind: 'active', prof: 'reason', power: 10,
      cost: { pool: 'guard', amount: 7 }, desc: 'A storm of ice shards driven at the foe.' },
    { id: 'thoron', label: 'Thoron', category: 'Tomes', kind: 'active', prof: 'reason', power: 12,
      cost: { pool: 'guard', amount: 10 }, desc: 'A lance of lightning thrown from afar.' },
    { id: 'meteor', label: 'Meteor', category: 'Tomes', kind: 'active', prof: 'reason', power: 14,
      cost: { pool: 'guard', amount: 13 }, desc: 'A burning stone called down from the sky.' },
    { id: 'ragnarok', label: 'Ragnarok', category: 'Tomes', kind: 'active', prof: 'reason', power: 18,
      cost: { pool: 'guard', amount: 19 }, desc: 'A ruin of fire that all but empties the caster.' },
    { id: 'seraphim', label: 'Seraphim', category: 'Tomes', kind: 'active', prof: 'faith', power: 9,
      cost: { pool: 'guard', amount: 6 }, desc: 'A burst of holy light that sears the unrighteous.' },
    { id: 'aura', label: 'Aura', category: 'Tomes', kind: 'active', prof: 'faith', power: 13,
      cost: { pool: 'guard', amount: 12 }, desc: 'A column of radiance that shines through armour.' },

    // Staves and Healing: fight-only heals. About 27 Energy per whole bar, so bigger heals cost a little more per bar.
    { id: 'heal', label: 'Heal', category: 'Staves and Healing', kind: 'defensive', cost: { pool: 'guard', amount: 4 },
      effect: { heal: 0.15 }, desc: 'A quick prayer that closes the lightest wounds. Not in a spar.' },
    { id: 'physic', label: 'Physic', category: 'Staves and Healing', kind: 'defensive', cost: { pool: 'guard', amount: 7 },
      effect: { heal: 0.25 }, desc: 'A staff of mending with a long, steady glow. Not in a spar.' },
    { id: 'recover', label: 'Recover', category: 'Staves and Healing', kind: 'defensive', cost: { pool: 'guard', amount: 8 },
      effect: { heal: 0.3 }, desc: 'Recover a third of your health. Not in a spar.' },
    { id: 'fortify', label: 'Fortify', category: 'Staves and Healing', kind: 'defensive', cost: { pool: 'guard', amount: 11 },
      effect: { heal: 0.4 }, desc: 'A great working that knits a warrior back together. Not in a spar.' },

    // Risk and Reward: they pay off when the owner is hurt, or when they are struck.
    { id: 'vantage', label: 'Vantage', category: 'Risk and Reward', kind: 'passive', trigger: 'defend', chance: 'a.speed/14 + 6',
      whenBelow: 0.5, effect: { counter: 0.8 }, desc: 'Hurt and cornered, you answer a blow before it has finished landing.' },
    { id: 'desperation', label: 'Desperation', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.luck/20 + 5',
      whenBelow: 0.35, effect: { dmgMult: 1.6 }, desc: 'With nothing left to lose, every swing is all in.' },
    { id: 'retaliation', label: 'Retaliation', category: 'Risk and Reward', kind: 'passive', trigger: 'defend', chance: 'a.presence/20 + 3',
      effect: { counter: 0.6 }, desc: 'Being hit only makes you hit back.' },
    { id: 'bloodthirst', label: 'Bloodthirst', category: 'Risk and Reward', kind: 'active', prof: 'sword', power: 9,
      cost: { pool: 'guard', amount: 12 }, effect: { drain: 0.3, missingBonus: 0.5 }, desc: 'A hungry strike that feeds on the wound it makes. Not in a spar.' },

    // The relics' own arts: each comes with its weapon (the Heroic Relics abilities became weapons).
    ...FE_RELIC_ARTS,
]);
