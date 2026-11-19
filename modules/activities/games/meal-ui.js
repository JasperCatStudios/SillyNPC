import { mealRestore, gradedRestore } from '../../../src/activity-hunger-core.js';
import { knownLine } from '../../../src/activity-tea-core.js';
import { hostSession, offerReaction, cannedReaction, hostRewards, describeHost } from '../../../src/activity-host-core.js';
import { dishArt } from '../../../src/mech/script-core.js';
import { cardOf, settleActivity, rememberTaste, sfx, startMusic, stopMusic } from '../activities-runtime.js';
import { talker } from './harvest-ui.js';
import { createHostTable } from './host-table.js';

/**
 * Share a Meal (fork): an optional step after cooking. The same table as Tea Time: the guest on top, the table with things to click on
 * (the plate you made, a drink, a candle and a napkin to set the table), the bar with what to do next, and the chat beside it.
 * Serve the dish, talk while you eat, and finish. How well the dish turned out, how well it suits the guest and whether you laid the
 * table nicely decide the grade. A meal you made yourself is worth a little extra warmth. Hunger is restored from the recipe's value.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };
/** How well a cooking grade counts as a made dish (feeds the same 0 to 2 points the steeping gives Tea Time). */
const DISH_QUALITY = { perfect: 1, good: 0.86, fair: 0.6, poor: 0.2 };
const DRINKS = [{ name: 'Water', part: 'water', icon: 'fa-glass-water' }, { name: 'Tea', part: 'mug', icon: 'fa-mug-hot' }];
const EXTRAS = [{ id: 'candle', label: 'Candle', part: 'candle', icon: 'fa-fire' }, { id: 'napkin', label: 'Napkin', part: 'napkin', icon: 'fa-scroll' }, { id: 'cutlery', label: 'Cutlery', part: 'cutlery', icon: 'fa-utensils' }];

