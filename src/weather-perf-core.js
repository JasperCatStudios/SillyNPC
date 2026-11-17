/**
 * The weather performance test, the rules (fork): which effects to try and how hard, when the test must stop by
 * itself, and how a run is summed up. Pure, so node can test it; the runner that draws the effects and reads the
 * frame clock is ui-weather-perf.js.
 *
 * Safety is the point of this file. A phone that is pushed too hard does not fail politely: the page freezes. So
 * every effect is tried in steps that start light and get heavier, a step only starts if the one before it ran well,
 * and the whole test stops by itself when the frame rate collapses, when frames stop arriving, or when the pause
 * between frames is long. A marker is also kept while a test runs, so if the page does crash the next visit
 * knows, and starts in safe mode.
 */

export const PERF_DEFAULTS = Object.freeze({
    stepSeconds: 4,                 // how long each step runs
    densities: [25, 60, 100],       // the density, in percent, of each step of one effect
    warmupSeconds: 0.6,             // frames in this time at the start of a step are not counted
    stopBelowFps: 8,                // stop the whole test when a step's average falls under this
    skipHeavierBelowFps: 24,        // do not go on to a heavier step of the same effect when this step averaged under this
    stallMs: 1500,                  // a single gap between frames this long stops the test
    maxHeapGrowthMb: 120,           // stop if the page's memory grew this much during the test (where the browser reports it)
});

/** The settings with every number in range. */
export function normalizePerfOptions(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = PERF_DEFAULTS;
    const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
    const dens = (Array.isArray(r.densities) ? r.densities : d.densities)
        .map(x => Math.round(num(x, 5, 100, 0))).filter(x => x > 0);
    return {
        stepSeconds: num(r.stepSeconds, 1, 30, d.stepSeconds),
        densities: [...new Set(dens.length ? dens : d.densities)].sort((a, b) => a - b),
        warmupSeconds: num(r.warmupSeconds, 0, 5, d.warmupSeconds),
        stopBelowFps: num(r.stopBelowFps, 1, 60, d.stopBelowFps),
        skipHeavierBelowFps: num(r.skipHeavierBelowFps, 1, 120, d.skipHeavierBelowFps),
        stallMs: num(r.stallMs, 200, 10000, d.stallMs),
        maxHeapGrowthMb: num(r.maxHeapGrowthMb, 10, 2000, d.maxHeapGrowthMb),
    };
}

/**
 * The steps of a run: every effect at every density, lightest first within an effect.
 * @param {string[]} kinds the effect names to try
 * @param {object} [options]
 * @returns {{ kind: string, density: number }[]}
 */
export function planSteps(kinds, options) {
    const o = normalizePerfOptions(options);
    const out = [];
    for (const kind of [...new Set((kinds || []).map(String).filter(Boolean))]) {
        for (const density of o.densities) out.push({ kind, density });
    }
    return out;
}

/** The numbers from one step's frame times (milliseconds between frames, in order). */
export function summarizeFrames(frameMs, { warmupMs = 0 } = {}) {
    const times = Array.isArray(frameMs) ? frameMs.filter(x => Number.isFinite(x) && x > 0) : [];
    // Drop the warm-up part from the front.
    let skipped = 0;
    let used = times;
    if (warmupMs > 0) {
        let sum = 0;
        let i = 0;
        while (i < times.length && sum < warmupMs) sum += times[i++];
        skipped = i;
        used = times.slice(i);
    }
    if (!used.length) return { frames: 0, skipped, avgFps: 0, lowFps: 0, worstMs: 0, slowShare: 0 };
    const total = used.reduce((a, b) => a + b, 0);
    const sorted = used.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const slow = used.filter(x => x > 33.4).length;          // slower than 30 fps
    return {
        frames: used.length,
        skipped,
        avgFps: Math.round((used.length / total) * 10000) / 10,
        lowFps: Math.round((1000 / p95) * 10) / 10,          // the frame rate of the slowest 5% of frames
        worstMs: Math.round(Math.max(...used)),
        slowShare: Math.round((slow / used.length) * 1000) / 10,
    };
}

/** The kind name of the first step of a run: an engine with nothing drawn, which says how many frames the page gets at all. */
export const BASELINE_KIND = 'baseline';

/** The steps of a results list that are effects (the baseline entry is not one). */
export function effectResults(results) {
    return (Array.isArray(results) ? results : []).filter(r => r && r.kind !== BASELINE_KIND);
}

