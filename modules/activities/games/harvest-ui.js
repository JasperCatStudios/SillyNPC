import { assistOn } from '../../../src/touch-ease.js';
import {
    zoneWidth, sweepMs, markerAt, hitQuality, newCook, tapStep, cookRewards, COOK_STEPS,
    newCast, advanceWait, tapCast, stepReel, pickFish, rivalCasts, contestWinner, totalWeight, fishRewards, catchItem,
    plantSeed, tendPlot, harvestPlot, plotState, plotText, gardenRewards, MAX_PLOTS,
} from '../../../src/activity-harvest-core.js';
import { normalizeActionKey, actionKeyLabel } from '../../../src/activity-config-core.js';
import { term } from '../../../src/activity-terms.js';
import {
    askPartner, settleActivity, sfx, inventoryActive, activitySettings, cardOf, packItems, availableSeeds, gardenState, saveGarden, giveItemsNow, takeItemNow, currentDay, talkAllowed,
} from '../activities-runtime.js';

/**
 * Cooking, fishing and gardening screens (fork). The rules are in src/activity-harvest-core.js; this file is the screens, the
 * sounds and what is kept at the end. Everything is tap-based and works on a phone: one big button, an assist setting for a wider
 * zone and a slower marker, a stepped marker when the system asks for reduced motion, and the keyboard (Space) for every tap.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor', failed: 'Failed' };
const QUALITY_TEXT = { perfect: 'Perfect!', good: 'Good', miss: 'Missed' };

/** Whether the system asks for less motion. */
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * The timing bar: a zone somewhere along a bar and a marker that sweeps across and back. `pos()` is where the marker is right now.
 * With reduced motion the marker moves in steps instead of gliding.
 */
export function createMeter({ difficulty, assist, scale = 1 }) {
    const wrap = el('div', 'snpc-act-meter');
    wrap.setAttribute('role', 'img');
    const zone = el('div', 'snpc-act-meter-zone');
    const marker = el('div', 'snpc-act-meter-marker');
    wrap.append(zone, marker);
    // scale: 1 is normal; a craft passes a number above 1 for an easier zone and below 1 for a harder one.
    const width = Math.min(0.9, zoneWidth(difficulty, assist) * Math.min(1.6, Math.max(0.5, scale)));
    const sweep = sweepMs(difficulty, assist);
    const stepped = reducedMotion();
    let center = 0.5;
    let t0 = 0;
    let raf = 0;
    let running = false;
    let shown = 0;
    const now = () => {
        const p = markerAt(performance.now() - t0, sweep);
        return stepped ? Math.round(p * 8) / 8 : p;
    };
    const frame = () => {
        if (!running) return;
        shown = now();
        marker.style.left = `${shown * 100}%`;
        raf = requestAnimationFrame(frame);
    };
    const api = {
        el: wrap,
        setCenter(c) {
            center = c;
            zone.style.left = `${(center - width / 2) * 100}%`;
            zone.style.width = `${width * 100}%`;
            wrap.setAttribute('aria-label', 'A marker sweeps along the bar. Tap when it is inside the green zone.');
        },
        start() { running = true; t0 = performance.now(); raf = requestAnimationFrame(frame); },
        stop() { running = false; cancelAnimationFrame(raf); },
        pos: () => (running ? now() : shown),
        quality: () => hitQuality(api.pos(), center, width),
    };
    api.setCenter(0.5);
    return api;
}

