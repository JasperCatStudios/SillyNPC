import { sceneSettings, saveSceneSettings, rematchScene } from './scene-state.js';
import {
    syncSceneWeather, weatherStatusText, onWeatherStatus, previewWeather, stopPreview, isPreviewing, weatherDiagnostics,
} from './scene-weather.js';
import { weatherDetectStatus, onWeatherDetectStatus, askWeatherNow } from './weather-detect.js';
import { classifyWeather } from './weather-kind.js';
import { WEATHER_EFFECTS, weatherEffect, normalizeKind } from './weather-fx-core.js';
import { isEffectEnabled, setEffectEnabled, applyPerfResults, describePerfChanges } from './weather-settings.js';

/**
 * The Weather section of the Scene pane (fork). Draws only: the settings rules are in weather-settings.js, the
 * SillyTavern side in scene-weather.js, the test screen in ui-weather-perf.js.
 *
 * Typing and dragging save as they happen and never rebuild anything. The list of weathers is built once and is
 * rebuilt only after a button click (the one that applies the test), never while a slider moves. Every change calls
 * syncSceneWeather() so it shows at once. What happened is said in inline text, not in toasts.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const button = (label, title, icon) => {
    const b = el('button', 'menu_button');
    b.type = 'button';
    if (icon) b.innerHTML = `<i class="fa-solid ${icon}"></i> `;
    b.append(document.createTextNode(label));
    if (title) b.title = title;
    return b;
};

const COST_HINT = {
    light: 'Light: easy on any device.',
    medium: 'Medium: fine on most devices.',
    heavy: 'Heavy: can slow a phone down. Off until you switch it on.',
};

/**
 * @param {HTMLElement} pane
 * @param {{ makeSwitch: (checked: boolean, onChange: (on: boolean) => void) => HTMLElement }} ctx
 */
