import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { getPlayerCard } from '../../src/status-logic.js';
import { hasTypeData, getTypeData, normalizeWeapon } from '../../src/combat-store.js';
import { setWeapon, setStatus, addXp } from '../../src/combat-edit.js';
import { XP_PER_ENEMY } from '../../src/combat-level.js';
import { fractionFromStatus, statusFromFraction, STATUS_DEFAULT } from '../../src/combat-status.js';
import { project } from '../../src/combat-roles.js';
import { profileText } from '../../src/profile-text.js';
import { contextBlocks } from '../../src/context-blocks.js';
import { requestOnConnection } from '../../src/connections.js';
import { DIALOGUE_RULE, dialogueOnly, speakLine } from '../../src/spoken-line.js';
import { addRecord, tallyAgainst, rivalryBlock } from '../../src/rivalry.js';
import { tallyText } from '../../src/rivalry-core.js';
import { openRivalryEditor } from '../../src/ui-rivalry.js';
import { rate, calibrate, SPAR_SHARE } from '../../src/combat-pace.js';
import { activeCombatType, combatPrefs, personaRecordFor, isCombatDisabled } from '../../src/combat-access.js';
import { lastTaggedSpeaker, sceneClock } from '../shim.js';
import { recordTalk } from '../../src/talk-store.js';
import { newTalkId } from '../../src/talk-log.js';
import {
    startFight, takeTurn, skipTurn, currentActor, living, offeredActions, canPay, chooseAction,
} from '../../src/combat-fight.js';

/**
 * The combat button, in the same corner row as the phone and the games (fork).
 *
 * It opens a small window: pick who you are fighting, spar or fight for real, and play the
 * turns. The numbers come from the world type picked under Modules → Combat. Pools are written
 * back onto a character who already has combat data. Someone running on the type's defaults
 * is not given a sheet just for stepping into a fight.
 */

const BANDS = { miss: 'Miss', stalemate: 'Stalemate', hit: 'Hit', strong: 'Strong hit', crit: 'Critical' };

let panel = null;
let session = null;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function chatOpen() {
    const c = getContext();
    if (!c) return false;
    if (c.groupId) return true;
    return c.characterId !== undefined && c.characterId !== null;
}

function buttonRow() {
    let row = document.getElementById('rpg-buttons-container');
    if (!row) {
        row = document.createElement('div');
        row.id = 'rpg-buttons-container';
        row.style.cssText = 'position:fixed; bottom:20px; right:20px; display:flex; gap:15px; z-index:3000;';
        document.body.append(row);
    }
    return row;
}

function difficultyRows(type) {
    const rows = type?.resolution?.difficulty;
    return Array.isArray(rows) && rows.length ? rows : [{ level: 2, mod: 0 }];
}

function characters() {
    return (getSettings().characters || []).filter(r => r?.name && !isCombatDisabled(r));
}

/** @returns {{ player: object, foes: object[], suggested: string }} */
function roster() {
    let player = null;
    try { player = getPlayerCard(); } catch { /* no persona yet */ }
    // A persona character with the player's name is the player: one set of stats, shared.
    if (player) player = personaRecordFor(player.name) || player;
    const foes = characters().filter(f => f !== player);
    let suggested = '';
    try {
        const last = lastTaggedSpeaker(getContext()?.chat);
        if (last?.name && foes.some(f => f.name === last.name)) suggested = last.name;
    } catch { /* chat not ready */ }
    return { player, foes, suggested };
}

function dataOf(record, type) {
    return record ? getTypeData(record, type.dataKey) : {};
}

/** A fight starts at the health their status grade stands for; everything else starts full. */
function startData(record, type) {
    const data = dataOf(record, type);
    const full = project({ ...data, pools: {} }, type).pools.health;
    const pools = {};
    if (full?.max > 0) pools.health = Math.max(1, Math.round(full.max * fractionFromStatus(data.status)));
    return { ...data, pools };
}

function persist(type, fighter, record) {
    if (!record || !hasTypeData(record, type.dataKey)) return;
    const health = fighter.view.pools.health;
    if (!health || !(health.max > 0)) return;
    // Health becomes a grade: that is the whole of what a fight leaves behind.
    if (setStatus(record, type, statusFromFraction(health.cur / health.max)).ok) saveSettings();
}

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'someone');

/** Who fought on each side, the player's side first. */
function sidesOfFight(state) {
    const all = Object.values(state.fighters);
    const me = state.fighters.player || null;
    const mine = all.filter(f => f.side === 'player');
    // The player first on their side, then their allies.
    mine.sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    return { me, mine, foes: all.filter(f => f.side === 'foe') };
}

