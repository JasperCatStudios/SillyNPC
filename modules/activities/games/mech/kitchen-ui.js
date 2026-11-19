import { scriptFor } from '../../../../src/mech/script-core.js';
import { createSession, beginNext, stepSession, sessionResult, gradeOfP, skipStep, describeSession } from '../../../../src/mech/session-core.js';
import { mechanicOf } from '../../../../src/mech/registry.js';
import { flickUp, inRect, knobValue, toStage } from '../../../../src/mech/input.js';
import { difficultyScale } from '../../../../src/craft/craft-core.js';
import { cookRewardsForGrade, recipeLevel } from '../../../../src/activity-harvest-core.js';
import { normalizeActionKey } from '../../../../src/activity-config-core.js';
import { settleActivity, sfx, startMusic, stopMusic, activitySettings } from '../../activities-runtime.js';
import { talker } from '../harvest-ui.js';
import { VIEWS, dishDrawing } from './views.js';

/**
 * The hands-on kitchen (fork): plays a recipe's script of steps (chop, stir, sear, season...) on a plain-shape stage.
 *
 * Every step works two ways, and scores about the same in both: with the pointer (mouse or touch: swipe, circle, drag a knob, shake)
 * or with ONE button or key (the action key, Space, or the big on-screen button). The rules are in src/mech (pure, tested with
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
const LOOPS = { stir: 'activity_mech_stir_loop', sear: 'activity_mech_sear_sizzle' };

/** The sound for an event of a step. */
function soundFor(e) {
    if (e.type === 'cut' || e.type === 'land') return e.grade === 'perfect' ? 'activity_mech_perfect' : e.grade === 'good' ? 'activity_mech_good' : 'activity_mech_miss';
    return ({
        guard: 'activity_mech_slice_guard', splash: 'activity_mech_stir_splash', scorch: 'activity_mech_sear_warn', smoke: 'activity_mech_sear_warn',
        silky: 'activity_mech_good', flip: 'activity_mech_sear_flip', burnt: 'activity_mech_ruin_comic', ruin: 'activity_mech_ruin_comic', shake: 'activity_mech_sprinkle_shake',
        even: 'activity_mech_streak', 'step-done': 'activity_mech_step_done', 'flow-up': 'activity_mech_flow_up', half: 'activity_mech_miss', stray: '',
    })[e.type] || '';
}

