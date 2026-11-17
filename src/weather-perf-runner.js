/**
 * The weather performance test, the runner (fork): steps through planSteps with a weather engine on its own
 * canvas, records the time between animation frames, and stops by itself by the rules of weather-perf-core.js.
 *
 * Everything the browser gives (requestAnimationFrame, the clock, timers, localStorage, the heap size, the engine)
 * is passed in, so node can drive it with fakes (tests/weather-perf-runner.test.mjs). The screen is
 * ui-weather-perf.js.
 *
 * Every way a run ends (the last step, an automatic stop, the Stop button, an error) goes through finish(): it
 * cancels the frame callback and the watchdog, destroys the engine (its canvas goes with it), clears the crash
 * marker, and only then reports. finish() runs once.
 */

import {
    normalizePerfOptions, summarizeFrames, shouldStop, goHeavier, startMarker,
} from './weather-perf-core.js';

export const PERF_MARKER_KEY = 'worldkit-weather-perf-running';

/** The weather drawn for one step: the given kind, heavy, by day (the aurora by night, where it shows). */
export function perfDescFor(kind) {
    const night = kind === 'aurora';
    return { kind, intensity: 4, timeOfDay: night ? 'night' : 'day', hour: night ? 0 : 12 };
}

/**
 * @param {object} deps
 * @param {{kind:string, density:number}[]} deps.steps from planSteps
 * @param {object} [deps.options] perf options (normalizePerfOptions)
 * @param {() => object} deps.createFx makes an engine (createWeatherFx with its own canvas)
 * @param {(fn:Function) => any} deps.raf
 * @param {(id:any) => void} deps.caf
 * @param {{ set(fn:Function, ms:number):any, clear(id:any):void }} deps.interval
 * @param {() => number} deps.now milliseconds
 * @param {{ set(v:string):void, clear():void }} deps.marker the crash marker store
 * @param {() => number|null} [deps.heapMb] used heap in MB where the browser reports it
 * @param {(live:object) => void} [deps.onUpdate]
 * @param {(result:{results:object[], stoppedBecause:string}) => void} deps.onDone
 */
export function createPerfRunner(deps) {
    const o = normalizePerfOptions(deps.options);
    const steps = (deps.steps || []).slice();
    const stepMs = o.stepSeconds * 1000;
    const warmupMs = o.warmupSeconds * 1000;
    const results = [];
    const skip = new Set();
    let fx = null;
    let idx = 0;
    let frames = [];
    let stepStart = null;
    let lastTs = null;
    let lastFrameAt = 0;
    let rafId = null;
    let watchdog = null;
    let inStep = false;
    let started = false;
    let done = false;
    let paused = false;
    let heapStart = null;

    const heapGrowth = () => {
        if (heapStart === null) return null;
        const h = deps.heapMb?.();
        return Number.isFinite(h) ? h - heapStart : null;
    };

    function finish(reason) {
        if (done) return;
        done = true;
        try { if (rafId !== null) deps.caf(rafId); } catch { /* gone */ }
        rafId = null;
        try { if (watchdog !== null) deps.interval.clear(watchdog); } catch { /* gone */ }
        watchdog = null;
        // A step cut short still says how it went.
        if (inStep && frames.length >= 3) {
            const step = steps[idx];
            results.push({ kind: step.kind, density: step.density, summary: summarizeFrames(frames), partial: true });
        }
        inStep = false;
        try { fx?.destroy(); } catch (err) { console.warn('[Worldkit] weather test: could not stop the engine', err); }
        fx = null;
        try { deps.marker.clear(); } catch { /* storage refused */ }
        try {
            deps.onDone({ results: results.slice(), stoppedBecause: reason || '' });
        } catch (err) {
            console.warn('[Worldkit] weather test: the results screen failed', err);
        }
    }

    function beginStep() {
        if (done || paused) return;
        while (idx < steps.length && skip.has(steps[idx].kind)) idx++;
        if (idx >= steps.length) { finish(''); return; }
        const step = steps[idx];
        try { deps.marker.set(startMarker(step, Date.now())); } catch { /* storage refused */ }
        try {
            fx.setDensity(step.density);
            fx.setWeather(perfDescFor(step.kind));
        } catch (err) {
            finish(`the engine failed on ${step.kind}: ${err?.message || err}`);
            return;
        }
        frames = [];
        stepStart = null;
        lastTs = null;
        lastFrameAt = deps.now();
        inStep = true;
        rafId = deps.raf(frame);
    }

    function endStep() {
        const step = steps[idx];
        const summary = summarizeFrames(frames, { warmupMs });
        results.push({ kind: step.kind, density: step.density, summary });
        inStep = false;
        const stop = shouldStop({ stepAvgFps: summary.avgFps, heapGrowthMb: heapGrowth() }, o);
        if (stop.stop) { finish(stop.reason); return; }
        if (!goHeavier(summary, o)) skip.add(step.kind);
        idx++;
        beginStep();
    }

    function frame(ts) {
        rafId = null;
        if (done || paused) return;
        lastFrameAt = deps.now();
        if (lastTs !== null) {
            const gap = ts - lastTs;
            frames.push(gap);
            const stop = shouldStop({ gapMs: gap }, o);
            if (stop.stop) { finish(stop.reason); return; }
            if (frames.length % 30 === 0) {
                const heap = shouldStop({ heapGrowthMb: heapGrowth() }, o);
                if (heap.stop) { finish(heap.reason); return; }
            }
        } else {
            stepStart = ts;
        }
        lastTs = ts;
        const recent = frames.slice(-20);
        const sum = recent.reduce((a, b) => a + b, 0);
        const step = steps[idx];
        try {
            deps.onUpdate?.({
                fps: sum > 0 ? Math.round((recent.length / sum) * 1000) : 0,
                kind: step.kind,
                density: step.density,
                step: idx + 1,
                total: steps.length,
                stepProgress: Math.min(1, (ts - stepStart) / stepMs),
            });
        } catch { /* the screen is gone; the run still ends cleanly */ }
        if (ts - stepStart >= stepMs) { endStep(); return; }
        rafId = deps.raf(frame);
    }

    // Frames that stop arriving while the page is visible (rather than one long gap) end the run too.
    function onWatch() {
        if (done || paused || !inStep) return;
        const quiet = deps.now() - lastFrameAt;
        const stop = shouldStop({ gapMs: quiet }, o);
        if (stop.stop) finish(`no frames arrived: ${stop.reason}`);
    }

    return {
        start() {
            if (started) return;
            started = true;
            try {
                const h = deps.heapMb?.();
                heapStart = Number.isFinite(h) ? h : null;
                fx = deps.createFx();
                fx.setEnabled(true);
                watchdog = deps.interval.set(onWatch, 500);
            } catch (err) {
                finish(`the engine could not start: ${err?.message || err}`);
                return;
            }
            beginStep();
        },
        /** Ends the run now (the Stop button). */
        stop(reason = 'stopped by you') { finish(reason); },
        /** The page went out of sight: the current step is dropped and nothing runs until resume(). */
        pause() {
            if (done || paused || !started) return;
            paused = true;
            try { if (rafId !== null) deps.caf(rafId); } catch { /* gone */ }
            rafId = null;
            frames = [];
            inStep = false;
            try { deps.marker.clear(); } catch { /* storage refused */ }
        },
        /** Starts the dropped step again. */
        resume() {
            if (done || !paused) return;
            paused = false;
            beginStep();
        },
        get done() { return done; },
        get paused() { return paused; },
        get results() { return results.slice(); },
    };
}