/** One record for the whole fight: everyone on both sides, allies and every foe. */
function recordFight() {
    const { state } = session;
    const { me, mine, foes } = sidesOfFight(state);
    if (!mine.length || !foes.length) return;
    const lost = state.over.loser === 'player';
    const hp = (f) => { const h = f.view.pools.health; return h ? `${percentOf(h.cur, h.max)}%` : '?'; };
    const kind = state.mode === 'spar' ? 'spar' : 'fight';
    const lead = me?.name || mine[0].name;
    const allies = mine.filter(f => f !== me).map(f => f.name);
    const company = allies.length ? `, fighting alongside ${andList(allies)},` : '';
    const foeNames = foes.map(f => f.name);
    // One id for the fight, shared by this record and the fight's talk (keepTalk), so the story
    // prompt can tell they are the same fight and never sends it twice.
    if (!session.talkId) session.talkId = newTalkId();
    try {
        addRecord({
            event: session.talkId,
            kind: 'combat', game: kind === 'spar' ? 'Spar' : 'Fight',
            sideA: mine.map(f => f.name), sideB: foeNames,
            winner: lost ? 'B' : 'A',
            userSide: me ? 'A' : '', player: me?.name || '',
            summary: `${lead}${company} ${lost ? 'lost to' : 'beat'} ${andList(foeNames)} in a ${kind}, ${state.round} round${state.round === 1 ? '' : 's'}. `
                + `Left standing: ${[...mine, ...foes].map(f => `${f.name} ${hp(f)}`).join(', ')} health.`,
        });
    } catch (err) { console.warn('[SillyNPC] could not record the fight', err); }
}

/** Everyone who fought gets XP for each enemy, win or lose, spar or fight. Only a sheet can keep it. */
function awardXp() {
    const { state, type } = session;
    session.xp = [];
    for (const fighter of Object.values(state.fighters)) {
        const enemies = Object.values(state.fighters).filter(f => f.side !== fighter.side).length;
        const record = session.records.get(fighter.id);
        if (!record || !hasTypeData(record, type.dataKey)) {
            session.xp.push({ name: fighter.name, none: true });
            continue;
        }
        const out = addXp(record, type, XP_PER_ENEMY * enemies);
        session.xp.push({ name: fighter.name, gained: out.gained, level: out.level, levelsGained: out.levelsGained });
    }
    saveSettings();
    for (const x of session.xp) if (x.levelsGained) toastr.success(`${x.name} reached level ${x.level}!`, 'SillyNPC');
}

function xpLines() {
    return (session?.xp || []).map(x => (x.none
        ? `${x.name}: no combat sheet, so no XP kept.`
        : `${x.name}: +${x.gained} XP${x.levelsGained ? `, level ${x.level}!` : ''}`));
}

/*
 * Fork: the fight's table talk, kept in the chat (talk-store.js) so the vectors can recall it.
 * Written when the fight ends and again for each line said after, under one id per fight.
 * A fight that is never finished is not kept.
 */
function keepTalk() {
    if (!session?.state?.over) return;
    try {
        const { state } = session;
        const sides = sidesOfFight(state);
        const me = sides.me?.name || 'You';
        const mine = sides.mine.map(f => f.name);
        const foes = sides.foes.map(f => f.name);
        const lost = state.over.loser === 'player';
        if (!session.talkId) session.talkId = newTalkId();
        const winner = lost ? (andList(foes) || 'they') : andList(mine.length ? mine : [me]);
        recordTalk('combat', {
            id: session.talkId,
            at: Date.now(),
            title: `${state.mode === 'spar' ? 'Spar' : 'Fight'} vs ${foes.join(', ') || 'someone'}`,
            // Everyone but the player: allies and foes. The sides say who stood where.
            with: [...mine.filter(n => n !== sides.me?.name), ...foes],
            sideA: mine,
            sideB: foes,
            date: sceneClock()?.dateText || '',
            lines: session.chat.map(m => ({ who: m.who, text: m.text })),
            result: `${winner} won after ${state.round} round${state.round === 1 ? '' : 's'}`,
        });
    } catch (err) { console.warn('[SillyNPC] could not keep the fight talk', err); }
}

function persistAll() {
    if (!session?.state.over || session.saved) return;
    session.saved = true;
    awardXp();
    recordFight();
    keepTalk();
    for (const fighter of Object.values(session.state.fighters)) {
        persist(session.type, fighter, session.records.get(fighter.id));
    }
}

