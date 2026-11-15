/**
 * Black Clover ability library (fork). Pure data, no imports.
 *
 * Mana (resource) is about 64 at a middling Magic stat (20 + MAG x 0.8). Spells cost a little over
 * 3 Mana for each point of power, so a big spell takes half the pool. Stamina (guard) pays for the
 * body: reinforcement, hand-to-hand and anti-magic swordplay. A block costs about 10 to 14 per full
 * block, a heal about 75 per whole bar, as in the other worlds. Passives are free but rare.
 *
 * Grimoire gating: the Advanced Abilities need a held grimoire at a given step of the grimoire
 * ladder (combat-gear-bc.js): Runes and Mana Zone from a Tempered Three-Leaf, Spirit Dive from a
 * Four-Leaf, Ultimate Magic from an Awakened Four-Leaf, Devil Union and True Magic from a Five-Leaf,
 * Full Devil Union only from an Ascended Five-Leaf. A fighter with no gear on their sheet is not held
 * back, as in the other worlds, so older saves keep what they had. Anti-Magic arts need an
 * anti-magic blade in hand.
 *
 * The signature spells per element all follow one cost curve (cheap 4 for 13, mid 6 for 22, big 8
 * for 31), so no element is better than another on paper; what differs is the matchup, which the
 * world's elemental wheel decides (combat-elements-bc.js). Each signature spell carries its own
 * `element`, so a Fire spell clashes as Fire whoever casts it; every other spell (a grimoire's
 * basic spell, Creation Magic, the Advanced Abilities) clashes as the caster's Magic Affinity.
 * The engine does not stop a Water mage from taking a Fire spell: pick the spells that fit the sheet.
 *
 * See tests/combat/bc-abilities.test.mjs.
 */

const grim = (tier) => ({ ladder: 'grimoire', tier });

/** [id, element label, [cheap, mid, big] as [label, desc]] : three signature spells per element. */
const ELEMENT_SPELLS = [
    ['fire', 'Flame Magic', [
        ['Fire Ball', 'A tight ball of flame hurled from the open grimoire.'],
        ['Spiral Flame', 'A corkscrew of fire that bores through a guard.'],
        ['Leo Rugiens', 'A great lion of flame leaps out and bites down.'],
    ]],
    ['water', 'Water Magic', [
        ['Water Bullet', 'A hard pellet of water fired like a stone from a sling.'],
        ['Torrent Lance', 'A spear of rushing water driven at the chest.'],
        ['Sea Dragon\'s Roar', 'A dragon of seawater surges out and crashes down.'],
    ]],
    ['plant', 'Plant Magic', [
        ['Vine Lash', 'A whip of green vine cracks across the foe.'],
        ['Thorn Barrage', 'A storm of thorns, each a needle of hardwood.'],
        ['Great Tree Crush', 'A trunk rises from the ground and falls like a hammer.'],
    ]],
    ['lightning', 'Lightning Magic', [
        ['Spark Needle', 'A quick needle of lightning, gone before it is seen.'],
        ['Thunder Crumbling Orb', 'Orbs of lightning that burst against whatever they touch.'],
        ['Thunder God\'s Roar', 'A column of lightning comes down with a crack like the sky breaking.'],
    ]],
    ['earth', 'Earth Magic', [
        ['Stone Bullet', 'A fist of rock shot from the ground.'],
        ['Earth Spike', 'The ground splits and a stone spike drives upward.'],
        ['Rock Titan\'s Fist', 'A giant arm of stone tears free and swings.'],
    ]],
    ['ice', 'Ice Magic', [
        ['Ice Shards', 'A spray of frozen splinters, sharp as glass.'],
        ['Glacier Lance', 'A lance of blue ice driven through the air.'],
        ['Absolute Zero', 'The cold closes in from every side at once.'],
    ]],
    ['wind', 'Wind Magic', [
        ['Wind Blade', 'A blade of compressed air, thrown with a flick.'],
        ['Wind Blade Shower', 'A rain of air blades from above.'],
        ['Towering Tornado', 'A spinning column of wind lifts and batters the foe.'],
    ]],
    ['light', 'Light Magic', [
        ['Light Arrow', 'A bolt of pure light, almost too fast to dodge.'],
        ['Light Blades', 'A ring of shining swords turns on the foe.'],
        ['Light Sword of Judgment', 'Countless blades of light rain down in judgment.'],
    ]],
    ['dark', 'Dark Magic', [
        ['Shadow Grasp', 'A hand of shadow reaches out of the foe\'s own darkness.'],
        ['Dark Cloaked Blade', 'A blade wrapped in darkness that swallows the light around it.'],
        ['Dark Cloaked Dimension Slash', 'A cut of darkness so deep it splits the space before it.'],
    ]],
    ['illusion', 'Illusion Magic', [
        ['Phantom Needle', 'The foe flinches from one needle and is struck by the real one.'],
        ['Mirage Assault', 'Many copies attack at once; only some of them are false.'],
        ['Nightmare Realm', 'The foe is dragged into a waking nightmare that hurts like the real thing.'],
    ]],
];

