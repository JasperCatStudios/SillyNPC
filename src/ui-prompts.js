import { availablePrompts, PROMPTS } from './prompts.js';
import { buildSettingNumber, buildSettingSlider } from './ui-shared.js';
import { getSettings, saveSettings } from './settings.js';
import { extension_settings } from '../../../../extensions.js';
import { buildTokenReadout } from './tokens.js';
import { phonePromptHost } from './phone-prompts.js';
import { MODE_DEFAULT, MODE_CUSTOM, modeChoices, currentMode, textForMode, chooseMode, editText } from './prompt-picker.js';
import { escapeHtml } from './utils.js';

/**
 * One prompt editor, built from its registry entry.
 *
 * Used both by the Prompts tab and by the tab the prompt has always lived in, so the two
 * are the same control rather than two that look alike.
 *
 * @param {object} entry From PROMPTS.
 * @param {{ onChange?: () => void, showHome?: boolean }} [options] `showHome` adds the
 *   line saying where else this prompt can be found - wanted in the collected view,
 *   noise in the tab it names.
 */
export function buildPromptEditor(entry, { onChange, showHome = false } = {}) {
    const slot = slotFor(entry);
    const presets = entry.presets || [];
    const defaultText = String(entry.recommended?.() ?? '');
    const ctx = () => { const r = slot.read(); return { ...r, defaultText, presets }; };

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.dataset.setting = entry.key;

    const head = document.createElement('div');
    head.className = 'sillynpc-setting-row';
    const title = document.createElement('label');
    title.style.fontWeight = 'bold';
    title.textContent = entry.label;
    const picker = document.createElement('select');
    picker.className = 'text_pole sillynpc-prompt-picker';
    picker.title = 'Pick the built-in prompt, another template, or your own saved text.';
    for (const c of modeChoices(presets)) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.label;
        picker.append(o);
    }
    head.append(title, picker);
    wrap.append(head);

    const textarea = document.createElement('textarea');
    textarea.className = 'text_pole sillynpc-setting-textarea';
    textarea.rows = 6;
    textarea.style.marginTop = '6px';
    const tokens = buildTokenReadout(() => textarea.value, { note: entry.emptyNote });

    // Opened for the first time the box shows the text that is sent, not an empty box.
    const show = () => {
        let c = ctx();
        // A saved copy of an out-of-date built-in version is the default, not the person's own: it goes back to following the default.
        if (entry.isStale?.(c.stored)) {
            slot.write({ mode: MODE_DEFAULT, stored: slot.storeDefault ? defaultText : '', custom: c.custom });
            c = ctx();
        }
        const mode = currentMode(c);
        picker.value = mode;
        textarea.value = textForMode(mode, c);
        tokens.refresh();
    };
    show();

    picker.addEventListener('change', () => {
        const c = ctx();
        const from = currentMode(c);
        const r = chooseMode(picker.value, { ...c, currentMode: from, currentText: textarea.value }, { storeDefault: slot.storeDefault });
        slot.write(r);
        textarea.value = r.text;
        tokens.refresh();
        onChange?.();
    });
    textarea.addEventListener('input', () => {
        // Typing makes it your own; the dropdown follows without being rebuilt.
        slot.write(editText(textarea.value));
        if (picker.value !== MODE_CUSTOM) picker.value = MODE_CUSTOM;
        tokens.refresh();
        onChange?.();
    });
    wrap.append(textarea, tokens.element);

    if (entry.help) {
        const helpEl = document.createElement('small');
        helpEl.className = 'notes';
        helpEl.textContent = entry.help;
        wrap.append(helpEl);
    }
    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = 'Default is the built-in prompt. Type in the box and it becomes My own, kept separately so you can switch back and forth without losing it.';
    wrap.append(note);

    if (showHome && entry.home) {
        const where = document.createElement('small');
        where.className = 'notes sillynpc-prompt-home';
        where.textContent = `Also in ${entry.home}. The same setting - editing it here or there is the same edit.`;
        wrap.append(where);
    }

    return wrap;
}

const getPath = (obj, path) => path.split('.').reduce((acc, part) => acc && acc[part], obj);
function setPath(obj, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((acc, part) => acc && acc[part], obj);
    if (target) target[last] = value;
}

/**
 * Where a prompt's text and its remembered choice live. Most live in this extension's settings
 * (the text at the entry's key, the choice and own-text in promptPicks); the phone's belong to
 * the phone module, which keeps the same three fields under its own names.
 */