/** One opposing turn, played when the player presses Continue. Nothing acts on its own. */
function playOneFoe() {
    if (!session || session.state.over) return null;
    const actor = currentActor(session.state);
    if (!actor || actor.side === 'player') return null;
    const target = living(session.state, 'player')[0];
    const action = target ? chooseAction(session.type, actor.view, actor.weapon, {
        me: actor, foe: target, mode: session.state.mode,
        diff: actor.side === 'player' ? session.state.diff : -session.state.diff,
    }) : null;
    let events = [];
    if (!target || !action) {
        actor.down = true;
        skipTurn(session.state, `${actor.name} has nothing they can do.`);
    } else {
        events = takeTurn(session.type, session.state, action.key, target.id).events || [];
    }
    persistAll();
    return { actor, events };
}

/** Pools that read as a condition, not a count: Health 97%, not 194/200. Resources stay numbers. */
const asPercent = (role) => role !== 'resource';

/** Whole percent; never 100 while hurt and never 0 while standing. */
function percentOf(cur, max) {
    if (!(max > 0)) return 0;
    const raw = (cur / max) * 100;
    if (cur >= max) return 100;
    if (cur <= 0) return 0;
    return Math.max(1, Math.min(99, Math.round(raw)));
}

function portraitOf(id) {
    const record = session?.records.get(id);
    return typeof record?.imageUrl === 'string' ? record.imageUrl : '';
}

function fighterCard(fighter) {
    const card = el('div', `snpc-fight-person is-${fighter.side}${fighter.down ? ' is-down' : ''}`);
    const face = el('div', 'snpc-fight-face');
    const img = portraitOf(fighter.id);
    if (img) face.style.backgroundImage = `url("${img.replace(/"/g, '%22')}")`;
    else face.textContent = fighter.name.slice(0, 1).toUpperCase();
    card.append(face);
    const info = el('div', 'snpc-fight-info');
    info.append(el('div', 'snpc-fight-name', fighter.name));
    if (fighter.weapon?.name) info.append(el('div', 'snpc-fight-weapon', fighter.weapon.name));
    for (const [role, pool] of Object.entries(fighter.view.pools)) {
        const row = el('div', 'snpc-fight-pool');
        row.append(el('span', 'snpc-fight-pool-label', pool.abbr || pool.label));
        const track = el('div', 'snpc-fight-track');
        const fill = el('div', 'snpc-fight-fill');
        const pct = pool.max > 0 ? Math.max(0, Math.min(100, (pool.cur / pool.max) * 100)) : 0;
        fill.style.width = `${pct}%`;
        if (pool.color) fill.style.background = pool.color;
        track.append(fill);
        row.append(track, el('span', 'snpc-fight-pool-num', asPercent(role) ? `${percentOf(pool.cur, pool.max)}%` : `${Math.round(pool.cur)}/${pool.max}`));
        info.append(row);
    }
    if (fighter.down) info.append(el('small', 'snpc-fight-downtag', session.state.mode === 'spar' ? 'Yielded' : 'Down'));
    card.append(info);
    return card;
}

function describe(event) {
    if (event.skip) return event.reason;
    const actor = session.state.fighters[event.actor];
    const target = session.state.fighters[event.target];
    if (event.passive) return `${actor.name} — ${event.label}: recovers ${Math.max(1, Math.round((event.healed / actor.view.pools.health.max) * 100))}% health.`;
    if (event.ability && event.target === event.actor) {
        const bits = [];
        if (event.healed > 0) bits.push(`recovers ${Math.max(1, Math.round((event.healed / actor.view.pools.health.max) * 100))}% health`);
        if (event.braced > 0) bits.push(`braces against the next blow (${Math.round(event.braced * 100)}% off)`);
        return `${actor.name} — ${event.label}: ${bits.join(', ') || 'no effect'}.`;
    }
    const band = BANDS[event.band] || event.band;
    const how = event.weapon ? `${event.label}, ${event.weapon}` : event.label;
    const lead = event.counter ? `${actor.name} strikes back (${event.label})` : event.follow ? `${actor.name} follows up` : `${actor.name} — ${how}`;
    const edge = event.advantage?.length ? ` (${event.advantage.join(', ')})` : '';
    const pool = target.view.pools[event.pool];
    const amount = pool && asPercent(event.pool) ? `${Math.max(1, Math.round((event.taken / pool.max) * 100))}%` : event.taken;
    const extras = [];
    if (event.passives?.length) extras.push(event.passives.join(', '));
    if (event.blocked > 0) extras.push(`${event.blocked}% blocked`);
    if (event.healed > 0) extras.push(`recovers ${Math.max(1, Math.round((event.healed / target.view.pools.health.max) * 100))}% health`);
    if (event.drained > 0) extras.push(`${actor.name} drains ${Math.max(1, Math.round((event.drained / actor.view.pools.health.max) * 100))}% health`);
    const note = extras.length ? ` [${extras.join('; ')}]` : '';
    const blow = event.taken > 0 ? `${band}, ${amount} to ${event.pool}${edge}${note}.` : (event.blocked > 0 ? `${band}, blocked${edge}${note}.` : `${band}${edge}${note}.`);
    const end = event.down ? (session.state.mode === 'spar' ? ` ${target.name} yields.` : ` ${target.name} falls.`) : '';
    return `${lead}: ${blow}${end}`;
}