/**
 * @param {object} win the activity window handle
 * @param {{ partner: string, label: string, preset: object, activityId?: string, recipe: object, grade: string, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runMeal(win, ctx) {
    const { partner, label, preset, recipe, grade: madeGrade, onLeave, onAgain } = ctx;
    const card = cardOf(partner);
    const prefs = card?.prefs;
    const foodWord = 'meal';
    let stage = 'set';                 // set -> served -> done
    let chosenDrink = '';
    const extras = new Set();
    let said = 0;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-utensils');
    win.setHelp([
        { title: 'The goal', text: `Share the ${recipe.name} you made with ${partner}. Set the table, serve it and talk while you eat.` },
        { title: 'The table', text: 'The plate is your dish. Click a drink if you like, and click the candle, napkin or cutlery to lay the table. Then press "Serve it".' },
        { title: 'Their tastes', text: 'You are not told what they like. Watch their face and what they say: what they reveal is kept for next time.' },
        { title: 'Talking', text: 'Use the chat while you eat. Talking at least twice is worth a point. Laying the table nicely is worth a point too.' },
        { title: 'The result', text: 'A good or perfect meal warms the bond a little (once a day per guest). A meal you made yourself is worth a little extra. Eating also restores hunger when vitals are on.' },
    ]);

    const speak = talker(win, partner, label, () => describeHost(hostSession({ guest: partner, drink: chosenDrink, food: { name: recipe.name }, perf: DISH_QUALITY[madeGrade] ?? 0.6, prefs }), { drinkWord: 'drink', stage: 'before' }));
    const table = createHostTable({
        partner, portraitUrl: card?.teaPortrait || card?.imageUrl || '',
        groups: [{ id: 'drinks', cols: 1, label: 'Drinks' }, { id: 'plates', cols: 1, label: 'The dish' }, { id: 'extras', cols: 3, label: 'Setting the table' }],
    });
    win.main.replaceChildren(table.el);

    const drinkSpots = new Map();
    const extraSpots = new Map();
    let serveBtn = null;
    let finishBtn = null;

    const paint = () => {
        for (const [name, spot] of drinkSpots) { spot.setChosen(name === chosenDrink); spot.setDisabled(stage !== 'set'); }
        for (const [id, spot] of extraSpots) { spot.setChosen(extras.has(id)); spot.setDisabled(stage !== 'set'); }
        serveBtn.hidden = stage !== 'set';
        finishBtn.hidden = stage !== 'served';
    };

    for (const d of DRINKS) {
        drinkSpots.set(d.name, table.addSpot('drinks', {
            id: d.name, label: d.name, icon: d.icon, layers: [{ key: 'mech.table', vars: { part: d.part } }],
            onClick: () => { if (stage !== 'set') return; chosenDrink = chosenDrink === d.name ? '' : d.name; sfx('activity_tea_cup'); paint(); },
        }));
    }
    table.addSpot('plates', {
        id: 'dish', label: recipe.name, icon: 'fa-utensils',
        layers: [{ key: 'mech.prop', vars: { set: 'kitchen', part: 'plate' } }, { key: 'mech.food', vars: { item: `${dishArt(recipe)}-cooked` }, cls: 'is-onplate' }],
        onClick: () => { /* the dish is always on the table */ },
    }).setChosen(true);
    for (const x of EXTRAS) {
        extraSpots.set(x.id, table.addSpot('extras', {
            id: x.id, label: x.label, icon: x.icon, layers: [{ key: 'mech.table', vars: { part: x.part } }],
            onClick: () => { if (stage !== 'set') return; if (extras.has(x.id)) extras.delete(x.id); else extras.add(x.id); sfx('activity_tea_cup'); paint(); },
        }));
    }

    const sessionNow = () => hostSession({ guest: partner, drink: chosenDrink, food: { name: recipe.name }, perf: DISH_QUALITY[madeGrade] ?? 0.6, said, brewWord: `${GRADE_TEXT[madeGrade]?.toLowerCase() || 'decent'} ${foodWord}`, extra: extras.size ? 1 : 0, prefs });

    function serve() {
        if (stage !== 'set') return;
        stage = 'served';
        const session = sessionNow();
        const reaction = offerReaction(session);
        table.setReaction(reaction);
        sfx(reaction === 'uneasy' || reaction === 'displeased' ? 'activity_tea_bad' : 'activity_tea_good');
        table.setHint(`${partner} tucks in. Talk with them in the chat while you eat, then press "Finish".`);
        paint();
        if (!win.talk().length) win.addLine(partner, cannedReaction(reaction), 'bot');
        speak('moment', '', reaction, `${describeHost(session, { drinkWord: 'drink' })}. Their first reaction: ${reaction}.`);
    }

    win.onSay((text) => {
        if (stage === 'done') return;
        if (stage === 'served') said += 1;
        speak('chat', text);
    });

    function finish() {
        if (stage !== 'served') return;
        stage = 'done';
        const session = sessionNow();
        const rewards = hostRewards(session);
        const gradeNow = rewards.grade;
        // A meal you made yourself warms the bond a little more.
        const bonds = gradeNow !== 'poor' && !rewards.bonds.some(b => b.meter === 'affection') ? [...rewards.bonds, { meter: 'affection', amount: 1 }] : rewards.bonds;
        const learned = rememberTaste(partner, session.known) || [];
        sfx(gradeNow === 'poor' ? 'activity_tea_bad' : 'activity_tea_good');
        speak('end', '', gradeNow === 'poor' ? 'poor' : gradeNow);
        const lines = settleActivity({
            activityId: ctx.activityId || 'meal', label, partner,
            summary: `${label} with ${partner}: ${recipe.name}, ${GRADE_TEXT[gradeNow].toLowerCase()}.`, lines: win.talk(),
            rewards: { grade: gradeNow, levelXp: rewards.levelXp, bonds, restore: { hunger: gradedRestore(mealRestore({ drink: chosenDrink, food: recipe.name, recipes: preset.harvest?.recipes, defaults: preset.tea?.restore }), gradeNow) } },
        });
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', `${GRADE_TEXT[gradeNow]} meal`));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[gradeNow]}: ${recipe.name}${chosenDrink ? ` with ${chosenDrink.toLowerCase()}` : ''}${session.setting ? ', nicely laid' : ''}${session.talk ? ', and good company' : ''}`));
        const list = el('ul');
        const learnedAll = [...new Map([...learned, ...session.known].map(k => [`${k.cat}:${String(k.value).toLowerCase()}`, k])).values()];
        if (learnedAll.length) list.append(el('li', '', `You learned: ${knownLine(learnedAll)}.`));
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Back to cooking');
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

    serveBtn = table.button('Serve it', serve, { primary: true });
    finishBtn = table.button('Finish', finish, { primary: true });
    paint();
    table.setHint(`Your ${recipe.name} is ready. Click a drink if you like, lay the table with the candle, napkin or cutlery, then press "Serve it".`);
    sfx('activity_tea_cup');
    startMusic(preset.tea?.music);
    speak('start');
}
