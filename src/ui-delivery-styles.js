import { getSettings, saveSettings } from './settings.js';
import { DEFAULT_TONE_TAGS, cleanToneTable, inlineNames } from './tts-text.js';
import { DELIVERY_MEANINGS } from './delivery-core.js';
import {
    DELIVERY_FONTS, DELIVERY_EFFECTS, DELIVERY_CASES, DELIVERY_DECORATIONS, DEFAULT_DELIVERY_STYLES, styleFor, cleanStyle,
} from './delivery-style.js';
import { applyDelivery, applyDeliveryStyle } from './delivery.js';
import { engineReadsAudioTags, ENGINES, engineOf } from './tts-engines.js';
import { previewVoice } from './tts.js';
import { buildVoicePicker } from './ui-character-extras.js';
import { missingTags, withAllTags } from './eleven-tags.js';

const KINDS = [['wrap', 'Wraps a line'], ['inline', 'Stands alone']];

/** Whether a tag stands alone (inline) with the owner's choices applied. */
const isInline = (settings, table, name) => inlineNames(table, settings.deliveryInline).has(name);

/** Writes the kind of one tag. Stored explicitly, so a built-in inline tag can be made a wrapper and the other way round. */
function setKind(settings, name, inline) {
    if (!settings.deliveryInline || typeof settings.deliveryInline !== 'object') settings.deliveryInline = {};
    settings.deliveryInline[name] = inline === true;
}

/** The section is a collapsible menu. Whether it is open is kept here, so a redraw (adding a tag) does not fold it shut. */
const view = { open: false };
const DEFAULT_TEST_LINE = 'I know what you did.';
const testLine = (settings) => String(settings.deliveryTestLine || '').trim() || DEFAULT_TEST_LINE;

/**
 * Appearance, Delivery Styles (fork): the look of each delivery tag with a live preview, and the tag
 * list itself (the name the model writes, the ElevenLabs word it maps to, and what it means).
 *
 * The preview line is a real <span data-tone>, so the page's delivery stylesheet styles it; changing
 * a value rewrites that stylesheet and the preview and every message on screen follow at once. Values
 * are saved as they change, but the section is only redrawn when a tag is added, removed or reset,
 * so typing in a field is never interrupted.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** The tag table to edit: the owner's, or a copy of the built-in one the first time it is touched. */
function editableTable(settings) {
    const own = cleanToneTable(settings.ttsToneTable);
    return Object.keys(own).length ? own : { ...DEFAULT_TONE_TAGS };
}

function field(labelText, control) {
    const wrap = el('label', 'sillynpc-dstyle-field');
    wrap.append(el('span', 'sillynpc-dstyle-label', labelText), control);
    return wrap;
}

function numberInput(value, { min, max, step }, onChange) {
    const input = el('input', 'text_pole');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => { if (input.value !== '') onChange(Number(input.value)); });
    input.addEventListener('change', () => { if (input.value === '') input.value = String(value); });
    return input;
}

function selectInput(options, value, onChange) {
    const select = el('select', 'text_pole');
    for (const [id, text] of options) select.append(new Option(text, id));
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
}

