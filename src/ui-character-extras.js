import { getSettings, saveSettings } from './settings.js';
import { eventSource } from '../../../../events.js';
import { buildSettingToggle, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { previewVoice, voiceChoices, ttsStatus, VOICE_KEYS } from './tts.js';
import { generateFromCard, DEFAULT_IMAGE_INJECT_TEMPLATE } from './image-prompts.js';
import { buildSettingSelect } from './ui-shared.js';
import { INTERNAL_STATES_SYSTEM, drawSection } from './internal-states.js';

import { PRODUCT_NAME } from './constants.js';
import { workflowPicker, apiFormatWarning } from './ui-workflow-picker.js';
import { openCharacterPicture } from './ui-character-picture.js';
import { saveCharacterSheet } from './api.js';
import { sheetPathOf } from './comfy-core.js';
/**
 * What the fork adds to a character's page: the picture prompt and the voice.
 *
 * Kept out of ui-manage.js, which is already 1500 lines and is upstream's, so a later merge
 * touches as little of it as possible - the editor gains one container and one call.
 */

function label(text) {
    const el = document.createElement('label');
    el.textContent = text;
    return el;
}

function note(text) {
    const el = document.createElement('small');
    el.className = 'notes';
    el.style.cssText = 'display:block; margin:4px 0;';
    el.textContent = text;
    return el;
}

function button(icon, text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu_button';
    btn.style.cssText = 'width:auto; white-space:nowrap;';
    btn.innerHTML = `<i class="fa-solid ${icon}"></i> `;
    btn.append(document.createTextNode(text));
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * @param {object} char
 * @param {HTMLElement} container
 * @param {{ part?: 'all'|'visual'|'voice' }} [options] A tab of the profile draws one half: the picture
 *   prompts (visual) or the phone skin and voice (voice). The editor draws both under one heading.
 */
/**
 * The character sheet slot: one picture of the whole character (outfit, front and back, details) that a workflow
 * can be given in place of their portrait. A picture in the gallery whose file name says "charactersheet" is
 * found as well, so a sheet added by name works without choosing it here.
 */
function buildSheetBlock(char) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-sheet-block';
    wrap.append(label('Character sheet'));
    const preview = document.createElement('img');
    preview.className = 'sillynpc-imagegen-thumb';
    const status = note('');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin:6px 0;';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    const show = () => {
        const path = sheetPathOf(char);
        preview.style.display = path ? '' : 'none';
        if (path) preview.src = /^(data:|https?:|\/)/i.test(path) ? path : `/${path}`;
        const named = !char.sheetImage && path;
        status.textContent = path
            ? (named ? `Found in the gallery by its name: ${path.split('/').pop()}.` : `Set: ${path.split('/').pop()}.`)
            : 'None yet. A picture named like "charactersheet" in the gallery is found by itself.';
        remove.style.display = char.sheetImage ? '' : 'none';
    };
    const choose = button('fa-image', 'Choose a sheet…', () => input.click());
    const remove = button('fa-trash', 'Remove', () => { delete char.sheetImage; saveSettings(); show(); });
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try { await saveCharacterSheet(char, String(reader.result)); toastr.success('Character sheet saved.', PRODUCT_NAME); show(); }
            catch (err) { toastr.error(`Could not save it: ${err?.message || err}`, PRODUCT_NAME); }
        };
        reader.readAsDataURL(file);
        input.value = '';
    });
    row.append(choose, remove, input);
    wrap.append(preview, row, status);
    show();
    return wrap;
}

