import { getSettings, saveSettings } from './settings.js';
import { eventSource } from '../../../../events.js';
import { buildSettingToggle, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { previewVoice, syncVoiceNames, applyAutoGenerationHandover, voiceChoices, getVoice, setVoice, GENERIC_VOICES } from './tts.js';
import { generateFromCard, DEFAULT_IMAGE_INJECT_TEMPLATE } from './image-prompts.js';
import { buildSettingSelect } from './ui-shared.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import { INTERNAL_STATES_SYSTEM, drawSection } from './internal-states.js';

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
 */
export function renderCharacterExtras(char, container) {
    if (!container) return;
    container.replaceChildren();

    const header = document.createElement('div');
    header.className = 'sillynpc-aliases-header';
    header.append(label('Image & Voice'));
    container.append(header);

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
                toastr.success('Copied.', 'SillyNPC');
            } catch {
                toastr.error('Could not copy.', 'SillyNPC');
            }
        }),
    );

    container.append(
        label('Image generation prompt'),
        promptBox,
        negBox,
        actions,
        note('Sent to SillyTavern\'s image generation by the button, and - when "Send Image Prompts '
            + 'To The Model" is on - listed for the story model whenever this character is in the '
            + 'scene, so a prompt it writes describes the same person each time.'),
    );

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
    container.append(buildVoicePicker(char.name, 'Voice', `${char.name}. This is what I sound like.`));
}

/**
 * A dropdown of the active TTS provider's voices, bound to one name in SillyTavern's voice map.
 *
 * @param {string} name The voice-map name this row controls.
 * @param {string} labelText
 * @param {string} sample What the test button says.
 * @returns {HTMLElement}
 */
export function buildVoicePicker(name, labelText, sample) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.style.cssText = 'width:auto; min-width:14em;';
    select.disabled = true;
    select.append(new Option('Loading voices...', ''));
    row.append(label(labelText), select);

    // Filled from the active provider (AllTalk, ElevenLabs, ...) once it answers.
    (async () => {
        await syncVoiceNames();
        const [voices, current] = await Promise.all([voiceChoices(), getVoice(name)]);
        select.replaceChildren();
        if (!voices.length) {
            select.append(new Option('No voices - enable TTS and apply the patch', ''));
            return;
        }
        for (const v of ['[Default Voice]', 'disabled', ...voices]) select.append(new Option(v, v));
        select.value = current || '[Default Voice]';
        select.disabled = false;
    })();
    select.addEventListener('change', async () => {
        if (!await setVoice(name, select.value)) {
            toastr.warning('Could not set the voice. Is the TTS extension enabled?', 'SillyNPC');
        }
    });

    row.append(button('fa-volume-high', 'Test voice', () => previewVoice(name, sample)));
    return row;
}

/** The two generic voices used by speakers who have no card, chosen by the face they wear. */
export function buildStrangerVoices() {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.append(
        label('Voices For Strangers'),
        note('A speaker with no card is read in the voice for their gender: the one their face is '
            + 'sorted under, or what their name says (Female Soldier, Old Man). Unsorted ones use the default voice.'),
        buildVoicePicker(GENERIC_VOICES.female, 'Female', 'Halt. State your business.'),
        buildVoicePicker(GENERIC_VOICES.male, 'Male', 'Halt. State your business.'),
    );
    return wrap;
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
            + 'bonds, thoughts, body scale, Chekhov, GM notebook, world sim) and it is shown in '
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

    container.append(buildConnectionProfilePicker(() => {}, {
        key: 'internalStatesProfileId',
        scope: 'root',
        labelText: 'Internal States Connection',
        noteText: 'Which connection writes the state block. Pick a fast, cheap model, or leave on '
            + 'the main API.',
    }));
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
        help: 'What the writer is told. Empty uses the built-in, which follows the Mimostein preset.',
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
    const voiceHeading = document.createElement('h3');
    voiceHeading.className = 'sillynpc-section-title';
    voiceHeading.style.marginTop = '24px';
    voiceHeading.textContent = 'Character Voices';
    view.append(voiceHeading);

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = "Uses SillyTavern's own TTS. Every character in the chat gets a row in "
        + "its voice map (Extensions -> TTS); choose their voice there. Each tagged line is "
        + 'then read in its speaker\'s voice.';
    view.append(intro);

    view.append(buildSettingToggle({
        key: 'ttsAutoSpeak',
        label: 'Read New Replies Aloud',
        help: 'Reads each new reply as it finishes: only "quoted" speech and (thoughts), each in its '
            + "speaker's voice. This takes over from SillyTavern's own Auto Generation, which would "
            + 'read the whole reply as one speaker, so that one is paused while this is on. Every '
            + 'message also has a speech-bubble button in its toolbar (the three dots) to read it on demand.',
        onChange: applyAutoGenerationHandover,
    }));
    view.append(buildSettingToggle({
        key: 'ttsSpeakThoughts',
        label: 'Read Thoughts',
        help: 'Text in (parentheses), in the speaker’s voice.',
    }));
    view.append(buildSettingToggle({
        key: 'ttsSpeakNarration',
        label: 'Read Quoted Speech With No Speaker',
        help: 'A "quote" in a paragraph with no speaker tag, in the [Default Voice]. Actions and '
            + 'description are never read.',
    }));

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
