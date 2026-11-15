import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { getPlayerCard } from '../../src/status-logic.js';
import { hasTypeData, getTypeData } from '../../src/combat-store.js';
import { setStatus, addXp } from '../../src/combat-edit.js';
import { renderLoadoutPicker } from '../../src/ui-gear.js';
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
import { andList, sidesOfFight, talkEntry, fightRecord } from '../../src/combat-talk.js';
import { newTalkId } from '../../src/talk-log.js';
import {
    startFight, takeTurn, skipTurn, currentActor, living, offeredActions, canPay, autoTurn,
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
/** The step between setup and the fight: who, what stakes, and a last look at the equipment. Null when not on it. */
let ready = null;
/** Setup: 'play' to fight yourself, 'watch' to spectate others (fork). */
let setupMode = 'play';
/** Who is on each team on the watch setup screen, as character ids. */
let watchPick = { a: [], b: [], mode: 'fight' };
/** Whose equipment panels are open on the watch equipment screen. */
const openWho = new Set();
/** People chosen to look on, as character ids (fork). */
let spectatorPick = [];

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

/** One record for the whole fight: everyone on both sides, allies and every foe, and who watched. */
function recordFight() {
    const { state } = session;
    // One id for the fight, shared by this record and the fight's talk (keepTalk), so the story
    // prompt can tell they are the same fight and never sends it twice.
    if (!session.talkId) session.talkId = newTalkId();
    const record = fightRecord({ state, id: session.talkId, percentOf, spectators: session.spectators });
    if (!record) return;
    try { addRecord(record); } catch (err) { console.warn('[SillyNPC] could not record the fight', err); }
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
        if (!session.talkId) session.talkId = newTalkId();
        const entry = talkEntry({
            state: session.state, chat: session.chat, id: session.talkId, at: Date.now(),
            date: sceneClock()?.dateText || '', spectators: session.spectators,
        });
        if (entry) recordTalk('combat', entry);
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
    const turn = autoTurn(session.type, session.state);
    persistAll();
    return turn;
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
    if (fighter.weaponName) {
        // The real weapon, with its tier when it is a tiered one (a default fist has none).
        const tier = fighter.loadout && !fighter.loadout.main.default ? fighter.loadout.main.tierLabel : '';
        info.append(el('div', 'snpc-fight-weapon', tier ? `${fighter.weaponName} · ${tier}` : fighter.weaponName));
    }
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
    const lead = event.counter ? `${actor.name} strikes back (${event.label})` : event.offhand ? `${actor.name} strikes again with the second blade (${event.label})` : event.follow ? `${actor.name} follows up` : `${actor.name} — ${how}`;
    const edge = event.advantage?.length ? ` (${event.advantage.join(', ')})` : '';
    const pool = target.view.pools[event.pool];
    const amount = pool && asPercent(event.pool) ? `${Math.max(1, Math.round((event.taken / pool.max) * 100))}%` : event.taken;
    const extras = [];
    if (event.passives?.length) extras.push(event.passives.join(', '));
    if (event.gearCrit) extras.push('finds a weak point');
    if (event.blocked > 0) extras.push(`${event.blocked}% blocked`);
    if (event.healed > 0) extras.push(`recovers ${Math.max(1, Math.round((event.healed / target.view.pools.health.max) * 100))}% health`);
    if (event.drained > 0) extras.push(`${actor.name} drains ${Math.max(1, Math.round((event.drained / actor.view.pools.health.max) * 100))}% health`);
    const note = extras.length ? ` [${extras.join('; ')}]` : '';
    const blow = event.taken > 0 ? `${band}, ${amount} to ${event.pool}${edge}${note}.` : (event.blocked > 0 ? `${band}, blocked${edge}${note}.` : `${band}${edge}${note}.`);
    const end = event.down ? (session.state.mode === 'spar' ? ` ${target.name} yields.` : ` ${target.name} falls.`) : '';
    return `${lead}: ${blow}${end}`;
}

function outcomeWord(state) {
    if (session?.spectator) {
        const won = state.order.map(id => state.fighters[id]).filter(f => f.side !== state.over.loser).map(f => f.name);
        return `${andList(won)} ${state.mode === 'spar' ? 'win the spar' : 'won the fight'}.`;
    }
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
        lines.push(`${f.name}${f.weaponName ? ` (${f.weaponName})` : ''}: ${parts.join(', ')}.`);
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
    if (session.spectator) { drawWatch(body); return; }
    const { state, type } = session;
    const head = el('div', 'snpc-fight-sides');
    const ids = state.order.slice().sort((a, b) => (state.fighters[a].side === 'player' ? -1 : 1) - (state.fighters[b].side === 'player' ? -1 : 1));
    ids.forEach((id, i) => {
        if (i === 1) head.append(el('div', 'snpc-fight-vs', 'VS'));
        head.append(fighterCard(state.fighters[id]));
    });
    body.append(head);

    if (session.spectators?.length) body.append(el('small', 'snpc-fight-order', `Watching: ${session.spectators.join(', ')}.`));
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
        go.addEventListener('click', () => { const turn = playOneFoe(); draw(); lineAfterTurn(turn); watcherLine(turn); });
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
    const mine = offeredActions(type, actor.view, actor.weapon, actor.abilities, state.mode, actor.loadout);
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
            watcherLine({ actor, events: result.events || [] });
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

    const modes = el('div', 'snpc-fight-modes');
    for (const [id, text, tip] of [['play', 'Fight', 'You take the turns'], ['watch', 'Watch', 'Pick two teams and spectate, talking to the fighters as it goes']]) {
        const b = el('button', `menu_button${setupMode === id ? ' is-active' : ''}`, text);
        b.type = 'button';
        b.title = tip;
        b.addEventListener('click', () => { setupMode = id; draw(); });
        modes.append(b);
    }
    body.append(modes);
    if (setupMode === 'watch') { drawWatchSetup(body, type, player, foes); return; }

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
        body.append(el('small', 'notes', "You have no combat sheet for this world, so the type's defaults are used. Choosing a weapon on the next screen gives you one."));
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
        return peopleFor(type, player, foe);
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

    drawSpectatorPicker(body, foes);

    // Start no longer begins the fight: it opens the equipment screen, where you can still back out.
    const start = el('button', 'menu_button snpc-fight-start', 'Next: equipment');
    start.type = 'button';
    start.addEventListener('click', () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        ready = { type, player, foe, mode: modeSelect.value, diffMod: Number(diffSelect.selectedOptions[0]?.dataset.mod) || 0, spectators: chosenSpectators(foes, [player, foe]) };
        draw();
    });
    body.append(start);
}