/** The big tap button; it also answers the Space key while the activity window is open. Returns { button, destroy }. */
export function bigButton(win, label, onPress, onRelease) {
    const button = el('button', 'snpc-act-bigtap', label);
    button.type = 'button';
    const down = (e) => { e.preventDefault(); try { button.setPointerCapture(e.pointerId); } catch { /* no capture: a slide off lets go */ } onPress?.(); };
    const up = () => onRelease?.();
    button.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(ev, up);
    // A keyboard click (Enter) acts as a quick press and release.
    button.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onPress?.(); } });
    button.addEventListener('keyup', (e) => { if (e.key === 'Enter') onRelease?.(); });
    const bound = normalizeActionKey(activitySettings().actionKey);
    const isMouse = bound.startsWith('Mouse');
    // The keys are heard on the whole page while the window is open (not only when something inside it has focus, which a fresh
    // screen does not), except while typing in a text box. A listener whose button has left the screen removes itself, so an old
    // game can never answer a key meant for a new one.
    const typing = (t) => { const tag = (t?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable === true; };
    const key = (e) => {
        if (!button.isConnected) { destroy(); return; }
        if ((e.code !== 'Space' && (isMouse || e.code !== bound)) || e.repeat || !win.isOpen() || typing(e.target)) return;
        e.preventDefault();
        if (e.type === 'keydown') onPress?.(); else onRelease?.();
    };
    // A bound mouse button works anywhere in the window except on other controls (the big button already answers its own clicks).
    const mouseKey = (e) => {
        if (!button.isConnected) { destroy(); return; }
        if (!isMouse || e.button !== Number(bound.slice(5)) || !win.isOpen() || !win.root.contains(e.target)) return;
        if (e.target?.closest?.('button, input, select, textarea, a')) return;
        e.preventDefault();
        if (e.type === 'mousedown') onPress?.(); else onRelease?.();
    };
    const noMenu = (e) => { if (bound === 'Mouse2' && win.isOpen() && win.root.contains(e.target)) e.preventDefault(); };
    function destroy() {
        document.removeEventListener('keydown', key); document.removeEventListener('keyup', key);
        document.removeEventListener('mousedown', mouseKey); document.removeEventListener('mouseup', mouseKey);
        document.removeEventListener('contextmenu', noMenu);
    }
    document.addEventListener('keydown', key);
    document.addEventListener('keyup', key);
    document.addEventListener('mousedown', mouseKey);
    document.addEventListener('mouseup', mouseKey);
    document.addEventListener('contextmenu', noMenu);
    return { button, destroy };
}

/** The partner says something short (never blocks). */
export function talker(win, partner, label, stateText) {
    return async (beat, playerText = '', outcome = '', event = '') => {
        if (!partner || !talkAllowed(beat)) return;
        win.addLine(partner, '...', 'typing');
        const out = await askPartner({ partner, label, beat, stateText: stateText(), playerText, talkSoFar: win.talk(), outcome, event });
        win.removeTyping();
        if (win.isOpen() && out.text) win.addLine(partner, out.text, 'bot');
    };
}

