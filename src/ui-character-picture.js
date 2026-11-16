import { generateForCharacter, workflowFor, describeComfyError, cancelImageGen, blobToDataUrl, comfyBase } from './comfy-engine.js';
import { checkWorkflow } from './comfy-engine.js';
import { adoptImageForCharacter } from './api.js';
import { PRODUCT_NAME } from './constants.js';

/**
 * A picture of one character, drawn with the workflow assigned to them (fork). Opened from the Visual Prompt
 * section of their profile. The result can become their portrait, or just be downloaded.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

let open = null;

export function openCharacterPicture(char) {
    if (open) { open.remove(); open = null; }
    if (!char) return;
    if (!comfyBase()) {
        toastr.warning('Set the ComfyUI address in Modules, Images first.', PRODUCT_NAME);
        return;
    }
    const overlay = el('div', 'sillynpc-imagegen-overlay');
    const box = el('div', 'sillynpc-imagegen-dialog');
    overlay.append(box);
    open = overlay;
    const head = el('div', 'sillynpc-imagegen-head');
    const close = el('button', 'sillynpc-imagegen-close', '×');
    close.type = 'button';
    head.append(close, el('span', '', `Picture of ${char.name}`));
    const body = el('div', 'sillynpc-imagegen-body');
    box.append(head, body);
    document.body.append(overlay);

    const workflow = workflowFor(char);
    body.append(el('small', 'notes', workflow ? `Workflow: ${workflow}` : 'No workflow is assigned, so the plain graph from the Images module is used.'));
    const extra = el('textarea', 'text_pole');
    extra.rows = 2;
    extra.placeholder = 'Anything to add to their image prompt: a pose, a place, an outfit…';
    body.append(extra);
    const go = el('button', 'menu_button', 'Draw');
    go.type = 'button';
    const stop = el('button', 'menu_button', 'Stop');
    stop.type = 'button';
    stop.style.display = 'none';
    const actions = el('div', 'sillynpc-imagegen-actions');
    actions.append(go, stop);
    const status = el('div', 'notes sillynpc-imagegen-status');
    const result = el('div', 'sillynpc-imagegen-result');
    body.append(actions, status, result);

    close.addEventListener('click', () => { cancelImageGen(); overlay.remove(); open = null; });
    stop.addEventListener('click', () => cancelImageGen());
    go.addEventListener('click', async () => {
        if (workflow) {
            const info = await checkWorkflow(workflow);
            if (!info.ok) { status.textContent = info.message; status.className = 'notes sillynpc-imagegen-status is-bad'; return; }
        }
        go.disabled = true; stop.style.display = ''; result.replaceChildren();
        status.className = 'notes sillynpc-imagegen-status';
        status.textContent = 'Drawing… this can take a while on a local GPU.';
        try {
            const blob = await generateForCharacter(char, { extra: extra.value });
            const dataUrl = await blobToDataUrl(blob);
            const img = el('img', 'sillynpc-imagegen-img');
            img.src = dataUrl;
            img.alt = char.name;
            const row = el('div', 'sillynpc-imagegen-actions');
            const use = el('button', 'menu_button', 'Use as portrait');
            use.type = 'button';
            use.addEventListener('click', async () => {
                try { await adoptImageForCharacter(char, dataUrl); toastr.success(`${char.name}'s portrait was updated.`, PRODUCT_NAME); } catch (err) { toastr.error(`Could not save it: ${err?.message || err}`, PRODUCT_NAME); }
            });
            const download = el('a', 'menu_button', 'Download');
            download.href = dataUrl;
            download.download = `${String(char.name).replace(/[^\w.-]+/g, '_')}-${Date.now()}.png`;
            row.append(use, download);
            result.append(img, row);
            status.textContent = '';
        } catch (err) {
            if (err?.name === 'AbortError') status.textContent = 'Stopped.';
            else { status.textContent = describeComfyError(err); status.classList.add('is-bad'); console.warn('[Worldkit] character picture failed', err); }
        } finally {
            go.disabled = false; stop.style.display = 'none';
        }
    });
}