function slotFor(entry) {
    if (entry.storage === 'phone') {
        const raw = () => phonePromptHost.get?.() ?? {
            prompt: extension_settings.sillynpc_phone?.prompt,
            preset: extension_settings.sillynpc_phone?.promptPreset,
            custom: extension_settings.sillynpc_phone?.promptCustom,
        };
        return {
            storeDefault: true,
            read: () => {
                const r = raw();
                return { stored: r.prompt, mode: r.preset === 'main' ? MODE_DEFAULT : r.preset, custom: r.custom };
            },
            write: ({ mode, stored, custom }) => {
                const patch = { prompt: stored, preset: mode === MODE_DEFAULT ? 'main' : mode, custom };
                if (phonePromptHost.set) phonePromptHost.set(patch);
                else {
                    const s = (extension_settings.sillynpc_phone ||= {});
                    s.prompt = patch.prompt; s.promptPreset = patch.preset; s.promptCustom = patch.custom;
                    saveSettings();
                }
            },
        };
    }
    return {
        storeDefault: false,
        read: () => {
            const s = getSettings();
            const pick = s.promptPicks?.[entry.id] || {};
            return { stored: getPath(s, entry.key), mode: pick.mode, custom: pick.custom };
        },
        write: ({ mode, stored, custom }) => {
            const s = getSettings();
            setPath(s, entry.key, stored);
            if (!s.promptPicks || typeof s.promptPicks !== 'object') s.promptPicks = {};
            s.promptPicks[entry.id] = { mode, custom };
            saveSettings();
        },
    };
}

/** The reply budget that belongs to a prompt, if it has one. */
export function buildPromptBudget(entry, { onChange } = {}) {
    const budget = entry.budget;
    if (!budget) return null;

    // advanced, to agree with the same control on the Tracker tab. A reply budget hidden
    // in one place and offered in another is the two disagreeing about what it is.
    const common = { key: budget.key, label: budget.label, help: budget.help, onChange, advanced: true };
    return budget.kind === 'slider'
        ? buildSettingSlider({ ...common, min: budget.min, max: budget.max, step: budget.step })
        : buildSettingNumber({ ...common, suffix: budget.suffix || '' });
}

/**
 * The Prompts tab: every prompt that applies to the current setup, with its reply budget
 * and its cost, in one place.
 *
 * Nothing was moved here. Each prompt still sits beside the settings it works with, where
 * it is found while doing that job; this view is for the other question - what is this
 * model being told in total, and what does it cost - which cannot be answered from a
 * setting seen one tab at a time.
 *
 * @param {HTMLElement} view
 * @param {() => void} [onApply] Called after an edit, so a view that shows the result of
 *   a prompt can redraw.
 */
export function renderPromptsView(view, onApply) {
    if (!view) return;
    view.replaceChildren();

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Prompts';
    view.append(title);

    const intro = document.createElement('small');
    intro.className = 'notes';
    intro.textContent = 'Everything this extension says to a model, and what each costs. '
        + 'The count is of the text as written - placeholders are filled when it is sent '
        + 'and cost whatever they are filled with.';
    view.append(intro);

    const shown = availablePrompts();
    // The phone prompts are most of this page, so they sit in one collapsible group, closed by default.
    // The tracker prompts are grouped the same way.
    const GROUPS = { Phone: 'Phone prompts', Trackers: 'Tracker prompts' };
    const groups = {};
    for (const entry of shown) {
        const section = document.createElement('div');
        section.className = 'sillynpc-prompt-section';
        section.append(buildPromptEditor(entry, { onChange: onApply, showHome: !GROUPS[entry.home] }));
        const budget = buildPromptBudget(entry, { onChange: onApply });
        if (budget) section.append(budget);
        if (GROUPS[entry.home]) {
            if (!groups[entry.home]) {
                const details = document.createElement('details');
                details.className = 'sillynpc-prompt-group';
                const summary = document.createElement('summary');
                summary.textContent = `${GROUPS[entry.home]} (${shown.filter(e => e.home === entry.home).length})`;
                details.append(summary);
                groups[entry.home] = details;
                view.append(details);
            }
            groups[entry.home].append(section);
        } else {
            view.append(section);
        }
    }

    // A prompt hidden because it does not apply is different from one that does not
    // exist. Saying which, and why, stops a search for the negative prompt on a Gemini
    // setup ending in the conclusion that it was lost.
    const hidden = PROMPTS.filter(p => !shown.includes(p));
    if (hidden.length) {
        const note = document.createElement('small');
        note.className = 'notes sillynpc-prompt-hidden';
        note.innerHTML = 'Not shown, because your current setup does not send them: '
            + hidden.map(p => `<b>${escapeHtml(p.label)}</b>`).join(', ') + '.';
        view.append(note);
    }
}
