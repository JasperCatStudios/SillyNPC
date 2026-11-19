import {
    newSession, judgeRound, gradeOf, rewardsOf, totalOf, knownFrom, knownLine, askThisRound, fillOpeners, neutralOpeners, neutralLine,
    moodWord, describeState, REACTION_DELTA, GRADES, teaSprite, snackSprite,
} from '../../../src/activity-tea-core.js';
import { term } from '../../../src/activity-terms.js';
import { requestStart, requestRound } from '../tea-persona.js';
import {
    activitySettings, cardOf, settleActivity, rememberTaste, teaKnown, guestLowMood, askPartner, sfx, speakAsPlayer, startMusic, loadArt,
} from '../activities-runtime.js';

/**
 * The Tea Time screen (fork): draws the session into the activity window and runs it. The rules are in
 * src/activity-tea-core.js and the talk with the model is in tea-persona.js; this file is the screen, the sounds and
 * what is kept at the end.
 *
 * A round: the guest's line, three openers (tap one) or free text, then the guest's reaction with an icon and a word
 * (never colour alone). With the model off, or a failed request, the round plays from the built-in bank.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const KIND_ICON = { question: 'fa-circle-question', story: 'fa-book-open', memory: 'fa-clock-rotate-left', tease: 'fa-face-grin-wink', compliment: 'fa-heart', plan: 'fa-calendar-check' };
const KIND_LABEL = { question: 'Question', story: 'From the story', memory: 'Memory', tease: 'Tease', compliment: 'Compliment', plan: 'Plan' };
const REACTION_ICON = { delighted: 'fa-face-grin-stars', pleased: 'fa-face-smile', neutral: 'fa-face-meh', uneasy: 'fa-face-frown-open', displeased: 'fa-face-angry' };
const REACTION_WORD = { delighted: 'Delighted', pleased: 'Pleased', neutral: 'Neutral', uneasy: 'Uneasy', displeased: 'Displeased' };
const GRADE_TEXT = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor' };

/**
 * @param {object} win the activity window handle
 * @param {{ partner: string, label: string, preset: object, tea: string, bring: { name: string } | null, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runTea(win, ctx) {
    const { partner, label, preset, tea, bring, onLeave, onAgain } = ctx;
    const s = activitySettings();
    const card = cardOf(partner);
    const prefs = card?.prefs;
    const teaWord = term(preset, 'tea');
    const llm = Boolean(s.teaLlm);
    let state = newSession({ guest: partner, tea, bring, rounds: s.teaRounds, lowMood: guestLowMood(partner), llm, prefs });
    const learned = [];          // what this session taught the player, for the result
    let busy = false;
    let finished = false;
    let nextOpeners = [];
    let failWhy = '';            // the first reason a request gave nothing usable, for the notice and the result
    let recap = '';
    let closing = '';
    const alive = () => win.isOpen() && !finished;

    win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-mug-hot');
    win.setHelp([
        { title: 'The goal', text: `Share a ${teaWord} with ${partner} and leave them in a good mood. How it goes decides the grade.` },
        { title: 'Before you start', text: `You chose a ${teaWord} and may bring one thing. If it suits their tastes it counts for you, a thing they dislike counts against you, and anything you bring at all shows effort. You are not told their tastes, so pay attention to how they react.` },
        { title: 'Each round', text: 'Their line sits at the top. Tap one of three things to say, or type your own words. They react with a face and a word, and a spoken line that hints at how it landed. Real attention, a memory you share, or something from the story lands better than empty praise.' },
        { title: 'Watch out', text: 'Saying the same sort of thing again and again, or going back to the same subject, costs you. Very short lines, long speeches and flattery count for nothing. One round in three the guest may ask you a question; your three choices are then answers.' },
        { title: 'Learning them', text: 'What the guest reveals about their tastes is written in the "Known so far" note, and teas you have learned about are marked next time. Different guests like different things.' },
        { title: 'The result', text: 'You get a grade. A good or perfect cup warms the bond a little (once a day per guest), and there is a small amount of XP. Without a model, the guest uses built-in lines and the best grade is Good.' },
    ]);

    const wrap = el('div', 'snpc-act-tea');

    // The scene, above the options: the table with what was served on it, and the guest beside it. The guest's tea-time picture is
    // used when their card has one (`teaPortrait`), otherwise their ordinary portrait.
    const stage = el('div', 'snpc-act-teastage');
    const scene = el('div', 'snpc-act-scene');
    const sceneImg = el('img', 'snpc-act-scene-img');
    sceneImg.alt = '';
    sceneImg.draggable = false;
    loadArt(sceneImg, 'table.webp', () => { sceneImg.remove(); scene.classList.add('is-plain'); });
    scene.append(sceneImg);
    const lay = (file, x, y, w, label) => {
        const img = el('img', 'snpc-act-served');
        img.alt = label;
        img.draggable = false;
        img.style.cssText = `left: ${x}%; top: ${y}%; width: ${w}%;`;
        loadArt(img, file, () => img.remove());
        scene.append(img);
    };
    lay(`teas/${teaSprite(tea)}.webp`, 38, 60, 19, tea);
    if (bring?.kind === 'food') lay(`snacks/${snackSprite(bring.name)}.webp`, 62, 66, 20, bring.name);
    const portrait = el('div', 'snpc-act-portrait');
    const pic = card?.teaPortrait || card?.imageUrl || '';
    if (pic) {
        const face = el('img', 'snpc-act-portrait-img');
        face.alt = partner;
        face.draggable = false;
        face.src = pic;
        face.addEventListener('error', () => { face.remove(); portrait.classList.add('is-plain'); });
        portrait.append(face);
    } else portrait.classList.add('is-plain');
    portrait.append(el('div', 'snpc-act-portrait-name', partner));
    stage.append(scene, portrait);
    wrap.append(stage);
    const bar = el('div', 'snpc-act-teabar');
    const pips = el('div', 'snpc-act-gauge');
    pips.setAttribute('role', 'img');
    const mood = el('span', 'snpc-act-moodword');
    const source = el('small', 'snpc-act-source');
    source.textContent = llm ? 'Voiced by the model' : 'Built-in lines (the model is off for Tea Time)';
    bar.append(pips, mood, source);
    const known = el('div', 'snpc-act-known');
    const guestLine = el('div', 'snpc-act-guestline');
    guestLine.setAttribute('aria-live', 'polite');
    const reaction = el('div', 'snpc-act-reaction');
    reaction.hidden = true;
    const openersBox = el('div', 'snpc-act-openers');
    const sayRow = el('div', 'snpc-act-sayrow');
    const sayInput = el('input', 'snpc-act-field');
    sayInput.type = 'text';
    sayInput.maxLength = 240;
    sayInput.placeholder = 'Or say something else...';
    sayInput.setAttribute('aria-label', 'Say something else');
    const sayBtn = el('button', 'snpc-act-btn', 'Say it');
    sayBtn.type = 'button';
    sayRow.append(sayInput, sayBtn);
    const modelNote = el('div', 'snpc-act-modelnote');
    modelNote.hidden = true;
    wrap.append(bar, known, guestLine, reaction, modelNote, openersBox, sayRow);
    win.main.replaceChildren(wrap);

    const drawBar = () => {
        pips.replaceChildren();
        for (let i = 0; i < state.rounds; i++) pips.append(el('span', `snpc-act-pip${i < state.round ? ' is-on' : ''}`));
        pips.setAttribute('aria-label', `Round ${Math.min(state.rounds, state.round + 1)} of ${state.rounds}`);
        mood.textContent = `${partner} is ${moodWord(state)}`;
        win.setSub(`Round ${Math.min(state.rounds, state.round + 1)} of ${state.rounds}`);
        const line = s.teaShowKnown ? knownLine(teaKnown()[partner] || []) : '';
        known.textContent = line ? `Known so far: ${line}.` : '';
        known.hidden = !line;
    };

    /** A request gave nothing usable: say so, once on screen and once as a toast, and play the round from the built-in bank. */
    const noteFailure = (why) => {
        if (!failWhy) {
            failWhy = why || 'no usable reply';
            try { toastr.warning(`Tea Time used built-in lines: ${failWhy}. Check the Activities connection under Connections.`, 'Worldkit', { preventDuplicates: true }); } catch { /* toastr not there */ }
        }
        modelNote.hidden = false;
        modelNote.textContent = `The model did not answer usefully (${why || failWhy}), so this round used built-in lines.`;
    };

    const setBusy = (on) => {
        busy = on;
        for (const b of openersBox.querySelectorAll('button')) b.disabled = on;
        sayBtn.disabled = on;
        sayInput.disabled = on;
    };

    const guestSays = (text) => {
        guestLine.textContent = `${partner}: ${text}`;
        win.addLine(partner, text, 'bot');
    };

    const drawOpeners = (openers) => {
        openersBox.replaceChildren();
        for (const o of openers) {
            const b = el('button', 'snpc-act-opener');
            b.type = 'button';
            b.append(el('i', `fa-solid ${KIND_ICON[o.kind] || 'fa-comment'}`));
            const text = el('span', 'snpc-act-opener-text');
            text.append(el('small', '', KIND_LABEL[o.kind] || 'Say'), document.createTextNode(o.text));
            b.append(text);
            b.addEventListener('click', () => choose(o.kind, o.text, false));
            openersBox.append(b);
        }
        // Free text only when a model can judge it.
        sayRow.hidden = !(s.teaFreeText && llm);
        setBusy(false);
        openersBox.querySelector('button')?.focus({ preventScroll: true });
    };

    const showReaction = (word, line) => {
        reaction.hidden = false;
        reaction.replaceChildren(el('i', `fa-solid ${REACTION_ICON[word] || 'fa-face-meh'}`), el('strong', '', REACTION_WORD[word] || 'Neutral'));
        reaction.setAttribute('aria-label', `${partner} reacted: ${REACTION_WORD[word]}`);
        if (line) guestSays(line);
    };

    async function choose(kind, text, typed) {
        if (busy || !alive()) return;
        const said = String(text || '').trim();
        if (!said) return;
        setBusy(true);
        win.addLine(win.userName, said, 'user');
        speakAsPlayer(said);
        guestLine.textContent = `${partner} is thinking...`;
        sfx('activity_tea_cup');

        const nextRound = state.round + 2;
        const askNext = askThisRound(state, nextRound, Math.random, s.teaGuestAsks);
        const answer = llm ? await requestRound({ state, preset, said, askNext }) : { parsed: null, why: '' };
        const parsed = answer.parsed;
        if (llm && !parsed) { noteFailure(answer.why); source.textContent = 'Built-in lines this round'; }
        else { modelNote.hidden = true; if (llm) source.textContent = 'Voiced by the model'; }
        if (!alive()) return;
        const res = judgeRound(state, { kind, text: said, typed, parsed, prefs, guestAsks: s.teaGuestAsks });
        state = res.state;
        for (const e of rememberTaste(partner, res.revealed)) learned.push(e);
        sfx(REACTION_DELTA[res.reaction] > 0 ? 'activity_tea_good' : REACTION_DELTA[res.reaction] < 0 ? 'activity_tea_bad' : 'activity_tea_cup');
        showReaction(res.reaction, (parsed && parsed.line) || neutralLine(res.reaction));
        drawBar();

        if (state.over) {
            closing = parsed?.closing || '';
            recap = parsed?.recap || '';
            if (closing) guestSays(closing);
            const done = el('button', 'snpc-act-btn', 'See how it went');
            done.type = 'button';
            done.addEventListener('click', finish);
            openersBox.replaceChildren(done);
            sayRow.hidden = true;
            busy = false;
            done.focus();
            return;
        }
        nextOpeners = parsed?.openers?.length ? fillOpeners(parsed.openers, state, { teaWord }) : neutralOpeners(state, { teaWord });
        drawOpeners(nextOpeners);
    }

    function finish() {
        finished = true;
        const rewards = rewardsOf(state);
        const grade = rewards.grade;
        const learnedLines = [...new Map([...learned, ...state.known].map(k => [`${k.cat}:${k.value.toLowerCase()}`, k])).values()];
        sfx(grade === 'poor' ? 'activity_tea_bad' : 'activity_tea_good');
        const summary = `${label} with ${partner}: ${recap || describeState(state)}`;
        const lines = settleActivity({
            activityId: 'tea', label, partner, summary, lines: win.talk(),
            rewards: { grade, levelXp: rewards.levelXp, bonds: rewards.bonds },
        });
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', closing ? `${partner}: ${closing}` : `${GRADE_TEXT[grade]} cup`));
        box.append(el('p', 'snpc-act-grade', `${GRADE_TEXT[grade]}${state.history.some(h => h.offline) || !state.llm ? (failWhy ? ` (built-in lines were used because ${failWhy}, so the best grade is Good)` : ' (the model is switched off for Tea Time, so the best grade is Good)') : ''}`));
        const list = el('ul');
        if (learnedLines.length) list.append(el('li', '', `You learned: ${knownLine(learnedLines)}.`));
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        const again = el('button', 'snpc-act-btn', 'Another cup');
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

    // The side chat: ordinary talk with the guest outside the rounds.
    win.onSay(async (said) => {
        win.addLine(partner, '...', 'typing');
        const out = await askPartner({ partner, label, beat: 'chat', stateText: describeState(state), playerText: said, talkSoFar: win.talk() });
        win.removeTyping();
        if (win.isOpen() && out.text) win.addLine(partner, out.text, 'bot');
    });

    sayBtn.addEventListener('click', () => { const v = sayInput.value; sayInput.value = ''; choose('question', v, true); });
    sayInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = sayInput.value; sayInput.value = ''; choose('question', v, true); } });

    // Begin: pour, then the greeting and the first openers.
    drawBar();
    sfx('activity_tea_pour');
    startMusic(preset.tea?.music);
    setBusy(true);
    guestLine.textContent = `${partner} is settling in...`;
    (async () => {
        const start = llm ? await requestStart({ state, preset }) : null;
        if (llm && start && !start.line) noteFailure(start.why);
        if (!alive()) return;
        const greeting = start?.line || `Thank you for the ${teaWord}. Shall we sit a while?`;
        guestSays(greeting);
        const openers = start?.openers?.length ? fillOpeners(start.openers, state, { teaWord }) : neutralOpeners(state, { teaWord });
        drawOpeners(openers);
    })();
}

export { GRADES, gradeOf, totalOf, knownFrom };
