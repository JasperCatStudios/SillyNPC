import { sceneSettings, saveSceneSettings } from './scene-state.js';
import { syncSceneWeather, weatherStatusText, onWeatherStatus } from './scene-weather.js';
import { WEATHER_EFFECTS } from './weather-fx-core.js';
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
        + 'module on and uses the weather word from the scene header. Nothing runs while this is off.'));

    const opt = (label, checked, onChange, hint) => {
        const row = el('label', 'sillynpc-pane-opt sillynpc-scene-opt');
        row.append(makeSwitch(checked, onChange), el('span', '', label));
        if (hint) row.title = hint;
        return row;
    };

    const status = el('div', 'notes sillynpc-weather-status');
    const drawStatus = () => { status.textContent = weatherStatusText(); };

    pane.append(opt('Show weather effects', w.enabled, (on) => { w.enabled = on; change(); drawStatus(); },
        'The master switch. Off removes the effect layer completely.'));
    pane.append(status);

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
        if (!pane.isConnected) { off(); return; }
        drawStatus();
    });
}