/** The two fighters as startFight takes them. Their weapons come from their own sheets. */
function peopleFor(type, player, foe) {
    return [
        { id: 'player', name: player.name || 'You', side: 'player', data: startData(player, type) },
        { id: foe.id, name: foe.name, side: 'foe', data: startData(foe, type) },
    ];
}

/**
 * The equipment screen (fork): the last look before a fight. Each side's weapons and tool belt can
 * be changed here (they are saved on the character), the difficulty is shown as it now stands, and
 * nothing has begun until Begin: Back returns to setup, and closing the window leaves nothing behind.
 */
function drawReady(body) {
    if (ready.watch) { drawWatchReady(body); return; }
    const { type, player, foe, mode } = ready;
    body.append(el('p', 'snpc-fight-type', type.name));
    body.append(el('p', 'snpc-fight-turn', `${mode === 'spar' ? 'Spar' : 'Fight'} against ${foe.name}. Get ready.`));

    const columns = el('div', 'snpc-fight-weapons snpc-fight-ready');
    for (const [record, title] of [[player, player.name || 'You'], [foe, foe.name]]) {
        const box = el('div', 'snpc-fight-weapon-edit');
        box.append(el('div', 'snpc-fight-weapon-title', title));
        box.append(renderLoadoutPicker(record, type, { mode, onChange: () => draw() }));
        columns.append(box);
    }
    body.append(columns);

    if (ready.spectators?.length) body.append(el('small', 'notes', `Watching: ${ready.spectators.map(r => r.name).join(', ')}.`));
    const r = rate(type, peopleFor(type, player, foe));
    const turns = mode === 'spar' ? Math.max(2, Math.round(r.turns * SPAR_SHARE)) : Math.round(r.turns);
    body.append(el('small', 'snpc-fight-pace', `${r.label}: about ${turns} turns (each side's action counts as one).`));

    const row = el('div', 'snpc-fight-actions');
    const begin = el('button', 'menu_button snpc-fight-start', 'Begin');
    begin.type = 'button';
    begin.addEventListener('click', () => beginFight());
    const back = el('button', 'menu_button', 'Back');
    back.type = 'button';
    back.title = 'Nothing has started. Go back and change who or how you fight.';
    back.addEventListener('click', () => { ready = null; draw(); });
    row.append(begin, back);
    body.append(row);
}

