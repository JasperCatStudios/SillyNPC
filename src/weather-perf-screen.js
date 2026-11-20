import { WEATHER_EFFECTS, weatherEffect } from './weather-fx-core.js';
import {
    PERF_DEFAULTS, BASELINE_KIND, planSteps, readMarker, safeModeFrom, reportText, bestDensities, verdictFor,
    baselineFpsOf, effectResults, percentOfBaseline, baselineNotes,
} from './weather-perf-core.js';
import { createPerfRunner } from './weather-perf-runner.js';

/**
 * The weather performance test screen (fork): a full-screen overlay that runs weather-perf-runner.js and shows the
 * numbers. It touches the page only through `deps` and a few DOM calls (createElement, append, remove,
 * addEventListener), so node can drive it with a fake document (tests/weather-perf-screen.test.mjs). The SillyTavern
 * wiring (settings, clipboard, the real engine) is src/ui-weather-perf.js.
 *
 * SAFETY. Every way the run ends (last step, an automatic stop, the Stop button, the page being hidden and aborted, the
 * close button, an error) goes through the runner's single finish(): frame loop and watchdog cancelled, engine
 * destroyed, crash marker cleared. Closing the screen (closeAll) then removes the overlay and its listeners and clears
 * the marker again. Each step is wrapped in try/catch so a failure in one cannot keep the next from running.
 *
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {{ get():string|null, set(v:string):void, clear():void }} deps.storage the crash marker store
 * @param {() => object} deps.createFx a fresh engine on its own canvas
 * @param {(fn:Function) => any} deps.raf
 * @param {(id:any) => void} deps.caf
 * @param {{ set(fn:Function, ms:number):any, clear(id:any):void }} deps.interval
 * @param {() => number} deps.now
 * @param {() => number|null} [deps.heapMb]
 * @param {() => string} [deps.device]
 * @param {(result:object) => void} deps.saveResult stores the finished or stopped result (scene.weather.lastTest)
 * @param {(results:object[]) => string} deps.applyResults applies the results to the settings, returns the sentence to show
 * @param {(text:string) => Promise<boolean>} deps.copy
 * @param {() => void} [deps.onClosed]
 */
