import { judgeTest, judgeExam, examRewards } from '../../../src/activity-exam-core.js';
import { settleActivity, activitySettings, credentialItem } from '../activities-runtime.js';
import { runDrill } from './drill-ui.js';
import { resultCard } from './harvest-ui.js';

/**
 * The exam screen (fork): a graded set of drills, one after another. The plan (which drills, how hard, what share of the points
 * each needs) is worked out in src/activity-exam-core.js; this file runs it. It has no world words: the exam, the examiner and the
 * credential are named by the caller from the preset's terms.
 *
 * Every test must be passed. The first one failed ends the exam. A pass raises the skill by one rank and pays the credential
 * (both done by settleActivity from `rewards.promote` and `rewards.items`).
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const percent = (n) => `${Math.round(n * 100)}%`;

/**
 * @param {object} win
 * @param {{ examiner: string, label: string, activityId?: string, subject: string, subjectLabel: string, fromRung: string|null, toRung: string,
 *           credentialName: string, plan: { drill: string, difficulty: string, need: number }[], drills: Record<string, object>,
 *           words: { exam: string, examiner: string, credential: string }, onLeave: () => void, onAgain: () => void }} ctx
 */
export function runExam(win, ctx) {
    const { plan, drills, words } = ctx;
    const verdicts = [];
    let alive = true;

    win.resetTalk();
    win.setView('play');
    win.setTitle(ctx.label, 'fa-certificate');
    win.setHelp([
        { title: 'The goal', text: `Pass every test to raise ${ctx.subjectLabel} from ${ctx.fromRung || 'no rank'} to ${ctx.toRung}. Passing earns a ${ctx.credentialName}.` },
        { title: 'The tests', text: `${plan.length} drill${plan.length === 1 ? '' : 's'} in a row. Each one needs a share of the points, shown before it starts. The first one you miss ends the ${words.exam.toLowerCase()}.` },
        { title: 'Retrying', text: 'You can sit the exam again later. A failed attempt gives a little XP, and no rank or credential.' },
    ]);

    /** A plain card with a few lines and buttons. */
    function card(title, lines, buttons) {
        if (!alive || !win.isOpen()) return;
        const box = el('div', 'snpc-act-result');
        box.append(el('h3', '', title));
        const list = el('ul');
        for (const l of lines) list.append(el('li', '', l));
        box.append(list);
        const row = el('div', 'snpc-act-row');
        for (const [text, onClick, quiet] of buttons) {
            const b = el('button', `snpc-act-btn${quiet ? ' is-quiet' : ''}`, text);
            b.type = 'button';
            b.addEventListener('click', onClick);
            row.append(b);
        }
        box.append(row);
        win.main.replaceChildren(box);
        row.firstChild?.focus();
    }

    function intro(i) {
        const test = plan[i];
        const drill = drills[test.drill];
        card(`Test ${i + 1} of ${plan.length}: ${drill.label}`, [
            drill.blurb || 'Hit the mark inside the ring.',
            `${drill.rounds} rounds, ${test.difficulty} setting.`,
            `You need ${percent(test.need)} of the points to pass.`,
        ], [['Begin', () => begin(i)], ['Give up', () => conclude(), true]]);
    }

    function begin(i) {
        const test = plan[i];
        runDrill(win, {
            partner: '', label: ctx.label, drill: drills[test.drill], difficulty: test.difficulty, keepTalk: true,
            onLeave: ctx.onLeave, onAgain: ctx.onAgain,
            onFinish: (run) => verdictOf(i, run),
        });
    }

    function verdictOf(i, run) {
        const test = plan[i];
        const v = judgeTest(run.results, test.need);
        verdicts.push(v);
        const line = `You scored ${percent(v.score)}; ${percent(test.need)} was needed.`;
        if (v.passed && i + 1 < plan.length) {
            card(`Test ${i + 1} passed`, [line], [['Next test', () => intro(i + 1)], ['Stop here', () => conclude(), true]]);
        } else if (v.passed) {
            card('Last test passed', [line], [[`See the ${words.exam.toLowerCase()} result`, () => conclude()]]);
        } else {
            card(`Test ${i + 1} not passed`, [line], [[`See the ${words.exam.toLowerCase()} result`, () => conclude()]]);
        }
    }

    function conclude() {
        if (!alive || !win.isOpen()) return;
        alive = false;
        const verdict = judgeExam(verdicts, plan.length);
        const rewards = examRewards({ passed: verdict.passed, average: verdict.average, tests: Math.max(1, verdicts.length), partner: Boolean(ctx.examiner), credential: ctx.credentialName });
        const items = rewards.credential ? [credentialItem(rewards.credential)] : [];
        const lines = settleActivity({
            activityId: ctx.activityId || 'exam', label: ctx.label, partner: ctx.examiner,
            // A pass moves the rank up by itself, so the skill gets no extra XP on top of it.
            subject: verdict.passed ? '' : ctx.subject, lines: win.talk(),
            summary: `${ctx.label} (${ctx.subjectLabel}, to ${ctx.toRung}) with ${ctx.examiner}: ${verdict.passed ? 'passed' : 'not passed'}, ${percent(verdict.average)} on average.`,
            rewards: { grade: rewards.grade, levelXp: rewards.levelXp, profXp: rewards.profXp, bonds: rewards.bonds, items, ...(rewards.promote ? { promote: { prof: ctx.subject } } : {}) },
        });
        if (rewards.credential && !activitySettings().itemsOn) lines.push(`Turn the Inventory on in the Activities settings to keep the ${rewards.credential}.`);
        const early = !verdict.passed && verdicts.length < plan.length && verdicts.every(v => v.passed);
        const title = verdict.passed ? `${words.exam}: passed` : early ? `${words.exam}: stopped early` : `${words.exam}: not passed`;
        resultCard({
            title, grade: rewards.grade, extra: `${percent(verdict.average)} on average`,
            lines: [verdict.passed ? `${ctx.subjectLabel} is now ${ctx.toRung}.` : early ? `${verdicts.length} of ${plan.length} tests passed. Finish all of them to rise a rank.` : 'No rank or credential this time.', ...lines],
            again: verdict.passed ? '' : 'Sit it again', onAgain: verdict.passed ? null : ctx.onAgain, onLeave: ctx.onLeave, win,
        });
    }

    if (!plan.length) { conclude(); return; }
    intro(0);
}