/** Starts the fight set up on the equipment screen. */
function beginFight() {
    if (!ready) return;
    const { type, player, foe, mode, diffMod } = ready;
    const watchers = (ready.spectators || []).map(r => r.name);
    const people = peopleFor(type, player, foe);
    const pace = calibrate(type, people, { mode, diff: diffMod });
    const state = startFight(type, people, { mode, diff: diffMod, seed: Date.now(), poolScale: pace.scale });
    ready = null;
    session = {
        type,
        state,
        pace,
        records: new Map([['player', player], [foe.id, foe]]),
        spectators: watchers,
        chat: [],
        talkTo: foe.name,
        talking: false,
        saved: false,
        reported: false,
        posting: false,
        failed: false,
    };
    draw();
}


/* ------------------------------------------------------------------- watching (fork) */

const MAX_TEAM = 4;
const SPEEDS = [['Slow', 3200], ['Normal', 1600], ['Fast', 600]];

/** Everyone who can be put in a fight to watch: the persona too, played by the computer. */
function watchCast(player, foes) {
    const all = [player, ...foes].filter(Boolean);
    return all.filter((r, i) => all.findIndex(x => x.id === r.id) === i);
}

/** Teams as they stand, fixed up: only people who exist, nobody twice, at least one a side. */
function tidyPicks(cast) {
    const ids = new Set(cast.map(r => r.id));
    const taken = new Set();
    const clean = (list) => list.filter(id => ids.has(id) && !taken.has(id) && taken.add(id)).slice(0, MAX_TEAM);
    watchPick.a = clean(watchPick.a);
    watchPick.b = clean(watchPick.b);
    for (const side of ['a', 'b']) {
        if (watchPick[side].length) continue;
        const free = cast.find(r => !taken.has(r.id));
        if (free) { watchPick[side].push(free.id); taken.add(free.id); }
    }
}