/** Words shown for an event. */
const POPUP = { perfect: 'Perfect!', good: 'Nice', miss: 'Oops', guard: 'Careful!', splash: 'Splash!', silky: 'Silky', flip: 'Flip!', burnt: 'Burnt!', even: 'Even!', scorch: 'Catching!', smoke: 'Smoking!' };

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
    const pref = activitySettings().controls;
    let controls = pref === 'button' ? 'button' : 'pointer';
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
        { title: 'Two ways to play', text: 'With a mouse or finger you swipe, circle, drag and shake. If you prefer one button, press "Play with one button" under the stage: every step has a one-button version that scores about the same. The action key and Space work too.' },
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

    const inp = { down: false, path: [], held: false, presses: [], pick: null, knob: 0.5, knobActive: false, lastShake: 0 };
    const clockNow = () => (session.run ? session.run.t + (performance.now() - last) : 0);
    const bound = normalizeActionKey(activitySettings().actionKey);
    const mouseBound = bound.startsWith('Mouse');
    const typing = (t) => { const tag = (t?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable === true; };

    const onDown = (e) => {
        if (session.phase !== 'play' || controls === 'button') return;
        const [x, y] = toStage(e.clientX, e.clientY, stage.getBoundingClientRect());
        stage.setPointerCapture?.(e.pointerId);
        if (session.step.mech === 'sear' && inRect(x, y, KNOB_ZONE)) { inp.knobActive = true; inp.knob = knobValue(y, { top: 0.18, bottom: 0.82 }); return; }
        inp.down = true;
        inp.path.push([clockNow(), x, y]);
    };
    const onMove = (e) => {
        if (session.phase !== 'play' || controls === 'button') return;
        const events = e.getCoalescedEvents?.() || [e];
        const box = stage.getBoundingClientRect();
        for (const ev of events) {
            const [x, y] = toStage(ev.clientX, ev.clientY, box);
            if (inp.knobActive) inp.knob = knobValue(y, { top: 0.18, bottom: 0.82 });
            else if (inp.down) inp.path.push([clockNow(), x, y]);
        }
    };
    const onUp = (e) => {
        if (inp.knobActive) { inp.knobActive = false; return; }
        if (!inp.down) return;
        // A quick upward flick over the fish flips it (sear, pointer mode).
        if (session.step?.mech === 'sear') { const fl = flickUp(inp.path); if (fl) inp.pick = 'flip'; else if (inp.path.length < 4) inp.presses.push(clockNow()); }
        inp.down = false;
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

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
        // A flick is read from the path of this frame (the sear step flips on it).
        if (session.step?.mech === 'sear' && controls === 'pointer' && frame.pointer.path.length > 1 && !frame.pick) { const fl = flickUp(frame.pointer.path); if (fl) frame.pick = 'flip'; }
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
        bar.append(toggleControls());
    }

    function toggleControls() {
        const b = el('button', 'snpc-act-btn is-quiet', controls === 'button' ? 'Play with the pointer' : 'Play with one button');
        b.type = 'button';
        b.addEventListener('click', () => { controls = controls === 'button' ? 'pointer' : 'button'; session.ctx.controls = controls; if (session.phase === 'between' || session.phase === 'idle') showIntro(); else b.textContent = controls === 'button' ? 'Play with the pointer' : 'Play with one button'; });
        return b;
    }

    function start() {
        beginNext(session, rng);
        const step = session.step;
        stage.replaceChildren();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 160 100');
        svg.setAttribute('width', '100%');
        svg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', step.words.title || step.id);
        stage.append(svg, popup);
        view = VIEWS[step.mech](svg);
        title.textContent = `${session.index + 1} of ${session.script.steps.length}: ${step.words.title || step.id}`;
        hint.textContent = step.words.hint || '';
        bar.replaceChildren();
        // Controls for this step.
        const mech = step.mech;
        if (mech === 'sear') { const plate = el('button', 'snpc-act-btn', 'Plate it'); plate.type = 'button'; plate.addEventListener('click', () => { inp.pick = 'plate'; }); bar.append(plate); }
        if (mech === 'sprinkle') { const done = el('button', 'snpc-act-btn', 'Done'); done.type = 'button'; done.addEventListener('click', () => { inp.pick = 'done'; }); bar.append(done); }
        if (controls === 'button') {
            const big = el('button', 'snpc-act-bigtap', mech === 'slice' ? 'Chop' : mech === 'stir' ? 'Stir' : mech === 'sear' ? 'Heat / Flip' : 'Shake');
            big.type = 'button';
            big.addEventListener('pointerdown', (e) => { e.preventDefault(); inp.held = true; inp.presses.push(clockNow()); });
            for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) big.addEventListener(ev, () => { inp.held = false; });
            bar.append(big);
        }
        if (step.optional) { const skip = el('button', 'snpc-act-btn is-quiet', 'Skip'); skip.type = 'button'; skip.addEventListener('click', () => { if (skipStep(session)) afterStep(); }); bar.append(skip); }
        speak('start');
        last = performance.now();
        lastLoop = '';
        raf = requestAnimationFrame(frameLoop);
    }

    function frameLoop(now) {
        if (!alive()) return;
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
        const want = run && LOOPS[session.step.mech] && ((session.step.mech === 'stir' && run.speed > 0.3) || session.step.mech === 'sear') && !run.over ? LOOPS[session.step.mech] : '';
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
