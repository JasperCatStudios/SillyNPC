import { getSettings, saveSettings } from './settings.js';
import { eventSource } from '../../../../events.js';
import { buildSettingToggle, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { previewVoice, voiceChoices, ttsStatus, VOICE_KEYS } from './tts.js';
import { generateFromCard, DEFAULT_IMAGE_INJECT_TEMPLATE } from './image-prompts.js';
import { buildSettingSelect } from './ui-shared.js';
import { engineOf, ENGINES, ELEVEN_MODELS } from './tts-engines.js';
import { INTERNAL_STATES_SYSTEM, drawSection } from './internal-states.js';
import { buildThemePicker } from './ui-tracker-theme.js';

import { PRODUCT_NAME } from './constants.js';
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

    container.append(
        label('Image generation prompt'),
        promptBox,
        negBox,
        actions,
        note('Sent to SillyTavern\'s image generation by the button, and - when "Send Image Prompts '
            + 'To The Model" is on - listed for the story model whenever this character is in the '
            + 'scene, so a prompt it writes describes the same person each time.'),
    );

    }

    container.append(buildTagsField(char));

    if (!wantVoice) return;
    // --- Voice -----------------------------------------------------------------------
    container.append(buildVoicePicker({
        label: 'Voice',
        get: () => char.ttsVoice || '',
        set: (voice) => { char.ttsVoice = voice; saveSettings(); },
        sample: `${char.name}. This is what I sound like.`,
    }));
    container.append(buildPhoneticField(char));
}

/** The character's own tags, comma separated. Used by the Activities exam (a world can let only tagged characters examine). */
export function buildTagsField(char) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole';
    input.style.cssText = 'flex:1; min-width:12em;';
    input.placeholder = 'e.g. mentor, professor';
    input.title = 'Words that describe this character, separated by commas. A world can let only characters with a certain tag (such as mentor) examine in Activities. Not case sensitive.';
    input.value = (char.tags || []).join(', ');
    input.addEventListener('input', () => { char.tags = input.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 12); saveSettings(); });
    row.append(label('Tags'), input);
    return row;
}

/** How the name is said: sent to the voice engine in place of the name wherever it appears in a line. */
export function buildPhoneticField(char) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole';
    input.style.cssText = 'flex:1; min-width:12em;';
    input.placeholder = 'e.g. VEH-tah';
    input.title = 'Said in place of the name whenever it is read aloud. The written name is not changed. For a name with several parts, give the same number of parts and each is also said that way alone.';
    input.value = char.phonetic || '';
    input.addEventListener('input', () => { char.phonetic = input.value; saveSettings(); });
    row.append(label('Name said as'), input);
    row.append(button('fa-volume-high', 'Test', () => previewVoice(char.ttsVoice || '', `${char.phonetic || char.name}. This is how my name sounds.`)));
    return row;
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
            select.append(new Option('No voices - is the voice engine ready?', ''));
            return;
        }
        select.append(new Option('- none -', ''));
        const current = String(get() || '');
        // A voice that has since left the server stays selectable rather than being lost silently.
        const known = voices.some(v => v.value === current);
        for (const v of (current && !known) ? [{ value: current, label: current }, ...voices] : voices) select.append(new Option(v.label, v.value));
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

/** A number field that takes decimals, bound to a settings key and kept inside its range. */
function decimalField({ key, label: text, help, min, max, step }) {
    const settings = getSettings();
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:6px;';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'text_pole';
    input.style.width = '6em';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.title = help || '';
    input.value = String(settings[key] ?? '');
    input.addEventListener('change', () => {
        const n = Number(input.value);
        const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
        settings[key] = next;
        input.value = String(next);
        saveSettings();
    });
    row.append(label(text), input);
    if (help) row.append(note(help));
    return row;
}

/** The settings of the cloud engine: ElevenLabs through SillyTavern. */
function buildCloudEngineSettings(engine) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    const status = document.createElement('small');
    status.className = 'notes';
    const test = button('fa-plug', 'Test', async () => {
        status.textContent = 'Checking...';
        const result = await ttsStatus();
        status.textContent = result.ready ? 'Ready.' : result.reason;
    });

    if (engine === 'elevenlabs') {
        wrap.append(
            note('This uses the ElevenLabs key SillyTavern already holds (set in its own TTS extension panel by choosing ElevenLabs there). Reload the page after the key is added. A voice is an ElevenLabs voice id, picked below from your account.'),
            buildSettingSelect({
                key: 'elevenModel',
                label: 'Model',
                help: 'Eleven v4, v4 Turbo and v3 read delivery tags such as [whispers]. Every other model gets the plain words.',
                options: Object.entries(ELEVEN_MODELS).map(([value, text]) => ({ value, label: text })),
            }),
            decimalField({ key: 'elevenStability', label: 'Stability', help: '0 to 1.', min: 0, max: 1, step: 0.05 }),
            decimalField({ key: 'elevenSimilarity', label: 'Similarity', help: '0 to 1. May not apply to Eleven v3.', min: 0, max: 1, step: 0.05 }),
            decimalField({ key: 'elevenSpeed', label: 'Speed', help: '0.7 to 1.2.', min: 0.7, max: 1.2, step: 0.05 }),
            test, status,
        );
        return wrap;
    }

    return wrap;
}