/** A result card with lines and two buttons. */
export function resultCard({ title, grade, extra, lines, again, onAgain, onLeave, win }) {
    const box = el('div', 'snpc-act-result');
    box.append(el('h3', '', title));
    if (grade) box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[grade] || grade}${extra ? `: ${extra}` : ''}`));
    const list = el('ul');
    for (const l of lines || []) list.append(el('li', '', l));
    box.append(list);
    const row = el('div', 'snpc-act-row');
    if (onAgain) {
        const a = el('button', 'snpc-act-btn', again || 'Again');
        a.type = 'button';
        a.addEventListener('click', onAgain);
        row.append(a);
    }
    const leave = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
    leave.type = 'button';
    leave.addEventListener('click', onLeave);
    row.append(leave);
    box.append(row);
    win.main.replaceChildren(box);
    (row.firstChild)?.focus();
}

/* ------------------------------------------------------------------ cooking */

/**
 * @param {object} win
 * @param {{ partner: string, label: string, recipe: object, difficulty: string, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runCook(win, ctx) {
    const { partner, label, recipe, onLeave, onAgain } = ctx;
    const assist = assistOn(activitySettings());
    const state = newCook({ recipe, difficulty: ctx.difficulty });
    const prefs = partner ? cardOf(partner)?.prefs : undefined;
    let busy = false;
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-utensils');
    win.setHelp([
        { title: 'The goal', text: `Cook ${recipe.name}. Three steps: chop, heat and season. Each one is a timing test.` },
        { title: 'How a step works', text: 'A marker sweeps back and forth along a bar. A green zone sits somewhere on the bar. Tap the big button (or press Space) when the marker is inside the zone. The middle of the zone is a perfect hit.' },
        { title: 'The dish', text: 'Two points for a perfect step, one for a good one. Five or six points is a perfect dish and doubles the portion, three or four is good, two is fair, one is poor, and none is a burnt mess. The ingredients are used up either way.' },
        { title: 'Serving', text: 'A good dish shared with a partner warms the bond a little, and more if it is a food they like (once a day). Played alone, you just keep the food.' },
        { title: 'Settings', text: `The harder settings make the zone narrower and the marker faster. "Easier timing" in the Activities settings widens the zone and slows the marker. ${assist ? 'It is on now.' : 'It is off now.'}` },
    ]);

    const wrap = el('div', 'snpc-act-cook');
    const steps = el('ol', 'snpc-act-cooksteps');
    const meter = createMeter({ difficulty: state.difficulty, assist });
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const speak = talker(win, partner, label, () => `cooking ${recipe.name}, ${state.index} of ${state.steps.length} steps done`);
    win.onSay((text) => { speak('chat', text); });
    const press = bigButton(win, 'Tap', () => onTap());
    wrap.append(el('h3', 'snpc-act-cookname', recipe.name), steps, meter.el, press.button, status);
    win.main.replaceChildren(wrap);

    const drawSteps = () => {
        steps.replaceChildren();
        state.steps.forEach((st, i) => {
            const li = el('li', `snpc-act-cookstep${i === state.index && !state.over ? ' is-now' : ''}${st.quality ? ` is-${st.quality}` : ''}`);
            li.append(el('strong', '', COOK_STEPS[i].label), el('small', '', st.quality ? QUALITY_TEXT[st.quality] : (i === state.index ? 'Now' : 'Next')));
            steps.append(li);
        });
    };
    const arm = () => {
        drawSteps();
        meter.setCenter(state.steps[state.index].center);
        meter.start();
        status.textContent = `${COOK_STEPS[state.index].label}: tap when the marker is in the green zone.`;
    };

    function onTap() {
        if (busy || !alive() || state.over) return;
        const pos = meter.pos();
        meter.stop();
        const q = tapStep(state, pos, assist);
        sfx(['activity_cook_chop', 'activity_cook_sizzle', 'activity_cook_bubble'][state.index - 1] || 'activity_cook_chop');
        status.textContent = `${COOK_STEPS[state.index - 1].label}: ${QUALITY_TEXT[q]}`;
        speak('moment', '', '', `the ${COOK_STEPS[state.index - 1].label.toLowerCase()} step of the ${recipe.name} went ${{ perfect: 'perfectly', good: 'well', miss: 'badly' }[q]}`);
        drawSteps();
        busy = true;
        setTimeout(() => {
            busy = false;
            if (!alive()) return;
            if (state.over) finish(); else arm();
        }, 650);
    }

    function finish() {
        finished = true;
        press.destroy();
        const tracked = inventoryActive();
        const rewards = cookRewards(state, { prefs, partner: Boolean(partner), pack: tracked ? packItems() : [] });
        if (!tracked) rewards.consume = [];
        sfx(rewards.grade === 'failed' ? 'activity_potion_fail' : 'activity_cook_done');
        speak('end', '', rewards.grade === 'failed' ? 'poor' : rewards.grade);
        const lines = settleActivity({
            activityId: ctx.activityId || 'cook', label, partner, lines: win.talk(),
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${recipe.name}, ${GRADE_TEXT[rewards.grade].toLowerCase()}.`,
            rewards: { grade: rewards.grade, levelXp: rewards.levelXp, bonds: rewards.bonds, item: rewards.item, consume: rewards.consume, recipeId: rewards.grade === 'failed' ? '' : recipe.id },
        });
        if (rewards.favorite && rewards.bonds.length) lines.push(`${recipe.name} is ${partner}'s favourite meal, and it shows.`);
        else if (rewards.liked && rewards.bonds.length) lines.push(`${partner} loved the ${recipe.name}.`);
        setTimeout(() => resultCard({
            title: rewards.grade === 'failed' ? 'It burnt' : `${recipe.name} is ready`, grade: rewards.grade, extra: `${state.steps.filter(s => s.quality === 'perfect').length} perfect steps`,
            lines, again: 'Cook again', onAgain, onLeave, win,
        }), 800);
    }

    arm();
    speak('start');
}

/* ------------------------------------------------------------------ fishing */

const CASTS = 3;

/**
 * @param {object} win
 * @param {{ partner: string, label: string, difficulty: string, contest: boolean, table: object[], onLeave: () => void, onAgain: () => void }} ctx
 */
