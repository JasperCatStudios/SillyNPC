import {
    newGame, submit, feedbackText, rewardsOf, describeState, CODE_LENGTH, ALLOW_REPEATS,
} from '../../../src/activity-mastermind-core.js';
import { askPartner, settleActivity, sfx, talkAllowed } from '../activities-runtime.js';

/**
 * The Brewing screen (fork): draws the recipe game into the activity window and runs it. The rules are in
 * src/activity-mastermind-core.js. Every ingredient has a colour, a shape and a letter, and each answer is given as pegs
 * and in words, so nothing depends on colour alone.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Barely', failed: 'Failed' };

/**
 * @param {object} win the activity window handle
 * @param {{ partner: string, label: string, difficulty: string, names?: object, recipe: string, failed: string, subject?: string,
 *           onLeave: () => void, onAgain: () => void }} ctx
 */
export function runPotion(win, ctx) {
    const { partner, label, subject, onLeave, onAgain } = ctx;
    const game = newGame({ difficulty: ctx.difficulty, names: ctx.names });
    const byId = Object.fromEntries(game.symbols.map(s => [s.id, s]));
    /** The slots being filled for the next try: an ingredient id or '' for each. */
    const slots = Array(CODE_LENGTH).fill('');
    let halfSaid = false;
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-flask');
    win.setHelp([
        { title: 'The goal', text: 'A recipe of four ingredients is hidden. Work it out before you run out of tries.' },
        { title: 'Making a try', text: 'Tap ingredients to fill the four slots, in order. Tap a filled slot to take that ingredient out. Then press Try it.' },
        { title: 'Reading the answer', text: 'After each try you get two numbers under it. They only count: they do not say which slot or which ingredient.\n\nExact match: how many ingredients are the right ingredient in the right slot.\n\nWrong position: how many ingredients are the right ingredient, but in a different slot.\n\nBoth 0: none of your four ingredients are in the recipe at all.\n\nThe numbers are not tied to your slots, so the first slot being right does not show up anywhere. Use the answers to narrow it down.' },
        { title: 'The settings', text: `${ALLOW_REPEATS[game.difficulty] ? 'An ingredient can be used more than once in a recipe and in a try.' : 'On Easy no ingredient appears twice in the recipe, and you cannot use one twice in a try.'} You have ${game.max} tries and ${game.symbols.length} ingredients to choose from. Each ingredient has a colour, a shape and a letter.` },
        { title: 'What you gain', text: 'Solve it in few tries for a better potion. A solved recipe gives you the potion; a failed brew gives a worthless one. You also gain skill XP (if a skill is set for brewing) and a little level XP. Your partner talks along the way, and you can chat with them in the Chat tab.' },
    ]);

    const wrap = el('div', 'snpc-act-brew');
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const tries = el('div', 'snpc-act-gauge');
    const historyBox = el('ol', 'snpc-act-brewlog');
    historyBox.setAttribute('aria-label', 'Your tries');
    const current = el('div', 'snpc-act-slots');
    current.setAttribute('role', 'group');
    current.setAttribute('aria-label', 'Your next try');
    const tray = el('div', 'snpc-act-tray');
    tray.setAttribute('role', 'group');
    tray.setAttribute('aria-label', 'Ingredients');
    const actions = el('div', 'snpc-act-row');
    const go = el('button', 'snpc-act-btn', 'Try it');
    go.type = 'button';
    const clear = el('button', 'snpc-act-btn is-quiet', 'Clear');
    clear.type = 'button';
    actions.append(go, clear);
    wrap.append(tries, historyBox, current, tray, actions, status);
    win.main.replaceChildren(wrap);

    const chip = (id, extraClass = '') => {
        const s = byId[id];
        const node = el('span', `snpc-act-chip ${extraClass}`);
        if (!s) { node.classList.add('is-empty'); node.textContent = '·'; return node; }
        node.style.setProperty('--chip', s.color);
        node.append(el('span', 'snpc-act-chip-shape', s.shape), el('b', '', s.letter));
        node.title = s.name;
        return node;
    };

    const say = (t) => { status.textContent = t; };

    const speak = async (beat, playerText = '') => {
        if (!partner || !talkAllowed(beat)) return;      // played alone, or nothing would be said
        win.addLine(partner, '...', 'typing');
        const out = await askPartner({
            partner, label, beat, stateText: describeState(game), playerText, talkSoFar: win.talk(),
            outcome: beat === 'end' ? rewardsOf(game, { recipe: ctx.recipe, failed: ctx.failed }).grade.replace('failed', 'poor') : '',
        });
        win.removeTyping();
        if (win.isOpen() && out.text) win.addLine(partner, out.text, 'bot');
    };
    win.onSay((text) => { speak('chat', text); });

    const draw = () => {
        tries.replaceChildren();
        for (let i = 0; i < game.max; i++) tries.append(el('span', `snpc-act-pip${i < game.max - game.guesses.length ? ' is-on' : ''}`));
        tries.setAttribute('role', 'img');
        tries.setAttribute('aria-label', `${game.max - game.guesses.length} of ${game.max} tries left`);
        win.setSub(`${game.guesses.length} of ${game.max} tries`);

        historyBox.replaceChildren();
        for (const g of game.guesses) {
            const row = el('li', 'snpc-act-brewrow');
            const chips = el('span', 'snpc-act-chips');
            for (const id of g.guess) chips.append(chip(id));
            // Two labelled counters instead of a row of dots, so nothing looks like it belongs to a slot.
            const counters = el('div', 'snpc-act-counters');
            const counter = (n, title, sub, cls) => {
                const c = el('div', 'snpc-act-counter');
                c.append(el('span', `snpc-act-count ${cls}`, String(n)));
                const words = el('span', 'snpc-act-counter-words');
                words.append(el('strong', '', title), el('small', '', sub));
                c.append(words);
                return c;
            };
            counters.append(
                counter(g.exact, 'Exact match', 'Right ingredient + position', 'is-exact'),
                counter(g.present, 'Wrong position', 'Right ingredient, different slot', 'is-wrong'),
            );
            row.setAttribute('aria-label', `${g.guess.map(id => byId[id].name).join(', ')}: ${feedbackText(g)}`);
            row.append(chips, el('div', 'snpc-act-divider'), counters);
            historyBox.append(row);
        }
        historyBox.scrollTop = historyBox.scrollHeight;

        current.replaceChildren();
        slots.forEach((id, i) => {
            const b = el('button', `snpc-act-slot${id ? ' is-filled' : ''}`);
            b.type = 'button';
            b.setAttribute('aria-label', id ? `Slot ${i + 1}: ${byId[id].name}. Tap to remove` : `Slot ${i + 1}: empty`);
            b.append(chip(id));
            b.addEventListener('click', () => { if (!game.over && id) { slots[i] = ''; draw(); } });
            current.append(b);
        });
        const full = slots.every(Boolean);
        go.disabled = !full || game.over;
        clear.disabled = game.over || slots.every(s => !s);
        for (const b of tray.querySelectorAll('button')) b.disabled = game.over;
    };

    for (const s of game.symbols) {
        const b = el('button', 'snpc-act-ingredient');
        b.type = 'button';
        b.setAttribute('aria-label', `${s.name}, ${s.shape} ${s.letter}`);
        b.append(chip(s.id));
        b.append(el('small', '', s.name));
        b.addEventListener('click', () => {
            if (game.over) return;
            const at = slots.indexOf('');
            if (at < 0) { say('The four slots are full. Tap a slot to take one out, or press Try it.'); return; }
            if (!ALLOW_REPEATS[game.difficulty] && slots.includes(s.id)) { say(`${s.name} is already in the try. On Easy each ingredient is used once.`); return; }
            slots[at] = s.id;
            sfx('activity_potion_pour');
            draw();
        });
        tray.append(b);
    }

    clear.addEventListener('click', () => { slots.fill(''); draw(); });
    go.addEventListener('click', () => {
        if (game.over || !alive()) return;
        const res = submit(game, slots.slice());
        if (!res.ok) { say(res.reason); return; }
        slots.fill('');
        sfx(res.result.exact === CODE_LENGTH ? 'activity_potion_success' : 'activity_potion_hint');
        say(res.result.exact === CODE_LENGTH ? 'That is the recipe!' : feedbackText(res.result) + '.');
        draw();
        if (!halfSaid && !game.over && game.guesses.length >= Math.ceil(game.max / 2)) { halfSaid = true; speak('halfway'); }
        if (game.over) finish();
    });

    function finish() {
        finished = true;
        const rewards = rewardsOf(game, { recipe: ctx.recipe, failed: ctx.failed });
        if (!rewards.brewed) sfx('activity_potion_fail');
        speak('end');
        setTimeout(() => {
            const summary = `${label}${partner ? ` with ${partner}` : ' alone'}: ${describeState(game)}.`;
            const lines = settleActivity({
                activityId: 'potion', label, partner, subject, summary, lines: win.talk(),
                rewards: { grade: rewards.grade, profXp: rewards.profXp, partnerProfXp: rewards.partnerProfXp, levelXp: rewards.levelXp, bonds: rewards.bond ? [rewards.bond] : [], item: rewards.item },
            });
            showResult(rewards, lines);
        }, 900);
    }

    function showResult(rewards, lines) {
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', rewards.brewed ? `You brewed ${rewards.item.name}` : 'The brew failed'));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[rewards.grade]}: ${game.guesses.length} of ${game.max} tries`));
        const answer = el('div', 'snpc-act-chips');
        for (const id of game.code) answer.append(chip(id));
        answer.setAttribute('aria-label', `The recipe was ${game.code.map(id => byId[id].name).join(', ')}`);
        box.append(el('small', '', 'The recipe:'), answer);
        const list = el('ul');
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Brew again');
        again.type = 'button';
        again.addEventListener('click', onAgain);
        const leave = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
        leave.type = 'button';
        leave.addEventListener('click', onLeave);
        row.append(again, leave);
        box.append(row);
        win.main.replaceChildren(box);
        again.focus();
    }

    draw();
    say('Pick four ingredients, then press Try it.');
    speak('start');
}