const CURVE = [[4, 13], [6, 22], [8, 31]];

const elementSpells = ELEMENT_SPELLS.flatMap(([id, category, spells]) => spells.map(([label, desc], i) => ({
    id: `${id}_${['minor', 'mid', 'major'][i]}`,
    label,
    category,
    kind: 'active',
    prof: 'mana_control',
    element: id,
    power: CURVE[i][0],
    cost: { pool: 'resource', amount: CURVE[i][1] },
    desc,
})));

export const BC_ABILITIES = Object.freeze([
    // Advanced Abilities: each needs a held grimoire at that step of the grimoire ladder. Cost climbs a little faster than power.
    { id: 'mana_zone', label: 'Mana Zone', category: 'Advanced Abilities', kind: 'active', prof: 'mana_control', power: 9,
      cost: { pool: 'resource', amount: 34 }, needs: grim('tempered_three'), desc: 'Your mana floods the space around you, and every spell inside it lands from every side.' },
    { id: 'spirit_dive', label: 'Spirit Dive', category: 'Advanced Abilities', kind: 'active', prof: 'mana_control', power: 10,
      cost: { pool: 'resource', amount: 35 }, needs: grim('four_leaf'), desc: 'Wrap yourself in your own magic and strike as part of it.' },
    { id: 'ultimate_magic', label: 'Ultimate Magic', category: 'Advanced Abilities', kind: 'active', prof: 'mana_control', power: 11,
      cost: { pool: 'resource', amount: 36 }, needs: grim('awakened_four'), desc: 'The last page of the grimoire, written for you alone, opens at last.' },
    { id: 'true_magic', label: 'True Magic', category: 'Advanced Abilities', kind: 'active', prof: 'mana_control', power: 12,
      cost: { pool: 'resource', amount: 37 }, needs: grim('five_leaf'), desc: 'Magic of the devil\'s own kind, drawn through the fifth leaf.' },
    { id: 'full_devil_union', label: 'Full Devil Union', category: 'Advanced Abilities', kind: 'active', prof: 'mana_control', power: 13,
      cost: { pool: 'resource', amount: 38 }, needs: grim('ascended_five'), desc: 'Body and devil become one for a heartbeat, and the blow carries both.' },
    { id: 'runes', label: 'Rune Ward', category: 'Advanced Abilities', kind: 'defensive', cost: { pool: 'resource', amount: 7.5 },
      effect: { block: 0.6 }, needs: grim('tempered_three'), desc: 'Runes written in mana hang in the air and turn a blow aside.' },
    { id: 'devil_union', label: 'Devil Union', category: 'Advanced Abilities', kind: 'passive', trigger: 'attack', chance: 'a.presence/47',
      effect: { dmgMult: 1.8 }, needs: grim('five_leaf'), desc: 'The devil in the grimoire lends its strength for one terrible blow.' },

    // Signature spells, three per element (cheap, mid, big), all on the same curve.
    ...elementSpells,

    // Barriers and defensive magic: chosen blocks, paid in Mana. About 12 Mana per full block.
    { id: 'mana_skin', label: 'Mana Skin', category: 'Defensive Magic', kind: 'defensive', cost: { pool: 'resource', amount: 3 },
      effect: { block: 0.25 }, desc: 'A thin coat of mana over the skin that dulls the next blow.' },
    { id: 'elemental_barrier', label: 'Elemental Barrier', category: 'Defensive Magic', kind: 'defensive', cost: { pool: 'resource', amount: 5 },
      effect: { block: 0.4 }, desc: 'A wall of your own element rises between you and the strike.' },
    { id: 'spatial_portal', label: 'Spatial Magic: Portal', category: 'Unique Magic', kind: 'defensive', cost: { pool: 'resource', amount: 6.5 },
      effect: { block: 0.5 }, desc: 'A portal opens and swallows half the blow somewhere else.' },
    { id: 'barrier_dome', label: 'Barrier Magic: Dome', category: 'Defensive Magic', kind: 'defensive', cost: { pool: 'resource', amount: 9 },
      effect: { block: 0.7 }, desc: 'A dome of hardened mana closes over you.' },
    { id: 'time_stasis', label: 'Time Magic: Stasis', category: 'Unique Magic', kind: 'defensive', cost: { pool: 'resource', amount: 11 },
      effect: { block: 0.8 }, desc: 'Time stops for the blow and starts again once you have stepped aside.' },

    // Healing Magic: fight-only heals. About 75 Mana per whole bar.
    { id: 'healing_mend', label: 'Healing Magic: Mend', category: 'Healing Magic', kind: 'defensive', cost: { pool: 'resource', amount: 8 },
      effect: { heal: 0.1 }, desc: 'Closes small wounds with a touch. Not in a spar.' },
    { id: 'recovery_magic', label: 'Recovery Magic', category: 'Healing Magic', kind: 'defensive', cost: { pool: 'resource', amount: 15 },
      effect: { heal: 0.18 }, desc: 'Mends a good part of your health. Not in a spar.' },
    { id: 'restoration', label: 'Restoration Magic', category: 'Healing Magic', kind: 'defensive', cost: { pool: 'resource', amount: 22 },
      effect: { heal: 0.28 }, desc: 'Grave wounds knit under a warm light. Not in a spar.' },
    { id: 'mana_regeneration', label: 'Mana Regeneration', category: 'Healing Magic', kind: 'passive', trigger: 'turnStart', chance: 'a.endurance/39 + 1',
      effect: { heal: 0.1 }, desc: 'Mana keeps the body mending itself between blows. Not in a spar.' },

    // Creation Magic: shaping mana into weapons and constructs. Scales on the Creation Magic skill.
    { id: 'forged_arms', label: 'Creation Magic: Forged Arms', category: 'Creation Magic', kind: 'active', prof: 'creation', power: 5,
      cost: { pool: 'resource', amount: 18 }, desc: 'Weapons made of your element take shape in the air and strike.' },
    { id: 'guardian_construct', label: 'Creation Magic: Guardian Construct', category: 'Creation Magic', kind: 'active', prof: 'creation', power: 7,
      cost: { pool: 'resource', amount: 28 }, desc: 'A great construct of your magic rises and fights at your side for a blow.' },

    // Reinforcement Magic: mana poured into the body, paid in Stamina.
    { id: 'reinforced_strike', label: 'Reinforced Strike', category: 'Reinforcement Magic', kind: 'active', prof: 'reinforcement', power: 4,
      cost: { pool: 'guard', amount: 12 }, desc: 'Mana floods the arm and the blow lands like a hammer.' },
    { id: 'full_body_reinforcement', label: 'Full-Body Reinforcement', category: 'Reinforcement Magic', kind: 'active', prof: 'reinforcement', power: 6,
      cost: { pool: 'guard', amount: 22 }, desc: 'Every muscle reinforced at once for one overwhelming strike.' },
    { id: 'reinforced_guard', label: 'Reinforcement Guard', category: 'Reinforcement Magic', kind: 'defensive', cost: { pool: 'guard', amount: 7 },
      effect: { block: 0.5 }, desc: 'Harden the body with mana and take the hit on it.' },

    // Hand-to-Hand Combat: fists, feet and blades, paid in Stamina.
    { id: 'ki_strike', label: 'Ki Strike', category: 'Hand-to-Hand Combat', kind: 'active', prof: 'hand_to_hand', power: 4,
      cost: { pool: 'guard', amount: 11 }, desc: 'Read the foe\'s ki and hit where they are open.' },
    { id: 'crushing_blow', label: 'Crushing Blow', category: 'Hand-to-Hand Combat', kind: 'active', prof: 'hand_to_hand', power: 6,
      cost: { pool: 'guard', amount: 19 }, desc: 'A full-weight blow from a body trained past its limits.' },
    { id: 'ki_parry', label: 'Ki Parry', category: 'Hand-to-Hand Combat', kind: 'defensive', cost: { pool: 'guard', amount: 8.5 },
      effect: { block: 0.6 }, desc: 'Feel the strike coming through the ki and meet it early.' },

    // Anti-Magic: swordplay with an anti-magic blade. Each needs one in hand.
    { id: 'black_meteorite', label: 'Black Meteorite', category: 'Anti-Magic', kind: 'active', prof: 'hand_to_hand', power: 8,
      cost: { pool: 'guard', amount: 27 }, needs: { kind: ['anti_magic_blade'] }, desc: 'A falling cut of anti-magic that tears through any spell in its path.' },
    { id: 'black_divider', label: 'Black Divider', category: 'Anti-Magic', kind: 'active', prof: 'hand_to_hand', power: 9,
      cost: { pool: 'guard', amount: 30 }, needs: { kind: ['anti_magic_blade'], tier: 'silver' }, desc: 'A wave of anti-magic thrown off a great blade, cutting magic and flesh alike.' },
    { id: 'anti_magic_deflect', label: 'Anti-Magic Deflection', category: 'Anti-Magic', kind: 'defensive', cost: { pool: 'guard', amount: 10 },
      effect: { block: 0.75 }, needs: { kind: ['anti_magic_blade'] }, desc: 'Swing the blade into the spell and send most of it back the way it came.' },

    // Mana Sensory: reading mana before it moves. Rare, free.
    { id: 'mana_sensing', label: 'Mana Sensing', category: 'Mana Sensory', kind: 'passive', trigger: 'defend', chance: 'a.awareness/27',
      effect: { block: 0.35 }, desc: 'You feel the spell gather and are already moving.' },
    { id: 'ki_sense', label: 'Ki Sense', category: 'Mana Sensory', kind: 'passive', trigger: 'defend', chance: 'a.awareness/23',
      effect: { block: 0.45 }, desc: 'The intent behind a blow is clear a moment before it lands.' },
    { id: 'mana_surge', label: 'Mana Surge', category: 'Mana Control', kind: 'passive', trigger: 'attack', chance: 'a.presence/39 + 1',
      effect: { dmgMult: 1.5 }, desc: 'Your mana may surge past its usual bounds into a spell.' },

    // Teamwork / Strategy: fighting as a squad, reading the field.
    { id: 'combination_magic', label: 'Combination Magic', category: 'Teamwork / Strategy', kind: 'passive', trigger: 'attack', chance: 'a.presence/39',
      effect: { dmgMult: 1.4 }, desc: 'A spell timed to an ally\'s, so the two land as one.' },
    { id: 'squad_tactics', label: 'Squad Tactics', category: 'Teamwork / Strategy', kind: 'passive', trigger: 'defend', chance: 'a.presence/34',
      effect: { block: 0.3 }, desc: 'A called warning, a covering spell: the squad takes part of the blow.' },

    // Unique Magic and Risk and Reward: they pay off when the owner is hurt, or when they are struck.
    { id: 'blood_feast', label: 'Blood Magic: Feast', category: 'Unique Magic', kind: 'passive', trigger: 'attack', chance: 'a.presence/18 + 2',
      effect: { drain: 0.35 }, desc: 'The blood spilled by a blow flows back to you. Not in a spar.' },
    { id: 'surpassing_limits', label: 'Surpassing Limits', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.presence/14 + 3',
      effect: { dmgMult: 1.05, missingBonus: 1.5 }, desc: 'The worse it gets, the harder you refuse to give up.' },
    { id: 'last_stand', label: 'Last Stand', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.presence/14 + 4',
      whenBelow: 0.3, effect: { dmgMult: 1.7 }, desc: 'Close to the edge, you put everything into one spell.' },
    { id: 'counter_spell', label: 'Counter Spell', category: 'Risk and Reward', kind: 'passive', trigger: 'defend', chance: 'a.speed/12 + 4',
      effect: { counter: 0.7 }, desc: 'A spell cast in the instant the blow comes, answering it before it lands.' },
]);
