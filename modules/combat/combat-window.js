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
import { wheelNote } from '../../src/combat-elements.js';
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
import { groupInstruction, parseGroupReply } from '../../src/group-talk.js';
import { newTalkId } from '../../src/talk-log.js';
import {
    startFight, takeTurn, skipTurn, currentActor, living, offeredActions, canPay, autoTurn,
    activeAbilities, toolActions, fleeChance, attemptFlee,
} from '../../src/combat-fight.js';

import { PRODUCT_NAME } from '../../src/constants.js';
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
/** Who is on each team on the watch setup screen, as character ids, and the two opt-in rules. */
let watchPick = { a: [], b: [], mode: 'fight', crowding: false, aiFlee: false };
/** Playing with a team (fork): allies at your side and foes beyond the first, as character ids, and the rules. */
let playPick = { allies: [], foes: [], crowding: false, aiFlee: false };
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
    try { addRecord(record); } catch (err) { console.warn('[Worldkit] could not record the fight', err); }
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
    for (const x of session.xp) if (x.levelsGained) toastr.success(`${x.name} reached level ${x.level}!`, PRODUCT_NAME);
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
    } catch (err) { console.warn('[Worldkit] could not keep the fight talk', err); }
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

/**
 * One turn by someone the player does not steer, played when the player presses Continue: a foe,
 * or (fork) an ally at the player's side, who chooses for themself. Nothing acts unseen.
 */
function playOneFoe() {
    if (!session || session.state.over) return null;
    const actor = currentActor(session.state);
    if (!actor || actor.id === 'player') return null;
    const turn = autoTurn(session.type, session.state);
    persistAll();
    return turn;
}

/** Puts these characters back to full health (status S+), for a fresh test. Sheets they do not have stay unmade. */
function resetStatus(type, records) {
    let reset = 0;
    for (const r of records) {
        if (!r || !hasTypeData(r, type.dataKey)) continue;
        if (setStatus(r, type, STATUS_DEFAULT).ok) reset++;
    }
    if (reset) saveSettings();
    return reset;
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
    if (fighter.down) info.append(el('small', 'snpc-fight-downtag', fighter.fled ? 'Fled' : session.state.mode === 'spar' ? 'Yielded' : 'Down'));
    else if (fighter.stun > 0) info.append(el('small', 'snpc-fight-downtag', 'Stunned'));
    card.append(info);
    return card;
}