/**
 * The Voices settings: where AllTalk is, who reads what, and what is read.
 *
 * @param {HTMLElement} container
 */
export function renderVoiceSettings(container) {
    // Draw into our own box, so a redraw (engine change) never removes what the caller put in the container, such as the on/off switch.
    const body = document.createElement('div');
    container.append(body);
    drawVoiceSettings(body);
}

/**
 * @param {HTMLElement} container The box this function owns and may clear.
 */
function drawVoiceSettings(container) {
    const settings = getSettings();

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = 'Characters are read by the engine chosen below. Pick each character\'s voice on their '
        + 'page; the rest are chosen here. SillyTavern\'s own TTS is not used, so it can stay off.';
    container.append(intro);

    const engine = engineOf(settings);
    container.append(buildSettingSelect({
        key: 'ttsEngine',
        label: 'Voice Engine',
        help: 'Voices are per engine: a voice picked under one is not valid under another, so change engines before picking voices.',
        options: Object.entries(ENGINES).map(([value, text]) => ({ value, label: text })),
        onChange: () => { container.replaceChildren(); drawVoiceSettings(container); },
    }));

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
    if (engine === 'alltalk') container.append(connection);
    else container.append(buildCloudEngineSettings(engine));

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
            + 'speaker\'s voice. Each spoken line also has its own speak button just before its words, and the '
            + 'message toolbar (the three dots) has one that reads the whole message. A line that has been '
            + 'spoken before is replayed from the saved audio instead of being requested again. This follows '
            + 'the Voices settings here only; SillyTavern\'s own TTS is not involved.',
    }));
    container.append(buildSettingToggle({
        key: 'ttsSpeakModules',
        label: 'Read Combat, Games and Activities Lines Aloud',
        help: 'The lines characters say during a fight, a game or an activity are read in their voices. '
            + 'This is separate from "Read New Replies Aloud", which is only for the chat.',
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
    container.append(buildSettingToggle({
        key: 'ttsToneTags',
        label: 'Send Delivery To The Voice',
        help: 'A line marked [whisper]...[/whisper] is sent to Eleven v4 or v3 as [whispers] and the closing tag is dropped. '
            + 'Off, or on any other model or engine, the tags are removed and only the words are read.',
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

    // An on/off switch like Bonds and Vitals. It is stored in internalStatesMode: off is "off", on is
    // "after" (a second request writes the block) or "inline" (the story model writes it, see below).
    const toggleWrap = document.createElement('div');
    toggleWrap.className = 'sillynpc-setting';
    toggleWrap.dataset.setting = 'internalStatesMode';
    const toggleRow = document.createElement('label');
    toggleRow.className = 'checkbox_label sillynpc-setting-row';
    toggleRow.style.cursor = 'pointer';
    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'sillynpc-setting-label';
    toggleLabel.style.fontWeight = '500';
    toggleLabel.textContent = 'Internal States';
    const toggleBox = document.createElement('input');
    toggleBox.type = 'checkbox';
    toggleBox.checked = getSettings().internalStatesMode !== 'off';
    toggleBox.addEventListener('change', () => {
        getSettings().internalStatesMode = toggleBox.checked ? 'after' : 'off';
        saveSettings();
        redraw();
        rerender();
    });
    toggleRow.append(toggleLabel, toggleBox);
    const toggleHelp = document.createElement('small');
    toggleHelp.className = 'notes';
    toggleHelp.style.cssText = 'margin-top:4px; display:block;';
    toggleHelp.textContent = 'A second request writes the state block (agendas, thoughts, body scale, Chekhov, GM '
        + 'notebook, world sim; bonds live in the Bonds view) and it is shown in its own section under the message. '
        + 'It uses the connection chosen for Internal states in Connections (the Main API until you pick one), '
        + 'and its instructions are in Prompts, under Tracker prompts.';
    toggleWrap.append(toggleRow, toggleHelp);
    container.append(toggleWrap);
    container.append(buildThemePicker('states', { onChange: rerender }));

    if (getSettings().internalStatesMode === 'off') return;

    // A save that still has the old In The Reply choice keeps it (nothing is written here, the preset and
    // its regexes handle it), so the settings below only apply to the written-after kind.
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
        key: 'internalStatesInject',
        label: 'Tell The Story Model The State',
        help: 'Sends the last written state to the story model as plain text and asks it not to '
            + 'write a block of its own.',
    }));
    // The instructions and template moved to the Prompts tab, under Tracker prompts.
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
