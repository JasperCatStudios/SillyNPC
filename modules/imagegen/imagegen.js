import { eventSource } from '../../../../../../script.js';
import { getMessageTimeStamp } from '../../../../../RossAscends-mods.js';
import { getContext } from '../../../../../st-context.js';
import { saveBase64AsFile } from '../../../../../utils.js';
import { SlashCommand } from '../../../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { registerModulePane } from '../../src/module-panes.js';
import { getSettings } from '../../src/settings.js';
import { PRODUCT_NAME } from '../../src/constants.js';
import {
    imagegenSettings, saveImagegenSettings, migrateFromPhone, checkWorkflow, comfyInfo, comfyBase,
    describeComfyError, generateScene, gatherScene, cancelImageGen, blobToDataUrl,
} from '../../src/comfy-engine.js';
import { apiFormatWarning, workflowPicker } from '../../src/ui-workflow-picker.js';
import { bindingsEditor } from '../../src/ui-workflow-bindings.js';
import { renderLocationBackgrounds } from '../../src/ui-location-backgrounds.js';
import { locationSettings, currentPlace } from '../../src/location-backgrounds.js';
import { matchLocation } from '../../src/location-core.js';
import { bindingsFor, vistalyzeScene, currentBackgroundUrl } from '../../src/comfy-engine.js';
import { DEFAULT_SCENE_TEMPLATE } from '../../src/comfy-bindings.js';
import { API_FORMAT_HELP, PLACEHOLDERS, SCENE_PLACEHOLDERS, SCENE_SLOTS, inspectWorkflow } from '../../src/comfy-core.js';

/**
 * The image generation module (fork). ComfyUI settings in one place, a workflow per character (chosen in their
 * profile), and a picture of the whole scene with each person in a slot of their own.
 *
 * The phone no longer has ComfyUI settings: it asks this module.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const field = (label, input, hint) => {
    const wrap = el('div', 'sillynpc-imagegen-field');
    wrap.append(el('label', '', label), input);
    if (hint) wrap.append(el('small', 'notes', hint));
    return wrap;
};

/* ------------------------------------------------------------------------------ the pane */

