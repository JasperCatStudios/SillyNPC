/**
 * Fire Emblem relic arts (fork). Pure data, no imports. The combat art of each Hero's Relic, as an ability
 * that belongs to its weapon: it is offered only while that weapon is held at Hero Relic tier (see `needs`
 * in combat-abilities.js) and takes none of the five ability slots. Power and cost follow the old Heroic
 * Relics (about 15 power for 16 Energy), a little more for the arts the game gives more Might, never over 18 power.
 */

export const FE_RELIC_ARTS = Object.freeze([
    { id: 'relic_ruptured_heaven', label: "Ruptured Heaven", category: 'Relic Arts', kind: 'active', prof: 'sword', power: 17,
      cost: { pool: 'guard', amount: 18 }, needs: { weapon: ['Sword of the Creator', 'Sublime Creator Sword'], tier: 'relic' }, desc: "Might increases based on user's Magic Effective against Dragon foes." },
    { id: 'relic_sublime_heaven', label: "Sublime Heaven", category: 'Relic Arts', kind: 'active', prof: 'sword', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Sword of the Creator', 'Sublime Creator Sword'], tier: 'relic' }, desc: "Might increases based on user's Magic Effective against Dragon foes." },
    { id: 'relic_heaven_s_fall', label: "Heaven's Fall", category: 'Relic Arts', kind: 'active', prof: 'sword', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Dark Creator Sword'], tier: 'relic' }, desc: "Might increases based on user's Magic" },
    { id: 'relic_foudroyant_strike', label: "Foudroyant Strike", category: 'Relic Arts', kind: 'active', prof: 'sword', power: 16,
      cost: { pool: 'guard', amount: 17 }, needs: { weapon: ['Thunderbrand'], tier: 'relic' }, desc: "Effective against Armored and Dragon foes." },
    { id: 'relic_raging_storm', label: "Raging Storm", category: 'Relic Arts', kind: 'active', prof: 'axe', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Aymr'], tier: 'relic' }, desc: "If attack lands, user can move again Effective against Dragon foes." },
    { id: 'relic_atrocity', label: "Atrocity", category: 'Relic Arts', kind: 'active', prof: 'lance', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Areadbhar'], tier: 'relic' }, desc: "Effective against all foes" },
    { id: 'relic_fallen_star', label: "Fallen Star", category: 'Relic Arts', kind: 'active', prof: 'bow', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Failnaught'], tier: 'relic' }, desc: "Avoids all attacks during the next round of combat; effective against Dragon foes." },
    { id: 'relic_ruined_sky', label: "Ruined Sky", category: 'Relic Arts', kind: 'active', prof: 'lance', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Lance of Ruin'], tier: 'relic' }, desc: "Effective against Flying and Dragon foes." },
    { id: 'relic_burning_quake', label: "Burning Quake", category: 'Relic Arts', kind: 'active', prof: 'lance', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Lúin'], tier: 'relic' }, desc: "Might increases based on user's Speed; Effective against Dragon foes." },
    { id: 'relic_dust', label: "Dust", category: 'Relic Arts', kind: 'active', prof: 'axe', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Crusher'], tier: 'relic' }, desc: "Inflicts Def -5 on foe for 1 turn, Effective against Dragon foes." },
    { id: 'relic_apocalyptic_flame', label: "Apocalyptic Flame", category: 'Relic Arts', kind: 'active', prof: 'axe', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Freikugel'], tier: 'relic' }, desc: "Inflicts Str -5 on foe for 1 turn; Effective against Dragon foes." },
    { id: 'relic_beast_fang', label: "Beast Fang", category: 'Relic Arts', kind: 'active', prof: 'sword', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Blutgang'], tier: 'relic' }, desc: "Effective against Cavalry and Dragon foes." },
    { id: 'relic_eviscerate', label: "Eviscerate", category: 'Relic Arts', kind: 'active', prof: 'brawling', power: 18,
      cost: { pool: 'guard', amount: 19 }, needs: { weapon: ['Vajra-Mushti'], tier: 'relic' }, desc: "Calculates damage using the lower of foe's Def or Res." },
]);
