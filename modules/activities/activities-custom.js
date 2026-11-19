import { term } from '../../src/activity-terms.js';
import {
    askPartner, settleActivity, sfx, activitySettings, talkAllowed, packItems, giveItemsNow, takeItemNow, inventoryActive, userName,
    startMusic, stopMusic, loadArt,
} from './activities-runtime.js';

/**
 * What a drop-in activity receives (fork). Built for each run from the hub's own pieces, so a custom activity uses exactly the
 * tools the built-in games use: the activity window, the partner, table talk, one call to settle (XP, bonds, items, records,
 * the story report), sounds, art, wording, the inventory. Documented in docs/MAKE-AN-ACTIVITY.md.
 */

const GRADES = { perfect: 'Perfect', good: 'Good', fair: 'Fair', poor: 'Poor', failed: 'Failed' };

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/**
 * @param {{ activity: object, win: object, partner: { name: string, alone: boolean }, preset: object, leave: () => void, restart: () => void }} ctx
 */
export function buildCustomApi({ activity, win, partner, preset, leave, restart }) {
    const who = partner.alone ? '' : partner.name;
    let settled = false;
    const api = {
        /** The hub entry (id, label, tab, icon, ...). */
        activity: Object.freeze({ ...activity }),
        /** The activity window. Draw into win.main; win.setTitle, win.setHelp and win.setView work as in the built-in games. */
        win,
        /** The partner's name ('' when played alone) and whether the player is alone. */
        partner: who,
        alone: Boolean(partner.alone),
        userName: userName(),
        preset,
        /** The player's Activities settings (difficulty, assist, actionKey, ...). Read only by convention. */
        settings: activitySettings(),
        /** The wording of the active world: api.term('knowledge'). */
        term: (key, vars) => term(preset, key, vars),
        rng: Math.random,

        /**
         * The partner says something short (never blocks, never throws). beat is 'start', 'moment', 'end' or 'chat';
         * detail: { state, player, outcome, event } describes what is going on in plain words.
         */
        async talk(beat, detail = {}) {
            if (!who || !win.isOpen() || !talkAllowed(beat)) return;
            try {
                win.addLine(who, '...', 'typing');
                const out = await askPartner({
                    partner: who, label: activity.label, beat, stateText: String(detail.state || ''), playerText: String(detail.player || ''),
                    talkSoFar: win.talk(), outcome: String(detail.outcome || ''), event: String(detail.event || ''),
                });
                win.removeTyping();
                if (win.isOpen() && out?.text) win.addLine(who, out.text, 'bot');
            } catch (err) { console.warn('[Worldkit] custom activity talk failed', err); try { win.removeTyping(); } catch { /* window gone */ } }
        },

        /**
         * Ends the activity: records it, pays XP and bonds, hands out items, writes the story report. Safe to call once;
         * a second call does nothing. result: { grade: 'perfect'|'good'|'fair'|'poor'|'failed', summary, levelXp?, profXp?,
         * subject?, bonds?: [{ meter, amount }], items?: [{ name, qty, kind, note }], consume?: [{ name, qty }], winners?: [] }.
         * Returns the lines to show on the result card.
         */
        settle(result = {}) {
            if (settled) return [];
            settled = true;
            const grade = GRADES[result.grade] ? result.grade : 'fair';
            return settleActivity({
                activityId: activity.id, label: activity.label, partner: who, subject: String(result.subject || ''),
                summary: String(result.summary || `${activity.label}${who ? ` with ${who}` : ' alone'}.`),
                winners: Array.isArray(result.winners) ? result.winners : [],
                lines: win.talk(),
                rewards: {
                    grade, levelXp: Number(result.levelXp) || 0, profXp: Number(result.profXp) || 0, partnerProfXp: Number(result.partnerProfXp) || 0,
                    bonds: Array.isArray(result.bonds) ? result.bonds : [], items: Array.isArray(result.items) ? result.items : [],
                    consume: Array.isArray(result.consume) ? result.consume : [],
                },
            });
        },

        /** Shows the result card: { title, grade, extra, lines, again } with Play again and Back to the hub buttons. */
        result({ title = 'Done', grade = '', extra = '', lines = [], again = 'Play again' } = {}) {
            const box = el('div', 'snpc-act-result');
            box.append(el('h3', '', title));
            if (grade) box.append(el('p', 'snpc-act-grade', `${GRADES[grade] || grade}${extra ? `: ${extra}` : ''}`));
            const list = el('ul');
            for (const l of lines) list.append(el('li', '', String(l)));
            box.append(list);
            const row = el('div', 'snpc-act-row');
            const again1 = el('button', 'snpc-act-btn', again);
            again1.type = 'button';
            again1.addEventListener('click', () => restart());
            const back = el('button', 'snpc-act-btn is-quiet', 'Back to the hub');
            back.type = 'button';
            back.addEventListener('click', () => leave());
            row.append(again1, back);
            box.append(row);
            win.main.replaceChildren(box);
            again1.focus();
        },

        /** Plays a sound by its tag (silent when the tag is not in the sound map). */
        sfx: (tag) => sfx(tag),
        /** Starts or stops a looping music tag (it follows the player's music setting and volume). */
        music: (tag) => { if (tag) startMusic(tag); else stopMusic(); },
        /** Puts a picture by manifest key in an <img>, with a fallback when it is missing (see docs/ASSETS-README.md). */
        loadArt: (img, key, vars, onMissing) => loadArt(img, key, vars, onMissing),
        /** The inventory, when the player uses one (api.inventory.active). */
        inventory: { active: inventoryActive(), items: () => packItems(), give: (items) => giveItemsNow(items), take: (name, qty = 1) => takeItemNow(name, qty) },
        /** Back to the hub, and run again. */
        leave: () => leave(),
        restart: () => restart(),
    };
    return api;
}
