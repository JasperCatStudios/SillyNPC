import { renderRecipeCreator as render } from '../../src/ui-recipe-creator.js';
import { activitySettings, saveActivitySettings, creatorItems } from './activities-runtime.js';

/**
 * The recipe creator inside the Cooking activity (fork): the screen is src/ui-recipe-creator.js and the rules are in
 * src/activity-recipe-creator-core.js; this only connects them to the live settings and the item database.
 */
export function renderRecipeCreator({ presetRecipes, onChange }) {
    return render({ presetRecipes, onChange, doc: document, settings: activitySettings(), save: saveActivitySettings, getItems: creatorItems });
}