function outcomeWord(state) {
    const youLost = state.over.loser === 'player';
    return state.mode === 'spar'
        ? (youLost ? 'You yield.' : 'They yield.')
        : (youLost ? 'You fall.' : 'The fight is yours.');
}

/** The after-action report, as plain text for the chat. */
function reportText() {
    const { state, type } = session;
    const players = state.order.map(id => state.fighters[id]).filter(f => f.side === 'player');
    const foes = state.order.map(id => state.fighters[id]).filter(f => f.side === 'foe');
    const lost = state.over.loser === 'player' ? players : foes;
    const won = state.over.loser === 'player' ? foes : players;
    const names = (list) => list.map(f => f.name).join(' and ');
    const lines = [];
    lines.push(`[Combat report: ${state.mode === 'spar' ? 'sparring match' : 'fight'}, ${names(players)} against ${names(foes)}, ${type.name}]`);
    lines.push(`Result: ${names(won)} won after ${state.round} round${state.round === 1 ? '' : 's'}. ${names(lost)} ${state.mode === 'spar' ? 'yielded' : 'fell'}.`);
    for (const f of [...players, ...foes]) {
        const parts = [];
        for (const [role, pool] of Object.entries(f.view.pools)) {
            parts.push(`${pool.label} ${asPercent(role) ? `${percentOf(pool.cur, pool.max)}%` : `${Math.round(pool.cur)}/${pool.max}`}`);
        }
        lines.push(`${f.name}${f.weapon?.name ? ` (${f.weapon.name})` : ''}: ${parts.join(', ')}.`);
    }
    for (const line of xpLines()) lines.push(line);
    lines.push('Blow by blow:');
    for (const event of state.log) lines.push(`- ${describe(event)}`);
    return lines.join('\n');
}

async function postReport() {
    if (!session || session.reported || session.posting) return;
    session.posting = true;
    const text = reportText()
        .replace(/\|/g, '/')
        .replace(/\{\{/g, '{ {')
        .replace(/\}\}/g, '} }');
    try {
        await getContext().executeSlashCommandsWithOptions(`/sys ${text}`, { displayCommand: false, showOutput: false });
        if (session) session.reported = true;
    } catch (err) {
        console.error('[SillyNPC] combat report failed', err);
        toastr.error('Could not post the combat report to chat.', 'SillyNPC');
        if (session) session.failed = true;
    }
    if (session) session.posting = false;
    draw();
}