function renderPane(pane, { live } = {}) {
    const s = imagegenSettings();
    if (live) migrateFromPhone();
    pane.classList.add('sillynpc-imagegen');

    pane.append(el('p', 'notes',
        'Draws pictures with ComfyUI. Pick a workflow for each character on their profile (Visual Prompt), and use '
        + 'Scene picture to draw everyone in the scene at once. The phone uses this module for its photos.'));
    pane.append(apiFormatWarning());

    // --- connection
    pane.append(el('h4', 'sillynpc-combat-heading', 'ComfyUI'));
    const url = el('input', 'text_pole');
    url.placeholder = 'http://127.0.0.1:8188';
    url.value = s.url || (live ? comfyBase() : '');
    const state = el('small', 'notes sillynpc-imagegen-state', 'not checked yet');
    const test = el('button', 'menu_button', 'Check');
    test.type = 'button';
    const urlRow = el('div', 'sillynpc-imagegen-row');
    urlRow.append(url, test);
    pane.append(field('Address', urlRow, 'ComfyUI must be started with --enable-cors-header for the browser to reach it.'), state);

    const lists = { ckpts: [], loras: [], samplers: [], schedulers: [] };
    const selects = {};
    const fillSelect = (select, values, current, blank) => {
        select.replaceChildren();
        if (blank !== undefined) select.append(new Option(blank, ''));
        const all = values.slice();
        if (current && !all.includes(current)) all.unshift(current);
        for (const v of all) select.append(new Option(v, v));
        select.value = current || '';
    };
    const fillAll = () => {
        fillSelect(selects.ckpt, lists.ckpts, s.ckpt, 'first in the list');
        fillSelect(selects.lora, lists.loras, s.lora, 'no LoRA');
        fillSelect(selects.sampler, lists.samplers, s.sampler);
        fillSelect(selects.scheduler, lists.schedulers, s.scheduler);
    };
    const check = async (quiet) => {
        state.textContent = 'checking…';
        state.dataset.kind = 'wait';
        try {
            const info = await comfyInfo(true);
            Object.assign(lists, { ckpts: info.ckpts, loras: info.loras, samplers: info.samplers, schedulers: info.schedulers });
            fillAll();
            state.textContent = `connected: ${info.ckpts.length} checkpoints, ${info.loras.length} LoRAs`;
            state.dataset.kind = 'ok';
        } catch (err) {
            state.textContent = describeComfyError(err);
            state.dataset.kind = 'bad';
            if (!quiet) toastr.warning(describeComfyError(err), PRODUCT_NAME);
        }
    };
    url.addEventListener('change', () => { s.url = url.value.trim().replace(/\/+$/, ''); saveImagegenSettings(); check(true); });
    test.addEventListener('click', () => check(false));

    // --- workflows
    pane.append(el('h4', 'sillynpc-combat-heading', 'Workflows'));
    pane.append(el('small', 'notes',
        'Workflows are read from SillyTavern\'s ComfyUI folder: data/<your user>/user/workflows. Save a workflow from ComfyUI with '
        + '"Save (API Format)", put the file in that folder, then press the refresh button.'));
    pane.append(field('Default workflow',
        workflowPicker({ value: s.defaultWorkflow, blank: 'None: use the plain graph from the settings below', live, onChange: (name) => { s.defaultWorkflow = name; saveImagegenSettings(); } }),
        'Used for any character with no workflow of their own, and for phone photos.'));
    pane.append(field('Scene workflow',
        workflowPicker({ value: s.sceneWorkflow, blank: 'Same as the default workflow', live, onChange: (name) => { s.sceneWorkflow = name; saveImagegenSettings(); } }),
        'Used for Scene picture. It can use the character slots listed below.'));

    pane.append(el('h4', 'sillynpc-combat-heading', 'Workflow inputs'));
    pane.append(el('small', 'notes',
        'For a workflow that takes pictures and a prompt through nodes instead of placeholders (a group photo of four reference people '
        + 'and a place, for example): choose it and say which input is you, which are the other people, and which is the place. '
        + 'Your portrait goes in the first picture; the others can be any characters you pick when you draw.'));
    pane.append(bindingsEditor({ live }));
    const template = el('textarea', 'text_pole');
    template.rows = 2;
    template.placeholder = DEFAULT_SCENE_TEMPLATE;
    template.value = s.sceneTemplate;
    template.addEventListener('change', () => { s.sceneTemplate = template.value; saveImagegenSettings(); });
    pane.append(field('Scene wording for picture workflows', template,
        'Becomes the bound prompt. Use {count}, {at}, {location}, {people} (Picture 1 is you, Picture 2 is the next person and so on) and {extra}. Empty uses the default.'));

    pane.append(field('Phone selfie workflow',
        workflowPicker({ value: s.phoneWorkflow, blank: 'None: use the plain graph from the settings below', live, onChange: (name) => { s.phoneWorkflow = name; saveImagegenSettings(); } }),
        'Used only for the phone\'s photos, never for scenes or portraits. A character can have their own on their profile. A workflow with one picture input '
        + '(set it as "Reference picture" under Workflow inputs) is given that character\'s sheet or portrait.'));
    const sheets = el('input');
    sheets.type = 'checkbox';
    sheets.checked = s.useSheets;
    sheets.addEventListener('change', () => { s.useSheets = sheets.checked; saveImagegenSettings(); });
    const sheetsRow = el('label', 'checkbox_label');
    sheetsRow.append(sheets, el('span', '', 'Use a character\'s sheet instead of their portrait when they have one'));
    pane.append(sheetsRow);

    // --- placeholders
    const details = el('details', 'sillynpc-imagegen-placeholders');
    details.append(el('summary', '', 'Placeholders a workflow can use'));
    details.append(el('p', 'notes', 'Type them into the text of a node input in ComfyUI before you save. A value that is only a placeholder becomes a number where one is needed.'));
    const list = el('div', 'sillynpc-imagegen-ph');
    const addTokens = (title, items) => {
        list.append(el('b', '', title));
        for (const p of items) {
            const row = el('div', 'sillynpc-imagegen-ph-row');
            row.append(el('code', '', p.token), el('span', '', `${p.about}${p.alias ? ` (also ${p.alias.join(', ')})` : ''}`));
            list.append(row);
        }
    };
    addTokens('Every picture', PLACEHOLDERS);
    addTokens(`Scene picture (up to ${SCENE_SLOTS} characters)`, SCENE_PLACEHOLDERS.filter(p => !/^%char[2-9]_/.test(p.token)));
    list.append(el('small', 'notes', `Characters 2 to ${SCENE_SLOTS} work the same way: %char2_prompt%, %char2_name%, and so on. Empty slots are empty text.`));
    details.append(list);
    pane.append(details);

    // --- the plain graph's settings
    pane.append(el('h4', 'sillynpc-combat-heading', 'Plain graph settings'));
    pane.append(el('small', 'notes', 'Used when no workflow is chosen. A workflow can also read these through %ckpt%, %lora%, %steps%, %cfg%, %sampler%, %scheduler%, %denoise%, %width% and %height%.'));
    const bindNumber = (key, label, attrs, hint) => {
        const input = el('input', 'text_pole');
        input.type = 'number';
        Object.assign(input, attrs);
        input.value = s[key];
        input.addEventListener('change', () => { s[key] = Number(input.value); saveImagegenSettings(); input.value = s[key]; });
        return field(label, input, hint);
    };
    const bindText = (key, label, placeholder, hint) => {
        const input = el('input', 'text_pole');
        input.placeholder = placeholder || '';
        input.value = s[key];
        input.addEventListener('change', () => { s[key] = input.value; saveImagegenSettings(); input.value = s[key]; });
        return field(label, input, hint);
    };
    const selectField = (key, label, blank) => {
        const select = el('select', 'text_pole');
        selects[key] = select;
        select.addEventListener('change', () => { s[key] = select.value; saveImagegenSettings(); });
        return field(label, select);
    };
    const ckpt = selectField('ckpt', 'Checkpoint');
    const lora = selectField('lora', 'LoRA');
    const sampler = selectField('sampler', 'Sampler');
    const scheduler = selectField('scheduler', 'Scheduler');
    fillAll();
    const grid = el('div', 'sillynpc-imagegen-grid');
    grid.append(ckpt, lora, bindNumber('loraStrength', 'LoRA strength', { min: -2, max: 2, step: 0.05 }), sampler, scheduler,
        bindNumber('steps', 'Steps', { min: 1, max: 150, step: 1 }), bindNumber('cfg', 'CFG', { min: 1, max: 30, step: 0.5 }),
        bindNumber('denoise', 'Denoise', { min: 0.01, max: 1, step: 0.05 }),
        bindText('size', 'Picture size', '768x1024', 'Width x height, for characters and phone photos.'),
        bindText('sceneSize', 'Scene size', '1216x832', 'For Scene picture.'),
        bindNumber('timeoutS', 'Give up after (seconds)', { min: 30, max: 1800, step: 30 }));
    pane.append(grid);
    const hires = el('input');
    hires.type = 'checkbox';
    hires.checked = s.hires;
    hires.addEventListener('change', () => { s.hires = hires.checked; saveImagegenSettings(); });
    const hiresRow = el('label', 'checkbox_label');
    hiresRow.append(hires, el('span', '', 'Second pass: sharper, but slower'));
    pane.append(hiresRow);
    const negative = el('textarea', 'text_pole');
    negative.rows = 2;
    negative.value = s.negative;
    negative.addEventListener('change', () => { s.negative = negative.value; saveImagegenSettings(); });
    pane.append(field('Negative prompt', negative, 'Added to every picture\'s own negative prompt.'));

    // --- the scene
    pane.append(el('h4', 'sillynpc-combat-heading', 'Scene picture'));
    pane.append(el('small', 'notes',
        'Draws the people in the current scene together with your own character. A workflow gives each person a prompt of their own '
        + 'through %char1_prompt%, %char2_prompt%, … and %player_prompt%, and the place through %location%.'));
    const open = el('button', 'menu_button', 'Draw the current scene…');
    open.type = 'button';
    open.addEventListener('click', () => openScenePicture());
    pane.append(open);

    renderLocationBackgrounds(pane, { live });

    if (live && (s.url || comfyBase())) check(true);
}

