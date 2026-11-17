import { promptListAvailable } from './prompt-slot.js';
import { sceneHeaderSettings, saveSceneHeaderSettings, applySceneHeaderPrompt } from './scene-header-inject.js';
import {
    DEFAULT_SCENE_HEADER_PROMPT, SCENE_HEADER_POSITIONS, SCENE_HEADER_ROLES, describeSceneHeaderPlacement,
} from './scene-header-prompt.js';

/**
 * Writing Rules, Scene Header (fork): a switch that makes Worldkit ask the story model to start every reply with the scene
 * header (date, time, place, weather), the words it asks with, and where they go. The Scene module reads that header, so
 * the scene comes with the main API call and nothing is typed in. Text boxes save as typed and nothing redraws while typing.
 *
 * @param {() => void} rerender redraws the Writing Rules tab (used when a choice changes which controls show)
 * @returns {HTMLElement}
 */
export function buildSceneHeaderSettings(rerender) {
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const row = (labelText, control, hint) => {
        const wrap = el('div', 'sillynpc-setting-row');
        const label = el('label', 'sillynpc-setting-label', hint ? `${labelText} ⓘ` : labelText);
        if (hint) { label.title = hint; control.title = hint; }
        wrap.append(label, control);
        return wrap;
    };
    const select = (table, value, onChange) => {
        const s = el('select', 'text_pole');
        for (const [k, v] of Object.entries(table)) s.append(new Option(v, k));
        s.value = value;
        s.addEventListener('change', () => onChange(s.value));
        return s;
    };
    const number = (value, min, max, onChange) => {
        const i = el('input', 'text_pole');
        i.type = 'number'; i.min = String(min); i.max = String(max); i.style.width = '6em'; i.value = String(value);
        i.addEventListener('change', () => onChange(Number(i.value)));
        return i;
    };

    const wrap = el('div', 'sillynpc-scene-header-settings');
    wrap.append(el('h4', 'sillynpc-subsection-title', 'Scene Header'));
    wrap.append(el('p', 'notes',
        'The Scene module (Modules, Scene) gets the date, time, place and weather from the header the story model writes at the top '
        + 'of every reply, so they come with the main API call and nothing is typed in. If your preset already asks for that header, '
        + 'leave this off. If it does not, switch this on and Worldkit adds the instruction for you.'));

    const cfg = sceneHeaderSettings();
    const set = (patch, redraw = false) => {
        Object.assign(sceneHeaderSettings(), patch);
        saveSceneHeaderSettings();
        applySceneHeaderPrompt();
        if (redraw) rerender?.();
    };

    const toggle = el('label', 'checkbox_label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = cfg.enabled;
    box.addEventListener('change', () => set({ enabled: box.checked }, true));
    toggle.append(box, el('span', '', 'Ask The Story Model To Start Every Reply With The Scene Header'));
    wrap.append(toggle);
    if (!cfg.enabled) return wrap;

    if (promptListAvailable()) {
        const listBox = el('input');
        listBox.type = 'checkbox';
        listBox.checked = cfg.inList;
        listBox.addEventListener('change', () => set({ inList: listBox.checked }, true));
        const label = el('label', 'checkbox_label');
        label.append(listBox, el('span', '', "Manage In SillyTavern's Prompt List"));
        wrap.append(label);
    }
    if (!cfg.inList) {
        wrap.append(row('Where', select(SCENE_HEADER_POSITIONS, cfg.position, v => set({ position: v }, true))));
        if (cfg.position === 'chat') wrap.append(row('Messages back', number(cfg.depth, 0, 100, v => set({ depth: v })), '0 is right after the newest message'));
        wrap.append(row('Role', select(SCENE_HEADER_ROLES, cfg.role, v => set({ role: v }))));
    } else {
        wrap.append(row('Order', number(cfg.order, 0, 1000, v => set({ order: v })), 'Blocks at the same depth are sorted by this. Position, depth and role are set in the prompt list.'));
    }
    wrap.append(el('small', 'notes', describeSceneHeaderPlacement(cfg)));

    const text = el('textarea', 'text_pole');
    text.rows = 9;
    text.maxLength = 4000;
    text.value = cfg.text || DEFAULT_SCENE_HEADER_PROMPT;
    text.addEventListener('input', () => {
        const v = text.value.trim();
        set({ text: v && v !== DEFAULT_SCENE_HEADER_PROMPT ? text.value : '' });
    });
    const reset = el('button', 'menu_button', 'Restore default');
    reset.type = 'button';
    reset.addEventListener('click', () => { text.value = DEFAULT_SCENE_HEADER_PROMPT; set({ text: '' }); });
    wrap.append(el('label', 'sillynpc-setting-label', 'The instruction'), text,
        el('small', 'notes', 'The Scene module reads this header format: [ Time | Date | Location - Area | Weather, Temp ]. Keep that shape if you change the words. {{user}} is filled in by SillyTavern.'), reset);
    return wrap;
}
