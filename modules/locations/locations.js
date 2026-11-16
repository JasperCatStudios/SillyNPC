import { registerModulePane } from '../../src/module-panes.js';
import { renderLocationBackgrounds } from '../../src/ui-location-backgrounds.js';

/** The Location backgrounds table, as its own module pane (Modules tab). */
registerModulePane('locations', (pane, { live } = {}) => renderLocationBackgrounds(pane, { live }));
