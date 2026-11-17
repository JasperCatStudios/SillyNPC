import {
    soundSettings, saveSoundSettings, applySfxPrompt, loadSoundMap, loadedMap, mapStatus, effectiveMapUrl, playSound, SOUND_MAP_EVENT,
} from './sound-runtime.js';
import { SOUND_ROLES, DEFAULT_SFX_PROMPT, sfxPromptText, roughTokens } from './sound-core.js';

/**
 * Writing Rules, Sound Effects (fork): a switch that lets the story model write [sfx:name] and shows each as a tappable chip,
 * where the sound map comes from, the volume, and the words the model is told. Text boxes save as typed and nothing
 * redraws while typing.
 *
 * @param {() => void} rerender redraws the Writing Rules tab (used when a choice changes which controls show)
 * @returns {HTMLElement}
 */
export function buildSoundSettings(rerender) {
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
    const check = (labelText, value, onChange) => {
        const label = el('label', 'checkbox_label');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = value;
        box.addEventListener('change', () => onChange(box.checked));
        label.append(box, el('span', '', labelText));
        return label;
    };

    const wrap = el('div', 'sillynpc-sound-settings');
    wrap.append(el('h4', 'sillynpc-subsection-title', 'Sound Effects'));
    wrap.append(el('p', 'notes',
        'The story model may write [sfx:name] where a sound happens. Each one shows as a small chip in the reply; tap it to hear the sound. '
        + 'The sounds come from a sound map: the sound pack in the Content Kit (Modules, Content Kit, Sounds) has 99 of them.'));

    const cfg = soundSettings();
    const set = (patch, redraw = false) => {
        Object.assign(soundSettings(), patch);
        saveSoundSettings();
        applySfxPrompt();
        if (redraw) rerender?.();
    };

    wrap.append(check('Show [sfx:name] As Tappable Chips And Tell The Story Model Which Sounds It May Use', cfg.enabled, (v) => {
        set({ enabled: v }, true);
        if (v) loadSoundMap(true);
    }));
    if (!cfg.enabled) return wrap;

    const status = el('p', 'notes', mapStatus());
    const refreshStatus = () => { status.textContent = mapStatus(); };
    document.addEventListener(SOUND_MAP_EVENT, refreshStatus, { once: true });
    loadSoundMap().then(refreshStatus, refreshStatus);
    wrap.append(status);

    const url = el('input', 'text_pole');
    url.type = 'text';
    url.placeholder = effectiveMapUrl();
    url.value = cfg.mapUrl;
    url.addEventListener('change', () => { set({ mapUrl: url.value.trim() }); loadSoundMap(true).then(refreshStatus, refreshStatus); });
    wrap.append(row('Sound map address', url, 'Leave empty to use the Content Kit sound pack. A path on this server (for example /user/files/mysounds/map.json) or a full address; the audio files sit beside the map.'));

    const volume = el('input', 'text_pole');
    volume.type = 'number'; volume.min = '0'; volume.max = '100'; volume.step = '5'; volume.style.width = '6em';
    volume.value = String(Math.round(cfg.volume * 100));
    volume.addEventListener('change', () => set({ volume: Math.min(100, Math.max(0, Number(volume.value) || 0)) / 100 }));
    wrap.append(row('Volume (%)', volume));

    wrap.append(check('Play A New Reply\'s Sounds By Themselves (Your Browser May Wait For A Tap On The Page First)', cfg.auto, v => set({ auto: v })));

    const test = el('button', 'menu_button', 'Play a sound');
    test.type = 'button';
    test.addEventListener('click', async () => {
        const map = loadedMap();
        const names = map ? [...map.sounds.values()].filter(s => !s.loop).map(s => s.key) : [];
        if (!names.length) { toastr.info('No sounds are loaded yet.', 'Worldkit'); return; }
        if (!await playSound(names[Math.floor(Math.random() * names.length)])) toastr.info('The browser would not play it. Tap the page and try again.', 'Worldkit');
    });
    wrap.append(test);

    wrap.append(check('Tell The Story Model The Sound Names', cfg.promptOn, v => set({ promptOn: v }, true)));
    if (!cfg.promptOn) return wrap;

    wrap.append(row('Messages back', (() => {
        const i = el('input', 'text_pole');
        i.type = 'number'; i.min = '0'; i.max = '100'; i.style.width = '6em'; i.value = String(cfg.depth);
        i.addEventListener('change', () => set({ depth: Number(i.value) }));
        return i;
    })(), '0 is right after the newest message'));
    const role = el('select', 'text_pole');
    for (const [k, v] of Object.entries(SOUND_ROLES)) role.append(new Option(v, k));
    role.value = cfg.role;
    role.addEventListener('change', () => set({ role: role.value }));
    wrap.append(row('Role', role));

    const text = el('textarea', 'text_pole');
    text.rows = 6;
    text.maxLength = 4000;
    text.value = cfg.text || DEFAULT_SFX_PROMPT;
    const cost = el('small', 'notes');
    const showCost = () => {
        const sent = sfxPromptText(soundSettings(), loadedMap());
        cost.textContent = sent ? `About ${roughTokens(sent)} tokens are sent with every reply (the instruction and the sound list).` : 'Nothing is sent until a sound map is loaded.';
    };
    showCost();
    text.addEventListener('input', () => {
        const v = text.value.trim();
        set({ text: v && v !== DEFAULT_SFX_PROMPT ? text.value : '' });
        showCost();
    });
    const reset = el('button', 'menu_button', 'Restore default');
    reset.type = 'button';
    reset.addEventListener('click', () => { text.value = DEFAULT_SFX_PROMPT; set({ text: '' }); showCost(); });
    wrap.append(el('label', 'sillynpc-setting-label', 'The instruction'), text,
        el('small', 'notes', '{{sounds}} is replaced with the list of sound names (loops are left out; they are for ambience).'), cost, reset);
    return wrap;
}
