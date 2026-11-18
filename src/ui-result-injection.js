import { Popup, POPUP_TYPE } from '../../../../popup.js';
import { saveSettings } from './settings.js';
import { promptListAvailable } from './prompt-slot.js';
import { RESULT_ROLES, DEFAULT_RESULT_INSTRUCTIONS, normalizeResultInjection } from './result-injection.js';
import { resultSettings, resultStatus, armResult, clearResult, previewResult } from './result-runtime.js';

/**
 * The "send the result to the story" settings on a module's tab (fork). The same settings the phone has for
 * sending its texts: a mode (off, always, random, manual), a chance and cooldown, where the block sits in the
 * prompt, a notice, the wording, and a preview. They apply to the report a finished fight or game leaves.
 *
 * @param {'combat'|'games'|'levelup'|'knives'|'activities'} id
 * @returns {HTMLElement}
 */
export function buildResultInjectionPanel(id) {
    const what = { combat: 'fight', games: 'game', levelup: 'level-up', knives: 'twist', activities: 'activity' }[id] || 'result';
    const cfg = resultSettings(id);
    const save = () => saveSettings();

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting-group sillynpc-result-injection';
    wrap.dataset.setting = `${id}.resultInjection`;

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const row = (labelText, control, hint) => {
        const r = el('div', 'sillynpc-setting-row');
        const label = el('label', 'sillynpc-setting-label', labelText);
        if (hint) { label.title = hint; label.textContent = `${labelText} ⓘ`; control.title = hint; }
        r.append(label, control);
        return r;
    };
    const numberBox = (key, min, max, width = '6em') => {
        const input = el('input', 'text_pole');
        input.type = 'number';
        input.min = String(min); input.max = String(max);
        input.style.width = width;
        input.value = String(cfg[key]);
        input.addEventListener('change', () => {
            const n = Number(input.value);
            cfg[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : normalizeResultInjection({})[key];
            input.value = String(cfg[key]);
            save();
        });
        return input;
    };
    const checkRow = (labelText, key, onChange) => {
        const label = el('label', 'checkbox_label');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(cfg[key]);
        box.addEventListener('change', () => { cfg[key] = box.checked; save(); onChange?.(); });
        label.append(box, el('span', '', labelText));
        return label;
    };

    wrap.append(el('h4', 'sillynpc-combat-heading', id === 'levelup' ? 'Send level-ups to the story' : id === 'knives' ? 'Knives: twists for the story' : `Send the ${what} result to the story`));
    wrap.append(el('small', 'notes',
        (id === 'levelup'
            ? 'When someone levels up after a fight, a line saying who and to what level goes into the prompt of the next story reply, with the instruction below. '
            : id === 'knives'
                ? 'Each character can keep prepared story twists (their Knives tab). When this fires, one random character who is in the scene and has an unused twist has one offered to the story model, hidden, with the instruction below, and it is marked used. '
                : `When a ${what} ends, its result goes into the prompt of the next story reply, the way the phone sends its texts. `)
        + (id === 'knives' ? 'It is never posted in the chat.' : 'It is never posted in the chat. Once a reply has carried it, it is cleared.')));

    // Mode.
    const mode = el('select', 'text_pole');
    for (const [value, label] of [
        ['off', 'Off'],
        ['always', 'Always (the next reply)'],
        ['random', 'Random (a chance each reply)'],
        ['manual', 'Manual (button)'],
    ]) mode.append(new Option(label, value));
    mode.value = cfg.mode;
    wrap.append(row('Mode', mode));

    // Random: chance and cooldown.
    const random = el('div');
    const chance = numberBox('chance', 0, 100);
    const quick = el('button', 'menu_button', '100% (next reply)');
    quick.type = 'button';
    quick.addEventListener('click', () => { cfg.chance = 100; chance.value = '100'; save(); });
    random.append(
        row('Chance each reply, %', chance, 'Each reply after the result is waiting has this chance to carry it. 100% means the very next reply.'),
        row('Cooldown (replies)', numberBox('cooldown', 0, 50), 'At least this many replies between two times. Not used at 100%.'),
        quick,
    );
    wrap.append(random);

    // Manual: the button and where things stand.
    const manual = el('div');
    const status = el('small', 'notes');
    const ask = el('button', 'menu_button');
    ask.type = 'button';
    const clear = el('button', 'menu_button', 'Forget the waiting result');
    const isKnives = id === 'knives';
    clear.type = 'button';
    const buttons = el('div');
    buttons.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;';
    buttons.append(ask, clear);
    manual.append(buttons);
    wrap.append(status, manual);

    const refreshStatus = () => {
        const s = resultStatus(id);
        status.textContent = isKnives
            ? (s.pending ? 'Somebody in the scene has an unused twist ready.' : 'Nobody in the scene has an unused twist.') + (s.armed ? ' One will go with the next reply.' : '')
            : s.pending
                ? `A ${what} ${id === 'levelup' ? 'report' : 'result'} is waiting${s.armed ? ' and will go with the next reply.' : '.'}`
                : `No ${what} result is waiting.`;
        ask.textContent = s.armed ? 'Cancel' : isKnives ? 'Offer a twist with the next reply' : 'Bring the result into the next reply';
        clear.style.display = s.pending && !isKnives ? '' : 'none';
    };
    ask.addEventListener('click', () => {
        const s = resultStatus(id);
        if (!s.armed && !s.pending) { toastr.info(isKnives ? 'Nobody in the scene has an unused twist.' : `There is no ${what} result waiting yet.`); return; }
        armResult(id, !s.armed);
        refreshStatus();
    });
    clear.addEventListener('click', () => { clearResult(id); refreshStatus(); });

    const preview = el('button', 'menu_button', 'Preview what would be sent now');
    preview.type = 'button';
    preview.addEventListener('click', () => {
        const { fire, reason, text } = previewResult(id);
        const box = el('div');
        box.style.textAlign = 'left';
        box.append(el('b', '', `${({ combat: 'Combat result', games: 'Game result', levelup: 'Level-up', knives: 'Knives' })[id]}: preview (nothing was sent)`));
        const info = el('small', '', `${fire ? 'Would fire: yes' : 'Would fire: no'} - Reason: ${reason}`);
        info.style.display = 'block';
        const pre = el('pre', '', text || '(nothing to send)');
        pre.style.cssText = 'white-space:pre-wrap; word-break:break-word; max-height:60vh; overflow:auto; font-size:.85em; user-select:text';
        box.append(info, pre);
        new Popup(box, POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: 'Close' }).show();
    });
    wrap.append(preview);

    // Where the block sits.
    const place = el('div');
    place.append(checkRow("Show in SillyTavern's prompt list (Chat Completion)", 'inList'));
    place.append(el('small', 'notes',
        'The block becomes a prompt-list entry (depth 0, system, order 510 to start with) that you can move there afterwards. '
        + 'The role below only applies when the list is switched off.'
        + (promptListAvailable() ? '' : ' (Not available on this API: it is placed in the chat instead.)')));
    place.append(row('Injection order', numberBox('order', 0, 1000)));
    place.append(row('Depth', numberBox('depth', 0, 20), 'How far back in the chat the block sits. 0 puts it with the latest message.'));
    const role = el('select', 'text_pole');
    for (const r of RESULT_ROLES) role.append(new Option(r[0].toUpperCase() + r.slice(1), r));
    role.value = cfg.role;
    role.addEventListener('change', () => { cfg.role = RESULT_ROLES.includes(role.value) ? role.value : 'system'; save(); });
    place.append(row('Role', role));
    place.append(checkRow('Show a small notice when it is sent'  , 'notify'));
    wrap.append(place);

    // The wording.
    const instr = el('textarea', 'text_pole');
    instr.rows = 4;
    instr.maxLength = 800;
    instr.value = cfg.instruction || DEFAULT_RESULT_INSTRUCTIONS[id];
    instr.addEventListener('change', () => {
        const v = instr.value.trim();
        cfg.instruction = v && v !== DEFAULT_RESULT_INSTRUCTIONS[id] ? v.slice(0, 800) : '';
        save();
    });
    const reset = el('button', 'menu_button', 'Reset the wording');
    reset.type = 'button';
    reset.addEventListener('click', () => { cfg.instruction = ''; instr.value = DEFAULT_RESULT_INSTRUCTIONS[id]; save(); });
    wrap.append(el('label', 'sillynpc-setting-label', 'Instruction'), instr, el('small', 'notes', (isKnives ? '<<user>> is replaced by your name. The twist itself is always sent first.' : '<<user>> is replaced by your name. The report itself is always sent first.')), reset);

    const showFor = () => {
        random.style.display = cfg.mode === 'random' ? '' : 'none';
        manual.style.display = cfg.mode === 'manual' ? '' : 'none';
        const off = cfg.mode === 'off';
        preview.style.display = off ? 'none' : '';
        place.style.display = off ? 'none' : '';
        status.style.display = off ? 'none' : '';
    };
    mode.addEventListener('change', () => {
        cfg.mode = ['off', 'always', 'random', 'manual'].includes(mode.value) ? mode.value : 'off';
        if (cfg.mode === 'off') clearResult(id);
        save(); showFor(); refreshStatus();
    });
    showFor();
    refreshStatus();
    return wrap;
}