function drawWatchSetup(body, type, player, foes) {
    const cast = watchCast(player, foes);
    if (cast.length < 2) {
        body.append(el('p', 'notes', 'Watching needs at least two characters.'));
        return;
    }
    tidyPicks(cast);
    body.append(el('p', 'notes', `Pick the two teams, one to ${MAX_TEAM} a side, and watch them fight. Everyone is played by the computer, and you can talk to any of them as it goes.`));

    const teams = el('div', 'snpc-fight-teams-setup');
    for (const [side, title] of [['a', 'Team A'], ['b', 'Team B']]) {
        const box = el('div', `snpc-fight-team-box is-${side}`);
        box.append(el('div', 'snpc-fight-team-title', title));
        const used = new Set([...watchPick.a, ...watchPick.b]);
        watchPick[side].forEach((id, slot) => {
            const row = el('div', 'snpc-fight-team-row');
            const select = el('select', 'text_pole');
            for (const r of cast) {
                const option = new Option(r.name + (hasTypeData(r, type.dataKey) ? '' : ' (defaults)'), r.id);
                option.disabled = used.has(r.id) && r.id !== id;
                select.append(option);
            }
            select.value = id;
            select.addEventListener('change', () => { watchPick[side][slot] = select.value; draw(); });
            row.append(select);
            if (watchPick[side].length > 1) {
                const del = el('button', 'menu_button', '×');
                del.type = 'button';
                del.title = 'Take them out of the team';
                del.addEventListener('click', () => { watchPick[side].splice(slot, 1); draw(); });
                row.append(del);
            }
            box.append(row);
        });
        const free = cast.find(r => !used.has(r.id));
        if (watchPick[side].length < MAX_TEAM && free) {
            const add = el('button', 'menu_button', '+ Add a fighter');
            add.type = 'button';
            add.addEventListener('click', () => { watchPick[side].push(free.id); draw(); });
            box.append(add);
        }
        teams.append(box);
    }
    body.append(teams);

    const mode = el('label', 'snpc-fight-field', 'Stakes');
    const modeSelect = el('select', 'text_pole');
    modeSelect.append(new Option('Spar: guard, then yield', 'spar'));
    modeSelect.append(new Option('Fight: health', 'fight'));
    if (!type.pools.some(p => p.role === 'guard')) { modeSelect.options[0].disabled = true; watchPick.mode = 'fight'; }
    modeSelect.value = watchPick.mode;
    modeSelect.addEventListener('change', () => { watchPick.mode = modeSelect.value; });
    mode.append(modeSelect);
    body.append(mode);
    body.append(el('small', 'snpc-fight-pace', `${watchPick.a.length} against ${watchPick.b.length}. The side with fewer fighters has its back to the wall: a small edge for each foe more than it has friends.`));

    const fighting = new Set([...watchPick.a, ...watchPick.b]);
    drawSpectatorPicker(body, cast.filter(r => !fighting.has(r.id)));

    const next = el('button', 'menu_button snpc-fight-start', 'Next: equipment');
    next.type = 'button';
    next.addEventListener('click', () => {
        const byId = new Map(cast.map(r => [r.id, r]));
        ready = {
            watch: true, type, mode: watchPick.mode,
            a: watchPick.a.map(id => byId.get(id)).filter(Boolean),
            b: watchPick.b.map(id => byId.get(id)).filter(Boolean),
            spectators: chosenSpectators(cast, [...watchPick.a, ...watchPick.b].map(id => ({ id }))),
        };
        openWho.clear();
        draw();
    });
    body.append(next);
}

/** The equipment screen for a watched fight: a panel for each fighter, nothing starts until Begin. */
function drawWatchReady(body) {
    const { type, mode } = ready;
    body.append(el('p', 'snpc-fight-type', type.name));
    body.append(el('p', 'snpc-fight-turn', `${mode === 'spar' ? 'A spar' : 'A fight'}: ${ready.a.length} against ${ready.b.length}. Look over the equipment, then begin.`));
    if (ready.spectators?.length) body.append(el('small', 'notes', `Watching: ${ready.spectators.map(r => r.name).join(', ')}.`));
    for (const [list, title] of [[ready.a, 'Team A'], [ready.b, 'Team B']]) {
        body.append(el('div', 'snpc-fight-team-title', title));
        for (const record of list) {
            const box = el('details', 'snpc-fight-weapon-edit');
            box.open = openWho.has(record.id);
            box.addEventListener('toggle', () => { if (box.open) openWho.add(record.id); else openWho.delete(record.id); });
            box.append(el('summary', 'snpc-fight-weapon-title', record.name));
            box.append(renderLoadoutPicker(record, type, { mode, onChange: () => draw() }));
            body.append(box);
        }
    }
    const row = el('div', 'snpc-fight-actions');
    const begin = el('button', 'menu_button snpc-fight-start', 'Begin');
    begin.type = 'button';
    begin.addEventListener('click', () => beginWatch());
    const back = el('button', 'menu_button', 'Back');
    back.type = 'button';
    back.title = 'Nothing has started. Go back and change the teams.';
    back.addEventListener('click', () => { ready = null; draw(); });
    row.append(begin, back);
    body.append(row);
}