/** The baseline frame rate found in a results list (0 when there is none, or it did not finish or has no frames). */
export function baselineFpsOf(results) {
    const b = (Array.isArray(results) ? results : []).find(r => r && r.kind === BASELINE_KIND && !r.partial && r.summary?.frames > 0);
    const fps = Number(b?.summary?.avgFps);
    return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

/** A step's average as a whole percentage of the baseline (null without a baseline). */
export function percentOfBaseline(summary, baselineFps) {
    if (!(baselineFps > 0) || !summary || !summary.frames) return null;
    return Math.round((summary.avgFps / baselineFps) * 100);
}

/**
 * A word for a step: good (smooth), fair (playable), poor, or no data. With a baseline (the frame rate of an engine
 * with nothing drawn) the step is judged against it; without one, against fixed numbers.
 */
export function verdictFor(summary, baselineFps = 0) {
    if (!summary || !summary.frames) return 'no data';
    if (baselineFps > 0) {
        if (summary.avgFps >= 0.92 * baselineFps && summary.lowFps >= 0.6 * baselineFps) return 'good';
        if (summary.avgFps >= 0.7 * baselineFps && summary.lowFps >= 0.35 * baselineFps) return 'fair';
        return 'poor';
    }
    if (summary.avgFps >= 50 && summary.lowFps >= 30) return 'good';
    if (summary.avgFps >= 30 && summary.lowFps >= 18) return 'fair';
    return 'poor';
}

/** Plain sentences about a low or capped baseline, for the report and the results screen (empty list when it is fine). */
export function baselineNotes(baselineFps) {
    const out = [];
    const capped30 = baselineFps >= 28 && baselineFps <= 31;
    if (!(baselineFps > 0) || (baselineFps >= 24 && !capped30)) return out;
    out.push(`The page only gets ${Math.round(baselineFps)} frames per second here even with nothing drawn, so look at the effect-to-baseline numbers, not the raw fps.`);
    if (capped30) {
        out.push('A baseline of 30 usually means the browser or display is limited to 30 frames per second (a 30 Hz display mode, battery saver, or a browser setting). Effects will look smooth at that speed.');
    }
    return out;
}

/**
 * Whether the test must stop right now, from what is known so far. Called on every frame and at the end of each step.
 *
 * @param {{ gapMs?: number, stepAvgFps?: number|null, heapGrowthMb?: number|null }} s
 * @returns {{ stop: boolean, reason: string }}
 */
export function shouldStop(s, options) {
    const o = normalizePerfOptions(options);
    if (Number.isFinite(s?.gapMs) && s.gapMs >= o.stallMs) return { stop: true, reason: `the page stalled for ${Math.round(s.gapMs)} ms` };
    if (Number.isFinite(s?.stepAvgFps) && s.stepAvgFps > 0 && s.stepAvgFps < o.stopBelowFps) {
        return { stop: true, reason: `the frame rate fell to ${Math.round(s.stepAvgFps)} per second` };
    }
    if (Number.isFinite(s?.stepAvgFps) && s.stepAvgFps > 0 && s.baselineFps > 0 && s.stepAvgFps < 0.25 * s.baselineFps) {
        return { stop: true, reason: `the frame rate fell to ${Math.round(s.stepAvgFps)} per second, under a quarter of the ${Math.round(s.baselineFps)} the page gets with nothing drawn` };
    }
    if (Number.isFinite(s?.heapGrowthMb) && s.heapGrowthMb > o.maxHeapGrowthMb) return { stop: true, reason: `memory grew by ${Math.round(s.heapGrowthMb)} MB` };
    return { stop: false, reason: '' };
}

/** Whether to try the next, heavier step of the same effect after this one. */
export function goHeavier(summary, options, baselineFps = 0) {
    const o = normalizePerfOptions(options);
    if (!summary || !(summary.frames > 0)) return false;
    if (baselineFps > 0) return summary.avgFps >= 0.7 * baselineFps;
    return summary.avgFps >= o.skipHeavierBelowFps;
}

/** The marker kept while a test runs. If it is still there on the next visit, the last test did not finish. */
export function startMarker(step, now = Date.now()) {
    return JSON.stringify({ at: now, kind: step?.kind || '', density: step?.density || 0 });
}

/** Reads a leftover marker: null when there is none (or it is unreadable), else what the last test was doing. */
export function readMarker(raw) {
    if (!raw) return null;
    try {
        const m = JSON.parse(String(raw));
        if (!m || typeof m !== 'object') return null;
        return { at: Number(m.at) || 0, kind: String(m.kind || ''), density: Number(m.density) || 0 };
    } catch { return null; }
}

/**
 * What a crashed test leaves behind for the next one: the effect and density that failed, and a lower density cap
 * so the next run starts below it. The cap is half the failing density, never below 10.
 */
export function safeModeFrom(marker) {
    if (!marker) return null;
    return { kind: marker.kind, failedAt: marker.density, cap: Math.max(10, Math.floor((marker.density || 20) / 2)) };
}

/** A plain-text report of a finished or stopped run, for the screen and for copying. */
export function reportText(results, { stoppedBecause = '', device = '' } = {}) {
    const lines = ['Weather performance test'];
    if (device) lines.push(device);
    lines.push('');
    const base = baselineFpsOf(results);
    if (base > 0) {
        lines.push(`Baseline (nothing drawn): ${Math.round(base)} fps. This device delivers at most this many frames per second to the page, so each effect is judged against it.`);
        for (const note of baselineNotes(base)) lines.push(note);
        lines.push('');
    }
    for (const r of effectResults(results)) {
        const s = r.summary;
        const pct = percentOfBaseline(s, base);
        const rel = pct === null ? '' : `, ${pct}% of baseline`;
        lines.push(`${r.kind} at ${r.density}%: ${s.frames ? `${s.avgFps} fps average${rel}, ${s.lowFps} fps lowest 5%, worst frame ${s.worstMs} ms, ${s.slowShare}% slow - ${verdictFor(s, base)}` : 'no frames'}`);
    }
    if (stoppedBecause) { lines.push(''); lines.push(`Stopped early: ${stoppedBecause}.`); }
    return lines.join('\n');
}

/**
 * The highest density that stayed smooth for each effect, for a recommendation line.
 * @returns {Record<string, number>} effect -> density (0 when even the lightest step was poor)
 */
export function bestDensities(results) {
    const best = {};
    const base = baselineFpsOf(results);
    for (const r of effectResults(results)) {
        if (!(r.kind in best)) best[r.kind] = 0;
        if (verdictFor(r.summary, base) !== 'poor' && r.summary?.frames) best[r.kind] = Math.max(best[r.kind], r.density);
    }
    return best;
}
