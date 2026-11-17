import { Popup, POPUP_TYPE } from '../../../../popup.js';
// The chat shows this picture beside every line the character speaks, so changing
// it has to redraw. reprocess.js rather than chat.js: chat.js imports this file.
import { triggerReprocess } from './reprocess.js';
import { saveSettings } from './settings.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import { auditCharacter, fillLore } from './character-fill.js';
import { generateCharacterImageLogic } from './api.js';

/**
 * One row of the plan: what this stage would do, and whether to do it.
 *
 * A stage already done is shown, ticked off and disabled, rather than left out. "There was
 * nothing to do" and "it did nothing" look identical when the row is simply absent, and
 * the second is the one worth noticing.
 *
 * The default tick is the stage's own answer rather than "not done": belongings are
 * offered on a character who already carries things, but not ticked.
 */
function stageRow(id, label, stage) {
    const row = document.createElement('label');
    row.className = 'sillynpc-fill-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'sillynpc-fill-check';
    box.dataset.stage = id;
    box.checked = stage.checked ?? !stage.done;
    box.disabled = stage.done;

    const text = document.createElement('span');
    text.className = 'sillynpc-fill-text';
    text.innerHTML = `<b>${label}</b><br><small class="notes">${stage.summary}</small>`;

    row.append(box, text);
    if (stage.done) row.classList.add('is-done');
    return row;
}

/**
 * Shows what filling this card would do, and asks.
 *
 * One decision rather than four: the whole point is doing it in one go, and the stages
 * worth declining - the portrait, which costs real money, and belongings, which can add
 * an item to a list somebody curated - have to be declinable before they run, not after.
 *
 * @returns {Promise<{ lore: boolean, image: boolean } | null>}
 *   Null on cancel.
 */
async function askPlan(char, audit) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-fill-plan';

    const heading = document.createElement('h3');
    heading.textContent = `Fill in ${char.name || 'this character'}`;
    wrap.append(heading);

    const intro = document.createElement('small');
    intro.className = 'notes';
    intro.textContent = 'Each stage feeds the next: the lore entry describes the portrait. '
        + 'Nothing already filled in is overwritten.';
    wrap.append(intro);

    // Numbered in the order they run, which is also the order they feed each other.
    wrap.append(
        stageRow('lore', '1. Lore entry', audit.lore),
        stageRow('image', '2. Portrait', audit.image),
    );

    const popup = new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Fill', cancelButton: 'Cancel',
    });
    const result = await popup.show();
    if (!result) return null;

    const chosen = {};
    for (const box of wrap.querySelectorAll('.sillynpc-fill-check')) {
        chosen[box.dataset.stage] = box.checked && !box.disabled;
    }
    return chosen;
}

/**
 * Fills in a character card: lore, then a portrait.
 *
 * Stops at the first stage that fails and says which one. The stages are ordered because
 * each reads what the one before it wrote, so carrying on past a failure produces exactly
 * the thin, guessed-at card this exists to avoid - and whatever earlier stages finished
 * is kept, since undoing good work to report a later failure helps nobody.
 *
 * @param {object} char
 * @param {{ onSave?: () => void }} [options]
 */
export async function fillCharacter(char, { onSave } = {}) {
    if (!char?.name) {
        toastr.warning('Give the character a name first.', PRODUCT_NAME);
        return;
    }

    const audit = auditCharacter(char);
    if (!audit.anything) {
        toastr.info(`${char.name} is already filled in.`, PRODUCT_NAME);
        return;
    }

    const chosen = await askPlan(char, audit);
    if (!chosen) return;
    if (!Object.values(chosen).some(Boolean)) return;

    const done = [];

    /** @returns {Promise<boolean>} False when the run should stop. */
    const runLore = async () => {
        toastr.info('Looking for a lore entry...', PRODUCT_NAME);
        const result = await fillLore(char);
        if (!result.ok) {
            toastr.error(`Lore: ${result.reason}`, PRODUCT_NAME);
            onSave?.();
            return false;
        }
        done.push(`Lore: ${result.action}`);
        onSave?.();
        return true;
    };

    try {
        if (chosen.lore && !(await runLore())) return;

        if (chosen.image) {
            toastr.info('Drawing a portrait...', PRODUCT_NAME);
            const imageUrl = await generateCharacterImageLogic(char, { referenceImages: [] });
            if (!Array.isArray(char.images)) char.images = [];
            if (!char.images.includes(imageUrl)) char.images.push(imageUrl);
            // The card had no portrait, which is why this stage ran - so it becomes the
            // one in use rather than sitting in the gallery unused.
            char.imageUrl = imageUrl;
            saveSettings();
            triggerReprocess();
            done.push('Portrait: drawn');
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'Fill failed', err);
        toastr.error(`Stopped: ${err?.message || err}`, PRODUCT_NAME);
        onSave?.();
        return;
    }

    debugLog('Filled in', char.name, done);
    toastr.success(done.join('. ') + '.', PRODUCT_NAME);
    onSave?.();
}