export function renderWeatherSection(pane, { makeSwitch }) {
    const w = sceneSettings().weather;
    const change = () => { saveSceneSettings(); syncSceneWeather(); };

    pane.append(el('h4', 'sillynpc-combat-heading', 'Weather effects'));
    pane.append(el('small', 'notes',
        'Draws the scene\'s weather (rain, snow, clouds, sun and more) over the chat. Off by default. It needs the Scene '
        + 'module on. The weather comes from the scene header unless you choose another source below. Nothing runs while this is off.'));

    const opt = (label, checked, onChange, hint) => {
        const row = el('label', 'sillynpc-pane-opt sillynpc-scene-opt');
        row.append(makeSwitch(checked, onChange), el('span', '', label));
        if (hint) row.title = hint;
        return row;
    };

    const status = el('div', 'notes sillynpc-weather-status');
    status.style.whiteSpace = 'pre-line';
    const drawStatus = () => {
        status.textContent = [weatherStatusText(), ...weatherDiagnostics(), weatherDetectStatus()].filter(Boolean).join('\n');
    };

    pane.append(opt('Show weather effects', w.enabled, (on) => { w.enabled = on; change(); drawStatus(); },
        'The master switch. Off removes the effect layer completely.'));
    pane.append(status);

    /* ---- where the weather comes from ---- */
    const SOURCE_HELP = {
        header: 'The weather segment of the scene header at the top of a message (for example the last part of '
            + '[ Time 07:24 AM | Friday, February 07 | Harbour Inn | light rain ]). Nothing extra is asked.',
        internal: 'The Weather line of the Internal States report under each reply. When Internal States writes the report '
            + 'as a separate request (the "after the reply" mode), that request is asked to add a Weather line, so there is '
            + 'no extra call. If the report has no Weather line, its Env line is read instead. Until a report gives a weather, '
            + 'the header\'s weather is used.',
        model: 'A small separate request after each new reply asks a model for the current weather, on the Weather connection '
            + '(Connections tab; empty uses your main API). The answer is kept on the message, so a swipe, a reload or a redraw '
            + 'never asks twice for the same text, and it asks at most once every 20 seconds. Until it answers, the header\'s '
            + 'weather is used. Edit the instructions under Prompts, Weather: Detection Instructions.',
    };
    const sourceRow = el('div', 'sillynpc-setting-row sillynpc-scene-row');
    const sourceSelect = el('select', 'text_pole');
    for (const [value, label] of [['header', 'The scene header'], ['internal', 'The Internal States report'], ['model', 'A model (separate request)']]) {
        sourceSelect.append(new Option(label, value));
    }
    sourceSelect.value = w.source;
    sourceRow.append(el('label', '', 'Weather comes from'), sourceSelect);
    const sourceHelp = el('small', 'notes', SOURCE_HELP[w.source]);
    const modelRow = el('div', 'sillynpc-scene-actions');
    const checkNow = button('Ask the model now', 'Asks about the newest reply again, ignoring the 20 second wait and any saved answer.', 'fa-cloud-sun');
    modelRow.append(checkNow);
    modelRow.style.display = w.source === 'model' ? '' : 'none';
    sourceSelect.addEventListener('change', () => {
        w.source = sourceSelect.value;
        sourceHelp.textContent = SOURCE_HELP[w.source] || '';
        modelRow.style.display = w.source === 'model' ? '' : 'none';
        change();
        try { rematchScene(); } catch (err) { console.warn('[Worldkit] weather source', err); }
        drawStatus();
    });
    checkNow.addEventListener('click', () => {
        askWeatherNow().catch(err => console.warn('[Worldkit] weather ask', err)).finally(drawStatus);
    });
    pane.append(sourceRow, sourceHelp, modelRow);

    /* ---- try it by hand ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Try a weather'));
    pane.append(el('small', 'notes',
        'See an effect without waiting for the story. Pick one and press Preview it: it is drawn now, even if the scene has no '
        + 'weather, until you press Stop previewing or reload. Nothing is saved.'));
    const pick = (options, value) => {
        const s = el('select', 'text_pole');
        for (const [v, label] of options) s.append(new Option(label, v));
        s.value = value;
        return s;
    };
    const effectSelect = pick(WEATHER_EFFECTS.map(e => [e.id, e.label]), 'rain');
    const intensitySelect = pick([['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']], 'moderate');
    const timeSelect = pick([['dawn', 'Dawn'], ['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], 'day');
    const windSelect = pick([['calm', 'Calm'], ['left', 'Wind to the left'], ['right', 'Wind to the right']], 'calm');
    const labelled = (text, control) => {
        const row = el('div', 'sillynpc-setting-row sillynpc-scene-row');
        row.append(el('label', '', text), control);
        return row;
    };
    pane.append(labelled('Weather', effectSelect), labelled('Intensity', intensitySelect),
        labelled('Time of day', timeSelect), labelled('Wind', windSelect));
    const windFor = (v) => (v === 'left' || v === 'right' ? { windSpeed: 'windy', windDirection: v } : { windSpeed: 'calm' });
    const previewActions = el('div', 'sillynpc-scene-actions');
    const previewBtn = button('Preview it', 'Draws this weather now.', 'fa-play');
    const stopBtn = button('Stop previewing', 'Gives the effect layer back to the scene.', 'fa-stop');
    previewActions.append(previewBtn, stopBtn);
    const previewNote = el('div', 'notes sillynpc-weather-preview-note');
    const showPreview = (desc) => {
        const result = previewWeather(desc);
        previewNote.textContent = result.ok ? `Previewing: ${desc.kind}, ${desc.intensity}, ${desc.timeOfDay}.` : result.reason;
        drawStatus();
    };
    previewBtn.addEventListener('click', () => showPreview({
        kind: effectSelect.value, intensity: intensitySelect.value, timeOfDay: timeSelect.value, ...windFor(windSelect.value),
    }));
    stopBtn.addEventListener('click', () => {
        stopPreview();
        previewNote.textContent = 'Back to the scene\'s weather.';
        drawStatus();
    });
    previewNote.textContent = isPreviewing() ? 'A preview is running. Press Stop previewing to go back to the scene.' : '';
    if (!w.enabled && !previewNote.textContent) previewNote.textContent = 'The "Show weather effects" switch is off: switch it on to see a preview.';
    pane.append(previewActions, previewNote);

    const wordsRow = el('div', 'sillynpc-setting-row sillynpc-scene-row');
    const wordsInput = el('input', 'text_pole');
    wordsInput.type = 'text';
    wordsInput.placeholder = 'Try some words, e.g. light rain, 54 F';
    wordsRow.append(el('label', '', 'Try some words'), wordsInput);
    const wordsResult = el('div', 'notes sillynpc-weather-words-result');
    const refineKind = (c) => normalizeKind(c.kind, c.word);
    const readWords = () => {
        const text = wordsInput.value.trim();
        if (!text) { wordsResult.textContent = ''; return null; }
        const c = classifyWeather(text);
        if (c.kind === 'none') wordsResult.textContent = 'Those words do not name a weather, so nothing would be drawn.';
        else {
            wordsResult.textContent = `Read as: ${c.kind}, ${c.intensity || 'moderate'}${c.word ? ` (from the word "${c.word}")` : ''}`
                + `${c.windSpeed ? `, wind ${c.windSpeed}` : ''}${c.haze ? ', hazy (drawn as a light clear sky)' : ''}`
                + `${isEffectEnabled(w, refineKind(c)) ? '' : `. ${weatherEffect(refineKind(c))?.label || c.kind} is switched off below, so a lighter one is drawn`}.`;
        }
        return c;
    };
    // Typing only reads the words; nothing is rebuilt.
    wordsInput.addEventListener('input', readWords);
    const wordsBtn = button('Preview these words', 'Draws what these words make.', 'fa-play');
    wordsBtn.addEventListener('click', () => {
        const c = readWords();
        if (!c || c.kind === 'none') { if (c) previewNote.textContent = 'Nothing to preview: those words do not name a weather.'; return; }
        showPreview({
            kind: c.kind, word: c.word, intensity: c.intensity || 'moderate', timeOfDay: timeSelect.value,
            ...(c.windSpeed ? { windSpeed: c.windSpeed } : windFor(windSelect.value)),
        });
    });
    const wordsActions = el('div', 'sillynpc-scene-actions');
    wordsActions.append(wordsBtn);
    pane.append(wordsRow, wordsResult, wordsActions);

    // Density: saved while dragging; nothing is rebuilt.
    const densityRow = el('div', 'sillynpc-setting-row sillynpc-scene-row sillynpc-weather-density');
    const densityLabel = el('label', '', 'Density');
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(w.density);
    const densityValue = el('span', 'sillynpc-weather-density-value', `${w.density}%`);
    slider.addEventListener('input', () => {
        w.density = Number(slider.value);
        densityValue.textContent = `${w.density}%`;
        change();
    });
    densityRow.append(densityLabel, slider, densityValue);
    pane.append(densityRow);

    pane.append(opt('Low power', w.lowPower, (on) => { w.lowPower = on; change(); drawStatus(); },
        'Fewer particles and no extra effects. Use it if the chat gets slow.'));
    pane.append(opt('Automatic low power on battery saver / reduced motion', w.autoLowPower,
        (on) => { w.autoLowPower = on; change(); drawStatus(); },
        'Switches low power on by itself when the device asks for less motion or the battery is low.'));

    /* ---- the list of weathers ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Weathers'));
    pane.append(el('small', 'notes',
        'Switch any weather off and the nearest lighter one is drawn instead (storm becomes rain, rain becomes drizzle, '
        + 'and so on). The badge says how hard it is on the device.'));
    const list = el('div', 'sillynpc-weather-list');
    pane.append(list);

    const drawList = () => {
        list.replaceChildren();
        for (const effect of WEATHER_EFFECTS) {
            const row = el('label', 'sillynpc-weather-effect');
            const name = el('span', 'sillynpc-weather-name', effect.label);
            const badge = el('span', `sillynpc-weather-cost sillynpc-weather-cost-${effect.cost}`, effect.cost);
            badge.title = COST_HINT[effect.cost] || '';
            const cap = el('span', 'sillynpc-weather-cap');
            const drawCap = () => {
                const c = w.caps?.[effect.id];
                cap.textContent = c ? `drawn at most ${c}%` : '';
            };
            drawCap();
            row.append(
                makeSwitch(isEffectEnabled(w, effect.id), (on) => { setEffectEnabled(w, effect.id, on); change(); drawStatus(); }),
                name, badge, cap,
            );
            list.append(row);
        }
    };
    drawList();

    /* ---- the performance test ---- */
    pane.append(el('h4', 'sillynpc-combat-heading', 'Performance'));
    const actions = el('div', 'sillynpc-scene-actions');
    const apply = button('Turn off the ones my phone struggles with',
        'Uses the last performance test: switches off the weathers that were too slow and caps the ones that were only smooth at a lower density.',
        'fa-wand-magic-sparkles');
    const run = button('Run the performance test', 'Opens a full-screen test that tries every weather at three densities and stops by itself if the device struggles.', 'fa-gauge-high');
    actions.append(apply, run);
    const applied = el('div', 'notes sillynpc-weather-applied');
    pane.append(actions, applied);

    const drawApply = () => {
        const has = !!w.lastTest?.results?.length;
        apply.disabled = !has;
        apply.classList.toggle('disabled', !has);
        if (!has && !applied.textContent) applied.textContent = 'No test has been run on this device yet. Run the performance test first.';
    };
    drawApply();

    apply.addEventListener('click', () => {
        if (!w.lastTest?.results?.length) return;
        applied.textContent = `Last test: ${w.lastTest.results.length} step${w.lastTest.results.length === 1 ? '' : 's'}. `
            + describePerfChanges(applyPerfResults(w, w.lastTest.results));
        change();
        drawList();
        drawStatus();
    });
    run.addEventListener('click', () => {
        import('./ui-weather-perf.js')
            .then(m => m.openWeatherPerfTest({ onClosed: () => { if (pane.isConnected) { applied.textContent = ''; drawApply(); drawList(); drawStatus(); } } }))
            .catch(err => { applied.textContent = `The test could not open: ${err?.message || err}`; console.warn('[Worldkit] weather test', err); });
    });

    drawStatus();
    const off = onWeatherStatus(() => {
        if (!pane.isConnected) { off(); offDetect(); return; }
        drawStatus();
    });
    const offDetect = onWeatherDetectStatus(() => {
        if (!pane.isConnected) { offDetect(); off(); return; }
        drawStatus();
    });
}