/** Starts the watched fight set up on its equipment screen. */
function beginWatch() {
    if (!ready?.watch) return;
    const { type, mode, a, b } = ready;
    const watchers = (ready.spectators || []).map(r => r.name);
    const records = new Map();
    const people = [];
    a.forEach((r, i) => { records.set(`a${i + 1}`, r); people.push({ id: `a${i + 1}`, name: r.name, side: 'player', data: startData(r, type) }); });
    b.forEach((r, i) => { records.set(`b${i + 1}`, r); people.push({ id: `b${i + 1}`, name: r.name, side: 'foe', data: startData(r, type) }); });
    const state = startFight(type, people, { mode, diff: 0, seed: Date.now(), poolScale: 1 });
    ready = null;
    session = {
        type, state, pace: null, records, chat: [], talkTo: '', talking: false, saved: false, reported: false, posting: false, failed: false,
        spectators: watchers, spectator: true, auto: false, speed: SPEEDS[1][1], chatter: 'notable', timer: null,
    };
    draw();
}

function stopAuto() {
    if (session) session.auto = false;
    if (session?.timer) clearTimeout(session.timer);
    if (session) session.timer = null;
}

/** One turn of a watched fight: whoever's turn it is plays it, and may say a word. */
function watchStep() {
    if (!session?.spectator || session.state.over) return;
    const turn = autoTurn(session.type, session.state);
    persistAll();
    draw();
    if (turn && worthAWord(turn)) lineAfterTurn(turn);
    if (turn) watcherLine(turn);
}

/** Whether this turn is worth a line from the one who took it, by the Chatter setting. */
function worthAWord(turn) {
    const mode = session.chatter;
    if (mode === 'off') return false;
    if (mode === 'every') return true;
    return isNotable(turn);
}

function scheduleAuto() {
    if (!session?.auto || session.state.over) return;
    session.timer = setTimeout(() => {
        if (!session?.auto) return;
        // Wait while someone is speaking (the reply to the viewer, or a fighter's line).
        if (!session.talking) watchStep();
        scheduleAuto();
    }, session.speed);
}

