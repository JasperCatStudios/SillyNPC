import { createSession, beginNext, stepSession, sessionResult, skipStep, describeSession } from '../../../../src/mech/session-core.js';
import { mechanicOf } from '../../../../src/mech/registry.js';
import { toStage } from '../../../../src/mech/input.js';
import { normalizeActionKey } from '../../../../src/activity-config-core.js';
import { sfx, activitySettings, saveActivitySettings } from '../../activities-runtime.js';
import { VIEWS } from './views.js';
import { CRAFT_VIEWS } from './craft-views.js';

/**
 * The step runner for crafts (fork): plays a recipe's script of hands-on steps (draw, stamp, ...) inside a craft's `mech` stage and
 * hands the result back. It is the generic part of what the kitchen does: it turns pointer, key and button events into the input frame
 * the rules in src/mech read, draws the step with its view, keeps the flow meter, a pause, and the choice between playing with the
 * pointer or with the action button. It knows no world: every word comes from the step's data.
 *
 * (The kitchen keeps its own screen for now, because the searing step needs a knob and a flip key this runner does not have.)
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** What the big button says in action-button play, by mechanic; a step's own `words.action` wins. */
const BUTTON_WORD = { trace: 'Draw (hold)', stamp: 'Stamp', stir: 'Stir', slice: 'Chop', pour: 'Pour (hold)', plate: 'Stop the marker', tune: 'Nudge', assemble: 'Stop the marker' };
/** Mechanics that end by a "Done" button as well as by themselves. */
const DONE_BUTTON = new Set(['sprinkle', 'pour', 'plate', 'assemble']);

/** The sound for an event of a step (a tag from the sound map; an unknown one is silent). */
function soundFor(e) {
    const grade = e.grade === 'perfect' ? 'activity_mech_perfect' : e.grade === 'good' ? 'activity_mech_good' : e.grade === 'miss' ? 'activity_mech_miss' : '';
    if (e.type === 'stroke-done' || e.type === 'lock') return grade;
    // The seal also has its own thud, played on top (see the loop below).
    if (e.type === 'stamp') return 'activity_mech_plate_place';
    if (e.type === 'start') return 'activity_mech_trace_brush';
    if (e.type === 'place') return 'activity_mech_plate_place';
    return ({
        stray: 'activity_mech_miss', blot: 'activity_mech_slice_guard', dry: 'activity_mech_sear_warn', dip: 'activity_potion_pour',
        slip: 'activity_mech_miss', surge: 'activity_mech_sear_warn', 'step-done': 'activity_mech_step_done', 'flow-up': 'activity_mech_flow_up', ruin: 'activity_mech_ruin_comic',
    })[e.type] || '';
}

const POPUP = { perfect: 'Perfect!', good: 'Nice', miss: 'Oops', stray: 'Off the line!', blot: 'Blot!', dry: 'Dry brush!', dip: 'Dipped', slip: 'Slipped!', surge: 'Surge!', lock: 'Locked in' };

/**
 * @param {{ win: object, container: HTMLElement, script: object, ctx: { tier: number, scale: number, assist: boolean },
 *   partner?: string, speak?: Function, alive: () => boolean, onDone: (result: object) => void }} opts
 * @returns {{ stop: () => void }}
 */