function drawBattle(body) {
    const { state, type } = session;
    const head = el('div', 'snpc-fight-sides');
    const ids = state.order.slice().sort((a, b) => (state.fighters[a].side === 'player' ? -1 : 1) - (state.fighters[b].side === 'player' ? -1 : 1));
    ids.forEach((id, i) => {
        if (i === 1) head.append(el('div', 'snpc-fight-vs', 'VS'));
        head.append(fighterCard(state.fighters[id]));
    });
    body.append(head);

    if (session.pace) body.append(el('small', 'snpc-fight-order', `${session.pace.label} fight, aiming for about ${Math.round(session.pace.target)} turns.`));
    const order = el('small', 'snpc-fight-order');
    order.textContent = 'Order: ' + state.order
        .map(id => `${state.fighters[id].name} ${Math.round(state.initiative[id])}`)
        .join(' · ') + `  ·  round ${state.round}`;
    body.append(order);

    const log = el('div', 'snpc-fight-log');
    const lines = state.over ? state.log : state.log.slice(-12);
    if (!lines.length) log.append(el('p', 'notes', 'The fight is on. Take your turn.'));
    for (const event of lines) log.append(el('p', '', describe(event)));
    body.append(log);
    log.scrollTop = log.scrollHeight;

    if (state.over) {
        const end = el('div', 'snpc-fight-result');
        end.append(el('p', 'snpc-fight-end', outcomeWord(state)));
        for (const line of xpLines()) end.append(el('small', 'snpc-fight-xp', line));
        end.append(el('small', 'notes', session.reported ? 'The combat report was posted to the chat.'
            : session.posting ? 'Posting the combat report...' : 'The combat report has not been posted.'));
        body.append(end);
        const row = el('div', 'snpc-fight-actions');
        if (!session.reported && !session.posting) {
            const post = el('button', 'menu_button', 'Post report to chat');
            post.type = 'button';
            post.addEventListener('click', () => { session.failed = false; postReport(); });
            row.append(post);
        }
        const again = el('button', 'menu_button', 'New fight');
        again.type = 'button';
        again.addEventListener('click', () => { keepTalk(); session = null; draw(); });
        row.append(again);
        body.append(row);
        if (!session.failed) postReport();
        return;
    }

    const actor = currentActor(state);
    if (!actor) return;
    if (actor.side !== 'player') {
        // Say whose turn it is and let the player start it, so nothing happens unseen.
        const first = !state.log.length;
        body.append(el('p', 'snpc-fight-turn', first ? `${actor.name} goes first.` : `${actor.name}'s turn.`));
        const go = el('button', 'menu_button', first ? 'Begin' : 'Continue');
        go.type = 'button';
        go.addEventListener('click', () => { const turn = playOneFoe(); draw(); lineAfterTurn(turn); });
        const row = el('div', 'snpc-fight-actions');
        row.append(go);
        body.append(row);
        return;
    }
    const foes = living(state, 'foe');
    const target = foes[0];
    if (!target) return;
    body.append(el('p', 'snpc-fight-turn', `${state.log.length ? 'Your turn' : 'You go first'}, against ${target.name}.`));
    const row = el('div', 'snpc-fight-actions');
    const mine = offeredActions(type, actor.view, actor.weapon, actor.abilities, state.mode);
    if (!mine.length) row.append(el('p', 'notes', 'This world type has no actions.'));
    for (const action of mine) {
        const affordable = canPay(actor.view, action);
        const button = el('button', `menu_button${action.ability ? ' is-ability' : ''}`, action.label);
        button.type = 'button';
        button.disabled = !affordable;
        const tip = [action.desc, action.cost?.amount ? `Costs ${action.cost.amount} ${type.pools.find(p => p.role === action.cost.pool)?.label || action.cost.pool}.` : ''].filter(Boolean).join(' ');
        if (tip) button.title = tip;
        if (!affordable && action.cost?.amount) button.title = `Needs ${action.cost.amount} ${type.pools.find(p => p.role === action.cost.pool)?.label || action.cost.pool}. ${tip}`;
        button.addEventListener('click', () => {
            const result = takeTurn(type, state, action.key, target.id);
            if (!result.ok) { toastr.warning(result.reason, 'SillyNPC'); return; }
            persistAll();
            draw();
        });
        row.append(button);
    }
    const yieldBtn = el('button', 'menu_button', state.mode === 'spar' ? 'Yield' : 'Fall back');
    yieldBtn.type = 'button';
    yieldBtn.addEventListener('click', () => {
        actor.down = true;
        skipTurn(state, `${actor.name} yields.`);
        persistAll();
        draw();
    });
    row.append(yieldBtn);
    body.append(row);
}

/** Weapon fields for one person in the setup screen. Saved onto their record as you type. */
function weaponEditor(title, record, type) {
    const box = el('div', 'snpc-fight-weapon-edit');
    box.append(el('div', 'snpc-fight-weapon-title', title));
    const w = getTypeData(record, type.dataKey).weapon || { name: '', prof: '', power: 0 };
    const name = el('input', 'text_pole');
    name.placeholder = 'Weapon, e.g. Dual scimitars';
    name.value = w.name || '';
    const prof = el('select', 'text_pole');
    prof.append(new Option('any weapon', ''));
    for (const p of type.proficiencies) {
        if ((p.roles || []).some(r => r === 'weapon' || r === 'magic')) prof.append(new Option(p.label, p.id));
    }
    prof.value = w.prof || '';
    const power = el('input', 'text_pole');
    power.type = 'number';
    power.title = 'Power bonus';
    power.value = w.power || 0;
    const save = () => {
        const out = setWeapon(record, type, { name: name.value, prof: prof.value, power: power.value });
        if (out.ok) saveSettings();
        else toastr.warning(out.reason, 'SillyNPC');
    };
    for (const i of [name, prof, power]) i.addEventListener('change', save);
    const row = el('div', 'snpc-fight-weapon-row');
    row.append(name, prof, power);
    box.append(row);
    return { box, read: () => ({ name: name.value, prof: prof.value, power: power.value }) };
}