/** A tick box with its words beside it, left-aligned like the other controls (a column of label over box looked adrift). */
function checkField(labelText, value, onChange) {
    const wrap = el('label', 'sillynpc-dstyle-check checkbox_label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => onChange(box.checked));
    wrap.append(box, el('span', '', labelText));
    return wrap;
}

function buildTagCard(name, table, settings, rerender) {
    const card = el('div', 'sillynpc-dstyle-card');
    const head = el('div', 'sillynpc-dstyle-head');
    const inline = isInline(settings, table, name);
    head.append(el('strong', 'sillynpc-dstyle-name', `[${name}]`));

    // Live preview: the page's own stylesheet styles this span. A standalone tag has no look, so no preview.
    if (!inline) {
        const preview = el('span', 'wk-tone', `"${testLine(settings)}"`);
        preview.dataset.tone = name;
        preview.dataset.dstylePreview = '1';
        const previewLine = el('div', 'sillynpc-dstyle-preview');
        previewLine.append(preview);
        head.append(previewLine);
    }

    // Hear it: reads the test line in the chosen voice in this delivery. Only a voice engine that understands audio
    // tags (ElevenLabs v3 and v4) turns the tag into a performance; any other would read the plain words.
    const hear = el('button', 'menu_button sillynpc-dstyle-hear');
    hear.type = 'button';
    hear.append(el('i', 'fa-solid fa-volume-high'), document.createTextNode(' Hear it'));
    const canHear = engineReadsAudioTags();
    hear.disabled = !canHear;
    hear.title = canHear
        ? 'Reads the test line in this delivery, in the test voice chosen above'
        : `The voice engine (${ENGINES[engineOf()] || 'this one'}) does not read delivery tags, so this would only speak the plain words. Choose ElevenLabs with Eleven v3, v4 or v4 Turbo under Voices.`;
    hear.addEventListener('click', () => {
        const voice = String(settings.deliveryTestVoice || '').trim();
        if (!voice) { toastr.info('Pick a test voice at the top of Tonal Typography first.', 'Worldkit'); return; }
        // A standalone tag is written before the words, and speakWith turns it into the ElevenLabs word in place.
        const request = inline ? previewVoice(voice, `[${name}] ${testLine(settings)}`) : previewVoice(voice, testLine(settings), { tone: name });
        request.catch(err => console.warn('[Worldkit] test voice failed', err));
    });
    head.append(hear);
    card.append(head);

    const read = () => styleFor(settings.deliveryStyles, name);
    const write = (patch) => {
        if (!settings.deliveryStyles || typeof settings.deliveryStyles !== 'object') settings.deliveryStyles = {};
        settings.deliveryStyles[name] = cleanStyle({ ...read(), ...patch });
        saveSettings();
        applyDeliveryStyle();
    };
    const s = read();

    const kind = field('Kind', selectInput(KINDS, inline ? 'inline' : 'wrap', v => {
        setKind(settings, name, v === 'inline');
        saveSettings();
        applyDelivery();
        rerender();
    }));
    kind.title = 'Wraps a line: written around the words, [whisper]"words"[/whisper]. Stands alone: no closing tag, written right before the words it affects, [pause].';
    card.append(kind);

    const grid = el('div', 'sillynpc-dstyle-grid');
    grid.append(
        field('Size %', numberInput(s.size, { min: 50, max: 200, step: 1 }, v => write({ size: v }))),
        field('Opacity %', numberInput(s.opacity, { min: 20, max: 100, step: 1 }, v => write({ opacity: v }))),
        field('Weight (0 = use Bold)', numberInput(s.weight, { min: 0, max: 900, step: 50 }, v => write({ weight: v }))),
        field('Letter spacing', numberInput(s.spacing, { min: -0.1, max: 0.5, step: 0.005 }, v => write({ spacing: v }))),
        field('Underline', selectInput(Object.entries(DELIVERY_DECORATIONS), s.decoration, v => write({ decoration: v }))),
        field('Case', selectInput(Object.entries(DELIVERY_CASES), s.case, v => write({ case: v }))),
        field('Font', selectInput(Object.entries(DELIVERY_FONTS).map(([id, f]) => [id, f.label]), s.font, v => write({ font: v }))),
        field('Effect', selectInput(Object.entries(DELIVERY_EFFECTS), s.effect, v => write({ effect: v }))),
        checkField('Bold', s.bold, v => write({ bold: v })),
        checkField('Italic', s.italic, v => write({ italic: v })),
    );
    if (inline) card.append(el('small', 'notes', 'Stands alone: it has no look. It is hidden in the chat and sent to the voice.'));
    else card.append(grid);

    // What the voice is told, and what the model is told it means.
    const words = el('div', 'sillynpc-dstyle-words');
    const audio = el('input', 'text_pole');
    audio.type = 'text';
    audio.value = table[name];
    audio.title = 'The ElevenLabs audio tag this becomes, without brackets: whispers gives [whispers].';
    audio.addEventListener('change', () => {
        const next = cleanToneTable({ ...editableTable(settings), [name]: audio.value });
        if (!next[name]) { audio.value = table[name]; return; }
        settings.ttsToneTable = next;
        saveSettings();
        applyDelivery();
    });
    const meaning = el('input', 'text_pole');
    meaning.type = 'text';
    meaning.value = String(settings.deliveryMeanings?.[name] ?? '') || DELIVERY_MEANINGS[name] || '';
    meaning.title = 'Said to the story model: when to use this tag.';
    meaning.addEventListener('change', () => {
        if (!settings.deliveryMeanings || typeof settings.deliveryMeanings !== 'object') settings.deliveryMeanings = {};
        settings.deliveryMeanings[name] = meaning.value.trim();
        saveSettings();
        applyDelivery();
    });
    words.append(field('Voice tag', audio), field('Meaning for the model', meaning));
    card.append(words);

    const actions = el('div', 'sillynpc-dstyle-actions');
    const reset = el('button', 'menu_button', 'Reset look');
    reset.type = 'button';
    reset.title = 'Back to the starting look for this tag.';
    reset.addEventListener('click', () => {
        if (settings.deliveryStyles) delete settings.deliveryStyles[name];
        saveSettings();
        applyDeliveryStyle();
        rerender();
    });
    if (!inline) actions.append(reset);
    if (Object.keys(table).length > 1) {
        const remove = el('button', 'menu_button', 'Remove tag');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            const next = editableTable(settings);
            delete next[name];
            if (settings.deliveryInline) delete settings.deliveryInline[name];
            settings.ttsToneTable = next;
            if (settings.deliveryStyles) delete settings.deliveryStyles[name];
            saveSettings();
            applyDelivery();
            applyDeliveryStyle();
            rerender();
        });
        actions.append(remove);
    }
    card.append(actions);
    return card;
}