function describe(event) {
    if (event.skip) return event.reason;
    const actor = session.state.fighters[event.actor];
    const target = session.state.fighters[event.target];
    if (event.passive) return `${actor.name} — ${event.label}: recovers ${Math.max(1, Math.round((event.healed / actor.view.pools.health.max) * 100))}% health.`;
    const share = (who, n) => `${Math.max(1, Math.round((n / Math.max(1, who.view.pools.health?.max || 1)) * 100))}%`;
    // Running away (fork): the try, and how it went.
    if (event.flee) {
        if (event.escaped) return `${actor.name} runs for it (${event.chance}% chance) and gets away${event.clean ? ' clean' : ''}.`;
        if (event.cutDown) return `${actor.name} runs for it (${event.chance}% chance), but is cut down before getting clear.`;
        return `${actor.name} tries to run (${event.chance}% chance), but is caught and loses the turn.`;
    }
    // Tools from the belt (fork).
    if (event.tool) {
        const left = event.usesLeft > 0 ? ` (${event.usesLeft} left)` : ' (the last one)';
        const lead = `${actor.name} ${event.verb || 'uses'} ${event.label}${left}`;
        if (event.toolType === 'heal') return `${lead}: ${target.name} recovers ${share(target, event.healed || 0)} health.`;
        if (event.toolType === 'smoke') return `${lead}: cover for ${target.name}.`;
        if (event.toolType === 'blind') return `${lead} at ${target.name}: ${event.landed ? 'blinded' : 'it misses'} (${event.chance}% chance).`;
        if (event.toolType === 'stun') return `${lead} at ${target.name}: ${event.landed ? 'stunned' : 'it misses'} (${event.chance}% chance).`;
        const hurt = event.taken > 0 ? `${BANDS[event.band] || event.band}, ${share(target, event.taken)} to ${event.pool}` : (BANDS[event.band] || event.band || 'no harm');
        return `${lead} at ${target.name}: ${hurt}${event.slowed ? ', slowed' : ''}.${event.down ? ` ${target.name} falls.` : ''}`;
    }
    if (event.ability && event.target === event.actor) {
        const bits = [];
        if (event.form) bits.push(`takes up ${event.form}`);
        if (event.healed > 0) bits.push(`recovers ${Math.max(1, Math.round((event.healed / actor.view.pools.health.max) * 100))}% health`);
        if (event.braced > 0) bits.push(`braces against the next blow (${Math.round(event.braced * 100)}% off)`);
        return `${actor.name} — ${event.label}: ${bits.join(', ') || 'no effect'}.`;
    }
    const band = BANDS[event.band] || event.band;
    const how = event.weapon ? `${event.label}, ${event.weapon}` : event.label;
    const lead = event.parting ? `${actor.name} catches ${target.name} running (${event.label})` : event.counter ? `${actor.name} strikes back (${event.label})` : event.offhand ? `${actor.name} strikes again with the second blade (${event.label})` : event.follow ? `${actor.name} follows up` : `${actor.name} — ${how}`;
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
    const ran = state.order.map(id => state.fighters[id]).filter(f => f.fled).map(f => f.name);
    if (session?.spectator) {
        const won = state.order.map(id => state.fighters[id]).filter(f => f.side !== state.over.loser).map(f => f.name);
        if (state.over.fled) return `${andList(ran)} fled. ${andList(won)} held the field.`;
        return `${andList(won)} ${state.mode === 'spar' ? 'win the spar' : 'won the fight'}.${ran.length ? ` ${andList(ran)} fled.` : ''}`;
    }
    const youLost = state.over.loser === 'player';
    if (state.over.fled) return youLost ? 'You got away.' : 'They ran. The field is yours.';
    if (state.fighters.player?.fled) return youLost ? 'You got away; your side fell.' : 'You got away, and your side won.';
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
    const rounds = `${state.round} round${state.round === 1 ? '' : 's'}`;
    const ran = [...players, ...foes].filter(f => f.fled);
    const fell = lost.filter(f => !f.fled);
    if (state.over.fled) {
        lines.push(`Result: ${names(lost.filter(f => f.fled))} fled from ${names(won)} after ${rounds}.${fell.length ? ` ${names(fell)} fell.` : ''}`);
    } else {
        lines.push(`Result: ${names(won)} won after ${rounds}. ${names(fell.length ? fell : lost)} ${state.mode === 'spar' ? 'yielded' : 'fell'}.`);
        if (ran.length) lines.push(`${names(ran)} fled the fight.`);
    }
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
        console.error('[Worldkit] combat report failed', err);
        toastr.error('Could not post the combat report to chat.', PRODUCT_NAME);
        if (session) session.failed = true;
    }
    if (session) session.posting = false;
    draw();
}

