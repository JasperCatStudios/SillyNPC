import {
    mixture, mixtureFit, slotAccepts, checkStart, difficultyScale, effectScale, effectForecasts, qualityScore, processScore, craftQuality, craftRewards,
    consumeFor, shelf, outputNamesOf, outputFor, autofillStarters, rollHelp, HELP_SCORE, reactionEffect,
} from '../../../src/craft/craft-core.js';
import { newTend, stepTend, tendParams, performance as tendPerformance, describeState as describeTend } from '../../../src/craft/tend-core.js';
import { newWork, stepWork, workParams, performance as workPerformance, describeState as describeWork, beatProgress } from '../../../src/craft/work-core.js';
import { settleActivity, sfx } from '../activities-runtime.js';
import { createMeter, bigButton, talker } from './harvest-ui.js';

/**
 * The crafting screen (fork): choose materials, then play the craft's stages (prep, tend, finish) and settle. The rules are in
 * src/craft/craft-core.js and src/craft/tend-core.js; a craft type is data (see src/activity-craft-data.js), so this one screen
 * plays alchemy, smithing or a talisman craft, using the craft's own words (terms) and, later, its art.
 *
 * Everything works with one button or key (the action key setting), on a phone, with an assist setting for wider zones.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor', failed: 'Failed' };

/** A material as a small chip: colour, shape and letter (so colour is never the only cue), name and a count. */
function chip(material, { count = null, selected = false } = {}) {
    const b = el('button', `snpc-act-chip${selected ? ' is-chosen' : ''}`);
    b.type = 'button';
    const mark = el('span', 'snpc-act-chip-mark', `${material.shape}${material.letter}`);
    mark.style.cssText = `background:${material.color}; color:#111; border-radius:6px; padding:0 6px; font-weight:bold; margin-right:6px;`;
    b.append(mark, el('span', '', material.name), el('small', '', ` ${'•'.repeat(material.tier)}${count === null ? (material.starter ? ' free' : '') : ` x${count}`}`));
    b.title = Object.entries(material.props).map(([k, v]) => `${k} ${v}`).join(', ');
    return b;
}

/**
 * @param {object} win the activity window
 * @param {{ partner: string, activityId?: string, label: string, craft: object, difficulty: string, assist: boolean, tier: number,
 *   pack: { name: string, qty: number }[] | null, onLeave: () => void, onAgain: () => void }} ctx
 *   `pack` is the player's inventory when the Inventory is on, null when it is off (then every material is free).
 */
