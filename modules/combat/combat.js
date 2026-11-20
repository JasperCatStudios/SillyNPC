import { registerModulePane } from '../../src/module-panes.js';
import { renderCombatPane } from './combat-pane.js';
import './combat-window.js';

/**
 * The combat module (fork). The tab is the roster and the world type; the corner button
 * (combat-window.js) starts a fight. Loading is isolated
 * by index.js, so a fault here takes nothing else with it.
 */
registerModulePane('combat', renderCombatPane);
