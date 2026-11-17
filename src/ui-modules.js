import { redrawWhenIdle } from './ui-edit-guard.js';
import { buildResultInjectionPanel } from './ui-result-injection.js';
import { buildLevelingPanel } from './ui-leveling.js';
import { renderVoiceSettings } from './ui-character-extras.js';
import { getSettings, saveSettings } from './settings.js';
import { moduleSends, setModuleSends } from './context-blocks.js';
import { getModulePane, moduleLoadState, onModuleLoad, missingModuleText } from './module-panes.js';

/**
 * The Modules tab (fork): one place for everything that rides along with Worldkit.
 *
 * Each borrowed module builds its own settings panel and parks it in SillyTavern's Extensions
 * list. Here those panels are moved into cards instead, so there is one menu rather than one
 * per extension, and the Extensions list keeps only Worldkit. The panels are the modules' own
 * and keep working as they were; a card only gives them a header, a switch and a place to be.
 *
 * Moving a panel is borrowing it: it is put back in a hidden holder when this tab goes away,
 * because a panel left inside a closed popup is a panel destroyed.
 */

/** What the manager knows about each module. */
export const MODULES = [
    {
        id: 'phone',
        name: 'Phone',
        icon: 'fa-mobile-screen-button',
        blurb: 'A messenger where your characters text you, and start conversations on their own.',
        drawer: '.rph-settings',
        enableBox: '#rph-enabled',
        content: '#rph-drawer',
    },
    {
        id: 'games',
        name: 'Games',
        icon: 'fa-gamepad',
        blurb: 'Chess, cards, dice and more, played against your characters, in character.',
        drawer: '.rpg-game-settings',
        enableBox: '#rpg-game-enabled',
        content: '.inline-drawer-content',
    },
    {
        id: 'combat',
        name: 'Combat',
        icon: 'fa-khanda',
        blurb: 'Duels and sparring by the rules of a world type: Fire Emblem, Bleach, or your own.',
        // Drawn by modules/combat/combat.js through registerModulePane, not borrowed from a drawer.
        render: true,
    },
    {
        id: 'scene',
        name: 'Scene',
        icon: 'fa-map-location-dot',
        blurb: 'Where and when the story is, read from the scene header: a map of places with other names, and a background for each.',
        // Drawn by modules/scene/scene.js. It sends nothing to a model, so there is nothing to choose to send.
        render: true,
        noContext: true,
    },
];

/** Combat and Games send their result to the story like the phone sends its texts; the settings sit on their tab. */
function addResultPanel(pane, mod) {
    if (mod.id !== 'combat' && mod.id !== 'games') return;
    try { pane.append(buildResultInjectionPanel(mod.id)); } catch (err) { console.warn('[Worldkit] result injection settings failed', err); }
    if (mod.id === 'combat') {
        try { pane.append(buildLevelingPanel(), buildResultInjectionPanel('levelup')); } catch (err) { console.warn('[Worldkit] leveling settings failed', err); }
    }
}

/** Where borrowed panels wait while the Modules tab is not open. */
function holder() {
    let el = document.getElementById('sillynpc-module-holder');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sillynpc-module-holder';
        el.style.display = 'none';
        document.body.append(el);
    }
    return el;
}

