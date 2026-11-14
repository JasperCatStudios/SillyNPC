import { registerModulePane } from '../../src/module-panes.js';
import { renderCombatPane } from './combat-pane.js';

/**
 * The combat module (fork). The base module only draws its tab; fights, training and
 * abilities come in later pieces. Loading is isolated by index.js, so a fault here takes
 * nothing else with it.
 */
registerModulePane('combat', renderCombatPane);