function drawSetup(body) {
    const type = activeCombatType();
    if (!type) {
        body.append(el('p', 'notes', 'Pick a world type under Modules, Combat, then come back.'));
        return;
    }
    const { player, foes, suggested } = roster();
    if (!player) {
        body.append(el('p', 'notes', 'There is no persona to fight as yet.'));
        return;
    }
    if (!foes.length) {
        body.append(el('p', 'notes', 'There are no characters to fight.'));
        return;
    }

    body.append(el('p', 'snpc-fight-type', type.name));

    const who = el('label', 'snpc-fight-field', 'Against');
    const select = el('select', 'text_pole');
    for (const foe of foes) {
        const option = el('option', '', foe.name + (hasTypeData(foe, type.dataKey) ? '' : ' (defaults)'));
        option.value = foe.id;
        select.append(option);
    }
    const suggestedFoe = foes.find(f => f.name === suggested);
    if (suggestedFoe) select.value = suggestedFoe.id;
    who.append(select);
    body.append(who);

    // Weapons: yours, and whoever you picked. Saved on the character, so they stick.
    const weapons = el('div', 'snpc-fight-weapons');
    const mineW = weaponEditor(player.name || 'You', player, type);
    weapons.append(mineW.box);
    let foeW = null;
    const drawFoeWeapon = () => {
        if (foeW) foeW.box.remove();
        const foe = foes.find(f => f.id === select.value) || foes[0];
        foeW = weaponEditor(foe.name, foe, type);
        weapons.append(foeW.box);
    };
    drawFoeWeapon();
    select.addEventListener('change', drawFoeWeapon);
    body.append(weapons);

    const mode = el('label', 'snpc-fight-field', 'Stakes');
    const modeSelect = el('select', 'text_pole');
    modeSelect.append(new Option('Spar — guard, then yield', 'spar'));
    modeSelect.append(new Option('Fight — health', 'fight'));
    if (!type.pools.some(p => p.role === 'guard')) {
        modeSelect.options[0].disabled = true;
        modeSelect.value = 'fight';
    }
    mode.append(modeSelect);
    body.append(mode);

    const diff = el('label', 'snpc-fight-field', 'Difficulty');
    const diffSelect = el('select', 'text_pole');
    for (const row of difficultyRows(type)) {
        const mod = Number(row.mod) || 0;
        const option = new Option(`Level ${row.level}${mod ? ` (${mod > 0 ? '+' : ''}${mod})` : ''}`, String(row.level));
        option.dataset.mod = String(mod);
        diffSelect.append(option);
    }
    const even = [...diffSelect.options].find(o => o.dataset.mod === '0');
    if (even) diffSelect.value = even.value;
    diff.append(diffSelect);
    body.append(diff);

    if (!hasTypeData(player, type.dataKey)) {
        body.append(el('small', 'notes', "You have no combat sheet for this world, so the type's defaults are used. Setting a weapon above gives you one."));
    }

    // Condition: what each of them is carrying in from earlier fights.
    const statusBox = el('div', 'snpc-fight-status');
    const check = el('button', 'menu_button', 'Check status');
    check.type = 'button';
    check.addEventListener('click', () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        statusBox.replaceChildren();
        for (const [who, rec] of [[player.name || 'You', player], [foe.name, foe]]) {
            const grade = getTypeData(rec, type.dataKey).status || STATUS_DEFAULT;
            const pct = Math.round(fractionFromStatus(grade) * 100);
            statusBox.append(el('div', 'snpc-fight-status-row', `${who}: ${grade} (about ${pct}% health)`));
        }
    });
    body.append(check, statusBox);

    const historyRow = el('div', 'snpc-fight-history');
    const historyText = el('small', 'snpc-fight-pace');
    const historyBtn = el('button', 'menu_button', 'History');
    historyBtn.type = 'button';
    const currentFoe = () => foes.find(f => f.id === select.value) || foes[0];
    const showHistory = () => { historyText.textContent = `Against ${currentFoe().name}: ${tallyText(tallyAgainst(currentFoe().name))}.`; };
    historyBtn.addEventListener('click', () => openRivalryEditor(currentFoe().name));
    historyRow.append(historyText, historyBtn);
    showHistory();
    select.addEventListener('change', showHistory);
    body.append(historyRow);

    const peopleNow = () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        return [
            { id: 'player', name: player.name || 'You', side: 'player', data: startData(player, type), weapon: normalizeWeapon(mineW.read()) },
            { id: foe.id, name: foe.name, side: 'foe', data: startData(foe, type), weapon: normalizeWeapon(foeW.read()) },
        ];
    };

    // How hard this fight is, from level and the gap between their stats and yours.
    const paceLine = el('small', 'snpc-fight-pace');
    const showPace = () => {
        const r = rate(type, peopleNow());
        const turns = modeSelect.value === 'spar' ? Math.max(2, Math.round(r.turns * SPAR_SHARE)) : Math.round(r.turns);
        paceLine.textContent = `${r.label}: about ${turns} turns (each side's action counts as one).`;
    };
    showPace();
    select.addEventListener('change', showPace);
    modeSelect.addEventListener('change', showPace);
    body.append(paceLine);

    const start = el('button', 'menu_button snpc-fight-start', 'Start');
    start.type = 'button';
    start.addEventListener('click', () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        const mod = Number(diffSelect.selectedOptions[0]?.dataset.mod) || 0;
        const people = peopleNow();
        const mode = modeSelect.value;
        const pace = calibrate(type, people, { mode, diff: mod });
        const state = startFight(type, people, { mode, diff: mod, seed: Date.now(), poolScale: pace.scale });
        session = {
            type,
            state,
            pace,
            records: new Map([['player', player], [foe.id, foe]]),
            chat: [],
            talkTo: foe.name,
            talking: false,
            saved: false,
            reported: false,
            posting: false,
            failed: false,
        };
        draw();
    });
    body.append(start);
}