/**
 * The whole section is one collapsible menu, Tonal Typography: there are many tags. The cards are only built when it is
 * opened, and whether it is open is remembered across redraws (adding a tag redraws the tab), so it never folds shut under you.
 *
 * @param {HTMLElement} container
 * @param {() => void} rerender Redraws the whole tab.
 */
export function renderDeliveryStyles(container, rerender) {
    const settings = getSettings();
    const table = editableTable(settings);
    const count = Object.keys(table).length;

    const menu = el('details', 'sillynpc-dstyle-menu');
    menu.open = view.open;
    menu.append(el('summary', 'sillynpc-subsection-title', `Tonal Typography (${count} tags)`));
    const wrap = el('div', 'sillynpc-dstyle');
    menu.append(wrap);
    let built = false;

    const build = () => {
        if (built) return;
        built = true;
        wrap.append(el('p', 'notes sillynpc-tab-intro',
            'How a line marked [whisper]...[/whisper] looks in the chat. Each tag is a delivery the story model can mark; the look is set here, '
            + 'never by the model. A character\'s own colour is left alone, and nothing is tilted or rotated. Turn the tags on under Writing Rules, Delivery Tags. '
            + 'Fonts other than the system ones are loaded from Google Fonts when a tag uses them.'));

        // The test line and test voice, shared by every Hear it button below. Typing here only changes the previews;
        // nothing is rebuilt, so typing is never interrupted.
        const test = el('div', 'sillynpc-dstyle-test');
        const lineBox = el('input', 'text_pole');
        lineBox.type = 'text';
        lineBox.maxLength = 200;
        lineBox.placeholder = DEFAULT_TEST_LINE;
        lineBox.value = String(settings.deliveryTestLine || '');
        lineBox.title = 'The line used by every preview and every Hear it button';
        lineBox.addEventListener('input', () => {
            settings.deliveryTestLine = lineBox.value;
            saveSettings();
            for (const span of wrap.querySelectorAll('[data-dstyle-preview]')) span.textContent = `"${testLine(settings)}"`;
        });
        const lineRow = el('div', 'sillynpc-dstyle-field');
        lineRow.append(el('span', 'sillynpc-dstyle-label', 'Test line'), lineBox);
        test.append(lineRow);
        test.append(buildVoicePicker({
            label: 'Test voice',
            get: () => settings.deliveryTestVoice || '',
            set: (voice) => { settings.deliveryTestVoice = voice; saveSettings(); },
            sample: testLine(settings),
        }));
        if (!engineReadsAudioTags()) {
            test.append(el('small', 'notes', 'Hear it only works with ElevenLabs and Eleven v3, v4 or v4 Turbo (Voices tab): the other voice engines do not read delivery tags.'));
        }
        wrap.append(test);

        for (const name of Object.keys(table)) wrap.append(buildTagCard(name, table, settings, rerender));

        // Add a tag
        const add = el('div', 'sillynpc-dstyle-add');
        const nameBox = el('input', 'text_pole');
        nameBox.type = 'text';
        nameBox.placeholder = 'new tag name, e.g. murmur';
        const audioBox = el('input', 'text_pole');
        audioBox.type = 'text';
        audioBox.placeholder = 'ElevenLabs word, e.g. whispering';
        const kindBox = selectInput(KINDS, 'wrap', () => {});
        kindBox.title = 'Wraps a line: [name]"words"[/name]. Stands alone: [name] before the words, no closing tag.';
        const button = el('button', 'menu_button', 'Add tag');
        button.type = 'button';
        button.addEventListener('click', () => {
            const name = nameBox.value.trim().toLowerCase();
            const next = cleanToneTable({ ...editableTable(settings), [name]: audioBox.value || name });
            if (!name || !next[name]) { toastr.info('A tag name is letters and digits only, 25 at most.', 'Worldkit'); return; }
            setKind(settings, name, kindBox.value === 'inline');
            settings.ttsToneTable = next;
            saveSettings();
            applyDelivery();
            applyDeliveryStyle();
            rerender();
        });
        add.append(nameBox, audioBox, kindBox, button);
        wrap.append(add);

        const buttons = el('div', 'sillynpc-dstyle-actions');
        // An older saved list lacks the tags added since; this puts the missing starting ones back without touching the rest.
        const missing = Object.keys(DEFAULT_TONE_TAGS).filter(n => !(n in table));
        if (missing.length) {
            const fill = el('button', 'menu_button', `Add the ${missing.length} missing starting tags`);
            fill.type = 'button';
            fill.title = 'Keeps your own tags and looks; adds only the starting tags that are not in your list.';
            fill.addEventListener('click', () => {
                const next = editableTable(settings);
                for (const n of missing) next[n] = DEFAULT_TONE_TAGS[n];
                settings.ttsToneTable = next;
                saveSettings();
                applyDelivery();
                applyDeliveryStyle();
                rerender();
            });
            buttons.append(fill);
        }
        // Every ElevenLabs audio tag: emotions, delivery, accents, and the standalone pacing and reaction tags. Not in the
        // starting list: every tag is described to the story model on every message, so they are added when you want them.
        const everything = missingTags(table);
        if (everything.length) {
            const pack = el('button', 'menu_button', `Add all the ElevenLabs tags (${everything.length})`);
            pack.type = 'button';
            pack.title = 'Adds the ElevenLabs audio tags that are not in your list: emotions, delivery and volume, accents, and the standalone pacing and reaction tags (pause, sighs...), each with a meaning for the story model. Tags you already have are left alone. Every tag in the list is described to the story model on each message, so a long list costs tokens.';
            pack.addEventListener('click', () => {
                const out = withAllTags(editableTable(settings), settings.deliveryMeanings, settings.deliveryInline);
                settings.ttsToneTable = out.table;
                settings.deliveryMeanings = out.meanings;
                settings.deliveryInline = out.inline;
                saveSettings();
                applyDelivery();
                applyDeliveryStyle();
                rerender();
            });
            buttons.append(pack);
        }
        const reset = el('button', 'menu_button', 'Reset all tags and looks');
        reset.type = 'button';
        reset.addEventListener('click', () => {
            if (!confirm('Put every delivery tag, look and meaning back to the starting ones?')) return;
            settings.ttsToneTable = {};
            settings.deliveryStyles = {};
            settings.deliveryMeanings = {};
            settings.deliveryInline = {};
            saveSettings();
            applyDelivery();
            applyDeliveryStyle();
            rerender();
        });
        buttons.append(reset);
        wrap.append(buttons);
    };

    menu.addEventListener('toggle', () => {
        view.open = menu.open;
        if (menu.open) build();
    });
    if (menu.open) build();
    container.append(menu);
    // The starting looks exist even when nothing has been saved.
    void DEFAULT_DELIVERY_STYLES;
}
