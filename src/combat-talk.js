/**
 * What a fight leaves in the history (fork), without the window: who stood where, the talk entry
 * kept in the chat's metadata (talk-store.js, embedded by the vectors) and the rivalry record.
 * The combat window calls these when a fight ends; tests call them without a screen.
 *
 * Spectators are people who watched but did not fight. They are named in both records ("watched
 * by") so a later scene can recall who saw it, and they never count toward a win or a tally.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'someone');

/** Who fought on each side, the player's side first. */
export function sidesOfFight(state) {
    const all = Object.values(state.fighters);
    const me = state.fighters.player || null;
    const mine = all.filter(f => f.side === 'player');
    // The player first on their side, then their allies.
    mine.sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
    return { me, mine, foes: all.filter(f => f.side === 'foe') };
}

const names = (list) => [...new Set((list || []).map(n => String(n ?? '').trim()).filter(Boolean))];

/**
 * The entry for the fight's table talk. Null until the fight is over: a fight that is never
 * finished is not kept.
 * @param {{ state: object, chat: {who:string,text:string}[], id: string, at?: number, date?: string, spectators?: string[] }} fight
 */
export function talkEntry({ state, chat, id, at = Date.now(), date = '', spectators = [] }) {
    if (!state?.over) return null;
    const sides = sidesOfFight(state);
    const me = sides.me?.name || 'You';
    const mine = sides.mine.map(f => f.name);
    const foes = sides.foes.map(f => f.name);
    const watchers = names(spectators).filter(n => !mine.includes(n) && !foes.includes(n));
    const lost = state.over.loser === 'player';
    const winner = lost ? (andList(foes) || 'they') : andList(mine.length ? mine : [me]);
    return {
        id,
        at,
        title: `${state.mode === 'spar' ? 'Spar' : 'Fight'} vs ${foes.join(', ') || 'someone'}`,
        // Everyone but the player: allies, foes and the people who watched. The sides say who stood where.
        with: [...mine.filter(n => n !== sides.me?.name), ...foes, ...watchers],
        sideA: mine,
        sideB: foes,
        ...(watchers.length ? { spectators: watchers } : {}),
        date,
        lines: (chat || []).map(m => ({ who: m.who, text: m.text })),
        result: `${winner} won after ${state.round} round${state.round === 1 ? '' : 's'}`,
    };
}

/**
 * The rivalry record for a finished fight: everyone on both sides, allies and every foe.
 * Null when one side is empty.
 */
export function fightRecord({ state, id, percentOf, spectators = [] }) {
    const { me, mine, foes } = sidesOfFight(state);
    if (!mine.length || !foes.length) return null;
    const lost = state.over.loser === 'player';
    const hp = (f) => { const h = f.view.pools.health; return h ? `${percentOf(h.cur, h.max)}%` : '?'; };
    const kind = state.mode === 'spar' ? 'spar' : 'fight';
    const lead = me?.name || mine[0].name;
    const allies = mine.filter(f => f !== me).map(f => f.name);
    const company = allies.length ? `, fighting alongside ${andList(allies)},` : '';
    const foeNames = foes.map(f => f.name);
    const watchers = names(spectators).filter(n => !mine.some(f => f.name === n) && !foeNames.includes(n));
    return {
        event: id,
        kind: 'combat', game: kind === 'spar' ? 'Spar' : 'Fight',
        sideA: mine.map(f => f.name), sideB: foeNames,
        ...(watchers.length ? { spectators: watchers } : {}),
        winner: lost ? 'B' : 'A',
        userSide: me ? 'A' : '', player: me?.name || '',
        summary: `${lead}${company} ${lost ? 'lost to' : 'beat'} ${andList(foeNames)} in a ${kind}, ${state.round} round${state.round === 1 ? '' : 's'}. `
            + `Left standing: ${[...mine, ...foes].map(f => `${f.name} ${hp(f)}`).join(', ')} health.`
            + (watchers.length ? ` Watched by ${andList(watchers)}.` : ''),
    };
}