/* ----------------------------------------------------------------- table talk */

function chatCast() {
    const names = [];
    const add = (n) => { if (n && !names.includes(n)) names.push(n); };
    if (session) {
        for (const f of Object.values(session.state.fighters)) if (f.side === 'foe') add(f.name);
    }
    for (const c of getSettings().characters || []) add(c?.name);
    const me = session?.state.fighters.player?.name;
    return names.filter(n => n !== me);
}

function standing(f) {
    const h = f.view.pools.health;
    return h ? `${percentOf(h.cur, h.max)}% health` : 'unknown condition';
}

function chatSystem(name) {
    const { state, type } = session;
    const record = (getSettings().characters || []).find(c => c?.name === name);
    const profile = record ? String(profileText(record) || '').slice(0, 2500) : '';
    const me = state.fighters.player?.name || 'the player';
    const recent = state.log.slice(-6).map(describe).join('\n');
    const people = state.order.map(id => `${state.fighters[id].name}: ${standing(state.fighters[id])}${state.fighters[id].down ? ', out of it' : ''}`).join('; ');
    return [
        ...contextBlocks('combat'),
        `You are ${name}, in the middle of ${state.mode === 'spar' ? 'a sparring match' : 'a real fight'} (${type.name}) with ${me} present. `
        + 'Do not decide how any blow lands. ' + DIALOGUE_RULE,
        profile ? `[ABOUT ${name}:\n${profile}\n]` : '',
        rivalryBlock(name, me),
        `[THE FIGHT SO FAR: round ${state.round}. ${people}.\n${recent}]`,
    ].filter(Boolean).join('\n\n');
}

/** After an opponent's turn they say one line, dialogue only, in the table talk. */
async function lineAfterTurn(turn) {
    if (!session || !turn?.actor) return;
    const { actor, events } = turn;
    const target = events.length ? session.state.fighters[events[0].target] : null;
    const what = events.length
        ? events.map(e => `${BANDS[e.band] || e.band}${e.taken > 0 ? `, took ${Math.round(e.taken / Math.max(1, session.state.fighters[e.target].view.pools[e.pool]?.max || 1) * 100)}% of ${e.pool}` : ''}`).join('; ')
        : 'they could not act';
    const system = chatSystem(actor.name) + '\n\n'
        + `[You just took your turn against ${target?.name || 'them'}: ${what}.] `
        + 'Say one short line about it, in your own voice. ' + DIALOGUE_RULE;
    session.talking = true;
    drawChat();
    try {
        const raw = await requestOnConnection('combatProfileId', system, `${actor.name}:`, 120);
        const line = dialogueOnly(raw, actor.name);
        if (session && line) {
            session.chat.push({ who: actor.name, text: line });
            speakLine(actor.name, line);
        }
    } catch (err) {
        console.error('[SillyNPC] combat line failed', err);
    }
    if (session) session.talking = false;
    // Said after the fight ended: the kept talk gets it too.
    keepTalk();
    drawChat();
}

async function sendTalk(text) {
    if (!session || session.talking || !text.trim()) return;
    const to = session.talkTo || chatCast()[0];
    if (!to) { toastr.info('Nobody to talk to.', 'SillyNPC'); return; }
    const me = session.state.fighters.player?.name || 'You';
    session.chat.push({ who: me, text: text.trim(), mine: true });
    session.talking = true;
    drawChat();
    try {
        const history = session.chat.slice(-8).map(m => `${m.who}: ${m.text}`).join('\n');
        const reply = String(await requestOnConnection('combatProfileId', chatSystem(to),
            `${history}\n${to}:`, 300) || '').trim().replace(new RegExp(`^${to}\\s*:\\s*`, 'i'), '');
        const line = dialogueOnly(reply, to);
        if (session) session.chat.push({ who: to, text: line || '...' });
        if (line) speakLine(to, line);
    } catch (err) {
        console.error('[SillyNPC] combat talk failed', err);
        toastr.error('They could not answer.', 'SillyNPC');
    }
    if (session) session.talking = false;
    keepTalk();
    drawChat();
}

