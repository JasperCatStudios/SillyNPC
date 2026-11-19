import { scriptFor } from '../../../../src/mech/script-core.js';
import { createSession, beginNext, stepSession, sessionResult, gradeOfP, skipStep, describeSession } from '../../../../src/mech/session-core.js';
import { mechanicOf } from '../../../../src/mech/registry.js';
import { flickUp, inRect, knobValue, toStage } from '../../../../src/mech/input.js';
import { difficultyScale } from '../../../../src/craft/craft-core.js';
import { cookRewardsForGrade, recipeLevel } from '../../../../src/activity-harvest-core.js';
import { normalizeActionKey, actionKeyLabel } from '../../../../src/activity-config-core.js';
import { settleActivity, sfx, startMusic, stopMusic, activitySettings, saveActivitySettings } from '../../activities-runtime.js';
import { talker } from '../harvest-ui.js';
import { VIEWS, dishDrawing, paintBench } from './views.js';

/**
 * The hands-on kitchen (fork): plays a recipe's script of steps (chop, stir, sear, season...) on a plain-shape stage.
 *
 * Every step works two ways, and scores about the same in both: with the pointer (mouse or touch: swipe, circle, drag a knob, shake)
 * or with the action button (the action key, Space, or the big on-screen button). The rules are in src/mech (pure, tested with
 * simulated players); this file draws the state and turns pointer and key events into the input frame the rules read.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor', failed: 'Failed' };
const KNOB_ZONE = { x0: 0.88, y0: 0.15, x1: 1, y1: 0.85 };
const LOOPS = { stir: 'activity_mech_stir_loop', sear: 'activity_mech_sear_sizzle', pour: 'activity_mech_pour_loop' };

/** The sound for an event of a step. */
function soundFor(e) {
    if (e.type === 'place') return 'activity_mech_plate_place';
    if (e.type === 'done' && e.mech === 'plate') return 'activity_mech_plate_present';
    if (e.type === 'cut' || e.type === 'land' || e.type === 'pour') return e.grade === 'perfect' ? 'activity_mech_perfect' : e.grade === 'good' ? 'activity_mech_good' : 'activity_mech_miss';
    return ({
        guard: 'activity_mech_slice_guard', splash: 'activity_mech_stir_splash', scorch: 'activity_mech_sear_warn', smoke: 'activity_mech_sear_warn',
        silky: 'activity_mech_good', flip: 'activity_mech_sear_flip', burnt: 'activity_mech_ruin_comic', ruin: 'activity_mech_ruin_comic', shake: 'activity_mech_sprinkle_shake',
        even: 'activity_mech_streak', bullseye: 'activity_mech_streak', spill: 'activity_mech_pour_spill', 'step-done': 'activity_mech_step_done', 'flow-up': 'activity_mech_flow_up', half: 'activity_mech_miss', stray: '',
    })[e.type] || '';
}

/** Words shown for an event. */
const POPUP = { perfect: 'Perfect!', good: 'Nice', miss: 'Oops', guard: 'Careful!', splash: 'Splash!', silky: 'Silky', flip: 'Flip!', burnt: 'Burnt!', even: 'Even!', bullseye: 'Just right!', spill: 'Spilled!', scorch: 'Catching!', smoke: 'Smoking!' };