export function runCraft(win, ctx) {
    const { partner, craft, difficulty, assist, tier, pack, onLeave, onAgain } = ctx;
    const label = ctx.label || craft.label;
    const terms = craft.terms || {};
    const say = (k, d) => terms[k] || d;
    const shelfRows = shelf(craft, pack, { outputNames: outputNamesOf(craft) });
    let recipe = null;
    let filled = {};
    let finished = false;
    let raf = 0;
    const cleanups = [];
    const alive = () => win.isOpen() && !finished;
    const stop = () => { cancelAnimationFrame(raf); while (cleanups.length) { try { cleanups.pop()(); } catch { /* gone */ } } };

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, craft.icon || 'fa-hammer');
    win.setHelp([
        { title: 'The goal', text: `Make something good. Pick a recipe, choose materials that fit it, then ${say('prep', 'prepare')}, tend the work and finish it.` },
        { title: 'Choosing materials', text: 'Each material has properties. The bars show what your choice adds up to and the green band is what the recipe wants. Better materials reach the band more easily, and a perfect result needs materials that fit well.' },
        { title: 'Preparing', text: 'Tap the button when the marker is in the green zone, once for each material. A good tap makes the material a little stronger, a miss weakens it.' },
        { title: 'Heat and strike', text: 'Some crafts use a forge. Hold the button to heat the work until it is ready, then tap on each beat. Each good strike shapes it. When the heat drops below the green band the work is cold: do not strike it (that cracks it), let that beat pass and heat it again. Too many cracks shatter it.' },
        { title: 'Tending', text: `Hold the button (or your action key) to raise the gauge and let go to lower it. Keep it inside the band for the whole time. Holding too long past the top ruins ${say('tended', 'the work')}.` },
        { title: 'Finishing', text: 'One last tap in the green zone seals it. The grade comes from your materials, your hands and your skill.' },
        { title: 'Materials', text: pack ? 'Materials come from your pack and are used up.' : 'The Inventory is off, so every material is free.' },
    ]);

    const speak = talker(win, partner, label, () => (recipe ? `making ${recipe.name}` : 'choosing what to make'));
    win.onSay((text) => { speak('chat', text); });
    const wrap = el('div', 'snpc-act-craft');
    win.main.replaceChildren(wrap);

    /* ------------------------------------------------------------------ select */

    function showSelect() {
        stop();
        wrap.replaceChildren();
        const intro = el('p', 'snpc-act-note', `${say('workplace', 'The workshop')}. Choose a recipe, then fill each slot from the shelf.`);
        wrap.append(intro);

        // Recipes.
        const recipes = el('div', 'snpc-act-recipes');
        recipes.setAttribute('role', 'radiogroup');
        recipes.setAttribute('aria-label', 'Choose a recipe');
        for (const r of craft.recipes.filter(x => !x.hidden)) {
            const b = el('button', `snpc-act-recipe${recipe?.id === r.id ? ' is-chosen' : ''}`);
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(recipe?.id === r.id));
            b.append(el('strong', '', r.name), el('small', '', r.desc || ''), el('small', 'snpc-act-recipe-needs', `Level ${r.level}${r.level > tier + 2 ? ' (hard for you)' : ''}`));
            b.addEventListener('click', () => { recipe = r; filled = autofillStarters(craft, r, {}); showSelect(); });
            recipes.append(b);
        }
        wrap.append(recipes);
        if (!recipe) { wrap.append(el('p', 'snpc-act-note is-small', 'Pick a recipe to begin.')); return; }

        // Slots.
        const slotBox = el('div', 'snpc-act-slots');
        slotBox.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin:8px 0;';
        for (const slot of recipe.slots) {
            const row = el('div', 'snpc-act-row');
            row.append(el('strong', '', `${slot.label}${slot.optional ? ' (optional)' : ''}${slot.qty > 1 ? ` x${slot.qty}` : ''}:`));
            const m = filled[slot.id];
            if (m) {
                const c = chip(m, { selected: true });
                c.addEventListener('click', () => { delete filled[slot.id]; showSelect(); });
                c.title = 'Tap to take it out';
                row.append(c);
            } else row.append(el('small', '', 'empty'));
            slotBox.append(row);
        }
        wrap.append(slotBox);

        // The shelf: a material goes in the first empty slot that takes it (or replaces the first one that takes it).
        const used = (id) => recipe.slots.reduce((n, s) => n + (filled[s.id]?.id === id ? s.qty : 0), 0);
        const shelfBox = el('div', 'snpc-act-shelf');
        shelfBox.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin:6px 0;';
        if (!shelfRows.length) shelfBox.append(el('p', 'snpc-act-note is-small', 'Nothing in your pack can be used for this. Gather some materials first.'));
        for (const { material, count } of shelfRows) {
            const fits = recipe.slots.some(s => slotAccepts(s, material));
            const left = count === null ? Infinity : count - used(material.id);
            const c = chip(material, { count: count === null ? null : Math.max(0, left) });
            c.disabled = !fits || left <= 0;
            c.addEventListener('click', () => {
                const target = recipe.slots.find(s => !filled[s.id] && slotAccepts(s, material)) || recipe.slots.find(s => slotAccepts(s, material));
                if (!target) return;
                const had = filled[target.id];
                if (count !== null && (count - used(material.id) + (had?.id === material.id ? target.qty : 0)) < target.qty) return;
                filled[target.id] = material;
                sfx('activity_cook_chop');
                showSelect();
            });
            shelfBox.append(c);
        }
        wrap.append(el('strong', '', 'The shelf'), shelfBox);

        // What the choice adds up to.
        const check = checkStart(craft, recipe, filled, 'good');
        const bars = el('div', 'snpc-act-bars');
        bars.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin:8px 0;';
        for (const p of craft.properties) {
            const t = recipe.targets[p.id];
            const v = check.mix[p.id] || 0;
            const row = el('div');
            row.append(el('small', '', `${p.label}: ${Math.round(v * 10) / 10}${t ? `  (wants ${t.ideal[0]} to ${t.ideal[1]}, limits ${t.min} to ${t.max})` : ''}`));
            const track = el('div');
            track.style.cssText = 'position:relative; height:14px; border:1px solid #a4947d; border-radius:7px; overflow:hidden;';
            const pct = (n) => `${Math.max(0, Math.min(100, (n / p.max) * 100))}%`;
            if (t) {
                const limit = el('div');
                limit.style.cssText = `position:absolute; top:0; bottom:0; left:${pct(t.min)}; width:calc(${pct(t.max)} - ${pct(t.min)}); background:#6aa84f33;`;
                const ideal = el('div');
                ideal.style.cssText = `position:absolute; top:0; bottom:0; left:${pct(t.ideal[0])}; width:calc(${pct(t.ideal[1])} - ${pct(t.ideal[0])}); background:#6aa84f99;`;
                track.append(limit, ideal);
            }
            const fill = el('div');
            fill.style.cssText = `position:absolute; top:0; bottom:0; left:0; width:${pct(v)}; border-right:3px solid #c0504d;`;
            track.append(fill);
            track.setAttribute('role', 'img');
            track.setAttribute('aria-label', `${p.label} ${Math.round(v * 10) / 10}`);
            row.append(track);
            bars.append(row);
        }
        wrap.append(bars);
        for (const f of effectForecasts(craft, check.mix)) wrap.append(el('small', 'snpc-act-note is-small', f));

        const status = el('p', 'snpc-act-note is-small');
        status.setAttribute('role', 'status');
        status.textContent = check.ok ? `Ready. How well it fits: ${Math.round(check.fit * 100)}%.` : check.reasons.join(' ');
        const row = el('div', 'snpc-act-row');
        const start = el('button', 'snpc-act-btn', say('craftVerb', 'Start'));
        start.type = 'button';
        start.disabled = !check.ok;
        start.addEventListener('click', () => begin());
        const back = el('button', 'snpc-act-btn is-quiet', 'Back');
        back.type = 'button';
        back.addEventListener('click', () => { stop(); onLeave(); });
        row.append(start, back);
        wrap.append(status, row);
    }

    /* ------------------------------------------------------------------ the stages */

    let results = [];
    let helpBonds = [];
    let prep = 'good';
    let ruined = false;
    let picks = [];
    let mix = {};

    function begin() {
        results = [];
        helpBonds = [];
        prep = 'good';
        ruined = false;
        picks = recipe.slots.filter(s => filled[s.id]).map(s => ({ material: filled[s.id], qty: s.qty }));
        mix = mixture(craft, picks, prep);
        sfx('activity_cook_sizzle');
        speak('start');
        runStages(0);
    }

    const stageBox = (title, sub) => {
        wrap.replaceChildren(el('h3', '', title), el('p', 'snpc-act-note', sub));
        const status = el('div', 'snpc-act-status');
        status.setAttribute('aria-live', 'polite');
        return status;
    };

    function runStages(at) {
        if (!alive()) return;
        const stage = craft.stages[at];
        if (!stage) { settle(); return; }
        const next = () => runStages(at + 1);
        if (stage.stage === 'prep') stagePrep(stage, next);
        else if (stage.stage === 'tend') stageTend(stage, next);
        else if (stage.stage === 'work') stageWork(stage, next);
        else stageFinish(stage, next);
    }

    /**
     * One timing tap for each different material. With a partner, the last material is theirs: they get the task, it goes perfectly,
     * normally or badly (by their skill), and the player answers (praise, critique or empathize), which nudges a bond.
     */
    function stagePrep(stage, next) {
        const all = [...new Map(picks.map(p => [p.material.id, p.material])).values()];
        const helper = partner && all.length >= 2 ? all[all.length - 1] : null;
        const mats = helper ? all.slice(0, -1) : all;
        const scores = [];
        let i = 0;
        const scale = difficultyScale(recipe.level, tier);

        const finishPrep = () => {
            const avg = scores.reduce((n, v) => n + v, 0) / Math.max(1, scores.length);
            prep = avg >= 0.8 ? 'perfect' : avg >= 0.4 ? 'good' : 'miss';
            mix = mixture(craft, picks, prep);
            results.push({ stage: 'prep', weight: stage.weight, performance: avg });
            speak('moment', '', '', `the ${say('prep', 'preparing').toLowerCase()} was ${prep === 'perfect' ? 'perfect' : prep === 'good' ? 'fine' : 'clumsy'}`);
            next();
        };

        /** The partner's task, then the player's answer. */
        const partnerTask = () => {
            const status = stageBox(`${partner} lends a hand`, `${partner} takes ${helper.name}.`);
            wrap.append(status);
            setTimeout(() => {
                if (!alive()) return;
                const result = rollHelp(ctx.partnerTier || 0, Math.random);
                scores.push(HELP_SCORE[result]);
                sfx(result === 'fail' ? 'activity_potion_fail' : 'activity_cook_chop');
                const said = result === 'perfect' ? `${partner} did it perfectly.` : result === 'normal' ? `${partner} did a decent job.` : `${partner} botched it.`;
                status.textContent = said;
                const box = el('div', 'snpc-act-row');
                box.style.cssText = 'flex-wrap:wrap; gap:8px; margin-top:10px;';
                const choose = (choice) => {
                    const taste = (ctx.partnerFeedback || {})[choice] || '';
                    const fx = choice ? reactionEffect(result, choice, taste) : { meter: '', amount: 0, verdict: '' };
                    if (fx.amount > 0) helpBonds.push({ meter: fx.meter, amount: fx.amount });
                    const verb = { praise: 'praised', critique: 'critiqued', empathize: 'comforted', silence: 'left it to' }[choice] || 'said nothing to';
                    const feel = fx.verdict === 'disliked' ? ` ${partner} did not like that.` : fx.verdict === 'liked' ? ` ${partner} appreciated that.` : fx.amount > 0 ? ' It meant something.' : ' It did not really land.';
                    status.textContent = `${said} You ${verb} ${partner}.${feel}`;
                    speak('moment', '', '', `${partner} prepared ${helper.name} and ${result === 'perfect' ? 'did it perfectly' : result === 'normal' ? 'did an ordinary job' : 'made a mess of it'}; the player ${verb} them${fx.verdict === 'disliked' ? ', which they disliked' : fx.verdict === 'liked' ? ', which they appreciated' : ''}`);
                    box.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    setTimeout(finishPrep, 900);
                };
                for (const [choice, text, hint] of [
                    ['praise', 'Praise', 'Tell them they did well.'],
                    ['critique', 'Critique', 'Point out what to do better.'],
                    ['empathize', 'Empathize', 'Show understanding, whatever happened.'],
                    ['silence', 'Say nothing', 'Leave them to it.'],
                ]) {
                    const b = el('button', choice !== 'silence' ? 'snpc-act-btn' : 'snpc-act-btn is-quiet', text);
                    b.type = 'button';
                    b.title = hint;
                    b.addEventListener('click', () => choose(choice));
                    box.append(b);
                }
                wrap.append(box);
                (box.firstChild)?.focus();
            }, 900);
        };

        const one = () => {
            if (!alive()) return;
            if (i >= mats.length) {
                if (helper) partnerTask(); else finishPrep();
                return;
            }
            const m = mats[i];
            const status = stageBox(`${say('prep', 'Prepare')}: ${m.name}`, `Tap when the marker is in the green zone. ${i + 1} of ${mats.length}.${helper ? ` ${partner} will take ${helper.name}.` : ''}`);
            const meter = createMeter({ difficulty, assist, scale });
            meter.setCenter(0.25 + Math.random() * 0.5);
            const press = bigButton(win, say('prep', 'Prepare'), () => {
                const q = meter.quality();
                meter.stop();
                press.destroy();
                scores.push(qualityScore(q));
                sfx('activity_cook_chop');
                status.textContent = q === 'perfect' ? 'Perfect!' : q === 'good' ? 'Good.' : 'Missed.';
                i += 1;
                setTimeout(one, 450);
            });
            cleanups.push(() => { meter.stop(); press.destroy(); });
            wrap.append(meter.el, press.button, status);
            meter.start();
        };
        one();
    }

    /** The gauge: hold to raise, let go to lower, keep it in the band. */
    function stageTend(stage, next) {
        const scale = difficultyScale(recipe.level, tier);
        const params = tendParams({
            base: stage.params, scale, assist,
            driftEffect: effectScale(craft, mix, 'tend', 'drift'), progressEffect: effectScale(craft, mix, 'tend', 'progress'),
        });
        const state = newTend(params, Math.random);
        const status = stageBox(say('tended', 'Tend the work'), 'Hold the button (or your action key) to raise the gauge, let go to lower it. Stay in the green band.');
        const gauge = el('div', 'snpc-act-gauge');
        gauge.style.cssText = 'position:relative; width:46px; height:200px; margin:8px auto; border:1px solid #a4947d; border-radius:10px; overflow:hidden;';
        const band = el('div');
        band.style.cssText = `position:absolute; left:0; right:0; bottom:${params.band[0] * 100}%; height:${(params.band[1] - params.band[0]) * 100}%; background:#6aa84f88;`;
        const fill = el('div');
        fill.style.cssText = 'position:absolute; left:0; right:0; bottom:0; background:#e69138; height:20%;';
        const line = el('div');
        line.style.cssText = 'position:absolute; left:0; right:0; height:3px; background:#c0504d; bottom:20%;';
        gauge.append(band, fill, line);
        gauge.setAttribute('role', 'img');
        gauge.setAttribute('aria-label', 'A gauge. Keep the level inside the green band.');
        const timer = el('div', 'snpc-act-counter');
        let held = false;
        const press = bigButton(win, 'Hold', () => { held = true; }, () => { held = false; });
        cleanups.push(() => press.destroy());
        wrap.append(gauge, timer, press.button, status);
        sfx('activity_cook_bubble');
        let last = performance.now();
        const frame = (now) => {
            if (!alive()) return;
            const dt = Math.min(100, now - last);
            last = now;
            stepTend(state, dt, { held }, Math.random);
            fill.style.height = `${state.gauge * 100}%`;
            line.style.bottom = `calc(${state.gauge * 100}% - 1px)`;
            timer.textContent = `${Math.max(0, Math.ceil((params.durationMs - state.t) / 1000))} s`;
            if (state.events.includes('scorching')) status.textContent = 'Too hot! Let go.';
            if (state.over) {
                press.destroy();
                ruined = state.ruined;
                results.push({ stage: 'tend', weight: stage.weight, performance: tendPerformance(state) });
                speak('moment', '', '', describeTend(state, { tended: say('tended', 'the work') }));
                sfx(ruined ? 'activity_potion_fail' : 'activity_cook_done');
                status.textContent = ruined ? `${say('tended', 'The work')} was ruined.` : 'Done.';
                setTimeout(() => (ruined ? settle() : next()), 700);
                return;
            }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
    }

    /**
     * Heat and strike: hold to heat the work until it is ready, then tap on the beat while it cools; heat it again when it goes
     * cold (striking cold work cracks it). One button does both: holding heats, a tap strikes.
     */
    function stageWork(stage, next) {
        const scale = difficultyScale(recipe.level, tier);
        const params = workParams({
            base: stage.params, scale, assist,
            driftEffect: effectScale(craft, mix, 'work', 'drift'), progressEffect: effectScale(craft, mix, 'work', 'progress'),
        });
        const state = newWork(params);
        const worked = say('worked', 'the work');
        const status = stageBox(say('tended', 'Heat and strike'), 'Hold the button (or your action key) to heat the work. When it glows and is ready, tap on each beat. If it goes cold, let that beat pass and heat it again.');
        const banner = el('div', 'snpc-act-banner');
        banner.style.cssText = 'text-align:center; font-weight:bold; margin:4px 0;';
        const row = el('div');
        row.style.cssText = 'display:flex; gap:14px; justify-content:center; align-items:flex-end;';
        const gauge = el('div');
        gauge.style.cssText = 'position:relative; width:46px; height:200px; border:1px solid #a4947d; border-radius:10px; overflow:hidden;';
        const band = el('div');
        band.style.cssText = `position:absolute; left:0; right:0; bottom:${params.band[0] * 100}%; height:${(params.band[1] - params.band[0]) * 100}%; background:#6aa84f88;`;
        const fill = el('div');
        fill.style.cssText = 'position:absolute; left:0; right:0; bottom:0; background:#e69138; height:20%;';
        gauge.append(band, fill);
        gauge.setAttribute('role', 'img');
        gauge.setAttribute('aria-label', 'The heat of the work. Keep it inside the green band.');
        const beat = el('div');
        beat.style.cssText = 'position:relative; width:46px; height:200px; border:1px solid #a4947d; border-radius:10px; overflow:hidden; opacity:0.35;';
        const target = el('div');
        target.style.cssText = 'position:absolute; left:0; right:0; top:0; height:24px; background:#6aa84f99;';
        const ball = el('div');
        ball.style.cssText = 'position:absolute; left:12px; width:22px; height:22px; border-radius:50%; background:#c0504d; bottom:0;';
        beat.append(target, ball);
        beat.setAttribute('role', 'img');
        beat.setAttribute('aria-label', 'The beat. Tap when the red dot reaches the green zone at the top.');
        row.append(gauge, beat);
        const progress = el('div', 'snpc-act-counter');
        let held = false;
        let pressed = false;
        const press = bigButton(win, 'Heat / Strike', () => { held = true; pressed = true; }, () => { held = false; });
        cleanups.push(() => press.destroy());
        wrap.append(banner, row, progress, press.button, status);
        sfx('activity_cook_bubble');
        const NOTE = { 'strike-perfect': 'Perfect strike!', 'strike-good': 'Good strike.', 'strike-miss': 'Missed the beat.', cold: 'It is going cold! Let the next beat pass and heat it again.', crack: 'Crack! You struck it cold.', 'back-to-heat': 'Heat it again.', ready: 'Ready! Strike on the beat.', scorching: 'Too hot! Let go.' };
        let last = performance.now();
        const frame = (now) => {
            if (!alive()) return;
            const dt = Math.min(100, now - last);
            last = now;
            const was = state.phase;
            stepWork(state, dt, { held, press: pressed }, Math.random);
            pressed = false;
            fill.style.height = `${state.heat * 100}%`;
            const strike = state.phase === 'strike';
            banner.textContent = strike ? (state.coldPending ? 'COLD: let the beat pass' : 'STRIKE on the beat') : 'HEAT: hold the button';
            banner.style.color = strike ? (state.coldPending ? '#4f81bd' : '#6aa84f') : '#e69138';
            beat.style.opacity = strike ? '1' : '0.35';
            const bp = beatProgress(state);
            ball.style.bottom = bp === null ? '0' : `calc(${Math.min(1, bp) * 100}% - 22px)`;
            progress.textContent = `${worked}: ${Math.round(Math.min(1, state.progress / params.progress) * 100)}%${state.cracks ? `, ${state.cracks} crack${state.cracks === 1 ? '' : 's'}` : ''}`;
            for (const e of state.events) {
                if (NOTE[e]) status.textContent = NOTE[e];
                if (e === 'strike-perfect' || e === 'strike-good') sfx('activity_cook_chop');
                if (e === 'crack' || e === 'strike-miss') sfx('activity_potion_fail');
            }
            if (was !== state.phase && state.phase === 'strike') sfx('activity_cook_sizzle');
            if (state.over) {
                press.destroy();
                ruined = state.ruined;
                results.push({ stage: 'work', weight: stage.weight, performance: workPerformance(state) });
                speak('moment', '', '', describeWork(state, { worked }));
                sfx(ruined ? 'activity_potion_fail' : 'activity_cook_done');
                status.textContent = state.ruined ? `${worked} was ruined.` : state.unfinished ? 'Out of time.' : 'Finished.';
                setTimeout(() => (ruined ? settle() : next()), 800);
                return;
            }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
    }

    /** One last precise tap. */
    function stageFinish(stage, next) {
        const scale = difficultyScale(recipe.level, tier) * effectScale(craft, mix, 'finish', 'zone');
        const status = stageBox(say('finish', 'Finish'), 'One last tap in the green zone seals it.');
        const meter = createMeter({ difficulty, assist, scale });
        meter.setCenter(0.25 + Math.random() * 0.5);
        const press = bigButton(win, say('finish', 'Finish'), () => {
            const q = meter.quality();
            meter.stop();
            press.destroy();
            results.push({ stage: 'finish', weight: stage.weight, performance: qualityScore(q) });
            sfx('activity_potion_success');
            status.textContent = q === 'perfect' ? 'Perfect!' : q === 'good' ? 'Good.' : 'Missed.';
            setTimeout(next, 500);
        });
        cleanups.push(() => { meter.stop(); press.destroy(); });
        wrap.append(meter.el, press.button, status);
        meter.start();
    }

    /* ------------------------------------------------------------------ the result */

    function settle() {
        if (finished) return;
        finished = true;
        stop();
        const fit = mixtureFit(recipe, mix);
        const performance = processScore(results);
        const { q, grade } = craftQuality({ fit, performance, tier, materialWeight: craft.materialWeight, ruined });
        const consume = consumeFor(picks, pack, { outputNames: outputNamesOf(craft) });
        const rewards = craftRewards({ craft, recipe, grade, tier, difficulty, partner: Boolean(partner), consume });
        sfx(grade === 'failed' ? 'activity_potion_fail' : 'activity_potion_success');
        speak('end', '', grade === 'failed' ? 'poor' : grade);
        const out = outputFor(recipe, grade);
        const lines = settleActivity({
            activityId: ctx.activityId || craft.id, label, partner, subject: rewards.subject,
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${recipe.name}, ${GRADE_TEXT[grade].toLowerCase()}${ruined ? ` (${say('tended', 'the work')} was ruined)` : ''}.`,
            rewards: { grade, levelXp: rewards.levelXp, profXp: rewards.profXp, partnerProfXp: rewards.partnerProfXp, bonds: [...rewards.bonds, ...helpBonds], items: rewards.items, consume: rewards.consume },
        });
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', out ? `${out.name}` : 'Nothing was made'));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[grade]}${out?.note ? `: ${out.note}` : ''}`));
        const list = el('ul');
        list.append(el('li', '', `Materials fit ${Math.round(fit * 100)}%, your work ${Math.round(performance * 100)}%.`));
        if (out && rewards.items[0]?.qty > 1) list.append(el('li', '', `You made ${rewards.items[0].qty}.`));
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Craft again');
        again.type = 'button';
        again.addEventListener('click', onAgain);
        const leave = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
        leave.type = 'button';
        leave.addEventListener('click', onLeave);
        row.append(again, leave);
        box.append(row);
        wrap.replaceChildren(box);
        again.focus();
    }

    showSelect();
    speak('start');
    return { stop };
}
