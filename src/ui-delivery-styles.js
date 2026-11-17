import { getSettings, saveSettings } from './settings.js';
import { DEFAULT_TONE_TAGS, cleanToneTable } from './tts-text.js';
import { DELIVERY_MEANINGS } from './delivery-core.js';
import {
    DELIVERY_FONTS, DELIVERY_EFFECTS, DELIVERY_CASES, DEFAULT_DELIVERY_STYLES, styleFor, cleanStyle,
} from './delivery-style.js';
import { applyDelivery, applyDeliveryStyle } from './delivery.js';

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

function checkInput(value, onChange) {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => onChange(box.checked));
    return box;
}

function buildTagCard(name, table, settings, rerender) {
    const card = el('div', 'sillynpc-dstyle-card');
    const head = el('div', 'sillynpc-dstyle-head');
    head.append(el('strong', 'sillynpc-dstyle-name', `[${name}]`));

    // Live preview: the page's own stylesheet styles this span.
    const preview = el('span', 'wk-tone', '"I know what you did."');
    preview.dataset.tone = name;
    const previewLine = el('div', 'sillynpc-dstyle-preview');
    previewLine.append(preview);
    head.append(previewLine);
    card.append(head);

    const read = () => styleFor(settings.deliveryStyles, name);
    const write = (patch) => {
        if (!settings.deliveryStyles || typeof settings.deliveryStyles !== 'object') settings.deliveryStyles = {};
        settings.deliveryStyles[name] = cleanStyle({ ...read(), ...patch });
        saveSettings();
        applyDeliveryStyle();
    };
    const s = read();

    const grid = el('div', 'sillynpc-dstyle-grid');
    grid.append(
        field('Size %', numberInput(s.size, { min: 50, max: 200, step: 1 }, v => write({ size: v }))),
        field('Opacity %', numberInput(s.opacity, { min: 20, max: 100, step: 1 }, v => write({ opacity: v }))),
        field('Letter spacing', numberInput(s.spacing, { min: 0, max: 0.5, step: 0.01 }, v => write({ spacing: v }))),
        field('Case', selectInput(Object.entries(DELIVERY_CASES), s.case, v => write({ case: v }))),
        field('Font', selectInput(Object.entries(DELIVERY_FONTS).map(([id, f]) => [id, f.label]), s.font, v => write({ font: v }))),
        field('Effect', selectInput(Object.entries(DELIVERY_EFFECTS), s.effect, v => write({ effect: v }))),
        field('Bold', checkInput(s.bold, v => write({ bold: v }))),
        field('Italic', checkInput(s.italic, v => write({ italic: v }))),
    );
    card.append(grid);

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
    actions.append(reset);
    if (Object.keys(table).length > 1) {
        const remove = el('button', 'menu_button', 'Remove tag');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            const next = editableTable(settings);
            delete next[name];
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
 * @param {HTMLElement} container
 * @param {() => void} rerender Redraws the whole tab.
 */
export function renderDeliveryStyles(container, rerender) {
    const settings = getSettings();
    const wrap = el('div', 'sillynpc-dstyle');
    wrap.append(el('h4', 'sillynpc-subsection-title', 'Delivery Styles'));
    wrap.append(el('p', 'notes sillynpc-tab-intro',
        'How a line marked [whisper]...[/whisper] looks in the chat. Each tag is a delivery the story model can mark; the look is set here, '
        + 'never by the model. A character\'s own colour is left alone, and nothing is tilted. Turn the tags on under Writing Rules, Delivery Tags. '
        + 'Fonts other than the system ones are loaded from Google Fonts when a tag uses them.'));

    const table = editableTable(settings);
    for (const name of Object.keys(table)) wrap.append(buildTagCard(name, table, settings, rerender));

    // Add a tag
    const add = el('div', 'sillynpc-dstyle-add');
    const nameBox = el('input', 'text_pole');
    nameBox.type = 'text';
    nameBox.placeholder = 'new tag name, e.g. murmur';
    const audioBox = el('input', 'text_pole');
    audioBox.type = 'text';
    audioBox.placeholder = 'ElevenLabs word, e.g. whispering';
    const button = el('button', 'menu_button', 'Add tag');
    button.type = 'button';
    button.addEventListener('click', () => {
        const name = nameBox.value.trim().toLowerCase();
        const next = cleanToneTable({ ...editableTable(settings), [name]: audioBox.value || name });
        if (!name || !next[name]) { toastr.info('A tag name is letters and digits only, 25 at most.', 'Worldkit'); return; }
        settings.ttsToneTable = next;
        saveSettings();
        applyDelivery();
        applyDeliveryStyle();
        rerender();
    });
    add.append(nameBox, audioBox, button);
    wrap.append(add);

    const reset = el('button', 'menu_button', 'Reset all tags and looks');
    reset.type = 'button';
    reset.addEventListener('click', () => {
        if (!confirm('Put every delivery tag, look and meaning back to the starting ones?')) return;
        settings.ttsToneTable = {};
        settings.deliveryStyles = {};
        settings.deliveryMeanings = {};
        saveSettings();
        applyDelivery();
        applyDeliveryStyle();
        rerender();
    });
    wrap.append(reset);
    container.append(wrap);
    // The starting looks exist even when nothing has been saved.
    void DEFAULT_DELIVERY_STYLES;
}