/**
 * @param {object} win the activity window
 * @param {{ partner: string, activityId?: string, label: string, recipe: object, difficulty: string, assist: boolean, tier: number,
 *   pack: object[] | null, prefs?: object, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runKitchen(win, ctx) {
    const { partner, recipe, difficulty, assist, tier, pack, prefs, onLeave, onAgain } = ctx;
    const label = ctx.label || 'Cooking';
    const script = scriptFor(recipe);
    const level = recipeLevel(recipe);
    const shift = difficulty === 'easy' ? 1 : difficulty === 'hard' ? -1 : 0;
    const effTier = Math.min(4, Math.max(0, (Number(tier) || 0) + shift));
    const settings = activitySettings();
    /** How a step is played: a forced choice in the settings, else what you last chose for that kind of step, else the pointer. */
    const controlsFor = (mech) => (settings.controls === 'pointer' || settings.controls === 'button' ? settings.controls : (settings.mechControls?.[mech] === 'button' ? 'button' : 'pointer'));
    let controls = 'pointer';
    const rng = Math.random;
    let session = createSession(script, { tier: effTier, scale: difficultyScale(level, effTier), assist, controls });
    let finished = false;
    let raf = 0;
    let last = 0;
    const cleanups = [];
    const alive = () => win.isOpen() && !finished;
    const stop = () => { cancelAnimationFrame(raf); stopMusic(); while (cleanups.length) { try { cleanups.pop()(); } catch { /* gone */ } } };

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-utensils');
    win.setHelp([
        { title: 'The goal', text: `Cook ${recipe.name}. It is a few steps, each a little game: ${script.steps.map(s => s.words?.title || s.id).join(', ')}.` },
        { title: 'Your action key', text: `The action key is ${actionKeyLabel(settings.actionKey)} (Space works too). It is the button for action-button play: press or hold it where a step says so. You can change it in the Activities settings.` },
        { title: 'Flipping the fish', text: `Press ${actionKeyLabel(settings.flipKey)} (the second action key), or the Flip button under the stage, to flip the fish. On the second side the same press serves it. Tapping the action key only keeps the heat up, so you can pulse it without flipping by mistake.` },
        { title: 'Two ways to play', text: 'With a mouse or finger you swipe, circle, drag and shake. If you prefer to use the action button, press "Use action button" under the stage: every step has an action-button version that scores about the same. The action key and Space work too.' },
        { title: 'Pouring and plating', text: 'Pouring: press and drag DOWN to tip the jug, further for a faster pour, and let go to stop. It keeps pouring a moment after you stop, so let go early. With the action button, hold it to pour. Plating: press, drag each item to its faint spot and let go. With the action button a marker sweeps the plate: press once to stop it across, once more to stop it down.' },
        { title: 'Pause', text: 'Press Pause to stop the clock while you talk to your partner. Typing in the chat pauses the game by itself, and it carries on when you leave the box.' },
        { title: 'Flow', text: 'Good moves in a row fill the flow bar. A full bar gives your dish a small bonus. A miss costs some of it.' },
        { title: 'Mistakes', text: 'Nothing here is dangerous. A careless swipe makes a comic "Careful!", a burnt side just makes a mess, and the dish still counts for what you did.' },
    ]);
    const speak = talker(win, partner, label, () => describeSession(session));
    win.onSay((text) => { speak('chat', text); });

    const wrap = el('div', 'snpc-act-kitchen');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    win.main.replaceChildren(wrap);

    /* ------------------------------------------------------------------ the frame around a step */

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
    const hint = el('p', 'snpc-act-note is-small', '');
    const stage = el('div', 'snpc-act-stage');
    stage.style.cssText = 'position:relative; width:100%; aspect-ratio:16/10; background:#23262b; border-radius:12px; overflow:hidden; touch-action:none; user-select:none;';
    paintBench(stage);
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const bar = el('div', 'snpc-act-row');
    bar.style.cssText = 'flex-wrap:wrap; gap:8px;';
    const popup = el('div');
    popup.style.cssText = 'position:absolute; left:0; right:0; top:8%; text-align:center; font-size:22px; font-weight:bold; color:#fff; text-shadow:0 2px 4px #000; pointer-events:none; opacity:0; transition:opacity 0.2s;';
    wrap.append(top, hint, stage, status, bar);

    let popTimer = 0;
    const say = (text) => {
        popup.textContent = text;
        popup.style.opacity = '1';
        clearTimeout(popTimer);
        popTimer = setTimeout(() => { popup.style.opacity = '0'; }, 650);
    };

    /* ------------------------------------------------------------------ input */

    const inp = { down: false, path: [], hist: [], downAt: 0, travel: 0, held: false, presses: [], pick: null, knob: 0.5, knobActive: false, lastShake: 0 };
    let paused = false;
    let autoPaused = false;
    const flying = () => Boolean(session.run?.fillets?.some(f => f.flight));
    const clockNow = () => (session.run ? session.run.t + (performance.now() - last) : 0);
    const bound = normalizeActionKey(settings.actionKey);
    const mouseBound = bound.startsWith('Mouse');
    const typing = (t) => { const tag = (t?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable === true; };

    const onDown = (e) => {
        if (session.phase !== 'play' || controls === 'button') return;
        const [x, y] = toStage(e.clientX, e.clientY, stage.getBoundingClientRect());
        stage.setPointerCapture?.(e.pointerId);
        if (session.step.mech === 'sear' && inRect(x, y, KNOB_ZONE)) { inp.knobActive = true; inp.knob = knobValue(y, { top: 0.18, bottom: 0.82 }); return; }
        if (session.step.mech === 'plate') sfx('activity_mech_plate_pick');
        inp.down = true;
        inp.hist = [[performance.now(), x, y]];
        inp.downAt = performance.now();
        inp.travel = 0;
        inp.path.push([clockNow(), x, y]);
    };
    const onMove = (e) => {
        if (session.phase !== 'play' || controls === 'button') return;
        const events = e.getCoalescedEvents?.() || [e];
        const box = stage.getBoundingClientRect();
        for (const ev of events) {
            const [x, y] = toStage(ev.clientX, ev.clientY, box);
            if (inp.knobActive) inp.knob = knobValue(y, { top: 0.18, bottom: 0.82 });
            else if (inp.down) {
                inp.path.push([clockNow(), x, y]);
                const prev = inp.hist[inp.hist.length - 1];
                if (prev) inp.travel += Math.hypot((x - prev[1]) * 1.6, y - prev[2]);
                inp.hist.push([performance.now(), x, y]);
                while (inp.hist.length > 2 && performance.now() - inp.hist[0][0] > 300) inp.hist.shift();
            }
        }
    };
    const onUp = (e) => {
        if (inp.knobActive) { inp.knobActive = false; return; }
        if (!inp.down) return;
        // Sear with the pointer: a quick flick up OR a simple tap flips the fish; a tap while it is in the air catches it.
        if (session.step?.mech === 'sear' && controls === 'pointer') {
            const tap = inp.travel < 0.03 && performance.now() - inp.downAt < 400;
            if (flying()) { if (tap) inp.presses.push(clockNow()); } else if (tap || flickUp(inp.hist.map(p => [p[0], p[1], p[2]]))) inp.pick = 'flip';
        }
        inp.down = false;
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

    const flipKey = (e) => { if (e.code === normalizeActionKey(settings.flipKey, 'KeyF') && e.type === 'keydown' && !e.repeat && session.step?.mech === 'sear' && !typing(e.target)) { e.preventDefault(); if (!flying()) inp.pick = 'flip'; } };
    const flipMouse = (e) => { if (`Mouse${e.button}` === normalizeActionKey(settings.flipKey, 'KeyF') && session.step?.mech === 'sear' && !typing(e.target) && win.root.contains(e.target)) { e.preventDefault(); if (!flying()) inp.pick = 'flip'; } };
    document.addEventListener('keydown', flipKey);
    document.addEventListener('mousedown', flipMouse);
    cleanups.push(() => { document.removeEventListener('keydown', flipKey); document.removeEventListener('mousedown', flipMouse); });
    const keyHandler = (e) => {
        if (!stage.isConnected) return;
        if (!win.isOpen() || typing(e.target) || e.repeat) return;
        if (e.code !== 'Space' && (mouseBound || e.code !== bound)) return;
        e.preventDefault();
        if (e.type === 'keydown') { inp.held = true; inp.presses.push(clockNow()); } else inp.held = false;
    };
    document.addEventListener('keydown', keyHandler);
    document.addEventListener('keyup', keyHandler);
    cleanups.push(() => { document.removeEventListener('keydown', keyHandler); document.removeEventListener('keyup', keyHandler); });

    /** The frame the rules read, built from what happened since the last one. */
    const buildFrame = () => {
        const frame = {
            held: inp.held, presses: inp.presses.splice(0), pointer: { down: inp.down, x: 0.5, y: 0.5, path: inp.path.splice(0) }, pick: inp.pick, knob: inp.knobActive || session.step?.mech === 'sear' ? inp.knob : undefined, controls,
        };
        if (inp.pick) inp.pick = null;
        if (frame.pointer.path.length) { const l = frame.pointer.path[frame.pointer.path.length - 1]; frame.pointer.x = l[1]; frame.pointer.y = l[2]; }
        return frame;
    };

    /* ------------------------------------------------------------------ steps */

    let view = null;
    let lastLoop = '';

    function showIntro() {
        cancelAnimationFrame(raf);
        stopMusic();
        stage.replaceChildren();
        bar.replaceChildren();
        const step = session.script.steps[session.index + 1];
        if (!step) { settle(); return; }
        title.textContent = `Step ${session.index + 2} of ${session.script.steps.length}`;
        flowFill.style.width = `${Math.round(session.flow * 100)}%`;
        hint.textContent = '';
        const card = el('div');
        card.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; padding:16px; color:#fff;';
        card.append(el('h3', '', step.words.title || step.id), el('p', '', step.words.hint || ''));
        const go = el('button', 'snpc-act-btn', 'Go!');
        go.type = 'button';
        go.addEventListener('click', () => start());
        card.append(go);
        stage.append(card);
        go.focus();
        const nextMech = step.mech;
        controls = controlsFor(nextMech);
        bar.append(toggleControls(nextMech));
    }

    /** Pause: the clock stops (nothing scores, nothing runs out) so you can talk to your partner. Typing in the chat pauses by itself. */
    let overlay = null;
    let pauseBtn = null;
    function setPaused(on, auto = false) {
        if (paused === on || session.phase !== 'play') return;
        paused = on;
        autoPaused = on && auto;
        inp.held = false;
        inp.down = false;
        inp.path = [];
        stopMusic();
        lastLoop = '';
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
    // Typing in the window's chat pauses the game while the cursor is in the box.
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
            // Remembered for this kind of step (unless the settings force one way for everything).
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
        view = VIEWS[step.mech](svg, step);
        title.textContent = `${session.index + 1} of ${session.script.steps.length}: ${step.words.title || step.id}`;
        hint.textContent = step.words.hint || '';
        bar.replaceChildren();
        // Controls for this step.
        const mech = step.mech;
        if (mech === 'sear') { const flipBtn = el('button', 'snpc-act-btn', 'Flip'); flipBtn.type = 'button'; flipBtn.title = 'Or tap the fish, or flick it up. On the last side it serves the fish.'; flipBtn.addEventListener('click', () => { if (!flying()) inp.pick = 'flip'; }); bar.append(flipBtn); }
        if (mech === 'sear') { const plate = el('button', 'snpc-act-btn', 'Plate it'); plate.type = 'button'; plate.addEventListener('click', () => { inp.pick = 'plate'; }); bar.append(plate); }
        if (mech === 'sprinkle' || mech === 'pour' || mech === 'plate') { const done = el('button', 'snpc-act-btn', 'Done'); done.type = 'button'; done.addEventListener('click', () => { inp.pick = 'done'; }); bar.append(done); }
        if (controls === 'button') {
            const big = el('button', 'snpc-act-bigtap', ({ slice: 'Chop', stir: 'Stir', sear: 'Heat', pour: 'Pour (hold)', plate: 'Stop the marker' })[mech] || 'Shake');
            big.type = 'button';
            big.addEventListener('pointerdown', (e) => { e.preventDefault(); inp.held = true; inp.presses.push(clockNow()); });
            for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) big.addEventListener(ev, () => { inp.held = false; });
            bar.append(big);
        }
        bar.append(toggleControls(mech, true), pauseButton());
        if (step.optional) { const skip = el('button', 'snpc-act-btn is-quiet', 'Skip'); skip.type = 'button'; skip.addEventListener('click', () => { if (skipStep(session)) afterStep(); }); bar.append(skip); }
        speak('start');
        last = performance.now();
        lastLoop = '';
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
            if (snd && !(e.type === 'shake' && now - inp.lastShake < 140)) { sfx(snd); if (e.type === 'shake') inp.lastShake = now; }
            const word = e.grade ? POPUP[e.grade] : POPUP[e.type];
            if (word && e.type !== 'step-done') say(word);
            if (e.type === 'splash' || e.type === 'guard' || e.type === 'burnt' || e.type === 'flip') speak('moment', '', '', describeSession(session));
        }
        // A looping sound under the stirring and the sizzle.
        const want = run && LOOPS[session.step.mech] && ((session.step.mech === 'stir' && run.speed > 0.3) || session.step.mech === 'sear' || (session.step.mech === 'pour' && run.flow > 0.001)) && !run.over ? LOOPS[session.step.mech] : '';
        if (want !== lastLoop) { if (want) startMusic(want); else stopMusic(); lastLoop = want; }
        if (session.phase === 'between') { stopMusic(); afterStep(); return; }
        raf = requestAnimationFrame(frameLoop);
    }

    function afterStep() {
        cancelAnimationFrame(raf);
        stopMusic();
        const r = session.results[session.results.length - 1];
        status.textContent = r?.skipped ? 'Skipped.' : `${GRADE_TEXT[r.ruined ? 'failed' : r.performance >= 0.9 ? 'perfect' : r.performance >= 0.7 ? 'good' : r.performance >= 0.4 ? 'fair' : 'poor']}: ${session.script.steps.find(s => s.id === r.id)?.words.done || 'Done.'}`;
        speak('moment', '', '', describeSession(session));
        setTimeout(() => { if (alive()) showIntro(); }, 1100);
    }

    /* ------------------------------------------------------------------ the result */

    function settle() {
        if (finished) return;
        finished = true;
        stop();
        const res = sessionResult(session);
        const grade = gradeOfP(res.P, res.ruined);
        const rewards = cookRewardsForGrade(recipe, grade, { prefs, partner: Boolean(partner), pack: pack || [], difficulty, tier });
        if (!pack) rewards.consume = [];
        sfx('activity_mech_serve');
        speak('end', '', grade === 'failed' ? 'poor' : grade);
        const lines = settleActivity({
            activityId: ctx.activityId || 'cook', label, partner, subject: rewards.subject,
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${recipe.name}, ${GRADE_TEXT[grade].toLowerCase()}.`,
            rewards: { grade, levelXp: rewards.levelXp, profXp: rewards.profXp, partnerProfXp: rewards.partnerProfXp, bonds: rewards.bonds, item: rewards.item, consume: rewards.consume, recipeId: grade === 'failed' ? '' : recipe.id },
        });
        if (rewards.favorite && rewards.bonds.length) lines.push(`${recipe.name} is ${partner}'s favourite meal, and it shows.`);
        else if (rewards.liked && rewards.bonds.length) lines.push(`${partner} loved the ${recipe.name}.`);
        wrap.replaceChildren();
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', grade === 'failed' ? 'A bit of a mess' : recipe.name));
        const art = el('div');
        art.style.cssText = 'max-width:320px; margin:0 auto;';
        dishDrawing(art, grade);
        box.append(art, el('p', 'snpc-act-grade', `${GRADE_TEXT[grade]}${res.bonus >= 0.02 ? ' (flow bonus!)' : ''}`));
        const list = el('ul');
        for (const r of res.results) list.append(el('li', '', `${session.script.steps.find(s => s.id === r.id)?.words.title || r.id}: ${Math.round(r.performance * 100)}%`));
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Cook again');
        again.type = 'button';
        again.addEventListener('click', onAgain);
        const leave = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
        leave.type = 'button';
        leave.addEventListener('click', onLeave);
        row.append(again, leave);
        box.append(row);
        wrap.append(box);
        again.focus();
    }

    showIntro();
    return { stop };
}