function drawBattle(body) {
    if (session.spectator) { drawWatch(body); return; }
    const { state, type } = session;
    if (state.order.length > 2) {
        // A team fight (fork): your side and theirs, in two columns, as when watching.
        const teams = el('div', 'snpc-fight-teams');
        for (const [side, title] of [['player', 'Your side'], ['foe', 'Their side']]) {
            const col = el('div', 'snpc-fight-team');
            col.append(el('div', 'snpc-fight-team-title', `${title} (${living(state, side).length} standing)`));
            for (const id of state.order.filter(x => state.fighters[x].side === side)) col.append(fighterCard(state.fighters[id]));
            teams.append(col);
        }
        body.append(teams);
    } else {
        const head = el('div', 'snpc-fight-sides');
        const ids = state.order.slice().sort((a, b) => (state.fighters[a].side === 'player' ? -1 : 1) - (state.fighters[b].side === 'player' ? -1 : 1));
        ids.forEach((id, i) => {
            if (i === 1) head.append(el('div', 'snpc-fight-vs', 'VS'));
            head.append(fighterCard(state.fighters[id]));
        });
        body.append(head);
    }
    const rules = [state.crowding ? 'crowding' : '', state.aiFlee ? 'fighters may run' : ''].filter(Boolean);
    if (rules.length) body.append(el('small', 'snpc-fight-order', `Rules: ${rules.join(', ')}.`));

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
    if (actor.id !== 'player') {
        // Say whose turn it is and let the player start it, so nothing happens unseen. Allies (fork)
        // choose for themselves, the same way.
        const first = !state.log.length;
        const who = actor.side === 'player' ? `${actor.name} (with you)` : actor.name;
        body.append(el('p', 'snpc-fight-turn', first ? `${who} goes first.` : `${who}'s turn.`));
        const go = el('button', 'menu_button', first ? 'Begin' : 'Continue');
        go.type = 'button';
        go.addEventListener('click', () => { const turn = playOneFoe(); draw(); lineAfterTurn(turn); watcherLine(turn); });
        const row = el('div', 'snpc-fight-actions');
        row.append(go);
        body.append(row);
        return;
    }
    const foes = living(state, 'foe');
    // Several foes (fork): the player picks whom to go for; the pick stays until they fall.
    const target = foes.find(f => f.id === session.targetId) || foes[0];
    if (!target) return;
    session.targetId = target.id;
    body.append(el('p', 'snpc-fight-turn', `${state.log.length ? 'Your turn' : 'You go first'}, against ${target.name}.`));
    if (foes.length > 1) {
        const aim = el('label', 'snpc-fight-field snpc-fight-target', 'Target');
        const pick = el('select', 'text_pole');
        for (const f of foes) pick.append(new Option(`${f.name} (${standing(f)})`, f.id));
        pick.value = target.id;
        pick.addEventListener('change', () => { session.targetId = pick.value; draw(); });
        aim.append(pick);
        body.append(aim);
    }
    const row = el('div', 'snpc-fight-actions');
    const mine = offeredActions(type, actor.view, actor.weapon, activeAbilities(actor), state.mode, actor.loadout);
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
            if (!result.ok) { toastr.warning(result.reason, PRODUCT_NAME); return; }
            persistAll();
            draw();
            watcherLine({ actor, events: result.events || [] });
        });
        row.append(button);
    }
    // The tool belt (fork): one use per turn, in place of an attack. Uses come back after the fight.
    for (const tool of toolActions(state, actor)) {
        const button = el('button', 'menu_button is-tool', `${tool.name} ×${tool.uses}`);
        button.type = 'button';
        button.disabled = !tool.usable;
        button.title = tool.usable ? `${tool.verb} ${tool.name}${tool.needsTarget ? ` at ${target.name}` : ''}. Takes your turn.` : tool.reason;
        button.addEventListener('click', () => {
            const result = takeTurn(type, state, tool.key, tool.needsTarget ? target.id : actor.id);
            if (!result.ok) { toastr.warning(result.reason, PRODUCT_NAME); return; }
            persistAll();
            draw();
            watcherLine({ actor, events: result.events || [] });
        });
        row.append(button);
    }
    // Running away (fork): real fights only. The chance is shown before the try.
    const odds = fleeChance(type, state, actor);
    if (odds) {
        const run = el('button', 'menu_button is-flee', `Run (${odds.chance}%)`);
        run.type = 'button';
        run.title = `Try to get away. ${odds.quickest ? `${odds.quickest.name} is the quickest after you. ` : ''}A narrow escape can cost a parting blow; a failed try loses the turn, but the next is easier.`;
        run.addEventListener('click', () => {
            const result = attemptFlee(type, state);
            if (!result.ok) { toastr.warning(result.reason, PRODUCT_NAME); return; }
            persistAll();
            draw();
            const turn = { actor, events: result.events || [] };
            fleeReaction(turn);
            watcherLine(turn);
        });
        row.append(run);
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
    // Coming back from the equipment screen: the same first foe as before.
    if (playPick.first && foes.some(f => f.id === playPick.first)) select.value = playPick.first;
    who.append(select);
    body.append(who);

    // Fighting with a team (fork): more foes, and allies at your side, who act on their own.
    const byId = new Map(foes.map(r => [r.id, r]));
    const teamBox = el('div', 'snpc-fight-teams-setup snpc-fight-playteams');
    const drawTeams = () => {
        teamBox.replaceChildren();
        const tidy = (list, banned) => list.filter((id, i) => byId.has(id) && !banned.has(id) && list.indexOf(id) === i).slice(0, MAX_TEAM - 1);
        playPick.foes = tidy(playPick.foes, new Set([select.value]));
        playPick.allies = tidy(playPick.allies, new Set([select.value, ...playPick.foes]));
        const taken = () => new Set([select.value, ...playPick.foes, ...playPick.allies]);
        for (const [key, title, tip] of [
            ['foes', 'More foes (optional)', 'Up to three more on their side.'],
            ['allies', 'Allies (optional)', 'Up to three at your side. They take their own turns: press Continue when it is theirs.'],
        ]) {
            const box = el('div', `snpc-fight-team-box is-${key === 'allies' ? 'a' : 'b'}`);
            box.append(el('div', 'snpc-fight-team-title', title));
            box.append(el('small', 'notes', tip));
            playPick[key].forEach((id, slot) => {
                const row = el('div', 'snpc-fight-team-row');
                const pick = el('select', 'text_pole');
                const used = taken();
                for (const r of foes) {
                    const option = new Option(r.name + (hasTypeData(r, type.dataKey) ? '' : ' (defaults)'), r.id);
                    option.disabled = used.has(r.id) && r.id !== id;
                    pick.append(option);
                }
                pick.value = id;
                pick.addEventListener('change', () => { playPick[key][slot] = pick.value; drawTeams(); showPace(); });
                const del = el('button', 'menu_button', '×');
                del.type = 'button';
                del.title = 'Take them out';
                del.addEventListener('click', () => { playPick[key].splice(slot, 1); drawTeams(); showPace(); });
                row.append(pick, del);
                box.append(row);
            });
            const free = foes.find(r => !taken().has(r.id));
            if (playPick[key].length < MAX_TEAM - 1 && free) {
                const add = el('button', 'menu_button', key === 'allies' ? '+ Add an ally' : '+ Add a foe');
                add.type = 'button';
                add.addEventListener('click', () => { playPick[key].push(free.id); drawTeams(); showPace(); });
                box.append(add);
            }
            teamBox.append(box);
        }
        if (playPick.allies.length || playPick.foes.length) {
            const n = 1 + playPick.allies.length;
            const m = 1 + playPick.foes.length;
            teamBox.append(el('small', 'snpc-fight-pace', `${n} against ${m}.${n !== m ? ' The side with fewer fighters has its back to the wall: a small edge for each foe more than it has friends.' : ''}`));
        }
    };
    select.addEventListener('change', () => { drawTeams(); });
    drawTeams();
    body.append(teamBox);
    body.append(ruleChecks(playPick));

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
    const teamRecords = () => [...playPick.allies, ...playPick.foes].map(id => byId.get(id)).filter(Boolean);
    check.addEventListener('click', () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        statusBox.replaceChildren();
        for (const [who, rec] of [[player.name || 'You', player], [foe.name, foe], ...teamRecords().map(r => [r.name, r])]) {
            const grade = getTypeData(rec, type.dataKey).status || STATUS_DEFAULT;
            const pct = Math.round(fractionFromStatus(grade) * 100);
            statusBox.append(el('div', 'snpc-fight-status-row', `${who}: ${grade} (about ${pct}% health)`));
        }
    });
    const reset = el('button', 'menu_button', 'Reset status');
    reset.type = 'button';
    reset.title = 'Puts you and the opponent back to full health (S+). For when you are testing.';
    reset.addEventListener('click', () => {
        const foe = foes.find(f => f.id === select.value) || foes[0];
        const n = resetStatus(type, [player, foe, ...teamRecords()]);
        toastr.success(n ? `Reset ${n} to full health.` : 'Nothing to reset: neither has a combat sheet yet.', PRODUCT_NAME);
        check.click();
    });
    body.append(check, reset, statusBox);

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
        const pick = (ids) => ids.map(id => byId.get(id)).filter(Boolean);
        return peopleFor(type, player, foe, pick(playPick.allies), pick(playPick.foes));
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
        const allies = playPick.allies.map(id => byId.get(id)).filter(Boolean);
        const more = playPick.foes.map(id => byId.get(id)).filter(Boolean);
        playPick.first = foe.id;
        ready = {
            type, player, foe, allies, more, mode: modeSelect.value, diffMod: Number(diffSelect.selectedOptions[0]?.dataset.mod) || 0,
            crowding: playPick.crowding, aiFlee: playPick.aiFlee,
            spectators: chosenSpectators(foes, [player, foe, ...allies, ...more]),
        };
        openWho.clear();
        draw();
    });
    body.append(start);
}