/** Gives every borrowed panel back when the tab is no longer on screen. */
function returnWhenGone(view, borrowed) {
    const observer = new MutationObserver(() => {
        if (view.isConnected) return;
        observer.disconnect();
        for (const panel of borrowed) holder().append(panel);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Takes back the panels a previous drawing of this view borrowed. Without this, redrawing the
 * tab (every switch back to Modules does) cleared the view with the panels still in it: they
 * left the page, the lookup for them found nothing, and the pane said the module had not loaded.
 */
function reclaimBorrowed(view) {
    for (const mod of MODULES) {
        if (!mod.drawer) continue;
        for (const panel of view.querySelectorAll(mod.drawer)) holder().append(panel);
    }
}

const watchers = new WeakMap();

/**
 * While a module's pane is missing, watches for it: a load that finishes or fails, or its
 * drawer appearing (the Phone builds its drawer a moment after it loads). Then draws again.
 */
function watchForMissing(view, mods) {
    watchers.get(view)?.();
    let timer = 0;
    let tries = 0;
    const ids = new Set(mods.map(m => m.id));
    const stop = () => { clearInterval(timer); off(); if (watchers.get(view) === stop) watchers.delete(view); };
    const redraw = () => { stop(); if (view.isConnected) redrawWhenIdle(view, () => renderModulesView(view)); };
    const off = onModuleLoad((id) => { if (ids.has(id)) redraw(); });
    timer = setInterval(() => {
        if (!view.isConnected || ++tries > 120) { stop(); return; }
        if (mods.some(m => (m.render ? getModulePane(m.id) : document.querySelector(m.drawer)))) redraw();
    }, 500);
    watchers.set(view, stop);
}

/** A switch, as a labelled checkbox. */
function makeSwitch(checked, onChange) {
    const label = document.createElement('label');
    label.className = 'sillynpc-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'sillynpc-switch-slider';
    label.append(input, slider);
    return label;
}

/** Which pane was open last, kept for the session so redrawing the tab does not jump back. */
let activePane = 'voices';

/**
 * @param {HTMLElement} view
 */
export function renderModulesView(view) {
    reclaimBorrowed(view);
    watchers.get(view)?.();
    view.replaceChildren();

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Modules';
    view.append(title);

    const bar = document.createElement('div');
    bar.className = 'sillynpc-subtabs';
    bar.setAttribute('role', 'tablist');
    const panes = document.createElement('div');
    view.append(bar, panes);

    /** Adds one tab and its pane. */
    const panes_ = [];
    const add = (id, icon, name, build) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-subtab';
        tab.setAttribute('role', 'tab');
        tab.innerHTML = `<i class="fa-solid ${icon}"></i> `;
        tab.append(document.createTextNode(name));
        const pane = document.createElement('div');
        pane.className = 'sillynpc-subpane';
        build(pane);
        bar.append(tab);
        panes.append(pane);
        panes_.push({ id, tab, pane });
        tab.addEventListener('click', () => { activePane = id; show(); });
    };
    const show = () => {
        if (!panes_.some(p => p.id === activePane)) activePane = panes_[0]?.id;
        for (const p of panes_) {
            const on = p.id === activePane;
            p.tab.classList.toggle('active', on);
            p.tab.setAttribute('aria-selected', String(on));
            p.pane.style.display = on ? '' : 'none';
        }
    };

    // Voices belong to Worldkit itself rather than to a module, and come first.
    add('voices', 'fa-volume-high', 'Voices', (pane) => {
        const head = document.createElement('div');
        head.className = 'sillynpc-pane-head';
        const text = document.createElement('small');
        text.className = 'notes';
        text.textContent = 'Characters read aloud through AllTalk, a voice each. Off, nothing is read and AllTalk is never contacted.';
        head.append(text, makeSwitch(getSettings().ttsEnabled, (on) => { getSettings().ttsEnabled = on; saveSettings(); }));
        pane.append(head);
        renderVoiceSettings(pane);
    });

    // What every module sends along, and the limits on it.
    add('context', 'fa-layer-group', 'Shared context', (pane) => {
        const intro = document.createElement('p');
        intro.className = 'notes';
        intro.textContent = 'Every module can send your persona and what other extensions remember (VectFox, '
            + 'Summaryception) with its requests. Which modules do is chosen on each module\'s tab; the limits are here. '
            + 'The memory is what those extensions put in the story prompt at the last main-chat reply.';
        pane.append(intro);

        const row = (labelText, input) => {
            const wrap = document.createElement('div');
            wrap.className = 'sillynpc-setting-row';
            const label = document.createElement('label');
            label.textContent = labelText;
            wrap.append(label, input);
            return wrap;
        };
        const settings = getSettings();
        const number = (key, min, step) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'text_pole';
            input.min = String(min);
            input.step = String(step);
            input.style.width = '8em';
            input.value = settings[key];
            input.addEventListener('change', () => {
                const value = Number(input.value);
                if (Number.isFinite(value) && value >= min) { settings[key] = value; saveSettings(); }
            });
            return input;
        };
        const keys = document.createElement('input');
        keys.type = 'text';
        keys.className = 'text_pole';
        keys.style.flex = '1';
        keys.value = settings.contextMemoryKeys || '';
        keys.addEventListener('change', () => { settings.contextMemoryKeys = keys.value.trim(); saveSettings(); });
        pane.append(
            row('Persona, at most (characters)', number('contextPersonaMaxChars', 200, 100)),
            row('Memory, at most (characters)', number('contextMemoryMaxChars', 500, 500)),
            row('Memory slots (names start with, comma separated)', keys),
        );
    });

    // The search index draws every tab offscreen once. Borrowing panels there would take them
    // away from the real one, so offscreen only the headings are drawn.
    const live = view.isConnected;
    const borrowed = [];
    const missingMods = [];
    const missingNote = (pane, mod) => {
        const missing = document.createElement('p');
        const load = moduleLoadState(mod.id);
        missing.className = `notes${load?.state === 'failed' ? ' sillynpc-module-error' : ''}`;
        missing.textContent = missingModuleText(mod.name, load);
        pane.append(missing);
        missingMods.push(mod);
    };

    for (const mod of MODULES) {
        add(mod.id, mod.icon, mod.name, (pane) => {
            const head = document.createElement('div');
            head.className = 'sillynpc-pane-head';
            const text = document.createElement('small');
            text.className = 'notes';
            text.textContent = mod.blurb;
            head.append(text);
            pane.append(head);

            // What this module sends along with its requests.
            const options = document.createElement('div');
            if (mod.noContext) options.style.display = 'none';
            options.className = 'sillynpc-pane-opts';
            for (const [kind, label] of [['persona', 'Send my persona'], ['memory', 'Send other extensions\' memory']]) {
                const item = document.createElement('label');
                item.className = 'sillynpc-pane-opt';
                item.append(makeSwitch(moduleSends(mod.id, kind), (on) => { setModuleSends(mod.id, kind, on); saveSettings(); }));
                const span = document.createElement('span');
                span.textContent = label;
                item.append(span);
                options.append(item);
            }
            pane.append(options);

            if (mod.render) {
                const draw = getModulePane(mod.id);
                if (draw) {
                    try {
                        draw(pane, { live, head, makeSwitch });
                    } catch (err) {
                        console.error('[Worldkit]', `The ${mod.name} pane failed to draw`, err);
                        const note = document.createElement('p');
                        note.className = 'notes sillynpc-module-error';
                        note.textContent = `${mod.name} loaded, but its pane failed to draw: ${err?.message || err}. Details are in the browser console.`;
                        pane.append(note);
                    }
                } else if (live) {
                    missingNote(pane, mod);
                }
                addResultPanel(pane, mod);
                return;
            }

            const panel = live ? document.querySelector(mod.drawer) : null;
            if (panel) {
                pane.append(panel);
                borrowed.push(panel);
                panel.classList.add('sillynpc-module-panel');
                const box = panel.querySelector(mod.enableBox);
                if (box) {
                    head.append(makeSwitch(box.checked, (on) => {
                        box.checked = on;
                        // jQuery handlers hear a native event, so one dispatch reaches them.
                        box.dispatchEvent(new Event('change', { bubbles: true }));
                    }));
                    // The pane's switch is that checkbox, so the second copy is hidden.
                    (box.closest('label') || box).classList.add('sillynpc-hidden');
                }
            } else if (live) {
                missingNote(pane, mod);
            }
            addResultPanel(pane, mod);
        });
    }

    show();
    if (borrowed.length) returnWhenGone(view, borrowed);
    // A module that fails for good stays as it is: its error is the note, nothing to wait for.
    const waiting = missingMods.filter(m => moduleLoadState(m.id)?.state !== 'failed');
    if (waiting.length) watchForMissing(view, waiting);
}