/* ----------------------------------------------------------------------- scene dialog */

let dialog = null;

/** Someone as the scene wants them: a name, an image prompt and a portrait to show a picture workflow. */
const personOf = (r) => ({
    id: r.id, name: r.name, prompt: String(r.imagePrompt || '').trim(), negative: String(r.imageNegative || '').trim(), image: String(r.imageUrl || ''),
});

/**
 * Opens the scene picture dialog, filled from the chat: who is here, who you are, and where.
 *
 * With a workflow that takes pictures (see Workflow inputs in the module), the dialog is a row of slots: you in the first,
 * then one dropdown per person slot, then the location picture. Anyone can go in any slot. With a placeholder workflow
 * the people fill the %char1_prompt%, %char2_prompt% ... slots in the same order.
 */
export function openScenePicture() {
    if (dialog) { dialog.remove(); dialog = null; }
    const s = imagegenSettings();
    const records = getSettings().characters || [];
    const scene = gatherScene();

    const overlay = el('div', 'sillynpc-imagegen-overlay');
    const box = el('div', 'sillynpc-imagegen-dialog');
    dialog = overlay;
    overlay.append(box);
    const head = el('div', 'sillynpc-imagegen-head');
    const close = el('button', 'sillynpc-imagegen-close', '×');
    close.type = 'button';
    close.title = 'Close';
    head.append(close, el('span', '', 'Scene picture'));
    const body = el('div', 'sillynpc-imagegen-body');
    box.append(head, body);
    document.body.append(overlay);

    // --- the workflow comes first: it decides how many people slots there are
    const picker = workflowPicker({ value: s.sceneWorkflow || s.defaultWorkflow, blank: 'The plain graph from the module settings', onChange: () => rebuild() });
    const pickerSelect = picker.querySelector('select');
    body.append(field('Workflow', picker));
    body.append(apiFormatWarning());

    const location = el('input', 'text_pole');
    location.value = scene.location;
    location.placeholder = 'Where is the scene?';
    body.append(field('Location', location, scene.location ? '' : 'The tracker has no Location yet: type one.'));

    // The place's picture is read when the picture is drawn, so a location change while this is open is picked up.
    // A place in the Location backgrounds table wins, then Vistalyze's background, then whatever the chat is showing.
    const presetBackground = () => {
        const hit = matchLocation(locationSettings().entries, location.value || currentPlace());
        return hit?.file ? `/backgrounds/${encodeURIComponent(hit.file)}` : '';
    };
    const liveBackground = () => presetBackground() || vistalyzeScene()?.background || currentBackgroundUrl();
    const slotsHost = el('div', 'sillynpc-imagegen-slots');
    body.append(slotsHost);

    const extra = el('textarea', 'text_pole');
    extra.rows = 2;
    extra.placeholder = 'Anything else: time of day, mood, who stands where, what they are doing…';
    body.append(field('Extra', extra));
    const size = el('input', 'text_pole');
    size.value = s.sceneSize;
    body.append(field('Size', size));

    const status = el('div', 'notes sillynpc-imagegen-status');
    const go = el('button', 'menu_button', 'Draw');
    go.type = 'button';
    const stop = el('button', 'menu_button', 'Stop');
    stop.type = 'button';
    stop.style.display = 'none';
    const actions = el('div', 'sillynpc-imagegen-actions');
    actions.append(go, stop);
    const result = el('div', 'sillynpc-imagegen-result');
    body.append(actions, status, result);

    // --- the slots, rebuilt whenever the workflow changes
    let includeMe = null;
    let peopleSelects = [];
    let locationSource = null;
    let locationFile = '';
    const rebuild = () => {
        const bound = pickerSelect.value ? bindingsFor(pickerSelect.value) : [];
        const pictures = bound.some(b => /_image$/.test(b.role));
        const personSlots = pictures ? bound.filter(b => /^char\d+_image$/.test(b.role)).length : SCENE_SLOTS;
        const wantsMe = !pictures || bound.some(b => b.role === 'player_image');
        const wantsPlace = pictures && bound.some(b => b.role === 'location_image');
        slotsHost.replaceChildren();
        peopleSelects = [];
        includeMe = null;
        locationSource = null;

        if (pictures) slotsHost.append(el('small', 'notes', 'This workflow takes reference pictures: each slot below is a portrait handed to it. A person with no portrait leaves their slot empty.'));

        if (wantsMe) {
            const card = el('label', 'checkbox_label');
            includeMe = el('input');
            includeMe.type = 'checkbox';
            includeMe.checked = Boolean(scene.player.name || scene.player.prompt || scene.player.image);
            const flaw = pictures && !scene.player.image ? ': no portrait on your persona yet' : (!pictures && !scene.player.prompt ? ': no image prompt on your persona yet' : '');
            card.append(includeMe, el('span', '', `${pictures ? 'Picture 1: ' : ''}${scene.player.name || 'You'} (you)${flaw}`));
            slotsHost.append(card);
        }
        const inScene = new Set(scene.characters.map(c => c.id));
        for (let i = 0; i < personSlots; i++) {
            const select = el('select', 'text_pole');
            select.append(new Option('Nobody', ''));
            const here = el('optgroup');
            here.label = 'In the scene';
            const others = el('optgroup');
            others.label = 'Everyone else';
            for (const r of records) {
                if (!r?.name) continue;
                (inScene.has(r.id) ? here : others).append(new Option(r.name, r.id));
            }
            if (here.children.length) select.append(here);
            if (others.children.length) select.append(others);
            select.value = scene.characters[i]?.id || '';
            const label = pictures ? `Picture ${(wantsMe ? 2 : 1) + i}` : `Person ${i + 1}`;
            slotsHost.append(field(label, select));
            peopleSelects.push(select);
        }
        if (wantsPlace) {
            const source = el('select', 'text_pole');
            if (liveBackground()) source.append(new Option(scene.vistalyze ? 'The chat\'s current background (from Vistalyze)' : 'The chat\'s current background', 'background'));
            source.append(new Option('Choose a picture…', 'file'), new Option('None', 'none'));
            source.value = liveBackground() ? 'background' : 'none';
            const file = el('input');
            file.type = 'file';
            file.accept = 'image/*';
            file.style.display = 'none';
            const preview = el('img', 'sillynpc-imagegen-thumb');
            preview.style.display = 'none';
            const show = () => {
                const url = source.value === 'background' ? liveBackground() : (source.value === 'file' ? locationFile : '');
                preview.style.display = url ? '' : 'none';
                if (url) preview.src = url;
            };
            source.addEventListener('change', () => {
                if (source.value === 'file') file.click();
                show();
            });
            file.addEventListener('change', () => {
                const picked = file.files?.[0];
                if (!picked) return;
                const reader = new FileReader();
                reader.onload = () => { locationFile = String(reader.result); show(); };
                reader.readAsDataURL(picked);
            });
            slotsHost.append(field(`Picture ${personSlots + (wantsMe ? 2 : 1)}: the place`, source), file, preview);
            locationSource = { source, value: () => (source.value === 'background' ? liveBackground() : (source.value === 'file' ? locationFile : '')) };
            show();
        }
    };
    rebuild();

    close.addEventListener('click', () => { cancelImageGen(); overlay.remove(); dialog = null; });
    stop.addEventListener('click', () => cancelImageGen());

    go.addEventListener('click', async () => {
        const chosen = peopleSelects.map(sel => records.find(r => r.id === sel.value)).filter(Boolean).map(personOf);
        const withMe = Boolean(includeMe?.checked);
        if (!chosen.length && !withMe) { toastr.info('Pick at least one person.', PRODUCT_NAME); return; }
        const workflow = pickerSelect.value;
        if (workflow) {
            const info = await checkWorkflow(workflow);
            if (!info.ok) { status.textContent = info.message; status.className = 'notes sillynpc-imagegen-status is-bad'; return; }
        }
        go.disabled = true; stop.style.display = ''; result.replaceChildren();
        status.className = 'notes sillynpc-imagegen-status';
        status.textContent = 'Drawing… this can take a while on a local GPU.';
        try {
            const blob = await generateScene({
                characters: chosen, player: withMe ? scene.player : null, location: location.value, extra: extra.value, workflow, size: size.value,
                locationImage: locationSource ? locationSource.value() : '',
            });
            const dataUrl = await blobToDataUrl(blob);
            showResult(result, dataUrl, [...chosen.map(c => c.name), withMe ? scene.player.name : ''].filter(Boolean));
            status.textContent = '';
        } catch (err) {
            if (err?.name === 'AbortError') status.textContent = 'Stopped.';
            else { status.textContent = describeComfyError(err); status.classList.add('is-bad'); console.warn('[Worldkit] scene picture failed', err); }
        } finally {
            go.disabled = false; stop.style.display = 'none';
        }
    });
}