export function runMechSteps(opts) {
    const { win, container, script, partner, speak = () => {}, alive: outerAlive, onDone } = opts;
    const settings = activitySettings();
    const rng = Math.random;
    const controlsFor = (mech) => (settings.controls === 'pointer' || settings.controls === 'button' ? settings.controls : (settings.mechControls?.[mech] === 'button' ? 'button' : 'pointer'));
    let controls = 'pointer';
    const session = createSession(script, { tier: opts.ctx.tier, scale: opts.ctx.scale, assist: opts.ctx.assist, controls });
    let finished = false;
    let raf = 0;
    let last = 0;
    let paused = false;
    let autoPaused = false;
    let view = null;
    const cleanups = [];
    const alive = () => outerAlive() && !finished;
    const stop = () => { finished = true; cancelAnimationFrame(raf); while (cleanups.length) { try { cleanups.pop()(); } catch { /* gone */ } } };

    const wrap = el('div', 'snpc-act-kitchen');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    container.replaceChildren(wrap);

    const top = el('div');
    top.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px;';
    const title = el('strong', '', '');
    const flowBar = el('div');
    flowBar.style.cssText = 'flex:0 0 40%; height:10px; border:1px solid #a4947d; border-radius:6px; overflow:hidden;';
    flowBar.setAttribute('role', 'img');
    const flowFill = el('div');
    flowFill.style.cssText = 'height:100%; width:0; background:linear-gradient(90deg,#e69138,#f1c232); transition:width 0.15s;';
    flowBar.append(flowFill);
    top.append(title, flowBar);
    const hint = el('p', 'snpc-act-note is-small snpc-kit-hint', '');
    const stage = el('div', 'snpc-act-stage');
    stage.style.cssText = 'position:relative; width:min(100%, calc(34dvh * 1.6)); margin:0 auto; aspect-ratio:16/10; background:#23262b; border-radius:12px; overflow:hidden; touch-action:none; user-select:none; -webkit-user-select:none;';
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const bar = el('div');
    bar.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    const actions = el('div', 'snpc-act-row');
    actions.style.cssText = 'flex-wrap:nowrap; gap:8px; align-items:stretch;';
    const extras = el('div', 'snpc-act-row');
    extras.style.cssText = 'flex-wrap:nowrap; gap:8px;';
    bar.append(actions, extras);
    const popup = el('div');
    popup.style.cssText = 'position:absolute; left:0; right:0; top:8%; text-align:center; font-size:22px; font-weight:bold; color:#fff; text-shadow:0 2px 4px #000; pointer-events:none; opacity:0; transition:opacity 0.3s;';
    wrap.append(top, hint, stage, status, bar);

    let popTimer = 0;
    const say = (text) => {
        popup.textContent = text;
        popup.style.opacity = '1';
        clearTimeout(popTimer);
        popTimer = setTimeout(() => { popup.style.opacity = '0'; }, 650);
    };

    /* ------------------------------------------------------------------ input */

    const inp = { down: false, path: [], held: false, presses: [], pick: null };
    const clockNow = () => (session.run ? session.run.t + (performance.now() - last) : 0);
    const bound = normalizeActionKey(settings.actionKey);
    const mouseBound = bound.startsWith('Mouse');
    const typing = (t) => { const tag = (t?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable === true; };

    /** Turns the pointer events of a surface into the stage's own coordinates (0 to 1 across and down the stage). */
    const attachPointer = (node, xyOf) => {
        node.addEventListener('pointerdown', (e) => {
            if (session.phase !== 'play' || controls === 'button' || paused) return;
            const [x, y] = xyOf(e);
            node.setPointerCapture?.(e.pointerId);
            inp.down = true;
            inp.path.push([clockNow(), x, y]);
        });
        node.addEventListener('pointermove', (e) => {
            if (session.phase !== 'play' || controls === 'button' || !inp.down || paused) return;
            for (const ev of (e.getCoalescedEvents?.() || [e])) {
                const [x, y] = xyOf(ev);
                inp.path.push([clockNow(), x, y]);
            }
        });
        for (const type of ['pointerup', 'pointercancel']) node.addEventListener(type, () => { inp.down = false; });
    };
    attachPointer(stage, (e) => toStage(e.clientX, e.clientY, stage.getBoundingClientRect()));

    /*
     * Tune on a touch screen: the ring is moved by how far you drag, so the finger does not have to be on it, but dragging on the
     * stage still puts the finger over the ring and the target, which are small there. A pad below the stage takes the drag instead.
     * Its pixels are scaled by the stage's size, so a drag moves the ring exactly as far as the same drag on the stage would.
     */
    let pad = null;
    const dropPad = () => { pad?.remove(); pad = null; };
    const touchScreen = () => Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    const addPad = () => {
        dropPad();
        pad = el('div', 'snpc-act-dragpad');
        pad.setAttribute('role', 'application');
        pad.setAttribute('aria-label', 'Drag here to move the ring');
        pad.style.cssText = 'position:relative; width:min(100%, calc(34dvh * 1.6)); height:max(96px, 16dvh); margin:6px auto 0; border:2px dashed #a4947d; border-radius:12px; background:rgba(164,148,125,0.12); display:flex; align-items:center; justify-content:center; text-align:center; color:#a4947d; font-size:14px; touch-action:none; user-select:none; -webkit-user-select:none;';
        pad.append(el('span', '', 'Drag here: the ring follows your finger, so the target stays in view'));
        pad.firstChild.style.pointerEvents = 'none';
        attachPointer(pad, (e) => {
            const r = pad.getBoundingClientRect();
            const sr = stage.getBoundingClientRect();
            return [(e.clientX - r.left) / Math.max(1, sr.width), (e.clientY - r.top) / Math.max(1, sr.height)];
        });
        stage.after(pad);
    };

    const keyHandler = (e) => {
        if (!stage.isConnected || !win.isOpen() || typing(e.target) || e.repeat) return;
        if (e.code !== 'Space' && (mouseBound || e.code !== bound)) return;
        e.preventDefault();
        if (e.type === 'keydown') { inp.held = true; inp.presses.push(clockNow()); } else inp.held = false;
    };
    document.addEventListener('keydown', keyHandler);
    document.addEventListener('keyup', keyHandler);
    cleanups.push(() => { document.removeEventListener('keydown', keyHandler); document.removeEventListener('keyup', keyHandler); });

    /** The frame the rules read, from what happened since the last one. */
    const buildFrame = () => {
        const frame = {
            held: inp.held, presses: inp.presses.splice(0), pointer: { down: inp.down, x: 0.5, y: 0.5, path: inp.path.splice(0) }, pick: inp.pick, controls,
        };
        inp.pick = null;
        if (frame.pointer.path.length) { const l = frame.pointer.path[frame.pointer.path.length - 1]; frame.pointer.x = l[1]; frame.pointer.y = l[2]; }
        return frame;
    };

    /* ------------------------------------------------------------------ steps */

    function showIntro() {
        cancelAnimationFrame(raf);
        dropPad();
        stage.replaceChildren();
        actions.replaceChildren();
        extras.replaceChildren();
        const step = session.script.steps[session.index + 1];
        if (!step) { finish(); return; }
        title.textContent = `Step ${session.index + 2} of ${session.script.steps.length}`;
        flowFill.style.width = `${Math.round(session.flow * 100)}%`;
        hint.textContent = '';
        const card = el('div');
        card.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:16px; color:#fff;';
        card.append(el('h3', '', step.words.title || step.id), el('p', '', step.words.hint || ''));
        const go = el('button', 'snpc-act-btn', 'Go!');
        go.type = 'button';
        // A short pause before it can be pressed, so a last tap of the step before does not start the next one by accident.
        go.disabled = true;
        setTimeout(() => { go.disabled = false; }, 600);
        go.addEventListener('click', () => start());
        card.append(go);
        stage.append(card);
        go.focus();
        controls = controlsFor(step.mech);
        extras.append(toggleControls(step.mech));
    }

    let overlay = null;
    let pauseBtn = null;
    function setPaused(on, auto = false) {
        if (paused === on || session.phase !== 'play') return;
        paused = on;
        autoPaused = on && auto;
        inp.held = false;
        inp.down = false;
        inp.path = [];
        if (on) {
            overlay = el('div');
            overlay.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; background:#000a; color:#fff; text-align:center; z-index:3;';
            overlay.append(el('h3', '', 'Paused'), el('p', '', partner ? `Take your time. Talk to ${partner}, then press Resume.` : 'Take your time, then press Resume.'));
            const resume = el('button', 'snpc-act-btn', 'Resume');
            resume.type = 'button';
            resume.addEventListener('click', () => setPaused(false));
            overlay.append(resume);
            stage.append(overlay);
            resume.focus();
        } else { overlay?.remove(); overlay = null; last = performance.now(); }
        if (pauseBtn) pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    }
    function pauseButton() {
        pauseBtn = el('button', 'snpc-act-btn is-quiet', 'Pause');
        pauseBtn.type = 'button';
        pauseBtn.title = 'Stop the clock to chat with your partner';
        pauseBtn.addEventListener('click', () => setPaused(!paused));
        return pauseBtn;
    }
    const onFocusIn = (e) => { if (typing(e.target)) setPaused(true, true); };
    const onFocusOut = (e) => { if (autoPaused && typing(e.target)) setPaused(false); };
    win.root.addEventListener('focusin', onFocusIn);
    win.root.addEventListener('focusout', onFocusOut);
    cleanups.push(() => { win.root.removeEventListener('focusin', onFocusIn); win.root.removeEventListener('focusout', onFocusOut); });

    function toggleControls(mech, restart = false) {
        const b = el('button', 'snpc-act-btn is-quiet', controls === 'button' ? 'Play with the pointer' : 'Use action button');
        b.type = 'button';
        b.addEventListener('click', () => {
            controls = controls === 'button' ? 'pointer' : 'button';
            settings.mechControls = { ...(settings.mechControls || {}), [mech]: controls };
            saveActivitySettings();
            b.textContent = controls === 'button' ? 'Play with the pointer' : 'Use action button';
            // In the middle of a step the step starts again the new way (the flow you have built stays).
            if (restart && session.phase === 'play') { cancelAnimationFrame(raf); session.index -= 1; session.phase = 'between'; start(); }
        });
        return b;
    }

    function start() {
        controls = controlsFor(session.script.steps[session.index + 1]?.mech);
        session.ctx.controls = controls;
        beginNext(session, rng);
        paused = false;
        autoPaused = false;
        const step = session.step;
        stage.replaceChildren();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 160 100');
        svg.setAttribute('width', '100%');
        svg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', step.words.title || step.id);
        stage.append(svg, popup);
        const make = CRAFT_VIEWS[step.mech] || VIEWS[step.mech];
        view = make ? make(svg, step) : null;
        title.textContent = `${session.index + 1} of ${session.script.steps.length}: ${step.words.title || step.id}`;
        // In action-button play a step may say how to play that way (`words.hintButton`).
        hint.textContent = (controls === 'button' && step.words.hintButton) || step.words.hint || '';
        dropPad();
        if (step.mech === 'tune' && controls === 'pointer' && touchScreen()) {
            addPad();
            hint.textContent = `${hint.textContent} Drag in the box under the picture: the ring moves with your finger and the target stays in view.`.trim();
        }
        // The grace at the start of a step ignores input for a moment: say so, so a press right after Go is not thought lost.
        status.textContent = 'Ready...';
        setTimeout(() => { if (status.textContent === 'Ready...') status.textContent = ''; }, 850);
        actions.replaceChildren();
        extras.replaceChildren();
        const mech = step.mech;
        if (DONE_BUTTON.has(mech)) { const done = el('button', 'snpc-act-btn', 'Done'); done.type = 'button'; done.addEventListener('click', () => { inp.pick = 'done'; }); actions.append(done); }
        if (controls === 'button') {
            const big = el('button', 'snpc-act-bigtap', step.words.action || BUTTON_WORD[mech] || 'Go');
            big.type = 'button';
            big.style.cssText = 'flex:1 1 auto; width:auto; margin:0;';
            big.addEventListener('pointerdown', (e) => { e.preventDefault(); inp.held = true; inp.presses.push(clockNow()); });
            for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) big.addEventListener(ev, () => { inp.held = false; });
            actions.append(big);
            // Only a step that has ink has a well to dip in.
            if (mech === 'trace' && session.run?.inkOn) { const dip = el('button', 'snpc-act-btn', 'Dip ink'); dip.type = 'button'; dip.style.flex = '0 0 auto'; dip.addEventListener('click', () => { inp.pick = 'dip'; }); actions.append(dip); }
        }
        extras.append(toggleControls(mech, true), pauseButton());
        if (step.optional) { const skip = el('button', 'snpc-act-btn is-quiet', 'Skip'); skip.type = 'button'; skip.addEventListener('click', () => { if (skipStep(session)) afterStep(); }); extras.append(skip); }
        speak('start');
        last = performance.now();
        raf = requestAnimationFrame(frameLoop);
    }

    function frameLoop(now) {
        if (!alive()) return;
        if (paused) { last = now; raf = requestAnimationFrame(frameLoop); return; }
        const dt = Math.min(100, now - last);
        last = now;
        stepSession(session, dt, buildFrame(), rng);
        const run = session.run;
        const core = mechanicOf(session.step.mech);
        if (run && view) view.update(core.view(run), dt);
        flowFill.style.width = `${Math.round(session.flow * 100)}%`;
        flowBar.setAttribute('aria-label', `Flow ${Math.round(session.flow * 100)} percent`);
        for (const e of session.events) {
            const snd = soundFor(e);
            if (snd) sfx(snd);
            if (e.type === 'stamp') sfx('activity_mech_stamp_thud');
            const word = e.grade ? POPUP[e.grade] : POPUP[e.type];
            if (word && e.type !== 'step-done') say(word);
            if (e.type === 'stray' || e.type === 'blot' || e.type === 'dry') speak('moment', '', '', describeSession(session));
        }
        if (session.phase === 'between') { afterStep(); return; }
        raf = requestAnimationFrame(frameLoop);
    }

    function afterStep() {
        cancelAnimationFrame(raf);
        const r = session.results[session.results.length - 1];
        const word = r?.skipped ? 'Skipped.' : `${r.ruined ? 'Ruined' : r.performance >= 0.9 ? 'Perfect' : r.performance >= 0.7 ? 'Good' : r.performance >= 0.4 ? 'Fair' : 'Poor'}: ${session.script.steps.find(s => s.id === r.id)?.words.title || r.id}`;
        status.textContent = word;
        speak('moment', '', '', describeSession(session));
        setTimeout(() => { if (alive()) showIntro(); }, 1100);
    }

    function finish() {
        if (finished) return;
        const result = sessionResult(session);
        stop();
        onDone(result);
    }

    showIntro();
    return { stop };
}
