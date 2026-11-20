import { assistOn } from '../../../src/touch-ease.js';
import { mealRestore, gradedRestore } from '../../../src/activity-hunger-core.js';
import { teaSprite, snackSprite, knownLine } from '../../../src/activity-tea-core.js';
import {
    STEEP_DEFAULTS, newSteep, stepSteep, steepPerformance, steepWord, hostSession, offerReaction, cannedReaction, hostRewards, describeHost,
} from '../../../src/activity-host-core.js';
import { normalizeActionKey, actionKeyLabel } from '../../../src/activity-config-core.js';
import { term } from '../../../src/activity-terms.js';
import { activitySettings, cardOf, settleActivity, rememberTaste, sfx, startMusic, stopMusic } from '../activities-runtime.js';
import { talker } from './harvest-ui.js';
import { createHostTable } from './host-table.js';

/**
 * Tea Time (fork): you are the host. Choose a tea tin, make the tea (the pot steeps; pour it when the strength looks right), choose
 * something to eat, and offer it. Talk to your guest in the chat while you sip. How well it suits them and how well it was made give
 * the grade; there are no topics to pick. The rules are in src/activity-host-core.js and the screen is host-table.js (shared with
 * Share a Meal).
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };

/**
 * @param {object} win the activity window handle
 * @param {{ partner: string, label: string, preset: object, activityId?: string,
 *   teas: { name: string, mark: string|null }[], snacks: { name: string, mark: string|null }[], bringItems: { name: string, qty: number }[],
 *   deal?: () => { teas: object[], snacks: object[] }, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runTea(win, ctx) {
    const { partner, label, preset, onLeave, onAgain } = ctx;
    const settings = activitySettings();
    const card = cardOf(partner);
    const prefs = card?.prefs;
    const teaWord = term(preset, 'tea');
    let spread = { teas: ctx.teas || [], snacks: ctx.snacks || [] };
    let stage = 'tin';                 // tin -> steeping -> made -> offered -> done
    let chosenTea = '';
    let chosenFood = '';
    let steep = null;
    let perf = 0;
    let brewWord = '';
    let said = 0;
    let finished = false;
    let raf = 0;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-mug-hot');
    const key = actionKeyLabel(settings.actionKey);
    win.setHelp([
        { title: 'The goal', text: `Be a good host. Make ${partner} a ${teaWord} they will like, put out something nice to eat, offer it, and talk with them while you sip. How well it suits them and how well you made it decide the grade.` },
        { title: 'The table', text: `Click a tea tin to choose the ${teaWord}. Click the tea set to start steeping, then click it again (or press ${key} or Space) when the strength bar is in the green. Click a plate to put it out, or bring something from your pack. Then press "Offer it".` },
        { title: 'Their tastes', text: 'You are not told what they like. A heart on a tin or a plate means you already know. Watch their face and what they say: what they reveal is kept for next time.' },
        { title: 'Making the tea', text: 'Too early and the tea is weak, too late and it is bitter. Pouring inside the green gives the best cup.' },
        { title: 'Talking', text: 'Use the chat while you sip. Talking at least twice while you host is worth a point. There are no topics: say what you like.' },
        { title: 'The result', text: 'You get a grade. A good or perfect cup warms the bond a little (once a day per guest), and there is a little XP. What you learn about their tastes is written down.' },
    ]);

    const speak = talker(win, partner, label, () => describeHost(hostSession({ guest: partner, drink: chosenTea, food: chosenFood ? { name: chosenFood } : null, perf, brewWord, prefs }), { drinkWord: teaWord, stage: stage === 'offered' ? 'offered' : 'before' }));
    const table = createHostTable({
        partner, portraitUrl: card?.teaPortrait || card?.imageUrl || '',
        groups: [{ id: 'tins', cols: 5, label: `${teaWord} tins` }, { id: 'set', cols: 1, label: 'The tea set' }, { id: 'plates', cols: 2, label: 'Things to eat' }],
    });
    win.main.replaceChildren(table.el);

    const tinSpots = new Map();
    const plateSpots = new Map();
    let setSpot = null;
    let cupDecor = null;
    let offerBtn = null;
    let finishBtn = null;
    let spreadBtn = null;
    let bringSelect = null;

    /* ------------------------------------------------------------------ the table */

    const buildSpread = () => {
        for (const g of ['tins', 'plates']) table.group(g).replaceChildren();
        tinSpots.clear();
        plateSpots.clear();
        for (const t of spread.teas) {
            const spot = table.addSpot('tins', {
                id: t.name, label: t.name, mark: t.mark, icon: 'fa-mug-hot',
                layers: [{ key: 'tea.tin', vars: { sprite: teaSprite(t.name) } }],
                onClick: () => chooseTea(t.name),
            });
            tinSpots.set(t.name, spot);
        }
        for (const sn of spread.snacks) {
            const spot = table.addSpot('plates', {
                id: sn.name, label: sn.name, mark: sn.mark, icon: 'fa-cookie-bite',
                layers: [{ key: 'mech.prop', vars: { set: 'kitchen', part: 'plate' } }, { key: 'tea.food', vars: { sprite: snackSprite(sn.name) }, cls: 'is-onplate' }],
                onClick: () => chooseFood(sn.name),
            });
            plateSpots.set(sn.name, spot);
        }
        paintChoices();
    };

    function paintChoices() {
        for (const [name, spot] of tinSpots) { spot.setChosen(name === chosenTea); spot.setDisabled(stage !== 'tin'); }
        for (const [name, spot] of plateSpots) { spot.setChosen(name === chosenFood); spot.setDisabled(stage === 'steeping' || stage === 'done'); }
        setSpot?.setDisabled(!chosenTea || (stage !== 'tin' && stage !== 'steeping'));
        if (offerBtn) offerBtn.disabled = stage !== 'made';
        if (finishBtn) finishBtn.hidden = stage !== 'offered';
        if (offerBtn) offerBtn.hidden = stage === 'offered' || stage === 'done';
        if (spreadBtn) spreadBtn.hidden = stage !== 'tin' || !ctx.deal;
        if (bringSelect) { bringSelect.hidden = stage === 'offered' || stage === 'done'; bringSelect.disabled = stage === 'steeping'; }
    }

    function chooseTea(name) {
        if (stage !== 'tin') return;
        chosenTea = name;
        sfx('activity_tea_cup');
        table.setHint(`${name}. Now click the tea set to start steeping.`);
        paintChoices();
    }

    function chooseFood(name) {
        if (stage === 'steeping' || stage === 'offered' || stage === 'done') return;
        chosenFood = chosenFood === name ? '' : name;
        if (chosenFood && bringSelect) bringSelect.value = '';
        sfx('activity_tea_cup');
        paintChoices();
        if (stage === 'made') table.setHint(chosenFood ? `${chosenFood} is on the table. Press "Offer it" when you are ready.` : 'Choose something to eat if you like, then press "Offer it".');
    }

    /* ------------------------------------------------------------------ making the tea */

    const meter = el('div', 'snpc-act-steepmeter');
    meter.hidden = true;
    meter.setAttribute('role', 'img');
    const band = el('span', 'snpc-act-steepband');
    const level = el('span', 'snpc-act-steeplevel');
    const needle = el('span', 'snpc-act-steepneedle');
    meter.append(level, band, needle);
    table.slot.append(meter);
    // A big button to pour: easier than hitting the tea set on a phone (the tea set and the key still work).
    const pourBtn = el('button', 'snpc-act-bigtap', 'Pour now');
    pourBtn.type = 'button';
    pourBtn.hidden = true;
    pourBtn.addEventListener('click', () => pourTea());
    table.slot.append(pourBtn);

    function startSteep() {
        if (stage !== 'tin' || !chosenTea) return;
        stage = 'steeping';
        steep = newSteep({ ease: assistOn(settings) ? 1.4 : 1, seconds: assistOn(settings) ? STEEP_DEFAULTS.seconds * 1.4 : STEEP_DEFAULTS.seconds });
        band.style.left = `${steep.band[0] * 100}%`;
        band.style.width = `${(steep.band[1] - steep.band[0]) * 100}%`;
        meter.hidden = false;
        pourBtn.hidden = false;
        sfx('activity_tea_pour');
        table.setHint(`Steeping ${chosenTea}... click the tea set (or press ${key} or Space) when the strength is in the green.`);
        paintChoices();
        let last = performance.now();
        const frame = (now) => {
            if (!alive() || stage !== 'steeping') return;
            stepSteep(steep, now - last, false);
            last = now;
            level.style.width = `${steep.level * 100}%`;
            needle.style.left = `${steep.level * 100}%`;
            meter.setAttribute('aria-label', `Strength ${Math.round(steep.level * 100)} percent`);
            if (steep.over) { pourTea(); return; }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
    }

    function pourTea() {
        if (stage !== 'steeping') return;
        cancelAnimationFrame(raf);
        if (!steep.over) stepSteep(steep, 0, true);
        perf = steepPerformance(steep);
        brewWord = steepWord(perf, steep.pouredAt);
        stage = 'made';
        meter.hidden = true;
        pourBtn.hidden = true;
        sfx(perf >= 0.55 ? 'activity_tea_good' : 'activity_tea_cup');
        cupDecor = table.addDecor('set', { layers: [{ key: 'tea.cup', vars: { sprite: teaSprite(chosenTea) } }], label: `A cup of ${chosenTea}` });
        table.setHint(`The ${teaWord} is ${brewWord}. Choose something to eat if you like, then press "Offer it".`);
        paintChoices();
    }

    const onKey = (e) => {
        if (!table.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (stage !== 'steeping') return;
        const bound = normalizeActionKey(settings.actionKey);
        if (e.code !== 'Space' && (bound.startsWith('Mouse') || e.code !== bound)) return;
        const t = e.target;
        if (t && ['input', 'textarea', 'select'].includes((t.tagName || '').toLowerCase())) return;
        e.preventDefault();
        pourTea();
    };
    document.addEventListener('keydown', onKey);

    /* ------------------------------------------------------------------ offering it, talking, and the result */

    const foodNow = () => {
        if (chosenFood) return { kind: 'food', name: chosenFood };
        if (bringSelect?.value) return { name: bringSelect.value };
        return null;
    };
    const sessionNow = () => hostSession({ guest: partner, drink: chosenTea, food: foodNow(), perf, said, brewWord, prefs });

    function offer() {
        if (stage !== 'made') return;
        stage = 'offered';
        const session = sessionNow();
        const reaction = offerReaction(session);
        table.setReaction(reaction);
        sfx(reaction === 'uneasy' || reaction === 'displeased' ? 'activity_tea_bad' : 'activity_tea_good');
        table.setHint(`${partner} takes the ${teaWord}. Talk with them in the chat while you sip, then press "Finish".`);
        paintChoices();
        const line = cannedReaction(reaction);
        if (!win.talk().length) win.addLine(partner, line, 'bot');
        speak('moment', '', reaction, `${describeHost(session, { drinkWord: teaWord })}. Their first reaction: ${reaction}.`);
    }

    win.onSay((text, { regen = false } = {}) => {
        if (stage === 'done') return;
        if (stage === 'offered' && !regen) said += 1;
        speak('chat', text);
    });

    function finish() {
        if (stage !== 'offered') return;
        finished = true;
        stage = 'done';
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey);
        const session = sessionNow();
        const rewards = hostRewards(session);
        const grade = rewards.grade;
        const learned = rememberTaste(partner, session.known) || [];
        sfx(grade === 'poor' ? 'activity_tea_bad' : 'activity_tea_good');
        speak('end', '', grade === 'poor' ? 'poor' : grade);
        const lines = settleActivity({
            activityId: ctx.activityId || 'tea', label, partner,
            summary: `${label} with ${partner}: ${describeHost(session, { drinkWord: teaWord })}, ${GRADE_TEXT[grade].toLowerCase()}.`, lines: win.talk(),
            rewards: { grade, levelXp: rewards.levelXp, bonds: rewards.bonds, restore: { hunger: gradedRestore(mealRestore({ drink: chosenTea, food: session.food?.name || '', recipes: preset.harvest?.recipes, defaults: preset.tea?.restore }), grade) } },
        });
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', `${GRADE_TEXT[grade]} cup`));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[grade]}: ${chosenTea}${session.food ? ` with ${session.food.name}` : ''}, ${brewWord}${session.talk ? ', and good company' : ''}`));
        const list = el('ul');
        const learnedAll = [...new Map([...learned, ...session.known].map(k => [`${k.cat}:${String(k.value).toLowerCase()}`, k])).values()];
        if (learnedAll.length) list.append(el('li', '', `You learned: ${knownLine(learnedAll)}.`));
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Another cup');
        again.type = 'button';
        again.addEventListener('click', () => { stopMusic(); onAgain(); });
        const leave = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
        leave.type = 'button';
        leave.addEventListener('click', () => { stopMusic(); onLeave(); });
        row.append(again, leave);
        box.append(row);
        win.main.replaceChildren(box);
        again.focus();
    }

    /* ------------------------------------------------------------------ begin */

    setSpot = table.addSpot('set', {
        id: 'teaset', label: 'Tea set', icon: 'fa-mug-hot', title: `Click to start steeping, and again to pour (or press ${key})`,
        layers: [{ key: 'tea.set', vars: { part: 'tray' } }],
        onClick: () => { if (stage === 'tin') startSteep(); else if (stage === 'steeping') pourTea(); },
    });
    setSpot.setDisabled(true);

    if (ctx.bringItems?.length) {
        bringSelect = el('select', 'snpc-act-select');
        bringSelect.setAttribute('aria-label', 'Bring something from your pack');
        bringSelect.append(new Option('Nothing from my pack', ''));
        for (const it of ctx.bringItems) bringSelect.append(new Option(it.qty > 1 ? `${it.name} (x${it.qty})` : it.name, it.name));
        bringSelect.addEventListener('change', () => { if (bringSelect.value) { chosenFood = ''; paintChoices(); } });
    }
    offerBtn = table.button('Offer it', offer, { primary: true });
    finishBtn = table.button('Finish', finish, { primary: true });
    spreadBtn = table.button('Lay out a different spread', () => { if (ctx.deal) { spread = ctx.deal(); chosenTea = ''; chosenFood = ''; buildSpread(); table.setHint(`Choose a ${teaWord} tin.`); } }, { quiet: true });
    if (bringSelect) table.buttons.append(bringSelect);
    buildSpread();
    paintChoices();
    table.setHint(`Welcome ${partner}. Choose a ${teaWord} tin to begin.`);
    sfx('activity_tea_cup');
    startMusic(preset.tea?.music);
    speak('start');
}