export function runFish(win, ctx) {
    const { partner, label, table, onLeave, onAgain } = ctx;
    const contest = Boolean(ctx.contest && partner);
    const assist = assistOn(activitySettings());
    const results = [];
    let cast = null;
    let mode = 'idle';           // idle: ready to cast; cast: a line is out; done: all casts made
    let holding = false;
    let raf = 0;
    let last = 0;
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-fish');
    win.setHelp([
        { title: 'The goal', text: `Land ${CASTS} fish. You cast ${CASTS} times, and each cast is a wait, a hook and a reel.` },
        { title: 'Casting and waiting', text: 'Press the big button (or your action key) to cast. Then wait, and do not press: tapping early scares the fish away.' },
        { title: 'The bite', text: 'When the line twitches the button says "Hook it!". Tap straight away, you have about a second and a half or it escapes.' },
        { title: 'Reeling', text: `A tall bar shows the fish and a cursor. Hold the button, or your action key (${actionKeyLabel(activitySettings().actionKey)} or Space), to raise the cursor and let go to lower it. Keep the cursor on the fish: the catch bar fills while you are on it and drains while you are not. Fill it and the fish is yours; empty it and it gets away.` },
        { title: 'The result', text: `Every fish you land goes in your pack. Landing all of them well is a perfect day. ${contest ? 'In the contest your partner fishes too, and the heavier catch wins (a bigger fish, landed well, weighs more).' : ''}` },
        { title: 'Settings', text: `Harder settings make the cursor band narrower. "Easier timing" in the Activities settings widens it. ${assist ? 'It is on now.' : 'It is off now.'}` },
    ]);

    const wrap = el('div', 'snpc-act-fish');
    const counter = el('div', 'snpc-act-fishcount');
    const pond = el('div', 'snpc-act-pond');
    const reel = el('div', 'snpc-act-reel');
    reel.hidden = true;
    const track = el('div', 'snpc-act-reel-track');
    const bandEl = el('div', 'snpc-act-reel-band');
    const fishEl = el('div', 'snpc-act-reel-fish');
    fishEl.append(el('i', 'fa-solid fa-fish'));
    const cursorEl = el('div', 'snpc-act-reel-cursor');
    track.append(bandEl, fishEl, cursorEl);
    const progress = el('div', 'snpc-act-reel-progress');
    const progressFill = el('div', 'snpc-act-reel-fill');
    progress.append(progressFill);
    reel.append(track, progress);
    pond.append(el('div', 'snpc-act-pond-note', 'The line is quiet.'), reel);
    const note = pond.firstChild;
    const log = el('ol', 'snpc-act-fishlog');
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const speak = talker(win, partner, label, () => `${results.filter(r => r.caught).length} of ${results.length} fish landed so far`);
    win.onSay((text) => { speak('chat', text); });
    const press = bigButton(win, 'Cast line', () => onPress(), () => { holding = false; });
    wrap.append(counter, pond, press.button, status, log);
    win.main.replaceChildren(wrap);

    const drawCount = () => { counter.textContent = mode === 'done' ? 'All casts made' : `Cast ${Math.min(CASTS, results.length + 1)} of ${CASTS}`; win.setSub(counter.textContent); };
    const drawLog = () => {
        log.replaceChildren();
        results.forEach((r, i) => {
            const li = el('li', r.caught ? 'is-caught' : 'is-lost');
            li.textContent = `Cast ${i + 1}: ${r.caught ? `${r.fish.name} (${catchItem(r).note})` : ({ scared: 'scared it away', escaped: 'it got away', lost: 'the line went slack' }[r.why] || 'nothing')}`;
            log.append(li);
        });
    };
    const drawReel = () => {
        const r = cast?.reel;
        if (!r) return;
        const band = Math.min(0.7, r.band * (assist ? 1.45 : 1));
        fishEl.style.bottom = `${r.fish * 100}%`;
        bandEl.style.bottom = `${Math.max(0, r.fish - band / 2) * 100}%`;
        bandEl.style.height = `${band * 100}%`;
        cursorEl.style.bottom = `${r.cursor * 100}%`;
        cursorEl.classList.toggle('is-on', Math.abs(r.cursor - r.fish) <= band / 2);
        progressFill.style.height = `${Math.max(0, Math.min(1, r.progress)) * 100}%`;
    };

    function endCast() {
        cancelAnimationFrame(raf);
        const result = cast.result;
        results.push(result);
        cast = null;
        holding = false;
        reel.hidden = true;
        if (result.caught) sfx('activity_fish_catch'); else sfx('activity_fish_lost');
        speak('moment', '', '', result.caught ? `a ${result.fish.name} was just landed` : ({ scared: 'the fish was just scared away by a tap that came too soon', escaped: 'a fish took the bait and got away', lost: 'the fish just got away' }[result.why] || 'the cast came to nothing'));
        note.textContent = result.caught ? `You landed a ${result.fish.name}!` : ({ scared: 'You moved too soon and scared it away.', escaped: 'It took the bait and got away.', lost: 'The fish got away.' }[result.why] || 'Nothing.');
        status.textContent = note.textContent;
        mode = results.length >= CASTS ? 'done' : 'idle';
        press.button.textContent = mode === 'done' ? 'See the result' : 'Cast again';
        drawLog();
        drawCount();
    }

    const frame = (now) => {
        if (!cast) return;
        const dt = Math.min(100, now - last);
        last = now;
        if (cast.phase === 'wait' || cast.phase === 'bite') {
            const ev = advanceWait(cast, dt, assist);
            if (ev === 'bite') { speak('moment', '', '', 'a fish just took the bait'); status.textContent = 'A bite! Tap now!'; note.textContent = 'The line twitches!'; press.button.textContent = 'Hook it!'; sfx('activity_fish_bite'); }
            if (ev === 'escaped') { endCast(); return; }
        } else if (cast.phase === 'reel') {
            const ev = stepReel(cast, dt, holding, Math.random, assist);
            drawReel();
            if (ev) { endCast(); return; }
        }
        raf = requestAnimationFrame(frame);
    };

    let castAt = 0;
    function onPress() {
        if (!alive()) return;
        // A double-tap on "Cast line" must not count as a tap that scares the fish.
        if (cast && cast.phase === 'wait' && performance.now() - castAt < 400) return;
        if (mode === 'done') { finish(); return; }
        if (mode === 'idle') {
            cast = newCast({ fish: pickFish(table), difficulty: ctx.difficulty });
            mode = 'cast';
            castAt = performance.now();
            sfx('activity_fish_cast');
            note.textContent = 'The line is out. Wait for a bite...';
            status.textContent = 'Wait for the line to twitch. Do not tap yet.';
            press.button.textContent = 'Wait...';
            last = performance.now();
            raf = requestAnimationFrame(frame);
            return;
        }
        if (!cast) return;
        if (cast.phase === 'wait' || cast.phase === 'bite') {
            const ev = tapCast(cast);
            if (ev === 'scared') { endCast(); return; }
            if (ev === 'hooked') {
                note.textContent = 'Hooked! Keep the cursor on the fish.';
                status.textContent = 'Hold the button to raise the cursor, let go to lower it.';
                press.button.textContent = 'Hold to reel';
                reel.hidden = false;
                holding = true;
                drawReel();
            }
            return;
        }
        if (cast.phase === 'reel') holding = true;
    }

    function finish() {
        finished = true;
        press.destroy();
        cancelAnimationFrame(raf);
        const rewards = fishRewards(results, { partner: Boolean(partner) });
        let winners = [];
        let contestText = '';
        let rival = [];
        if (contest) {
            rival = rivalCasts(table, CASTS);
            const out = contestWinner(results, rival);
            winners = out.winner === 'A' ? [win.userName] : out.winner === 'B' ? [partner] : [];
            contestText = out.winner === 'A' ? `You won the contest, ${out.mine} to ${out.theirs}.` : out.winner === 'B' ? `${partner} won the contest, ${out.theirs} to ${out.mine}.` : `A draw, ${out.mine} each.`;
        }
        speak('end', '', rewards.grade);
        const caught = results.filter(r => r.caught).length;
        const lines = settleActivity({
            activityId: ctx.activityId || 'fish', label, partner, lines: win.talk(), winners,
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${caught} of ${CASTS} landed${contest ? `, ${contestText}` : ''}.`,
            rewards: { grade: rewards.grade, levelXp: rewards.levelXp, bonds: rewards.bonds, items: rewards.items },
        });
        if (contest) lines.unshift(contestText, `Your catch weighed ${totalWeight(results)}; ${partner}'s weighed ${totalWeight(rival)}.`);
        setTimeout(() => resultCard({
            title: caught ? `${caught} fish landed` : 'No luck today', grade: rewards.grade, extra: `${caught} of ${CASTS}`,
            lines, again: 'Fish again', onAgain, onLeave, win,
        }), 500);
    }

    drawCount();
    speak('start');
}

/* ------------------------------------------------------------------ gardening */

/**
 * The garden: plots that grow by being tended on different days. State is saved as you go, so closing the window loses nothing.
 * @param {object} win
 * @param {{ partner: string, label: string, preset: object, onLeave: () => void }} ctx
 */
export function runGarden(win, ctx) {
    const { partner, label, preset, onLeave } = ctx;
    const gardenPlace = term(preset, 'gardenPlace');
    const assist = assistOn(activitySettings());
    const day = currentDay();
    let garden = gardenState();
    const acts = [];
    const harvested = [];
    let watering = null;          // the plot being watered, with its timing bar
    let planting = false;
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-seedling');
    win.setHelp([
        { title: 'The goal', text: 'Grow food and flowers. Plant a seed, then tend it on different days until it is ready to harvest.' },
        { title: 'Planting', text: `Choose "Plant something" on an empty bed and pick a seed. A free bag of seeds is always on hand; other seeds come from your pack and are used up. ${gardenPlace[0].toUpperCase()}${gardenPlace.slice(1)} has room for ${MAX_PLOTS} plots.` },
        { title: 'Tending', text: 'Press Water on a plot, then tap when the marker is in the green zone. A plot counts a day of growth once per story day, however many times you tend it, and the day you plant it does not count, so come back on another day. Every seed needs 1 to 3 days of tending.' },
        { title: 'Harvest', text: 'When a plot says it is ready, press Harvest. Careful watering (mostly perfect or good taps) gives an extra one. The produce goes in your pack: vegetables to cook with, flowers for gifts.' },
        { title: 'Finishing', text: 'Press Finish when you are done. Your garden is saved as you go, so nothing is lost if you close the window. A partner helps and chats; alone, you just work.' },
    ]);

    const wrap = el('div', 'snpc-act-garden');
    const note = el('p', 'snpc-act-note', 'Tend each plot once a day. The day you plant does not count toward growth. A plot is ready after it has been tended on enough different days.');
    const grid = el('div', 'snpc-act-plots');
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const row = el('div', 'snpc-act-row');
    const done = el('button', 'snpc-act-btn', 'Finish');
    done.type = 'button';
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => { finished = true; onLeave(); });
    row.append(done, back);
    wrap.append(note, grid, status, row);
    win.main.replaceChildren(wrap);

    const speak = talker(win, partner, label, () => `${garden.plots.length} plots, ${acts.length} things done this visit`);
    win.onSay((text) => { speak('chat', text); });

    const save = (g) => { garden = g; saveGarden(g); };

    function water(plot) {
        const meter = createMeter({ difficulty: activitySettings().difficulty, assist });
        meter.setCenter(0.25 + Math.random() * 0.5);
        watering = { plot, meter };
        meter.start();
        render();
    }

    function tap() {
        if (!watering) return;
        const { plot, meter } = watering;
        const q = meter.quality();
        meter.stop();
        watering = null;
        const res = tendPlot(garden, plot.id, day, q);
        if (res.ok && res.counted) { speak('moment', '', '', `the ${plot.produce} was just watered ${{ perfect: 'carefully', good: 'well', miss: 'carelessly' }[q]}${res.ready ? ' and is now ready to harvest' : ''}`); save(res.garden); acts.push({ quality: q }); sfx('activity_garden_water'); status.textContent = `${plot.produce}: ${QUALITY_TEXT[q]}${res.grew === false ? ' It was only just planted, so it starts growing tomorrow.' : ''}${res.ready ? ' It is ready to harvest!' : ''}`; }
        else status.textContent = res.reason || 'Nothing happened.';
        render();
    }

    function harvest(plot) {
        const res = harvestPlot(garden, plot.id);
        if (!res.ok) { status.textContent = res.reason; return; }
        save(res.garden);
        giveItemsNow([res.item]);
        harvested.push(res.item);
        speak('moment', '', '', `${res.qty} ${res.item.name} were just harvested`);
        acts.push({ quality: 'good' });
        sfx('activity_garden_harvest');
        status.textContent = `Harvested ${res.qty} x ${res.item.name} (${res.item.note}).`;
        render();
    }

    function plant(entry) {
        const res = plantSeed(garden, entry.seed, day);
        if (!res.ok) { status.textContent = res.reason; return; }
        if (entry.qty !== null) takeItemNow(entry.seed.name, 1);
        save(res.garden);
        speak('moment', '', '', `${entry.seed.name} were just planted`);
        acts.push({ quality: 'good' });
        planting = false;
        sfx('activity_garden_dig');
        status.textContent = `Planted ${entry.seed.name}. It needs ${entry.seed.needs} day${entry.seed.needs === 1 ? '' : 's'} of tending.`;
        render();
    }

    function render() {
        grid.replaceChildren();
        for (const plot of garden.plots) {
            const st = plotState(plot, day);
            const card = el('div', `snpc-act-plot${st.ready ? ' is-ready' : ''}`);
            card.append(el('i', `fa-solid ${st.ready ? 'fa-basket-shopping' : 'fa-seedling'}`), el('strong', '', plot.produce), el('small', '', plotText(plot, day)));
            if (watering && watering.plot.id === plot.id) {
                card.append(watering.meter.el);
                const t = el('button', 'snpc-act-btn', 'Tap');
                t.type = 'button';
                t.addEventListener('click', tap);
                card.append(t);
            } else if (st.ready) {
                const b = el('button', 'snpc-act-btn', 'Harvest');
                b.type = 'button';
                b.addEventListener('click', () => harvest(plot));
                card.append(b);
            } else if (st.tendedToday) {
                card.append(el('small', 'snpc-act-plot-done', 'Tended today'));
            } else {
                const b = el('button', 'snpc-act-btn', 'Water');
                b.type = 'button';
                b.disabled = Boolean(watering);
                b.addEventListener('click', () => water(plot));
                card.append(b);
            }
            grid.append(card);
        }
        if (garden.plots.length < MAX_PLOTS) {
            const empty = el('div', 'snpc-act-plot is-empty');
            empty.append(el('i', 'fa-solid fa-plus'), el('strong', '', 'Empty bed'));
            if (planting) {
                const seeds = availableSeeds(preset);
                if (!seeds.length) empty.append(el('small', '', 'No seeds in your pack.'));
                for (const entry of seeds) {
                    const b = el('button', 'snpc-act-btn is-quiet', `${entry.seed.name}${entry.qty === null ? ' (free)' : ` (x${entry.qty})`}, ${entry.seed.needs} day${entry.seed.needs === 1 ? '' : 's'}`);
                    b.type = 'button';
                    b.addEventListener('click', () => plant(entry));
                    empty.append(b);
                }
                const cancel = el('button', 'snpc-act-btn is-quiet', 'Cancel');
                cancel.type = 'button';
                cancel.addEventListener('click', () => { planting = false; render(); });
                empty.append(cancel);
            } else {
                const b = el('button', 'snpc-act-btn', 'Plant something');
                b.type = 'button';
                b.disabled = Boolean(watering);
                b.addEventListener('click', () => { planting = true; render(); });
                empty.append(b);
            }
            grid.append(empty);
        }
    }

    done.addEventListener('click', () => {
        if (!alive()) return;
        finished = true;
        if (!acts.length) { onLeave(); return; }
        const rewards = gardenRewards(acts, [], { partner: Boolean(partner) });
        speak('end', '', rewards.grade);
        const lines = settleActivity({
            activityId: ctx.activityId || 'garden', label, partner, lines: win.talk(),
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${acts.length} things done, ${harvested.length} harvested.`,
            rewards: { grade: rewards.grade, levelXp: rewards.levelXp, bonds: rewards.bonds },
        });
        for (const it of harvested) lines.unshift(`You harvested ${it.qty} x ${it.name} (${it.note}).`);
        resultCard({ title: 'A good day in the garden', grade: rewards.grade, extra: `${acts.length} thing${acts.length === 1 ? '' : 's'} done`, lines, onLeave, win });
    });

    render();
    speak('start');
}

export { GRADE_TEXT };