function showResult(host, dataUrl, names) {
    host.replaceChildren();
    const img = el('img', 'sillynpc-imagegen-img');
    img.src = dataUrl;
    img.alt = `Scene with ${names.join(', ')}`;
    const row = el('div', 'sillynpc-imagegen-actions');
    const save = el('button', 'menu_button', 'Save');
    const post = el('button', 'menu_button', 'Post in chat');
    const download = el('a', 'menu_button', 'Download');
    download.href = dataUrl;
    download.download = `scene-${Date.now()}.png`;
    for (const b of [save, post]) b.type = 'button';
    const saved = { path: '' };
    const persist = async () => {
        if (saved.path) return saved.path;
        const base64 = dataUrl.split(',')[1];
        const type = /^data:image\/([a-z0-9+.-]+);/i.exec(dataUrl)?.[1] || 'png';
        saved.path = await saveBase64AsFile(base64, 'worldkit-scenes', `scene_${Date.now()}`, type === 'jpeg' ? 'jpg' : type);
        return saved.path;
    };
    save.addEventListener('click', async () => {
        try { const path = await persist(); toastr.success(`Saved to ${path}`, PRODUCT_NAME); } catch (err) { toastr.error(`Could not save: ${err?.message || err}`, PRODUCT_NAME); }
    });
    post.addEventListener('click', async () => {
        try {
            const path = await persist();
            const context = getContext();
            const message = {
                name: PRODUCT_NAME, is_user: false, is_system: true, send_date: getMessageTimeStamp(), mes: `Scene: ${names.join(', ')}`,
                extra: { image: path, title: `Scene: ${names.join(', ')}`, inline_image: false },
            };
            context.chat.push(message);
            await eventSource.emit('message_sent', context.chat.length - 1);
            context.addOneMessage(message);
            await context.saveChat();
            toastr.success('Posted in the chat.', PRODUCT_NAME);
        } catch (err) { toastr.error(`Could not post: ${err?.message || err}`, PRODUCT_NAME); }
    });
    row.append(save, post, download);
    host.append(img, row);
}

/* ------------------------------------------------------------------------------ wiring */

function registerSceneCommand() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'scenepic',
            aliases: ['scene-picture'],
            callback: () => { openScenePicture(); return ''; },
            returns: 'nothing',
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'nothing', typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
            helpString: 'Opens the Worldkit scene picture dialog: draw the people in the scene, with you, at the current location.',
        }));
    } catch (err) { console.warn('[Worldkit] could not register /scenepic', err); }
}

registerModulePane('imagegen', renderPane);
registerSceneCommand();
// The wand menu (index.js) asks for the dialog through this event, so it needs no import of the module.
eventSource.on('worldkit-scene-picture', () => openScenePicture());
void inspectWorkflow;