function drawWatch(body) {
    const { state } = session;
    const teams = el('div', 'snpc-fight-teams');
    for (const [side, title] of [['player', 'Team A'], ['foe', 'Team B']]) {
        const col = el('div', 'snpc-fight-team');
        col.append(el('div', 'snpc-fight-team-title', `${title} (${living(state, side).length} standing)`));
        for (const id of state.order.filter(x => state.fighters[x].side === side).sort()) col.append(fighterCard(state.fighters[id]));
        teams.append(col);
    }
    body.append(teams);

    if (session.spectators?.length) body.append(el('small', 'snpc-fight-order', `Also watching: ${session.spectators.join(', ')}.`));
    const order = el('small', 'snpc-fight-order');
    order.textContent = `Round ${state.round}` + (state.over ? '' : `  ·  next: ${currentActor(state)?.name || '...'}`);
    body.append(order);

    const log = el('div', 'snpc-fight-log');
    const lines = state.over ? state.log : state.log.slice(-14);
    if (!lines.length) log.append(el('p', 'notes', 'Nothing has happened yet. Press Step or Play.'));
    for (const event of lines) log.append(el('p', '', describe(event)));
    body.append(log);
    log.scrollTop = log.scrollHeight;

    if (state.over) {
        stopAuto();
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

    const row = el('div', 'snpc-fight-actions snpc-fight-watchbar');
    const step = el('button', 'menu_button', 'Step');
    step.type = 'button';
    step.title = 'Play one turn';
    step.disabled = session.auto;
    step.addEventListener('click', () => watchStep());
    const play = el('button', 'menu_button', session.auto ? 'Pause' : 'Play');
    play.type = 'button';
    play.addEventListener('click', () => {
        if (session.auto) stopAuto();
        else { session.auto = true; scheduleAuto(); }
        draw();
    });
    const speed = el('select', 'text_pole');
    for (const [label, ms] of SPEEDS) speed.append(new Option(label, String(ms)));
    speed.value = String(session.speed);
    speed.title = 'How long between turns';
    speed.addEventListener('change', () => { session.speed = Number(speed.value); });
    const chatter = el('select', 'text_pole');
    for (const [label, id] of [['Quiet', 'off'], ['Big moments', 'notable'], ['Every turn', 'every']]) chatter.append(new Option(`Chatter: ${label}`, id));
    chatter.value = session.chatter;
    chatter.title = 'How often a fighter says a line after their turn';
    chatter.addEventListener('change', () => { session.chatter = chatter.value; });
    const skip = el('button', 'menu_button', 'Skip to the end');
    skip.type = 'button';
    skip.title = 'Play the rest out at once';
    skip.addEventListener('click', () => {
        stopAuto();
        let guard = 0;
        while (!session.state.over && guard++ < 2000) autoTurn(session.type, session.state);
        persistAll();
        draw();
    });
    const leave = el('button', 'menu_button', 'Stop watching');
    leave.type = 'button';
    leave.title = 'Leave without a result: nothing is recorded';
    leave.addEventListener('click', () => { stopAuto(); session = null; draw(); });
    row.append(step, play, speed, chatter, skip, leave);
    body.append(row);
}


/* ------------------------------------------------------------ spectators (fork) */

const MAX_SPECTATORS = 6;

/**
 * "Spectators", for a fight you are in or one you watch: characters who look on. They are named in
 * the fight's history and talk (so a later scene can recall who saw it), can be talked to, and now
 * and then say a word about a big moment. They never fight and never count toward a result.
 * The picker redraws only itself, so the rest of the setup keeps what was chosen.
 */
function drawSpectatorPicker(body, candidates) {
    const box = el('div', 'snpc-fight-spectators');
    const draw = () => {
        box.replaceChildren();
        const ids = new Set(candidates.map(r => r.id));
        spectatorPick = spectatorPick.filter((id, i) => ids.has(id) && spectatorPick.indexOf(id) === i).slice(0, MAX_SPECTATORS);
        box.append(el('div', 'snpc-fight-team-title', 'Spectators (optional)'));
        box.append(el('small', 'notes', 'People who watch from the side. They are written into the fight\'s history and can be talked to.'));
        spectatorPick.forEach((id, slot) => {
            const row = el('div', 'snpc-fight-team-row');
            const select = el('select', 'text_pole');
            for (const r of candidates) {
                const option = new Option(r.name, r.id);
                option.disabled = spectatorPick.includes(r.id) && r.id !== id;
                select.append(option);
            }
            select.value = id;
            select.addEventListener('change', () => { spectatorPick[slot] = select.value; draw(); });
            const del = el('button', 'menu_button', '×');
            del.type = 'button';
            del.title = 'Send them away';
            del.addEventListener('click', () => { spectatorPick.splice(slot, 1); draw(); });
            row.append(select, del);
            box.append(row);
        });
        const free = candidates.find(r => !spectatorPick.includes(r.id));
        if (spectatorPick.length < MAX_SPECTATORS && free) {
            const add = el('button', 'menu_button', '+ Add a spectator');
            add.type = 'button';
            add.addEventListener('click', () => { spectatorPick.push(free.id); draw(); });
            box.append(add);
        }
    };
    draw();
    body.append(box);
}

/** The spectators chosen, as records, leaving out anyone who is fighting. */
function chosenSpectators(candidates, fighters) {
    const out = [];
    for (const id of spectatorPick) {
        const r = candidates.find(c => c.id === id);
        if (r && !fighters.some(f => f.id === r.id) && !out.includes(r)) out.push(r);
    }
    return out;
}

/** Whether this turn was a big moment: someone fell, a critical, a passive, a counter, a heavy blow. */
function isNotable(turn) {
    return Boolean(turn?.events?.some((e) => {
        const target = session.state.fighters[e.target];
        const pool = target?.view.pools[e.pool];
        return e.down || e.band === 'crit' || e.counter || e.passives?.length || (pool && e.taken / Math.max(1, pool.max) >= 0.2);
    }));
}

function fightSoFar() {
    const { state } = session;
    const people = state.order.map(id => `${state.fighters[id].name}: ${standing(state.fighters[id])}${state.fighters[id].down ? ', out of it' : ''}`).join('; ');
    const recent = state.log.slice(-6).map(describe).join('\n');
    return `[THE FIGHT SO FAR: round ${state.round}. ${people}.\n${recent}]`;
}

function watcherSystem(name) {
    const { state, type } = session;
    const record = (getSettings().characters || []).find(c => c?.name === name);
    const profile = record ? String(profileText(record) || '').slice(0, 2500) : '';
    const sides = sidesOfFight(state);
    const fighting = `${andList(sides.mine.map(f => f.name))} against ${andList(sides.foes.map(f => f.name))}`;
    return [
        ...contextBlocks('combat'),
        `You are ${name}, watching ${state.mode === 'spar' ? 'a sparring match' : 'a real fight'} (${type.name}) between ${fighting}. `
        + 'You are standing to the side and are not fighting. Do not decide how any blow lands. ' + DIALOGUE_RULE,
        profile ? `[ABOUT ${name}:\n${profile}\n]` : '',
        fightSoFar(),
    ].filter(Boolean).join('\n\n');
}

/** Now and then, after a big moment, one of the spectators says a line about it (never over another speaker). */
async function watcherLine(turn) {
    if (!session?.spectators?.length || session.talking || !isNotable(turn)) return;
    // Every other big moment, so the side does not talk over the fight.
    session.notableCount = (session.notableCount || 0) + 1;
    if (session.notableCount % 2) return;
    session.watcherAt = ((session.watcherAt ?? -1) + 1) % session.spectators.length;
    const name = session.spectators[session.watcherAt];
    const system = `${watcherSystem(name)}\n\n[React to what just happened in one short line, in your own voice.] ${DIALOGUE_RULE}`;
    session.talking = true;
    drawChat();
    try {
        const raw = await requestOnConnection('combatProfileId', system, `${name}:`, 120);
        const line = dialogueOnly(raw, name);
        if (session && line) {
            session.chat.push({ who: name, text: line });
            speakLine(name, line);
        }
    } catch (err) {
        console.error('[SillyNPC] spectator line failed', err);
    }
    if (session) session.talking = false;
    keepTalk();
    drawChat();
}


/* ----------------------------------------------------------------- table talk */

function chatCast() {
    const names = [];
    const add = (n) => { if (n && !names.includes(n)) names.push(n); };
    if (session?.spectator) {
        for (const f of Object.values(session.state.fighters)) add(f.name);
        for (const n of session.spectators || []) add(n);
        return names;
    }
    if (session) {
        for (const n of session.spectators || []) add(n);
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
    if (session.spectators?.includes(name)) return watcherSystem(name);
    const { state, type } = session;
    const record = (getSettings().characters || []).find(c => c?.name === name);
    const profile = record ? String(profileText(record) || '').slice(0, 2500) : '';
    const me = state.fighters.player?.name || 'the player';
    const recent = state.log.slice(-6).map(describe).join('\n');
    const people = state.order.map(id => `${state.fighters[id].name}: ${standing(state.fighters[id])}${state.fighters[id].down ? ', out of it' : ''}`).join('; ');
    return [
        ...contextBlocks('combat'),
        (session.spectator
            ? `You are ${name}, in the middle of ${state.mode === 'spar' ? 'a sparring match' : 'a real fight'} (${type.name}). Someone is watching from the side and talking to you; they are not fighting. `
            : `You are ${name}, in the middle of ${state.mode === 'spar' ? 'a sparring match' : 'a real fight'} (${type.name}) with ${me} present. `)
        + 'Do not decide how any blow lands. ' + DIALOGUE_RULE,
        profile ? `[ABOUT ${name}:\n${profile}\n]` : '',
        rivalryBlock(name, me),
        `[THE FIGHT SO FAR: round ${state.round}. ${people}.\n${recent}]`,
    ].filter(Boolean).join('\n\n');
}

/** After an opponent's turn they say one line, dialogue only, in the table talk. */
async function lineAfterTurn(turn) {
    if (!session || !turn?.actor || session.talking) return;
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
    if (!session.chat.length) log.append(el('p', 'notes', session.spectator ? 'Talk to the fighters while you watch.' : 'Say something to them while you fight.'));
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
    else if (ready) drawReady(body);
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
        close.addEventListener('click', () => { if (session?.auto) { stopAuto(); draw(); } panel.classList.remove('is-open'); });
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
    stopAuto();
    session = null;
    ready = null;
    if (panel) panel.classList.remove('is-open');
}

jQuery(() => {
    renderCombatButton();
    eventSource.on(event_types.CHAT_CHANGED, () => { endSession(); renderCombatButton(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => renderCombatButton());
});