export function createPerfScreen(deps) {
    const doc = deps.doc;
    let closed = false;
    let runner = null;
    let phase = 'intro';
    let lastResult = null;
    let lastPaint = 0;
    let safe = null;

    const el = (tag, className, text) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const button = (label, className, onClick) => {
        const b = el('button', `menu_button wk-perf-btn ${className || ''}`.trim(), label);
        b.type = 'button';
        b.addEventListener('click', () => {
            try { onClick(); } catch (err) { try { console.warn('[Worldkit] weather test', err); } catch { /* no console */ } }
        });
        return b;
    };
    const show = (node, on) => { node.style.display = on ? '' : 'none'; };
    const label = (kind) => (kind === BASELINE_KIND ? 'Baseline (nothing drawn)' : (weatherEffect(kind)?.label || kind));

    /* ---- the leftover marker of a test that did not end ---- */
    let previous = null;
    try { previous = readMarker(deps.storage.get()); } catch { previous = null; }
    safe = safeModeFrom(previous);

    /* ---- elements ---- */
    const overlay = el('div', 'wk-perf-overlay');
    overlay.setAttribute?.('role', 'dialog');
    const style = el('style');
    style.textContent = `
.wk-perf-overlay{position:fixed;inset:0;height:100vh;height:100dvh;z-index:2147482990;background:rgba(8,10,16,.9);color:#eef;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px calc(24px + env(safe-area-inset-bottom));box-sizing:border-box;font-size:16px;line-height:1.4}
.wk-perf-panel{position:relative;z-index:2147483000;max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.wk-perf-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.wk-perf-title{font-size:1.25em;font-weight:700}
.wk-perf-btn{min-height:52px;font-size:1.1em;padding:10px 18px;flex:1 1 140px;justify-content:center}
.wk-perf-close{min-height:44px;min-width:44px;flex:0 0 auto}
.wk-perf-row{display:flex;flex-wrap:wrap;gap:10px}
.wk-perf-big{font-size:1.6em;font-weight:700;word-break:break-word}
.wk-perf-note{opacity:.85}
.wk-perf-warn{border-left:4px solid #e0a030;padding:6px 10px;background:rgba(224,160,48,.12)}
.wk-perf-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden}
.wk-perf-bar>div{height:100%;width:0;background:#5cb85c}
.wk-perf-step{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.12)}
.wk-perf-step .wk-perf-what{flex:1 1 200px}
.wk-perf-verdict{font-weight:700;padding:1px 10px;border-radius:10px;border:1px solid currentColor}
.wk-perf-good{color:#6fdc6f}.wk-perf-fair{color:#f0b84a}.wk-perf-poor{color:#ff7070}.wk-perf-nodata{color:#aab}
.wk-perf-copybox{width:100%;min-height:8em;box-sizing:border-box}
`;
    const panel = el('div', 'wk-perf-panel');
    const head = el('div', 'wk-perf-head');
    const title = el('div', 'wk-perf-title', 'Weather performance test');
    const closeBtn = button('Close', 'wk-perf-close', () => closeAll());
    head.append(title, closeBtn);

    const intro = el('div', 'wk-perf-note',
        'This first measures a baseline (nothing drawn), then tries every weather effect at three densities, lightest first, '
        + 'a few seconds each, and judges how smoothly the device draws each one compared with that baseline. It stops by itself if the frame rate collapses or the page stalls, and you can stop it any '
        + 'time. Keep this screen in front while it runs. It works whether or not the weather switch is on.');
    const notice = el('div', 'wk-perf-warn');
    show(notice, false);

    const live = el('div', 'wk-perf-live');
    const current = el('div', 'wk-perf-big');
    const fps = el('div', 'wk-perf-note');
    const stepLine = el('div', 'wk-perf-note');
    const bar = el('div', 'wk-perf-bar');
    const barFill = el('div');
    bar.append(barFill);
    live.append(current, fps, stepLine, bar);
    show(live, false);

    const controls = el('div', 'wk-perf-row');
    const startBtn = button('Start the test', 'wk-perf-start', () => start());
    const stopBtn = button('Stop', 'wk-perf-stop', () => runner?.stop('stopped by you'));
    const resumeBtn = button('Resume', 'wk-perf-resume', () => resume());
    const abortBtn = button('Stop the test', 'wk-perf-abort', () => runner?.stop('stopped: the page was hidden during the test'));
    controls.append(startBtn, stopBtn, resumeBtn, abortBtn);

    const results = el('div', 'wk-perf-results');
    show(results, false);

    panel.append(head, intro, notice, live, controls, results);
    overlay.append(style, panel);

    function setPhase(p) {
        phase = p;
        show(startBtn, p === 'intro' || p === 'results');
        startBtn.textContent = p === 'results' ? 'Run again' : 'Start the test';
        show(stopBtn, p === 'running');
        show(resumeBtn, p === 'paused');
        show(abortBtn, p === 'paused');
        show(live, p === 'running' || p === 'paused');
        show(intro, p === 'intro');
        show(results, p === 'results');
    }

    function showNotice(text) {
        notice.textContent = text;
        show(notice, !!text);
    }

    if (safe) {
        showNotice(`The last test did not finish (the page was reloaded or stopped while it was on ${label(safe.kind)} at ${safe.failedAt}%). `
            + `This run starts in safe mode and stays at or under ${safe.cap}% density.`);
    }

    /* ---- running ---- */
    function options() {
        const base = PERF_DEFAULTS.densities;
        if (!safe) return {};
        const kept = base.filter(d => d <= safe.cap);
        return { densities: kept.length ? kept : [safe.cap] };
    }

    function start() {
        if (closed || runner) return;
        if (lastResult && phase === 'results') { results.replaceChildren(); lastResult = null; }
        const opts = options();
        const steps = planSteps(WEATHER_EFFECTS.map(e => e.id), opts);
        current.textContent = 'Starting...';
        fps.textContent = '';
        stepLine.textContent = '';
        barFill.style.width = '0%';
        setPhase('running');
        runner = createPerfRunner({
            steps,
            options: opts,
            createFx: deps.createFx,
            raf: deps.raf,
            caf: deps.caf,
            interval: deps.interval,
            now: deps.now,
            marker: deps.storage,
            heapMb: deps.heapMb,
            onUpdate: paint,
            onDone: finished,
        });
        runner.start();
    }

    function paint(u) {
        const t = deps.now();
        if (t - lastPaint < 200) return;
        lastPaint = t;
        current.textContent = u.kind === BASELINE_KIND ? `${label(u.kind)}: measuring the best this device can do` : `${label(u.kind)} at ${u.density}%`;
        fps.textContent = u.baselineFps > 0
            ? `${u.fps} frames per second (baseline ${Math.round(u.baselineFps)})`
            : `${u.fps} frames per second`;
        stepLine.textContent = `Step ${u.step} of ${u.total}`;
        barFill.style.width = `${Math.round(((u.step - 1 + (u.stepProgress || 0)) / u.total) * 100)}%`;
    }

    function resume() {
        if (phase !== 'paused' || !runner) return;
        setPhase('running');
        current.textContent = 'Resuming...';
        runner.resume();
    }

    function onVisibility() {
        if (closed || !runner || runner.done) return;
        if (doc.hidden) {
            runner.pause();
            if (runner.paused) {
                setPhase('paused');
                current.textContent = 'Paused';
                fps.textContent = 'The page was hidden, so the test paused. Resume starts the current step again; Stop ends the test.';
            }
        }
    }

    /* ---- the end of a run: results ---- */
    function finished({ results: list, stoppedBecause }) {
        runner = null;
        let device = '';
        try { device = deps.device?.() || ''; } catch { device = ''; }
        lastResult = { at: Date.now(), device, stoppedBecause: stoppedBecause || '', results: list };
        try { deps.saveResult(lastResult); } catch (err) { try { console.warn('[Worldkit] weather test: could not save the result', err); } catch { /* no console */ } }
        if (closed) return;
        safe = null;
        showNotice('');
        drawResults();
        setPhase('results');
    }

    function drawResults() {
        const { results: list, stoppedBecause } = lastResult;
        results.replaceChildren();
        results.append(el('div', 'wk-perf-big', stoppedBecause ? 'Test stopped' : 'Test finished'));
        if (stoppedBecause) results.append(el('div', 'wk-perf-warn', `Stopped early: ${stoppedBecause}. The steps that ran are below.`));
        if (!effectResults(list).length) results.append(el('div', 'wk-perf-note', 'No step finished, so there is nothing to measure.'));
        const base = baselineFpsOf(list);
        if (base > 0) {
            const row = el('div', 'wk-perf-step');
            row.append(
                el('span', 'wk-perf-what', label(BASELINE_KIND)),
                el('span', 'wk-perf-note', `${Math.round(base)} fps: the most this device delivers to the page, so each effect is judged against it`),
            );
            results.append(row);
            for (const note of baselineNotes(base)) results.append(el('div', 'wk-perf-warn', note));
        }
        for (const r of effectResults(list)) {
            const v = verdictFor(r.summary, base);
            const pct = percentOfBaseline(r.summary, base);
            const row = el('div', 'wk-perf-step');
            row.append(
                el('span', 'wk-perf-what', `${label(r.kind)} at ${r.density}%`),
                el('span', 'wk-perf-note', r.summary.frames ? `${r.summary.avgFps} fps${pct === null ? '' : `, ${pct}% of baseline`} (lowest 5%: ${r.summary.lowFps})` : 'no frames'),
                el('span', `wk-perf-verdict wk-perf-${v.replace(' ', '')}`, v),
            );
            results.append(row);
        }
        const best = bestDensities(list);
        const kinds = Object.keys(best);
        if (kinds.length) {
            results.append(el('div', 'wk-perf-big', 'Recommended'));
            for (const k of kinds) {
                results.append(el('div', 'wk-perf-note', best[k] > 0
                    ? `${label(k)}: up to ${best[k]}% stayed smooth.`
                    : `${label(k)}: too slow even at the lightest step.`));
            }
        }
        const said = el('div', 'wk-perf-note');
        const box = el('textarea', 'wk-perf-copybox');
        box.readOnly = true;
        show(box, false);
        const actions = el('div', 'wk-perf-row');
        actions.append(
            button('Copy results', '', async () => {
                const text = reportText(list, { stoppedBecause, device: lastResult.device });
                let ok = false;
                try { ok = await deps.copy(text); } catch { ok = false; }
                said.textContent = ok ? 'Copied.' : 'Could not copy automatically. Select the text below and copy it.';
                box.value = text;
                show(box, !ok);
            }),
            button('Disable the ones that struggled', '', () => {
                said.textContent = deps.applyResults(list);
            }),
            button('Done', '', () => closeAll()),
        );
        results.append(actions, said, box);
    }

    /* ---- closing ---- */
    function closeAll() {
        if (closed) return;
        closed = true;
        try { runner?.stop('closed before the end'); } catch { /* finish already ran */ }
        runner = null;
        try { doc.removeEventListener('visibilitychange', onVisibility); } catch { /* gone */ }
        try { doc.removeEventListener('keydown', onKey); } catch { /* gone */ }
        try { deps.storage.clear(); } catch { /* storage refused */ }
        try { overlay.remove(); } catch { /* gone */ }
        try { deps.onClosed?.(); } catch { /* the opener is gone */ }
    }

    function onKey(e) {
        if (e?.key === 'Escape') {
            if (runner) runner.stop('stopped by you'); else closeAll();
        }
    }

    doc.addEventListener('visibilitychange', onVisibility);
    doc.addEventListener('keydown', onKey);
    setPhase('intro');
    doc.body.append(overlay);

    return {
        overlay,
        close: closeAll,
        get closed() { return closed; },
        get phase() { return phase; },
        start,
        stop: () => runner?.stop('stopped by you'),
    };
}