export function renderCharacterExtras(char, container, options = {}) {
    if (!container) return;
    const part = options.part || 'all';
    const wantVisual = part === 'all' || part === 'visual';
    const wantVoice = part === 'all' || part === 'voice';
    container.replaceChildren();

    if (part === 'all') {
        const header = document.createElement('div');
        header.className = 'sillynpc-aliases-header';
        header.append(label('Image & Voice'));
        container.append(header);
    }

    if (wantVisual) {

    // --- Image generation prompt ---------------------------------------------------
    const promptBox = document.createElement('textarea');
    promptBox.className = 'text_pole';
    promptBox.rows = 4;
    promptBox.placeholder = '1girl, silver hair, braided, green eyes, scar over left brow, black leather coat';
    promptBox.value = char.imagePrompt || '';
    promptBox.addEventListener('input', () => {
        char.imagePrompt = promptBox.value;
        saveSettings();
    });

    const negBox = document.createElement('textarea');
    negBox.className = 'text_pole';
    negBox.rows = 2;
    negBox.placeholder = 'Negative prompt (optional)';
    negBox.value = char.imageNegative || '';
    negBox.addEventListener('input', () => {
        char.imageNegative = negBox.value;
        saveSettings();
    });

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin:6px 0;';
    actions.append(
        button('fa-wand-magic-sparkles', 'Generate with this prompt', () => generateFromCard(char)),
        button('fa-copy', 'Copy', async () => {
            try {
                await navigator.clipboard.writeText(char.imagePrompt || '');
                toastr.success('Copied.', PRODUCT_NAME);
            } catch {
                toastr.error('Could not copy.', PRODUCT_NAME);
            }
        }),
    );

    // --- ComfyUI workflow for this character (the Images module draws with it, and so does the phone) ---
    actions.append(button('fa-image', 'Draw with ComfyUI workflow', () => openCharacterPicture(char)));
    const workflowRow = document.createElement('div');
    workflowRow.append(
        label('ComfyUI workflow'),
        workflowPicker({
            value: char.imageWorkflow || '',
            blank: 'Use the default from Modules, Images',
            onChange: (name) => { char.imageWorkflow = name; saveSettings(); },
        }),
        apiFormatWarning(),
        note('Chosen from SillyTavern\'s ComfyUI workflow folder (data/<your user>/user/workflows). The workflow draws the pictures made '
            + 'with the button below, using the image prompt and negative prompt above as %prompt% and %negative%.'),
        label('Phone selfie workflow'),
        workflowPicker({
            value: char.phoneWorkflow || '',
            blank: 'Use the phone default from Modules, Images',
            onChange: (name) => { char.phoneWorkflow = name; saveSettings(); },
        }),
        note('Used only for this character\'s photos on the phone. A workflow with a reference picture input is shown their sheet, or their portrait.'),
        buildSheetBlock(char),
    );

    container.append(
        label('Image generation prompt'),
        promptBox,
        negBox,
        workflowRow,
        actions,
        note('Sent to SillyTavern\'s image generation by the button, and - when "Send Image Prompts '
            + 'To The Model" is on - listed for the story model whenever this character is in the '
            + 'scene, so a prompt it writes describes the same person each time.'),
    );

    }

    if (!wantVoice) return;
    // --- Phone theme -----------------------------------------------------------------
    const skinRow = document.createElement('div');
    skinRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const skinSelect = document.createElement('select');
    skinSelect.className = 'text_pole';
    skinSelect.style.cssText = 'width:auto; min-width:14em;';
    for (const [value, text] of [['', 'Phone default'], ['cute', 'Cute'], ['goth', 'Gothic'], ['lace', 'Lace'], ['modern', 'Classic']]) {
        skinSelect.append(new Option(text, value));
    }
    skinSelect.value = char.phoneSkin || '';
    skinSelect.addEventListener('change', () => {
        char.phoneSkin = skinSelect.value;
        saveSettings();
        eventSource.emit('sillynpc-phone-refresh');
    });
    skinRow.append(label('Phone theme'), skinSelect);
    container.append(skinRow, note('This contact’s thread on the phone uses this skin, tinted with their accent colour. Applies when the phone is in one of its phone skins.'));

    // --- Voice -----------------------------------------------------------------------
    container.append(buildVoicePicker({
        label: 'Voice',
        get: () => char.ttsVoice || '',
        set: (voice) => { char.ttsVoice = voice; saveSettings(); },
        sample: `${char.name}. This is what I sound like.`,
    }));
}

/**
 * A dropdown of the voices AllTalk offers, bound to whatever the caller keeps a voice in.
 *
 * @param {{ label: string, get: () => string, set: (voice: string) => void, sample?: string }} spec
 * @returns {HTMLElement}
 */
export function buildVoicePicker({ label: labelText, get, set, sample = 'This is what I sound like.' }) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.style.cssText = 'width:auto; min-width:14em;';
    select.disabled = true;
    select.append(new Option('Loading voices...', ''));
    row.append(label(labelText), select);

    (async () => {
        const voices = await voiceChoices();
        select.replaceChildren();
        if (!voices.length) {
            select.append(new Option('No voices - is AllTalk running?', ''));
            return;
        }
        select.append(new Option('- none -', ''));
        const current = String(get() || '');
        // A voice that has since left the server stays selectable rather than being lost silently.
        for (const v of (current && !voices.includes(current)) ? [current, ...voices] : voices) select.append(new Option(v, v));
        select.value = current;
        select.disabled = false;
    })();
    select.addEventListener('change', () => set(select.value));

    row.append(button('fa-volume-high', 'Test voice', () => previewVoice(select.value || get(), sample)));
    return row;
}

