import { newGame, flip, hideMiss, canFlip, rewardsOf, describeState, knowledgeOf, GRADES } from '../../../src/activity-memory-core.js';
import { askPartner, settleStudy, sfx, talkAllowed, activePreset } from '../activities-runtime.js';
import { term } from '../../../src/activity-terms.js';

/**
 * The Study board (fork): draws the rune memory game into the activity window and runs it. The rules are in
 * src/activity-memory-core.js; this file is only the screen, the sounds and the partner's talk.
 *
 * Tiles are buttons with labels, a match is announced through the window's live chat line, and the arrow keys
 * move between tiles. A missed pair turns back by itself after a moment (or at the next flip).
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };
const MISS_MS = 750;

/**
 * @param {object} win the activity window handle
 * @param {{ partner: string, label: string, pairs: number, difficulty: string, runes?: string[], subject?: string, subjectLabel?: string,
 *           onLeave: () => void, onAgain: () => void }} ctx
 */
export function runStudy(win, ctx) {
    const { partner, label, subject, onLeave, onAgain } = ctx;
    const preset = activePreset();
    const tile = term(preset, 'tile');
    const cursed = term(preset, 'cursedTile');
    const know = term(preset, 'knowledge');
    const cls = term(preset, 'classWord').toLowerCase();
    const game = newGame({ pairs: ctx.pairs, difficulty: ctx.difficulty, runes: ctx.runes });
    const cols = game.pairs === 12 ? 6 : 4;
    const rows = Math.ceil(game.tiles.length / cols);
    let busy = false;
    let halfSaid = false;
    let curseSaid = false;
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-book-open');
    win.setHelp([
        { title: 'The goal', text: `Find every pair of matching ${tile}s before your concentration runs out.` },
        { title: 'How a turn works', text: `Tap two tiles to turn them over. If the ${tile}s match, they stay open. If not, they turn back and you lose one point of concentration (the dots above the board).` },
        { title: `Cursed ${tile}s`, text: `On the medium and large boards one or two ${tile}s are cursed. When one turns up it is marked in purple with a skull. If you miss while a ${cursed} is one of the two tiles, every tile that is not matched yet is shuffled, so what you remembered is lost. Matching the cursed pair lifts the curse and gives a point of concentration back.` },
        { title: 'When it ends', text: 'The board is cleared (you win), or concentration reaches zero (the session ends early, and you keep credit for the pairs you found).' },
        { title: 'What you gain', text: `${know} for a ${cls} change, skill XP in the subject you chose, and a little level XP. A cleared board with plenty of concentration left earns the best grade. Your partner talks along the way, and you can chat with them in the Chat tab.` },
        { title: 'Keyboard', text: 'Arrow keys move between tiles. Enter or Space turns one over. Escape closes the window.' },
    ]);

    const wrap = el('div', 'snpc-act-study');
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const gauge = el('div', 'snpc-act-gauge');
    const grid = el('div', 'snpc-act-grid');
    grid.style.setProperty('--cols', String(cols));
    grid.style.setProperty('--rows', String(rows));
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', `${tile} tiles`);
    wrap.append(gauge, grid, status);
    win.main.replaceChildren(wrap);

    const say = (text) => { status.textContent = text; };
    const stateText = () => describeState(game);

    /** The partner speaks: a typing line, then the reply (or a canned line). Never blocks the game. */
    const speak = async (beat, playerText = '') => {
        if (!partner || !talkAllowed(beat)) return;      // played alone, or nothing would be said
        win.addLine(partner, '...', 'typing');
        const out = await askPartner({
            partner, label, beat, stateText: stateText(), playerText, talkSoFar: win.talk(),
            outcome: beat === 'end' ? rewardsOf(game).grade : '',
        });
        win.removeTyping();
        if (win.isOpen() && out.text) win.addLine(partner, out.text, 'bot');
    };
    win.onSay((text) => { speak('chat', text); });

    const tiles = game.tiles.map((_, i) => {
        const b = el('button', 'snpc-act-tile');
        b.type = 'button';
        b.dataset.index = String(i);
        b.addEventListener('click', () => onTile(i));
        b.addEventListener('keydown', (e) => {
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
            if (!step) return;
            e.preventDefault();
            const next = tiles[i + step];
            if (next) next.focus();
        });
        grid.append(b);
        return b;
    });

    const draw = () => {
        game.tiles.forEach((t, i) => {
            const b = tiles[i];
            const open = t.state !== 'down';
            b.className = `snpc-act-tile${t.state === 'up' ? ' is-up' : ''}${t.state === 'matched' ? ' is-matched' : ''}`
                + `${open && game.cursed.includes(t.symbol) && game.known.includes(t.symbol) ? ' is-cursed' : ''}`;
            b.textContent = open ? t.symbol : '';
            b.disabled = t.state === 'matched' || game.over;
            b.setAttribute('aria-label', open ? `${tile} ${i + 1}, ${t.symbol}${t.state === 'matched' ? ', matched' : ''}` : `${tile} ${i + 1}, face down`);
        });
        gauge.replaceChildren();
        for (let i = 0; i < game.startConcentration; i++) gauge.append(el('span', `snpc-act-pip${i < game.concentration ? ' is-on' : ''}`));
        gauge.setAttribute('role', 'img');
        gauge.setAttribute('aria-label', `Concentration ${Math.max(0, game.concentration)} of ${game.startConcentration}`);
        win.setSub(`${game.found} of ${game.pairs} pairs`);
    };

    function finish() {
        finished = true;
        const rewards = rewardsOf(game);
        sfx(game.cleared ? 'activity_study_clear' : 'activity_study_miss');
        speak('end');
        // The end talk is awaited by a short delay so its line can be part of what is kept.
        setTimeout(() => {
            const kept = win.talk();
            const lines = settleStudy({ partner, label, subject, game, rewards, lines: kept, activityId: ctx.activityId || undefined });
            showResult(rewards, lines);
        }, 900);
    }

    function showResult(rewards, lines) {
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', game.cleared ? 'The board is cleared' : 'Out of concentration'));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[rewards.grade]}: ${game.found} of ${game.pairs} pairs found`));
        const list = el('ul');
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Play again');
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

    function onTile(i) {
        if (busy || !alive() || !canFlip(game, i)) return;
        const { ok, events } = flip(game, i);
        if (!ok) return;
        sfx('activity_study_flip');
        let announce = '';
        let wait = 0;
        for (const e of events) {
            if (e.type === 'match') { sfx('activity_study_match'); announce = `Matched ${e.symbol}.`; }
            else if (e.type === 'miss') { announce = 'No match.'; wait = MISS_MS; }
            else if (e.type === 'curse-seen') { win.addLine('', `A ${cursed} turned up (${e.symbol}).`, 'system'); announce = `A ${cursed}: ${e.symbol}.`; }
            else if (e.type === 'curse-lifted') { win.addLine('', 'The curse was lifted.', 'system'); announce = 'The curse is lifted. Concentration restored a little.'; }
            else if (e.type === 'shuffle') { sfx('activity_study_curse'); win.addLine('', `The ${cursed} shuffled the board.`, 'system'); announce = 'The tiles shuffled.'; wait = 500; grid.classList.add('is-shuffled'); }
            else if (e.type === 'miss' && !events.some(x => x.type === 'shuffle')) sfx('activity_study_miss');
        }
        if (events.some(e => e.type === 'miss') && !events.some(e => e.type === 'shuffle')) sfx('activity_study_miss');
        say(announce);
        draw();
        if (events.some(e => e.type === 'shuffle') && !curseSaid) { curseSaid = true; speak('curse'); }
        if (!halfSaid && game.found * 2 >= game.pairs && !game.over) { halfSaid = true; speak('halfway'); }
        if (game.over) { finish(); return; }
        if (wait) {
            busy = true;
            setTimeout(() => {
                busy = false;
                grid.classList.remove('is-shuffled');
                if (game.pending.length) hideMiss(game);
                if (alive()) draw();
            }, wait);
        }
    }

    draw();
    say('Flip two tiles to find a pair.');
    speak('start');
    setTimeout(() => tiles[0]?.focus({ preventScroll: true }), 0);
}

export { GRADES, knowledgeOf };
