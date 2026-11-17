import { saveSettings } from './settings.js';
import {
    GRADIENT_TYPES, MAX_GRADIENT_STOPS, MIN_GRADIENT_STOPS, GRADIENT_PRESET_NAMES,
    normalizeGradient, gradientCss, presetGradient, defaultGradient,
} from './gradient-style.js';

/**
 * The dialogue gradient editor in a character's Edit tab (fork): pick a shipped gradient or build one with
 * 2 to 5 colour stops, set its type, angle and position, and optionally let it drift. It paints the
 * character's dialogue text in the chat.
 *
 * Gradient model and presets adapted from the Dialogue Colors extension (MIT licence): see gradient-style.js.
 *
 * @param {object} char
 * @returns {HTMLElement}
 */
export function buildDialogueGradientPanel(char) {
    const panel = document.createElement('details');
    panel.className = 'sillynpc-gradient-panel';
    const summary = document.createElement('summary');
    summary.textContent = 'Gradient text';
    panel.append(summary);
    const body = document.createElement('div');
    panel.append(body);

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const write = (g) => { char.gradient = g ? normalizeGradient(g) : null; saveSettings(); };
    const numberBox = (value, min, max, step, onInput) => {
        const box = el('input', 'text_pole');
        box.type = 'number';
        box.min = String(min); box.max = String(max); box.step = String(step);
        box.value = String(value);
        box.style.cssText = 'width:5.5em; flex:none;';
        box.addEventListener('change', () => { const n = Number(box.value); if (Number.isFinite(n)) onInput(Math.max(min, Math.min(max, n))); });
        return box;
    };

    const draw = () => {
        body.replaceChildren();
        const g = normalizeGradient(char.gradient);

        const note = el('small', 'notes', 'Colours this character’s profile page: the banner, the name, the section labels and the frame around the portrait. '
            + 'Separate from the dialogue colours above. Gradients adapted from the Dialogue Colors extension.');
        note.style.display = 'block';
        body.append(note);

        const preview = el('div', 'sillynpc-gradient-preview');
        preview.style.background = g ? gradientCss(g) : 'transparent';
        if (!g) preview.textContent = 'No gradient';
        body.append(preview);

        // A shipped gradient, or none.
        const presetRow = el('div', 'sillynpc-color-row');
        const preset = el('select', 'text_pole');
        preset.append(new Option(g ? 'Replace with a shipped gradient...' : 'Start from a shipped gradient...', ''));
        for (const name of GRADIENT_PRESET_NAMES) preset.append(new Option(name.replace(/-/g, ' '), name));
        preset.addEventListener('change', () => { if (preset.value) { write(presetGradient(preset.value)); draw(); } });
        const blank = el('button', 'menu_button', g ? 'Edit below' : 'Start blank');
        blank.type = 'button';
        blank.addEventListener('click', () => { if (!g) { write(defaultGradient(char.color || '#d9b45a')); draw(); } });
        const clear = el('button', 'menu_button clear-color-btn');
        clear.type = 'button';
        clear.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        clear.title = 'Remove the gradient';
        clear.addEventListener('click', () => { write(null); draw(); });
        presetRow.append(preset, blank, clear);
        body.append(presetRow);
        if (!g) return;

        const refreshPreview = () => { preview.style.background = gradientCss(char.gradient); };
        const update = (patch, redraw = false) => {
            write({ ...char.gradient, ...patch });
            if (redraw) draw(); else refreshPreview();
        };

        // Type, angle and position.
        const geo = el('div', 'sillynpc-color-row');
        const type = el('select', 'text_pole');
        for (const t of GRADIENT_TYPES) type.append(new Option(t, t));
        type.value = g.type;
        type.addEventListener('change', () => update({ type: type.value }, true));
        geo.append(type);
        if (g.type !== 'radial') {
            geo.append(el('span', 'notes', 'Angle'), numberBox(g.angle, 0, 360, 1, v => update({ angle: v })));
        }
        if (g.type !== 'linear') {
            geo.append(el('span', 'notes', 'X %'), numberBox(g.x, 0, 100, 1, v => update({ x: v })));
            geo.append(el('span', 'notes', 'Y %'), numberBox(g.y, 0, 100, 1, v => update({ y: v })));
        }
        body.append(geo);

        // The colour stops.
        const stopsBox = el('div');
        g.stops.forEach((stop, index) => {
            const row = el('div', 'sillynpc-color-row');
            const picker = el('input', 'sillynpc-color-input');
            picker.type = 'color';
            picker.value = stop.color;
            const hex = el('input', 'text_pole sillynpc-color-hex');
            hex.type = 'text'; hex.maxLength = 7; hex.value = stop.color; hex.style.cssText = 'width:7em; flex:none;';
            const setColor = (value) => {
                const stops = char.gradient.stops.map((s, i) => (i === index ? { ...s, color: value } : s));
                update({ stops });
                picker.value = value; hex.value = value;
            };
            picker.addEventListener('input', () => setColor(picker.value));
            hex.addEventListener('change', () => {
                let v = hex.value.trim();
                if (v && v[0] !== '#') v = `#${v}`;
                if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${[...v.slice(1)].map(c => c + c).join('')}`;
                if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v.toLowerCase()); else hex.value = char.gradient.stops[index]?.color || stop.color;
            });
            const pos = numberBox(stop.position, 0, 100, 1, v => {
                update({ stops: char.gradient.stops.map((s, i) => (i === index ? { ...s, position: v } : s)) }, true);
            });
            pos.title = 'Position along the gradient, in percent';
            const remove = el('button', 'menu_button clear-color-btn');
            remove.type = 'button';
            remove.innerHTML = '<i class="fa-solid fa-minus"></i>';
            remove.title = 'Remove this colour';
            remove.disabled = g.stops.length <= MIN_GRADIENT_STOPS;
            remove.addEventListener('click', () => update({ stops: char.gradient.stops.filter((_, i) => i !== index) }, true));
            row.append(picker, hex, pos, el('span', 'notes', '%'), remove);
            stopsBox.append(row);
        });
        body.append(stopsBox);
        const add = el('button', 'menu_button');
        add.type = 'button';
        add.innerHTML = '<i class="fa-solid fa-plus"></i> Add a colour';
        add.disabled = g.stops.length >= MAX_GRADIENT_STOPS;
        add.addEventListener('click', () => {
            const last = char.gradient.stops[char.gradient.stops.length - 1];
            update({ stops: [...char.gradient.stops, { color: last.color, position: Math.min(100, last.position + 10) }] }, true);
        });
        body.append(add);

        // Drift.
        const motion = el('div', 'sillynpc-color-row');
        const driftLabel = el('label', 'checkbox_label');
        const drift = el('input');
        drift.type = 'checkbox';
        drift.checked = g.animation.enabled;
        drift.addEventListener('change', () => update({ animation: { ...char.gradient.animation, enabled: drift.checked } }, true));
        driftLabel.append(drift, ' Drift slowly');
        motion.append(driftLabel);
        if (g.animation.enabled) {
            motion.append(el('span', 'notes', 'Seconds'), numberBox(g.animation.duration, 0.5, 120, 0.5, v => update({ animation: { ...char.gradient.animation, duration: v } })));
            const revLabel = el('label', 'checkbox_label');
            const rev = el('input');
            rev.type = 'checkbox';
            rev.checked = g.animation.reverse;
            rev.addEventListener('change', () => update({ animation: { ...char.gradient.animation, reverse: rev.checked } }));
            revLabel.append(rev, ' Reverse');
            motion.append(revLabel);
        }
        body.append(motion);
        body.append(el('small', 'notes', 'Drift is switched off automatically for anyone whose system asks for reduced motion.'));
    };

    draw();
    return panel;
}