/**
 * The fighters as startFight takes them. Their weapons come from their own sheets. With a team
 * (fork), allies join the player's side and further foes the other, each under their own id.
 */
function peopleFor(type, player, foe, allies = [], more = []) {
    return [
        { id: 'player', name: player.name || 'You', side: 'player', data: startData(player, type) },
        ...allies.map(r => ({ id: r.id, name: r.name, side: 'player', data: startData(r, type) })),
        { id: foe.id, name: foe.name, side: 'foe', data: startData(foe, type) },
        ...more.map(r => ({ id: r.id, name: r.name, side: 'foe', data: startData(r, type) })),
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
    const allies = ready.allies || [];
    const more = ready.more || [];
    body.append(el('p', 'snpc-fight-type', type.name));
    const against = andList([foe, ...more].map(r => r.name));
    const withWho = allies.length ? `, with ${andList(allies.map(r => r.name))} at your side` : '';
    body.append(el('p', 'snpc-fight-turn', `${mode === 'spar' ? 'Spar' : 'Fight'} against ${against}${withWho}. Get ready.`));

    const columns = el('div', 'snpc-fight-weapons snpc-fight-ready');
    for (const [record, title] of [[player, player.name || 'You'], [foe, foe.name]]) {
        const box = el('div', 'snpc-fight-weapon-edit');
        box.append(el('div', 'snpc-fight-weapon-title', title));
        box.append(renderLoadoutPicker(record, type, { mode, onChange: () => draw() }));
        columns.append(box);
    }
    body.append(columns);
    // A team (fork): everyone else gets a panel too, folded until opened, as on the watch screen.
    for (const [list, title] of [[allies, 'With you'], [more, 'Also against you']]) {
        if (!list.length) continue;
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
    const rules = [ready.crowding ? 'crowding' : '', ready.aiFlee ? 'fighters may run' : ''].filter(Boolean);
    if (rules.length) body.append(el('small', 'notes', `Rules: ${rules.join(', ')}.`));

    if (ready.spectators?.length) body.append(el('small', 'notes', `Watching: ${ready.spectators.map(r => r.name).join(', ')}.`));
    const people = peopleFor(type, player, foe, allies, more);
    // A world with an elemental wheel (Black Clover): how the two affinities meet. Nothing for the others.
    const firstFoe = people.find(p => p.id === foe.id) || people[1];
    const wheel = wheelNote(type, project(people[0].data, type), project(firstFoe.data, type), player.name || 'You', foe.name);
    if (wheel) body.append(el('small', 'notes snpc-fight-wheel', wheel));
    const r = rate(type, people);
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
    const allies = ready.allies || [];
    const more = ready.more || [];
    const watchers = (ready.spectators || []).map(r => r.name);
    const people = peopleFor(type, player, foe, allies, more);
    // The two opt-in rules (fork), off unless ticked on the setup screen.
    const rules = { crowding: Boolean(ready.crowding), aiFlee: Boolean(ready.aiFlee) };
    const pace = calibrate(type, people, { mode, diff: diffMod, ...rules });
    const state = startFight(type, people, { mode, diff: diffMod, seed: Date.now(), poolScale: pace.scale, ...rules });
    ready = null;
    session = {
        type,
        state,
        pace,
        records: new Map([['player', player], [foe.id, foe], ...[...allies, ...more].map(r => [r.id, r])]),
        targetId: foe.id,
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

/**
 * The two opt-in rules for a fight with more than one a side (fork), as checkboxes that write into
 * `pick` (playPick or watchPick). Both start unticked, so a fight is as it always was unless asked.
 */
function ruleChecks(pick) {
    const box = el('div', 'snpc-fight-rules');
    for (const [key, text, tip] of [
        ['crowding', 'Crowding', 'Friends who all go for the same foe in one round get in each other\'s way: each one already on them makes the next a little less likely to hit.'],
        ['aiFlee', 'Fighters may run', 'In a real fight, a computer-run fighter who is badly hurt, on the losing side, may try to get away.'],
    ]) {
        const label = el('label', 'checkbox_label snpc-fight-rule');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = Boolean(pick[key]);
        input.addEventListener('change', () => { pick[key] = input.checked; });
        label.title = tip;
        label.append(input, el('span', '', text));
        box.append(label);
    }
    return box;
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

    const byIdAll = new Map(cast.map(r => [r.id, r]));
    const picked = () => [...watchPick.a, ...watchPick.b].map(id => byIdAll.get(id)).filter(Boolean);
    const watchStatus = el('div', 'snpc-fight-status');
    const watchCheck = el('button', 'menu_button', 'Check status');
    watchCheck.type = 'button';
    watchCheck.addEventListener('click', () => {
        watchStatus.replaceChildren();
        for (const rec of picked()) {
            const grade = getTypeData(rec, type.dataKey).status || STATUS_DEFAULT;
            watchStatus.append(el('div', 'snpc-fight-status-row', `${rec.name}: ${grade} (about ${Math.round(fractionFromStatus(grade) * 100)}% health)`));
        }
    });
    const watchReset = el('button', 'menu_button', 'Reset status');
    watchReset.type = 'button';
    watchReset.title = 'Puts everyone picked back to full health (S+). For when you are testing.';
    watchReset.addEventListener('click', () => {
        const n = resetStatus(type, picked());
        toastr.success(n ? `Reset ${n} to full health.` : 'Nothing to reset: none of them has a combat sheet yet.', PRODUCT_NAME);
        watchCheck.click();
    });
    body.append(watchCheck, watchReset, watchStatus);

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
    body.append(ruleChecks(watchPick));

    const fighting = new Set([...watchPick.a, ...watchPick.b]);
    drawSpectatorPicker(body, cast.filter(r => !fighting.has(r.id)));

    const next = el('button', 'menu_button snpc-fight-start', 'Next: equipment');
    next.type = 'button';
    next.addEventListener('click', () => {
        const byId = new Map(cast.map(r => [r.id, r]));
        ready = {
            watch: true, type, mode: watchPick.mode, crowding: watchPick.crowding, aiFlee: watchPick.aiFlee,
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
    const state = startFight(type, people, { mode, diff: 0, seed: Date.now(), poolScale: 1, crowding: Boolean(ready.crowding), aiFlee: Boolean(ready.aiFlee) });
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
        // Fork: a try at running, a parting blow and a stun that lands are big moments too.
        if (e.flee || e.parting || (e.tool && e.toolType === 'stun' && e.landed)) return true;
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
        console.error('[Worldkit] spectator line failed', err);
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
        // Foes, and allies at your side (fork).
        for (const f of Object.values(session.state.fighters)) if (f.id !== 'player') add(f.name);
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
    // Someone got away (fork): the word goes to one who stayed, not the one already gone.
    if (turn.events?.some(e => e.flee && e.escaped)) { fleeReaction(turn); return; }
    const { actor, events } = turn;
    const target = events.length ? session.state.fighters[events[0].target] : null;
    const what = events.length
        ? events.map(e => (e.flee || e.tool ? describe(e) : `${BANDS[e.band] || e.band}${e.taken > 0 ? `, took ${Math.round(e.taken / Math.max(1, session.state.fighters[e.target].view.pools[e.pool]?.max || 1) * 100)}% of ${e.pool}` : ''}`)).join('; ')
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
        console.error('[Worldkit] combat line failed', err);
    }
    if (session) session.talking = false;
    // Said after the fight ended: the kept talk gets it too.
    keepTalk();
    drawChat();
}

/**
 * After a try at running (fork): one who stays says a line about it. A friend of the runner speaks
 * first (left behind, or seeing them caught), else one of those they ran from. Never the player.
 */
async function fleeReaction(turn) {
    const ev = turn?.events?.find(e => e.flee);
    if (!session || !ev || session.talking) return;
    const runner = session.state.fighters[ev.actor];
    if (!runner) return;
    const stayed = Object.values(session.state.fighters).filter(f => f.id !== runner.id && f.id !== 'player' && !f.fled);
    const speaker = stayed.find(f => f.side === runner.side && !f.down) || stayed.find(f => f.side !== runner.side && !f.down);
    if (!speaker) return;
    const how = ev.escaped ? 'got away from the fight' : ev.cutDown ? 'was cut down trying to run' : 'tried to run and was caught';
    const whose = speaker.side === runner.side ? 'your own side' : 'the other side';
    const system = chatSystem(speaker.name) + '\n\n'
        + `[${runner.name}, from ${whose}, just ${how}.] `
        + 'Say one short line about it, in your own voice. ' + DIALOGUE_RULE;
    session.talking = true;
    drawChat();
    try {
        const raw = await requestOnConnection('combatProfileId', system, `${speaker.name}:`, 120);
        const line = dialogueOnly(raw, speaker.name);
        if (session && line) {
            session.chat.push({ who: speaker.name, text: line });
            speakLine(speaker.name, line);
        }
    } catch (err) {
        console.error('[Worldkit] flee reaction failed', err);
    }
    if (session) session.talking = false;
    keepTalk();
    drawChat();
}

/** Everyone in the fight who can be spoken to as a group: the fighters (not you) and the spectators. */
function groupNames() {
    const me = session.state.fighters.player?.name;
    const names = Object.values(session.state.fighters).map(f => f.name).filter(n => n !== me);
    for (const n of session.spectators || []) if (!names.includes(n)) names.push(n);
    return names;
}

/** Who answers: one person, everyone ('*'), or one team of a watched fight ('@player' / '@foe'). */
function talkTargets(to) {
    if (to === '*') return groupNames();
    if (to === '@player' || to === '@foe') return Object.values(session.state.fighters).filter(f => f.side === to.slice(1)).map(f => f.name);
    return [to];
}

const GROUP_TALK_MAX = 8;
const isGroupTalk = (to) => to === '*' || to === '@player' || to === '@foe';

/** The system prompt for answering a whole group in one request: everyone's profile, the fight so far, how to reply. */
function groupChatSystem(names, me) {
    const { state, type } = session;
    const profiles = names.map((n) => {
        const record = (getSettings().characters || []).find(c => c?.name === n);
        const profile = record ? String(profileText(record) || '').slice(0, 900) : '';
        return profile ? `[ABOUT ${n}:\n${profile}\n]` : '';
    });
    return [
        ...contextBlocks('combat'),
        `You are voicing ${andList(names)} in the middle of ${state.mode === 'spar' ? 'a sparring match' : 'a real fight'} (${type.name}). `
        + (session.spectator ? 'Someone is watching from the side and talking to them; they are not fighting. ' : `${me} is present. `)
        + 'Do not decide how any blow lands. ' + DIALOGUE_RULE,
        ...profiles,
        fightSoFar(),
        groupInstruction(names, me),
    ].filter(Boolean).join('\n\n');
}

/** One request for a whole group: they each answer in the same reply, which is split back out. */
async function groupReply(names, me) {
    const history = session.chat.slice(-10).map(m => `${m.who}: ${m.text}`).join('\n');
    const raw = await requestOnConnection('combatProfileId', groupChatSystem(names, me), history, Math.min(500, 110 * names.length));
    const lines = parseGroupReply(raw, names, { also: [me, ...Object.values(session.state.fighters).map(f => f.name), ...(session.spectators || [])].filter(n => !names.includes(n)) });
    if (!lines.length) { toastr.info('None of them had anything to say.', PRODUCT_NAME); return; }
    for (const { who, text } of lines) {
        const line = dialogueOnly(text, who);
        if (!line || !session) continue;
        session.chat.push({ who, text: line });
        speakLine(who, line);
    }
}

async function sendTalk(text) {
    if (!session || session.talking || !text.trim()) return;
    const to = session.talkTo || chatCast()[0];
    if (!to) { toastr.info('Nobody to talk to.', PRODUCT_NAME); return; }
    const targets = talkTargets(to).slice(0, GROUP_TALK_MAX);
    if (!targets.length) { toastr.info('Nobody to talk to.', PRODUCT_NAME); return; }
    const me = session.state.fighters.player?.name || 'You';
    session.chat.push({ who: me, text: text.trim(), mine: true });
    session.talking = true;
    drawChat();
    try {
        if (isGroupTalk(to) && targets.length > 1) {
            // Everyone at once costs one request, not one each.
            await groupReply(targets, me);
        } else {
            const name = targets[0];
            const history = session.chat.slice(-8).map(m => `${m.who}: ${m.text}`).join('\n');
            const label = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const reply = String(await requestOnConnection('combatProfileId', chatSystem(name),
                `${history}\n${name}:`, 300) || '').trim().replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '');
            const line = dialogueOnly(reply, name);
            if (session) session.chat.push({ who: name, text: line || '...' });
            if (line) speakLine(name, line);
        }
    } catch (err) {
        console.error('[Worldkit] combat talk failed', err);
        toastr.error('They could not answer.', PRODUCT_NAME);
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
    // Groups first: everyone in the fight, and in a watched fight each team on its own.
    const groups = [];
    if (groupNames().length > 1) groups.push(['*', 'Talk to everyone']);
    if (session.spectator) groups.push(['@player', 'Talk to Team A'], ['@foe', 'Talk to Team B']);
    for (const [value, label] of groups) to.append(new Option(label, value));
    for (const n of chatCast()) to.append(new Option(`Talk to ${n}`, n));
    const valid = (v) => groups.some(g => g[0] === v) || chatCast().includes(v);
    to.value = session.talkTo && valid(session.talkTo) ? session.talkTo : (chatCast()[0] || '');
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
    // A new chat has other people in it: the team picks start over.
    playPick = { allies: [], foes: [], crowding: false, aiFlee: false };
    if (panel) panel.classList.remove('is-open');
}

jQuery(() => {
    renderCombatButton();
    eventSource.on(event_types.CHAT_CHANGED, () => { endSession(); renderCombatButton(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => renderCombatButton());
});
