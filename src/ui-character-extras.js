import { getSettings, saveSettings } from './settings.js';
import { buildSettingToggle, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { ttsStatus, previewVoice, syncVoiceNames, applyAutoGenerationHandover, voiceChoices, getVoice, setVoice } from './tts.js';
import { generateFromCard, DEFAULT_IMAGE_INJECT_TEMPLATE } from './image-prompts.js';

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

    // --- Voice -----------------------------------------------------------------------
    const voiceRow = document.createElement('div');
    voiceRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const voiceSelect = document.createElement('select');
    voiceSelect.className = 'text_pole';
    voiceSelect.style.cssText = 'width:auto; min-width:14em;';
    voiceSelect.disabled = true;
    voiceSelect.append(new Option('Loading voices...', ''));
    voiceRow.append(label('Voice'), voiceSelect);

    // Filled from the active provider (AllTalk, ElevenLabs, ...) once it answers.
    (async () => {
        await syncVoiceNames();
        const [voices, current] = await Promise.all([voiceChoices(), getVoice(char.name)]);
        voiceSelect.replaceChildren();
        if (!voices.length) {
            voiceSelect.append(new Option('No voices - enable TTS and apply the patch', ''));
            return;
        }
        for (const v of ['[Default Voice]', 'disabled', ...voices]) voiceSelect.append(new Option(v, v));
        voiceSelect.value = current || '[Default Voice]';
        voiceSelect.disabled = false;
    })();
    voiceSelect.addEventListener('change', async () => {
        if (!await setVoice(char.name, voiceSelect.value)) {
            toastr.warning('Could not set the voice. Is SillyTavern's TTS enabled?', 'SillyNPC');
        }
    });

    voiceRow.append(button('fa-volume-high', 'Test voice', async () => {
        await previewVoice(char.name, `${char.name}. This is what I sound like.`);
    }));
    container.append(voiceRow);

    ttsStatus().then(status => {
        if (!status.ready && getSettings().ttsEnabled) container.append(note(status.reason));
    });
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
        key: 'ttsEnabled',
        label: 'Give Characters Their Own Voice',
        help: "Adds this chat's characters to SillyTavern's TTS voice map and puts a speaker "
            + 'button on each message. Needs SillyTavern\'s TTS enabled, and the small patch in '
            + 'this extension\'s patches folder.',
        onChange: () => { syncVoiceNames(); applyAutoGenerationHandover(); rerender(); },
    }));

    if (getSettings().ttsEnabled) {
        view.append(buildSettingToggle({
            key: 'ttsAutoSpeak',
            label: 'Read New Replies Aloud',
            help: "Reads each new reply as it finishes, a voice per speaker. This takes over "
                + "from SillyTavern's own Auto Generation, which would read the whole reply as "
                + 'one speaker, so that one is paused while this is on.',
            onChange: applyAutoGenerationHandover,
        }));
        view.append(buildSettingToggle({
            key: 'ttsSpeakThoughts',
            label: 'Read Thoughts',
            help: 'Lines written in parentheses. Off by default: a thought is not said out loud.',
        }));
        view.append(buildSettingToggle({
            key: 'ttsSpeakNarration',
            label: 'Read Narration',
            help: "Untagged paragraphs, in the voice mapped to [Default Voice] in SillyTavern's TTS panel.",
        }));
    }

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