/** The voice somebody with no card is read in, by gender - chosen here and on the Voices card. */
export function buildStrangerVoices() {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    const settings = getSettings();
    const bind = (key) => ({
        get: () => settings[key] || '',
        set: (voice) => { settings[key] = voice; saveSettings(); },
    });
    wrap.append(
        label('Voices For Strangers'),
        note('A speaker with no card is read in the voice for their gender: the one their face is '
            + 'sorted under, or what their name says (Female Soldier, Old Man). Unsorted ones use the default voice.'),
        buildVoicePicker({ label: 'Female', ...bind(VOICE_KEYS.female), sample: 'Halt. State your business.' }),
        buildVoicePicker({ label: 'Male', ...bind(VOICE_KEYS.male), sample: 'Halt. State your business.' }),
    );
    return wrap;
}

/**
 * The Voices settings: where AllTalk is, who reads what, and what is read.
 *
 * @param {HTMLElement} container
 */
export function renderVoiceSettings(container) {
    const settings = getSettings();

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = 'Characters are read through AllTalk directly. Pick each character\'s voice on their '
        + 'page; the rest are chosen here. SillyTavern\'s own TTS is not used, so it can stay off.';
    container.append(intro);

    // connection
    const connection = document.createElement('div');
    connection.className = 'sillynpc-setting';
    const urlRow = document.createElement('div');
    urlRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;';
    const url = document.createElement('input');
    url.type = 'text';
    url.className = 'text_pole';
    url.style.cssText = 'flex:1; min-width:14em;';
    url.placeholder = 'http://localhost:7851';
    url.value = settings.alltalkUrl || '';
    url.addEventListener('change', () => { settings.alltalkUrl = url.value.trim(); saveSettings(); });
    const language = document.createElement('input');
    language.type = 'text';
    language.className = 'text_pole';
    language.style.width = '4em';
    language.title = 'Language code';
    language.value = settings.alltalkLanguage || 'en';
    language.addEventListener('change', () => { settings.alltalkLanguage = language.value.trim() || 'en'; saveSettings(); });
    const status = document.createElement('small');
    status.className = 'notes';
    urlRow.append(label('AllTalk address'), url, label('Language'), language, button('fa-plug', 'Test', async () => {
        status.textContent = 'Checking...';
        const result = await ttsStatus();
        status.textContent = result.ready ? 'Connected.' : result.reason;
    }));
    connection.append(urlRow, status, note('On a phone, use the address of the computer running AllTalk (for example http://192.168.1.20:7851), not localhost.'));
    container.append(connection);

    // who reads whom
    const bind = (key) => ({
        get: () => settings[key] || '',
        set: (voice) => { settings[key] = voice; saveSettings(); },
    });
    container.append(
        buildVoicePicker({ label: 'Default', ...bind(VOICE_KEYS.default), sample: 'This is the default voice.' }),
        buildVoicePicker({ label: 'You', ...bind(VOICE_KEYS.player), sample: 'This is my voice.' }),
        buildVoicePicker({ label: 'Female strangers', ...bind(VOICE_KEYS.female), sample: 'Halt. State your business.' }),
        buildVoicePicker({ label: 'Male strangers', ...bind(VOICE_KEYS.male), sample: 'Halt. State your business.' }),
    );

    container.append(buildSettingToggle({
        key: 'ttsAutoSpeak',
        label: 'Read New Replies Aloud',
        help: 'Reads each new reply as it finishes: only "quoted" speech and (thoughts), each in its '
            + 'speaker\'s voice. Every message also has a speech-bubble button in its toolbar (the three dots) '
            + 'to read it on demand. If SillyTavern\'s own TTS is on with Auto Generation, turn that off or '
            + 'replies are read twice.',
    }));
    container.append(buildSettingToggle({
        key: 'ttsSpeakThoughts',
        label: 'Read Thoughts',
        help: 'Text in (parentheses), in the speaker’s voice.',
    }));
    container.append(buildSettingToggle({
        key: 'ttsSpeakNarration',
        label: 'Read Quoted Speech With No Speaker',
        help: 'A "quote" in a paragraph with no speaker tag, in the default voice. Actions and description are never read.',
    }));
}

