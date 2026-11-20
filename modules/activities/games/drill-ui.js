import { assistOn } from '../../../src/touch-ease.js';
import { newDrill, markAt, centerOf, tapDrill, missDrill, drillRewards, describeDrill } from '../../../src/activity-drill-core.js';
import { actionKeyLabel } from '../../../src/activity-config-core.js';
import { settleActivity, sfx, activitySettings } from '../activities-runtime.js';
import { bigButton, talker, resultCard } from './harvest-ui.js';

/**
 * The skill drill screen (fork). The rules and the numbers are in src/activity-drill-core.js and the drill itself is data (a
 * preset's `drills`), so this screen has no world words: what the mark is called comes from the drill's own terms.
 * One big button (also the action key and Space), made for a thumb: the ring is wider on a touch screen, like every timing game.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const QUALITY_TEXT = { perfect: 'Dead centre!', good: 'Hit', miss: 'Missed' };
const REVEAL_MS = 700;

/**
 * @param {object} win the activity window
 * @param {{ partner: string, label: string, activityId?: string, drill: object, difficulty: string, subject?: string,
 *           subjectLabel?: string, onLeave: () => void, onAgain: () => void, onFinish?: (run: object) => void, keepTalk?: boolean }} ctx
 * `onFinish` is for an exam: the run is handed back unsettled instead of paying out and showing a result card.
 */
export function runDrill(win, ctx) {
    const { partner, label, drill, onLeave, onAgain } = ctx;
    const assist = assistOn(activitySettings());
    const run = newDrill(drill, { difficulty: ctx.difficulty, assist });
    const mark = drill.terms.mark;
    let roundStart = 0;
    let raf = 0;
    let waiting = false;         // between rounds, showing how the last one went
    let finished = false;
    const alive = () => win.isOpen() && !finished;

    if (!ctx.keepTalk) win.resetTalk();
    win.setView('play');
    win.setTitle(label, 'fa-bullseye');
    win.setHelp([
        { title: 'The goal', text: `Hit the ${mark} ${drill.rounds} times. ${ctx.subjectLabel ? `Each good round trains ${ctx.subjectLabel}.` : ''}`.trim() },
        { title: 'How it works', text: `A ${mark} crosses the lane${drill.wobble > 0 ? ' and speeds up and slows down as it goes' : ''}. A green ring marks where to hit it. Press the big button (or ${actionKeyLabel(activitySettings().actionKey)} or Space) when the ${mark} is inside the ring. Dead centre is worth the most.` },
        { title: 'The result', text: 'Your hits decide the grade. A better grade trains the skill more. A drill can be done again and again.' },
        { title: 'Settings', text: `${assist ? 'The ring is wider and the mark slower on a touch screen, or with "Easier timing" on.' : '"Easier timing" in the Activities settings widens the ring and slows the mark.'}` },
    ]);

    const speak = talker(win, partner, label, () => describeDrill(run));
    const wrap = el('div', 'snpc-act-fish');
    const counter = el('div', 'snpc-act-fishcount');
    const lane = el('div', 'snpc-act-meter');
    lane.setAttribute('role', 'img');
    lane.setAttribute('aria-label', `A ${mark} crosses the lane. Press when it is inside the green ring.`);
    const ring = el('div', 'snpc-act-meter-zone');
    const dot = el('div', 'snpc-act-meter-marker');
    lane.append(ring, dot);
    const status = el('div', 'snpc-act-status');
    status.setAttribute('aria-live', 'polite');
    const log = el('ol', 'snpc-act-fishlog');
    const press = bigButton(win, drill.terms.action, () => onPress());
    wrap.append(counter, lane, press.button, status, log);
    win.main.replaceChildren(wrap);

    const drawCount = () => {
        counter.textContent = run.over ? 'Drill done' : `${mark[0].toUpperCase()}${mark.slice(1)} ${run.round + 1} of ${drill.rounds}`;
        win.setSub(counter.textContent);
    };

    function beginRound() {
        if (!alive() || run.over) return;
        waiting = false;
        const c = centerOf(run);
        ring.style.left = `${(c - run.width / 2) * 100}%`;
        ring.style.width = `${run.width * 100}%`;
        status.textContent = `Press when the ${mark} is inside the ring.`;
        drawCount();
        roundStart = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
    }

    function frame(now) {
        if (!alive() || waiting) return;
        const ms = now - roundStart;
        dot.style.left = `${markAt(run, ms) * 100}%`;
        // Two full crossings with no press is a miss, so a drill never hangs.
        if (ms > run.sweep * 2) { settleRound(missDrill(run)); return; }
        raf = requestAnimationFrame(frame);
    }

    function settleRound(quality) {
        if (!quality) return;
        waiting = true;
        cancelAnimationFrame(raf);
        sfx(quality === 'miss' ? 'activity_drill_miss' : 'activity_drill_hit');
        status.textContent = QUALITY_TEXT[quality];
        const li = el('li', quality === 'miss' ? 'is-lost' : 'is-caught', `${mark[0].toUpperCase()}${mark.slice(1)} ${run.results.length}: ${QUALITY_TEXT[quality].toLowerCase()}`);
        log.append(li);
        if (run.over) { setTimeout(finish, REVEAL_MS); return; }
        setTimeout(beginRound, REVEAL_MS);
    }

    function onPress() {
        if (!alive() || waiting || run.over) return;
        if (drill.sound) sfx(drill.sound);
        settleRound(tapDrill(run, performance.now() - roundStart));
    }

    function finish() {
        if (finished || !win.isOpen()) return;
        finished = true;
        press.destroy();
        cancelAnimationFrame(raf);
        // Run inside an exam: hand the run back and let the exam judge it (nothing is settled here).
        if (ctx.onFinish) { ctx.onFinish(run); return; }
        const rewards = drillRewards(run, { partner: Boolean(partner) });
        speak('end', '', rewards.grade);
        const hits = run.results.filter(q => q !== 'miss').length;
        const lines = settleActivity({
            activityId: ctx.activityId || drill.id, label, partner, subject: ctx.subject || '', lines: win.talk(),
            summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${hits} of ${drill.rounds} hit.`,
            rewards: { grade: rewards.grade, levelXp: rewards.levelXp, profXp: rewards.profXp, partnerProfXp: rewards.partnerProfXp, bonds: rewards.bonds },
        });
        setTimeout(() => resultCard({
            title: `${hits} of ${drill.rounds} hit`, grade: rewards.grade, extra: `${run.results.filter(q => q === 'perfect').length} dead centre`,
            lines, again: 'Drill again', onAgain, onLeave, win,
        }), 300);
    }

    speak('start');
    beginRound();
}