function drawChat() {
    const pane = panel?.querySelector('.snpc-fight-chat');
    if (!pane) return;
    pane.classList.toggle('is-hidden', !session);
    pane.replaceChildren();
    if (!session) return;

    pane.append(el('div', 'snpc-fight-chat-title', 'Table talk'));
    const to = el('select', 'text_pole snpc-fight-chat-to');
    for (const n of chatCast()) to.append(new Option(`Talk to ${n}`, n));
    to.value = session.talkTo && chatCast().includes(session.talkTo) ? session.talkTo : (chatCast()[0] || '');
    session.talkTo = to.value;
    to.addEventListener('change', () => { session.talkTo = to.value; });
    pane.append(to);

    const log = el('div', 'snpc-fight-chat-log');
    if (!session.chat.length) log.append(el('p', 'notes', 'Say something to them while you fight.'));
    for (const m of session.chat) {
        const row = el('div', `snpc-fight-bubble${m.mine ? ' is-mine' : ''}`);
        row.append(el('b', '', m.who), el('span', '', m.text));
        log.append(row);
    }
    if (session.talking) log.append(el('p', 'notes', 'Typing...'));
    pane.append(log);
    log.scrollTop = log.scrollHeight;

    const form = el('div', 'snpc-fight-chat-form');
    const input = el('input', 'text_pole');
    input.placeholder = 'Say something...';
    input.disabled = Boolean(session.talking);
    const send = el('button', 'menu_button', 'Send');
    send.type = 'button';
    send.disabled = Boolean(session.talking);
    const go = () => { const t = input.value; input.value = ''; sendTalk(t); };
    send.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    form.append(input, send);
    pane.append(form);
}

function draw() {
    if (!panel) return;
    const body = panel.querySelector('.snpc-fight-body');
    body.replaceChildren();
    if (session) drawBattle(body);
    else drawSetup(body);
    drawChat();
}

function openPanel() {
    if (!panel) {
        panel = el('div', 'snpc-fight');
        panel.id = 'snpc-fight';
        const head = el('div', 'snpc-fight-head');
        head.append(el('span', '', 'Combat'));
        const close = el('button', 'snpc-fight-close', '×');
        close.type = 'button';
        close.title = 'Close';
        close.addEventListener('click', () => panel.classList.remove('is-open'));
        // History is always one click away, in a fight or out of one: narrowed to the opponent when there is one.
        const hist = el('button', 'snpc-fight-histbtn', 'History');
        hist.type = 'button';
        hist.title = 'Past fights, spars and games in this chat';
        hist.addEventListener('click', () => {
            const foe = session ? Object.values(session.state.fighters).find(f => f.side === 'foe') : null;
            openRivalryEditor(foe?.name || '');
        });
        const tools = el('span', 'snpc-fight-tools');
        tools.append(hist, close);
        head.append(tools);
        const main = el('div', 'snpc-fight-main');
        main.append(el('div', 'snpc-fight-body'));
        main.append(el('div', 'snpc-fight-chat is-hidden'));
        panel.append(head, main);
        document.body.append(panel);
    }
    panel.classList.add('is-open');
    draw();
}

/** Shows or hides the corner button. Called when a chat opens and when Combat is switched. */
export function renderCombatButton() {
    const row = buttonRow();
    let btn = document.getElementById('snpc-combat-btn');
    if (!btn) {
        btn = el('div', 'rpg-floating-btn');
        btn.id = 'snpc-combat-btn';
        btn.title = 'Combat';
        btn.append(el('i', 'fa-solid fa-khanda'));
        btn.addEventListener('click', () => {
            if (panel?.classList.contains('is-open')) panel.classList.remove('is-open');
            else openPanel();
        });
        row.append(btn);
    }
    const show = combatPrefs().enabled && chatOpen();
    btn.style.display = show ? 'flex' : 'none';
    if (!show && panel) panel.classList.remove('is-open');
}

function endSession() {
    session = null;
    if (panel) panel.classList.remove('is-open');
}

jQuery(() => {
    renderCombatButton();
    eventSource.on(event_types.CHAT_CHANGED, () => { endSession(); renderCombatButton(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => renderCombatButton());
});