/**
 * The Internal States settings, drawn at the top of the Tracker tab.
 *
 * @param {HTMLElement} container
 * @param {() => void} rerender Redraws the panel, for controls that add or remove others.
 */
export function renderInternalStatesSettings(container, rerender) {
    const heading = document.createElement('h3');
    heading.className = 'sillynpc-section-title';
    heading.textContent = 'Internal States';
    container.append(heading);

    const redraw = () => document.querySelectorAll('#chat .mes').forEach(drawSection);

    container.append(buildSettingSelect({
        key: 'internalStatesMode',
        label: 'Internal States',
        help: 'After The Reply: a second request writes the state block (agendas, '
            + 'thoughts, body scale, Chekhov, GM notebook, world sim; bonds now live in the Bonds tab) and it is shown in '
            + 'its own section under the message. In The Reply: the story model writes it itself, and '
            + 'any regex scripts you have handle it - nothing happens here. '
            + 'If a preset of yours also asks for a block, switch that off.',
        options: [
            { value: 'after', label: 'After the reply (separate request)' },
            { value: 'inline', label: 'In the reply (preset writes it)' },
            { value: 'off', label: 'Off' },
        ],
        onChange: () => { redraw(); rerender(); },
    }));

    if (getSettings().internalStatesMode !== 'after') return;

    container.append(buildSettingNumber({
        key: 'internalStatesMaxTokens',
        label: 'Reply Budget',
        suffix: 'tokens',
        help: 'The whole block is rewritten every message, so give it room: 3000 or more.',
    }));
    container.append(buildSettingNumber({
        key: 'internalStatesContextMessages',
        advanced: true,
        label: 'Earlier Messages Read',
        suffix: 'messages',
        help: 'How many messages before the new one the writer is shown, besides the previous state.',
    }));
    container.append(buildSettingToggle({
        key: 'internalStatesApplyRegex',
        label: "Apply The Preset's Regexes",
        help: 'Runs your regex scripts that are set to Markdown-only over the block before showing it, '
            + 'so the preset’s colours and layout apply. Stripping scripts are never run on it.',
        onChange: redraw,
    }));
    container.append(buildSettingToggle({
        key: 'internalStatesInject',
        label: 'Tell The Story Model The State',
        help: 'Sends the last written state to the story model as plain text and asks it not to '
            + 'write a block of its own.',
    }));
    container.append(buildSettingTextArea({
        key: 'internalStatesPrompt',
        advanced: true,
        label: 'Instructions And Template',
        help: 'What the writer is told. Empty uses the built-in, which follows the Worldkit preset.',
        recommended: INTERNAL_STATES_SYSTEM,
        emptyNote: 'The built-in instructions are sent.',
        showTokens: true,
    }));
}

/**
 * The fork's switches, drawn at the foot of the Writing Rules tab.
 *
 * @param {HTMLElement} view
 * @param {() => void} rerender
 */
export function renderForkSettings(view, rerender) {
    const imageHeading = document.createElement('h3');
    imageHeading.className = 'sillynpc-section-title';
    imageHeading.style.marginTop = '24px';
    imageHeading.textContent = 'Character Image Prompts';
    view.append(imageHeading);

    view.append(buildSettingToggle({
        key: 'imagePromptInject',
        label: 'Send Image Prompts To The Model',
        help: 'Lists the saved image prompt of every character who spoke or was named in the '
            + 'last few messages, and asks the model to reuse those tags whenever it writes '
            + 'an image prompt of its own.',
        onChange: rerender,
    }));
    if (getSettings().imagePromptInject) {
        view.append(buildSettingNumber({
            key: 'imagePromptInjectDepth',
            advanced: true,
            label: 'Image Tag Depth',
            suffix: 'messages back',
            help: 'How far back from the newest message the list is inserted.',
        }));
        view.append(buildSettingTextArea({
            key: 'imagePromptInjectTemplate',
            advanced: true,
            label: 'Image Tag Wording',
            help: '{{list}} is replaced with one line per character. Empty uses the built-in wording.',
            recommended: DEFAULT_IMAGE_INJECT_TEMPLATE,
            emptyNote: 'The built-in wording is sent.',
        }));
    }
}
