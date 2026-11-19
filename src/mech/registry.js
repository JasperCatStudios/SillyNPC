/**
 * The mechanics registry (fork): every hands-on mechanic by id. A recipe's step names a mechanic by id, so adding a mechanic is one core
 * file plus one line here. Pure: no DOM, no SillyTavern imports.
 */

import * as slice from './slice-core.js';
import * as stir from './stir-core.js';
import * as sear from './sear-core.js';
import * as sprinkle from './sprinkle-core.js';

export const MECHANICS = Object.freeze({ slice, stir, sear, sprinkle });

/** The mechanic with this id, or null. */
export const mechanicOf = (id) => MECHANICS[String(id ?? '')] || null;

export const MECHANIC_IDS = Object.freeze(Object.keys(MECHANICS));
