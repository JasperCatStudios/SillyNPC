import { registerModulePane } from '../../src/module-panes.js';
import { renderScenePane } from '../../src/ui-scene.js';
import { initScene } from '../../src/scene-state.js';
import { initSceneWeather } from '../../src/scene-weather.js';

/**
 * The Scene module (fork): where and when the story is, a map of places, and a background for each. The rules live in
 * src/scene-*.js, the pane in src/ui-scene.js. Off by default; initScene attaches nothing while it is off. Loading is
 * isolated by index.js, so a fault here takes nothing else with it.
 */
registerModulePane('scene', renderScenePane);
initScene();
// Weather effects (src/scene-weather.js): only when the Scene module and its Weather switch are both on.
try { initSceneWeather(); } catch (err) { console.warn('[Worldkit] Weather effects failed to start', err); }
