import { createWeatherFx } from './weather-fx-canvas.js';
import { sceneSettings, saveSceneSettings } from './scene-state.js';
import { syncSceneWeather } from './scene-weather.js';
import { applyPerfResults, describePerfChanges, trimTestResult } from './weather-settings.js';
import { PERF_MARKER_KEY } from './weather-perf-runner.js';
import { createPerfScreen } from './weather-perf-screen.js';

/**
 * The weather performance test, SillyTavern wiring (fork). The screen is weather-perf-screen.js, the rules
 * weather-perf-core.js, the runner weather-perf-runner.js. The test makes its own temporary engine (a canvas layer
 * that is destroyed at the end) and does not need the Scene module or the Weather switch to be on.
 */

let current = null;

const storage = {
    get() { try { return localStorage.getItem(PERF_MARKER_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(PERF_MARKER_KEY, v); } catch { /* storage refused */ } },
    clear() { try { localStorage.removeItem(PERF_MARKER_KEY); } catch { /* storage refused */ } },
};

// The engine canvas goes just under the screen's panel and over its backdrop, so the effect is seen behind the text.
function createTestFx() {
    const fx = createWeatherFx({ layer: 'front', zIndex: 2147482995 });
    fx.setAutoLowPower(false);
    fx.setLowPower(false);
    fx.setDisabledEffects([]);
    fx.setDensityCaps({});
    return fx;
}

async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall through */ }
    const box = document.createElement('textarea');
    box.value = text;
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;z-index:2147483647';
    document.body.append(box);
    try {
        box.focus();
        box.select();
        return !!document.execCommand?.('copy');
    } catch { return false; } finally { box.remove(); }
}

/**
 * Opens the full-screen test. Only one at a time.
 * @param {{ onClosed?: () => void }} [opts]
 */
export function openWeatherPerfTest({ onClosed } = {}) {
    if (current && !current.closed) return current;
    current = createPerfScreen({
        doc: document,
        storage,
        createFx: createTestFx,
        raf: (fn) => requestAnimationFrame(fn),
        caf: (id) => cancelAnimationFrame(id),
        interval: { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id) },
        now: () => performance.now(),
        heapMb: () => {
            const used = performance?.memory?.usedJSHeapSize;
            return Number.isFinite(used) ? used / 1048576 : null;
        },
        device: () => `${navigator.platform || 'device'}, screen ${screen.width}x${screen.height}, touch ${navigator.maxTouchPoints || 0}, ${navigator.userAgent || ''}`,
        saveResult: (result) => {
            const kept = trimTestResult(result);
            if (!kept) return;
            sceneSettings().weather.lastTest = kept;
            saveSceneSettings();
        },
        applyResults: (results) => {
            const w = sceneSettings().weather;
            const text = describePerfChanges(applyPerfResults(w, results));
            saveSceneSettings();
            syncSceneWeather();
            return text;
        },
        copy: copyText,
        onClosed,
    });
    return current;
}
