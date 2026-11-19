/**
 * The built-in recipes, fish and seeds for cooking, fishing and gardening (fork). Plain fantasy names, nothing from any game.
 * A world preset may bring its own lists (see normalizeHarvest in activity-config-core.js); the item database's fish and seed
 * items are added to these when it has them.
 *
 * Pure data: no DOM, no SillyTavern imports.
 */

/** Words that make an item count as a fish, a vegetable, a herb or a fruit for a recipe's needs. */
export const FISH_WORDS = Object.freeze(['fish', 'trout', 'carp', 'perch', 'pike', 'loach', 'goby', 'herring', 'eel', 'minnow', 'gar', 'crayfish', 'bullhead', 'bass']);
export const VEG_WORDS = Object.freeze(['carrot', 'cabbage', 'onion', 'turnip', 'tomato', 'potato', 'pumpkin', 'vegetable', 'chickpea', 'radish']);
export const HERB_WORDS = Object.freeze(['herb', 'salad', 'lettuce', 'angelica', 'basil', 'mint', 'weed']);
export const FRUIT_WORDS = Object.freeze(['berry', 'berries', 'currant', 'plum', 'fruit', 'peach', 'apple']);

/**
 * A recipe: id, name, needs (each: label for the screen, `any` the words an inventory item's name may contain, qty), and a short
 * description. A recipe with no needs is simple: it can always be cooked.
 */
export const GENERIC_RECIPES = Object.freeze([
    { id: 'porridge', name: 'Plain Porridge', needs: [], desc: 'Oats and water. Always possible.' },
    { id: 'toast', name: 'Buttered Toast', needs: [], desc: 'Bread, butter and a hot pan.' },
    { id: 'flatbread', name: 'Flatbread', needs: [], desc: 'Quick and filling.' },
    { id: 'fishstew', name: 'Fish Stew', needs: [{ label: 'a fish', any: FISH_WORDS, qty: 1 }], desc: 'A warm stew of the day\'s catch.' },
    { id: 'grilledfish', name: 'Grilled Fish', needs: [{ label: 'a fish', any: FISH_WORDS, qty: 1 }], desc: 'Simple, over the coals.' },
    { id: 'vegsoup', name: 'Vegetable Soup', needs: [{ label: '2 vegetables', any: VEG_WORDS, qty: 2 }], desc: 'Thick and hearty.' },
    { id: 'roastveg', name: 'Roast Vegetables', needs: [{ label: '2 vegetables', any: VEG_WORDS, qty: 2 }], desc: 'Golden at the edges.' },
    { id: 'herbsalad', name: 'Herb Salad', needs: [{ label: 'some herbs', any: HERB_WORDS, qty: 1 }], desc: 'Fresh and green.' },
    { id: 'fishpie', name: 'Fish Pie', needs: [{ label: 'a fish', any: FISH_WORDS, qty: 1 }, { label: 'a vegetable', any: VEG_WORDS, qty: 1 }], desc: 'A proper supper.' },
    { id: 'berrytart', name: 'Berry Tart', needs: [{ label: '2 fruits', any: FRUIT_WORDS, qty: 2 }], desc: 'Sweet, with a crisp crust.' },
]);

/** What can be caught: weight (how often), difficulty 1 to 3 (how hard the reel is), size 1 to 9 (for a contest). */
export const GENERIC_FISH = Object.freeze([
    { name: 'Pond Minnow', weight: 36, difficulty: 1, size: 1 },
    { name: 'River Trout', weight: 28, difficulty: 1, size: 2 },
    { name: 'Silver Carp', weight: 18, difficulty: 2, size: 3 },
    { name: 'Spotted Perch', weight: 10, difficulty: 2, size: 3 },
    { name: 'Golden Pike', weight: 6, difficulty: 3, size: 5 },
    { name: 'Moonlit Eel', weight: 2, difficulty: 3, size: 6 },
]);

/**
 * What can be planted: the seed item's name, what it grows, how many visits (days tended) it needs, how many it yields, what the
 * produce is (food or a plant such as a flower), and whether the seed is free (always on hand, so a garden can always be started).
 */
export const GENERIC_SEEDS = Object.freeze([
    { name: 'Wild Herb Seeds', produce: 'Wild Herbs', needs: 1, yield: 2, kind: 'plant', free: true },
    { name: 'Carrot Seeds', produce: 'Carrot', needs: 2, yield: 2, kind: 'food' },
    { name: 'Cabbage Seeds', produce: 'Cabbage', needs: 2, yield: 2, kind: 'food' },
    { name: 'Onion Seeds', produce: 'Onion', needs: 2, yield: 2, kind: 'food' },
    { name: 'Tomato Seeds', produce: 'Tomato', needs: 3, yield: 2, kind: 'food' },
    { name: 'Pumpkin Seeds', produce: 'Pumpkin', needs: 3, yield: 1, kind: 'food' },
    { name: 'Berry Seeds', produce: 'Garden Berries', needs: 3, yield: 3, kind: 'food' },
    { name: 'Lavender Seeds', produce: 'Lavender', needs: 2, yield: 1, kind: 'plant' },
    { name: 'Rose Seeds', produce: 'Rose', needs: 3, yield: 1, kind: 'plant' },
]);
