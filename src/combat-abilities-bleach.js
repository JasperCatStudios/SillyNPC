/**
 * Bleach ability library (fork). Pure data, no imports.
 *
 * Reiryoku (resource) is about 66 to 100. Attacks cost roughly 2 to 3 Reiryoku for each point of
 * power, so a big technique takes half the pool; a block costs about 10 Reiryoku per full block, a
 * heal about 75 per whole health bar. Stamina (guard) pays for bodily techniques. Passives are free
 * but rare (a few percent at middling stats). The numbers are tuned so a character holding every
 * ability still wins only about two fights in three against an equal with none.
 * See tests/combat/ability-library.test.mjs.
 */

export const BLEACH_ABILITIES = Object.freeze([
    // Zanpakutō: sword releases, from a first release up to a full bankai. Cost climbs a little faster than power.
    // Each needs a held zanpakutō at that release (a Bankai move needs one set to Bankai); a fighter with no gear
    // on their sheet is not held back, so older saves keep what they had.
    { id: 'shikai_release', label: 'Shikai Release', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 4,
      cost: { pool: 'resource', amount: 18 }, needs: { ladder: 'release', tier: 'shikai' }, desc: 'Call the blade by name and let its first form answer.' },
    { id: 'shikai_special', label: 'Shikai Special Ability', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 5,
      cost: { pool: 'resource', amount: 22 }, needs: { ladder: 'release', tier: 'shikai' }, desc: 'The released blade turns its own strange gift on the foe.' },
    { id: 'getsuga', label: 'Getsuga Tenshō', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 8,
      cost: { pool: 'resource', amount: 24 }, needs: { ladder: 'release', tier: 'shikai' }, desc: 'A crescent of reiatsu from the blade.' },
    { id: 'shikai_full', label: 'Shikai Full Force', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 9,
      cost: { pool: 'resource', amount: 31 }, needs: { ladder: 'release', tier: 'shikai' }, desc: 'Every drop of spirit poured into one released stroke.' },
    { id: 'bankai', label: 'Bankai', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 11,
      cost: { pool: 'resource', amount: 37 }, needs: { ladder: 'release', tier: 'bankai' }, desc: 'The blade reaches its final form and the whole field feels it.' },
    { id: 'final_getsuga', label: 'Final Getsuga Tenshō', category: 'Zanpakutō', kind: 'active', prof: 'zanjutsu', power: 12,
      cost: { pool: 'resource', amount: 39 }, needs: { ladder: 'release', tier: 'bankai' }, desc: 'A last, black-edged wave that costs more than it should.' },
    { id: 'zanpakuto_resonance', label: 'Zanpakutō Resonance', category: 'Zanpakutō', kind: 'passive', trigger: 'attack', chance: 'a.presence/39',
      effect: { dmgMult: 1.4 }, desc: 'The spirit of the blade sings along with the stroke.' },

    // Reiatsu: raw spiritual pressure, rare surges that add weight to a blow.
    { id: 'reiatsu_burst', label: 'Reiatsu Surge', category: 'Reiatsu', kind: 'passive', trigger: 'attack', chance: 'a.presence/39 + 1',
      effect: { dmgMult: 1.5 }, desc: 'Spiritual pressure may surge into a blow.' },
    { id: 'reiatsu_crush', label: 'Reiatsu Crush', category: 'Reiatsu', kind: 'passive', trigger: 'attack', chance: 'a.presence/47',
      effect: { dmgMult: 1.9 }, desc: 'Overwhelming pressure bears down for a heartbeat, and the blow follows.' },

    // Kidō (Hadō): spirit attacks that scale on the Kidō stat. Cost about 1.6 Reiryoku per point of power.
    { id: 'hado_byakurai', label: 'Hadō 4: Byakurai', category: 'Kidō', kind: 'active', prof: 'kido', power: 4,
      cost: { pool: 'resource', amount: 15 }, desc: 'A thin bolt of white lightning from a pointed finger.' },
    { id: 'hado_shakkaho', label: 'Hadō 31: Shakkahō', category: 'Kidō', kind: 'active', prof: 'kido', power: 5,
      cost: { pool: 'resource', amount: 22 }, desc: 'A ball of red fire loosed with a short chant.' },
    { id: 'hado_sokatsui', label: 'Hadō 33: Sōkatsui', category: 'Kidō', kind: 'active', prof: 'kido', power: 6,
      cost: { pool: 'resource', amount: 28 }, desc: 'Blue flame, hot enough to stagger a captain.' },
    { id: 'hado_raikoho', label: 'Hadō 63: Raikōhō', category: 'Kidō', kind: 'active', prof: 'kido', power: 7,
      cost: { pool: 'resource', amount: 33 }, desc: 'A thunder cannon fired from the open palm.' },
    { id: 'hado_soren', label: 'Hadō 73: Sōren Sōkatsui', category: 'Kidō', kind: 'active', prof: 'kido', power: 8,
      cost: { pool: 'resource', amount: 37 }, desc: 'Twin blue flames roar down the field.' },
    { id: 'hado_hiryu', label: 'Hadō 88: Hiryū Gekizoku Shinten Raihō', category: 'Kidō', kind: 'active', prof: 'kido', power: 9,
      cost: { pool: 'resource', amount: 39 }, desc: 'A towering dragon of lightning, chanted in full.' },

    // Barriers (Bakudō): chosen blocks. About 12 Reiryoku per full block.
    { id: 'bakudo_sai', label: 'Bakudō 1: Sai', category: 'Barriers', kind: 'defensive', cost: { pool: 'resource', amount: 3 },
      effect: { block: 0.25 }, desc: 'A thin wall of force that dulls the next blow.' },
    { id: 'bakudo_enkosen', label: 'Bakudō 39: Enkōsen', category: 'Barriers', kind: 'defensive', cost: { pool: 'resource', amount: 6 },
      effect: { block: 0.45 }, desc: 'A spinning disc of reiatsu to catch a strike.' },
    { id: 'bakudo_rikujo', label: 'Bakudō 61: Rikujōkōrō', category: 'Barriers', kind: 'defensive', cost: { pool: 'resource', amount: 7 },
      effect: { block: 0.55 }, desc: 'Six bars of light brace the body against the blow.' },
    { id: 'danku', label: 'Bakudō: Danku', category: 'Barriers', kind: 'defensive', cost: { pool: 'resource', amount: 8 },
      effect: { block: 0.7 }, desc: 'A barrier against the next blow.' },
    { id: 'bakudo_hyapporankan', label: 'Bakudō 81: Hyapporankan', category: 'Barriers', kind: 'defensive', cost: { pool: 'resource', amount: 11 },
      effect: { block: 0.8 }, desc: 'A hundred lances of light rain down as a wall.' },

    // Healing Kidō: fight-only heals. About 75 Reiryoku per whole bar.
    { id: 'kaido_minor', label: 'Minor Mending', category: 'Healing Kidō', kind: 'defensive', cost: { pool: 'resource', amount: 8 },
      effect: { heal: 0.1 }, desc: 'A short working that closes small wounds. Not in a spar.' },
    { id: 'kaido', label: 'Healing Kidō', category: 'Healing Kidō', kind: 'defensive', cost: { pool: 'resource', amount: 14 },
      effect: { heal: 0.17 }, desc: 'Mends a good part of your health. Not in a spar.' },
    { id: 'kaido_soten', label: 'Sōten Kisshun', category: 'Healing Kidō', kind: 'defensive', cost: { pool: 'resource', amount: 21 },
      effect: { heal: 0.28 }, desc: 'A shield of calm, warm light that undoes grave injury. Not in a spar.' },

    // Hollow and Arrancar: cero, hide, resurrección. Cero scales on the Cero proficiency.
    { id: 'cero_debil', label: 'Cero Débil', category: 'Hollow and Arrancar', kind: 'active', prof: 'cero', power: 4,
      cost: { pool: 'resource', amount: 15 }, desc: 'A small, quick cero fired from a fingertip.' },
    { id: 'bala_barrage', label: 'Bala Barrage', category: 'Hollow and Arrancar', kind: 'active', prof: 'bala', power: 4,
      cost: { pool: 'resource', amount: 19 }, desc: 'A volley of hollow bolts, each a fraction of a cero.' },
    { id: 'cero_sincronizado', label: 'Cero Sincronizado', category: 'Hollow and Arrancar', kind: 'active', prof: 'cero', power: 5,
      cost: { pool: 'resource', amount: 32 }, desc: 'Two ceros fired together become one huge beam.' },
    { id: 'cero_oscuras', label: 'Cero Oscuras', category: 'Hollow and Arrancar', kind: 'active', prof: 'cero', power: 7,
      cost: { pool: 'resource', amount: 38 }, desc: 'A black cero that swallows the light around it.' },
    { id: 'resurreccion', label: 'Resurrección', category: 'Hollow and Arrancar', kind: 'active', prof: 'zanjutsu', power: 10,
      cost: { pool: 'resource', amount: 34 }, desc: 'The blade is cast aside and the true form takes over.' },
    { id: 'gran_rey_cero', label: 'Gran Rey Cero', category: 'Hollow and Arrancar', kind: 'active', prof: 'cero', power: 9,
      cost: { pool: 'resource', amount: 39 }, desc: 'A vast, violet beam, the heaviest cero there is.' },
    { id: 'hierro', label: 'Hierro', category: 'Hollow and Arrancar', kind: 'passive', trigger: 'defend', chance: 'a.defense/23',
      effect: { block: 0.4 }, desc: 'A hardened hide may turn aside part of a blow.' },
    { id: 'hierro_hardening', label: 'Hierro Hardening', category: 'Hollow and Arrancar', kind: 'defensive', cost: { pool: 'resource', amount: 4 },
      effect: { block: 0.35 }, desc: 'Flood the skin with reiatsu until it turns to iron.' },
    { id: 'hollow_regeneration', label: 'Hollow Regeneration', category: 'Hollow and Arrancar', kind: 'passive', trigger: 'turnStart', chance: 'a.endurance/39 + 1',
      effect: { heal: 0.1 }, desc: 'A hollow body knits its own flesh, turn by turn.' },

    // Quincy: reishi arrows and blood arts. Archery and Reishi Manipulation scale the damage.
    { id: 'heilig_pfeil', label: 'Heilig Pfeil', category: 'Quincy', kind: 'active', prof: 'archery', power: 4,
      cost: { pool: 'resource', amount: 18 }, desc: 'A holy arrow of gathered reishi.' },
    { id: 'licht_regen', label: 'Licht Regen', category: 'Quincy', kind: 'active', prof: 'archery', power: 5,
      cost: { pool: 'resource', amount: 28 }, desc: 'A rain of light arrows from a sky full of reishi.' },
    { id: 'sprenger', label: 'Sprenger', category: 'Quincy', kind: 'active', prof: 'reishi_manipulation', power: 6,
      cost: { pool: 'resource', amount: 35 }, desc: 'A blast of reishi that sets the whole field aflame.' },
    { id: 'ginrei_kojaku', label: 'Ginrei Kojaku', category: 'Quincy', kind: 'active', prof: 'gintou', power: 7,
      cost: { pool: 'resource', amount: 39 }, desc: 'A silver peacock of reishi, a blast of fire from a sealed vessel.' },
    { id: 'hirenkyaku', label: 'Hirenkyaku', category: 'Quincy', kind: 'passive', trigger: 'defend', chance: 'a.speed/30',
      effect: { block: 0.4 }, desc: 'Step on the spirit particles and be somewhere else.' },
    { id: 'blut_vene', label: 'Blut Vene', category: 'Quincy', kind: 'defensive', cost: { pool: 'resource', amount: 6.5 },
      effect: { block: 0.5 }, desc: 'Reiatsu flows through the veins and hardens the body against a strike.' },
    { id: 'blut_arterie', label: 'Blut Arterie', category: 'Quincy', kind: 'passive', trigger: 'attack', chance: 'a.attack/39',
      effect: { dmgMult: 1.5 }, desc: 'Spirit surges through the arms and the blow is carried by it.' },

    // Fullbringer: object-bound power. Mid-power actives and one hardened ward.
    { id: 'fullbring_strike', label: 'Fullbring Strike', category: 'Fullbringer', kind: 'active', prof: 'fullbring_control', power: 4,
      cost: { pool: 'resource', amount: 19 }, desc: 'The soul of an object lends its weight to a blow.' },
    { id: 'bringer_light', label: 'Bringer Light', category: 'Fullbringer', kind: 'active', prof: 'fullbring_control', power: 5,
      cost: { pool: 'resource', amount: 32 }, desc: 'Light rises from the object and burns the foe.' },
    { id: 'cross_of_scaffold', label: 'Cross of Scaffold', category: 'Fullbringer', kind: 'active', prof: 'fullbring_control', power: 7,
      cost: { pool: 'resource', amount: 39 }, desc: 'A great cross of reiatsu comes down on the target.' },
    { id: 'invade_object', label: 'Invade Object', category: 'Fullbringer', kind: 'defensive', cost: { pool: 'resource', amount: 6 },
      effect: { block: 0.45 }, desc: 'Reach into your object and let it take the hit.' },

    // Vizard: the mask. Rare, strong, and tied to presence.
    { id: 'hollow_mask', label: 'Hollow Mask', category: 'Vizard', kind: 'passive', trigger: 'attack', chance: 'a.presence/47',
      effect: { dmgMult: 1.8 }, desc: 'A pale mask flickers over the face and the blow turns savage.' },
    { id: 'mask_fortitude', label: 'Mask Fortitude', category: 'Vizard', kind: 'passive', trigger: 'defend', chance: 'a.defense/27',
      effect: { block: 0.35 }, desc: 'The mask hardens the bearer, shrugging off part of a strike.' },
    { id: 'vizard_cero', label: 'Vizard Cero', category: 'Vizard', kind: 'active', prof: 'cero', power: 6,
      cost: { pool: 'resource', amount: 35 }, desc: 'A red-black cero fired from behind the mask.' },

    // Mod Soul: artificial body, strong and quick, thin on reiryoku. Cheap actions, mostly stamina.
    { id: 'mod_kick', label: 'Mod Kick', category: 'Mod Soul', kind: 'active', prof: 'mod_strength', power: 4,
      cost: { pool: 'guard', amount: 14 }, desc: 'An overpowered kick from a body built to be strong.' },
    { id: 'mod_overdrive', label: 'Mod Overdrive', category: 'Mod Soul', kind: 'active', prof: 'mod_strength', power: 5,
      cost: { pool: 'guard', amount: 26 }, desc: 'The artificial body pushed past its safe limit.' },
    { id: 'mod_reflex', label: 'Mod Reflex', category: 'Mod Soul', kind: 'passive', trigger: 'defend', chance: 'a.evasion/27',
      effect: { block: 0.35 }, desc: 'A sharp-tuned body twitches clear of the worst of a strike.' },

    // Body Techniques: Stamina-paid techniques of hand and foot, and the movement passives.
    { id: 'shunpo', label: 'Shunpo', category: 'Body Techniques', kind: 'passive', trigger: 'defend', chance: 'a.evasion/19',
      effect: { block: 0.5 }, desc: 'Flash Step: gone before the blade arrives.' },
    { id: 'flash_counter', label: 'Flash Step Counter', category: 'Body Techniques', kind: 'passive', trigger: 'attack', chance: 'a.speed/39',
      effect: { dmgMult: 1.4 }, desc: 'Vanish and reappear behind the foe, blade already moving.' },
    { id: 'combat_instinct', label: 'Combat Instinct', category: 'Body Techniques', kind: 'passive', trigger: 'defend', chance: 'a.awareness/34',
      effect: { block: 0.3 }, desc: 'The body reads the strike before the mind has.' },
    { id: 'iron_fist', label: 'Iron Fist', category: 'Body Techniques', kind: 'active', prof: 'hakuda', power: 4,
      cost: { pool: 'guard', amount: 12 }, desc: 'A hard, clean strike, delivered with the whole body.' },
    { id: 'shunko', label: 'Shunkō', category: 'Body Techniques', kind: 'active', prof: 'hakuda', power: 6,
      cost: { pool: 'guard', amount: 24 }, desc: 'Compress kidō at the back and shoulders and strike with it.' },
    { id: 'utsusemi', label: 'Utsusemi', category: 'Body Techniques', kind: 'defensive', cost: { pool: 'guard', amount: 8 },
      effect: { block: 0.6 }, desc: 'Leave an afterimage behind and take the hit on nothing.' },

    // Risk and Reward: they pay off when the owner is hurt, or when they are struck.
    { id: 'berserk_reiatsu', label: 'Berserk Reiatsu', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.presence/14 + 3',
      effect: { dmgMult: 1.05, missingBonus: 1.5 }, desc: 'Wounds feed the pressure, and the blows grow wilder the worse it gets.' },
    { id: 'last_stand', label: 'Last Stand', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.presence/14 + 4',
      whenBelow: 0.3, effect: { dmgMult: 1.7 }, desc: 'Close to the edge, you give everything to one blow.' },
    { id: 'riposte_step', label: 'Riposte Step', category: 'Risk and Reward', kind: 'passive', trigger: 'defend', chance: 'a.speed/12 + 4',
      effect: { counter: 0.7 }, desc: 'A step to the side and the blow is answered before it lands.' },
    { id: 'desperate_flash', label: 'Desperate Flash', category: 'Risk and Reward', kind: 'passive', trigger: 'defend', chance: 'a.speed/14 + 6',
      whenBelow: 0.5, effect: { counter: 0.9 }, desc: 'Hurt and cornered, you strike first and worry later.' },
    { id: 'bloodlust', label: 'Bloodlust', category: 'Risk and Reward', kind: 'passive', trigger: 'attack', chance: 'a.presence/18 + 2',
      effect: { drain: 0.35 }, desc: 'A blow that takes strength from the one who suffers it. Not in a spar.' },
]);
