import { getContext } from '../../../../../extensions.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { queueResult } from '../../src/result-runtime.js';
import { requestOnConnection } from '../../src/connections.js';
import { contextBlocks } from '../../src/context-blocks.js';
import { DIALOGUE_RULE, dialogueOnly, speakLine } from '../../src/spoken-line.js';
import { addRecord, rivalryBlock } from '../../src/rivalry.js';
import { recordTalk } from '../../src/talk-store.js';
import { newTalkId } from '../../src/talk-log.js';
import { combatPrefs, activeCombatType, personaRecordFor, isPersonaChar, isCombatDisabled } from '../../src/combat-access.js';
import { getTypeData, hasTypeData } from '../../src/combat-store.js';
import { addXp } from '../../src/combat-edit.js';
import { levelUpReport } from '../../src/combat-level.js';
import { levelingSettings } from '../../src/leveling.js';
import { editPerson, getPerson, bondSettings } from '../../src/bonds.js';
import { likesPromptText } from '../../src/likes-core.js';
import { playSound } from '../../src/sound-runtime.js';
import { sceneClock } from '../shim.js';
import {
    normalizeActivitySettings, presetFor,
} from '../../src/activity-config-core.js';
import {
    normalizeActivityStore, dayKey, gainedToday, markGained, applyActivityNudge,
} from '../../src/activity-bond-core.js';
import { buildTalkRequest, cannedLine } from '../../src/activity-talk-core.js';
import { activityRecord, activityTalkEntry, activityReport } from '../../src/activity-record.js';
import {
    applyProfXp, unlocksFor, applyUnlocks, progressLine, recordPlay,
} from '../../src/activity-progress-core.js';
import { describeState } from '../../src/activity-memory-core.js';

/**
 * Activities, the SillyTavern side (fork): settings, the chat's activity record, who can be a partner,
 * the partner's talk, and what a finished activity writes (history, XP, bond, story report). The rules are in
 * the src/activity-*-core.js files; this file only connects them to SillyTavern.
 */

const STORE_KEY = 'sillynpc_activities';

/** Built-in presets by id. Only Generic exists so far; the Fire Emblem preset arrives with its activities. */
const BUILT_IN_PRESETS = {};

export const userName = () => String(getContext()?.name1 || 'Player');

/** The saved settings, repaired in place so the object a screen holds is the saved one. */
export function activitySettings() {
    const root = getSettings();
    if (!root.activities || typeof root.activities !== 'object' || Array.isArray(root.activities)) root.activities = {};
    Object.assign(root.activities, normalizeActivitySettings(root.activities));
    return root.activities;
}

export function saveActivitySettings() {
    activitySettings();
    saveSettings();
}

/** The preset in force: the one picked, else the one for the active combat type, else Generic. */
export function activePreset() {
    const s = activitySettings();
    let typeId = '';
    try { typeId = combatPrefs().activeType || ''; } catch { /* combat not set up */ }
    return presetFor({ presetId: s.presetId, typeId, builtIns: BUILT_IN_PRESETS, userPresets: s.presets });
}

/** This chat's activity record (daily bond rule), or null with no chat open. */
export function activityStore() {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta || !ctx.chatId) return null;
    meta[STORE_KEY] = normalizeActivityStore(meta[STORE_KEY]);
    return meta[STORE_KEY];
}

const saveStore = () => getContext()?.saveMetadataDebounced?.();

/**
 * Who can be the partner: every Worldkit character except persona cards and the ones switched off for combat,
 * and the chat's current character if it is not one of them.
 * @returns {{ name: string, id: string, avatar: string }[]}
 */
export function partnerList() {
    const me = userName().toLowerCase();
    const out = [];
    for (const c of getSettings().characters || []) {
        if (!c?.name || isPersonaChar(c) || isCombatDisabled(c)) continue;
        if (String(c.name).trim().toLowerCase() === me) continue;
        out.push({ name: c.name, id: c.id || c.name, avatar: c.imageUrl || '' });
    }
    const current = String(getContext()?.name2 || '').trim();
    if (current && !out.some(p => p.name.toLowerCase() === current.toLowerCase()) && current.toLowerCase() !== me) {
        out.unshift({ name: current, id: current, avatar: '' });
    }
    return out;
}

/** The card for a name, or null. */
export const cardOf = (name) => (getSettings().characters || []).find(c => String(c?.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()) || null;

/** The proficiencies the active combat type has, narrowed to the ones the preset's Study names. */
export function studySubjects(preset) {
    const type = activeCombatType();
    if (!type) return [];
    const want = new Set(preset?.study?.profs || []);
    return (type.proficiencies || []).filter(p => want.has(p.id)).map(p => ({ id: p.id, label: p.label }));
}

/** Plays a sound by id; a missing map or tag is silent. */
export function sfx(name) {
    try { Promise.resolve(playSound(name)).catch(() => { }); } catch { /* sound is optional */ }
}

/* ------------------------------------------------------------------ talk */

/**
 * One line from the partner, or a canned one. Never throws. Returns { text, canned }.
 * With talk off the line is canned; a failed request falls back to a canned line too.
 */
export async function askPartner({ partner, label, beat, stateText = '', playerText = '', talkSoFar = [], outcome = '' }) {
    const s = activitySettings();
    const canned = () => ({ text: cannedLine(beat, outcome), canned: true });
    if (!s.talkOn) return canned();
    try {
        const ctx = getContext();
        const chat = (ctx?.chat || []).filter(m => !m.is_system).slice(-Math.max(0, s.contextMessages));
        const story = chat.map(m => `${m.name}: ${m.mes}`).join('\n\n');
        const card = cardOf(partner);
        const req = buildTalkRequest({
            partner, user: userName(), activity: label.toLowerCase(), beat, stateText, playerText, talkSoFar,
            story, blocks: contextBlocks('activities'), rivalry: rivalryBlock(partner, userName()),
            likes: card ? likesPromptText(card.prefs) : '', rule: DIALOGUE_RULE,
        });
        const raw = await requestOnConnection('activitiesProfileId', req.system, req.user, s.talkTokens);
        const line = dialogueOnly(raw, partner);
        if (!line) return canned();
        speakLine(partner, line);
        return { text: line, canned: false };
    } catch (err) {
        console.warn('[Worldkit] activity talk failed', err);
        return canned();
    }
}

/* ------------------------------------------------------------------ settling */

/** The dangerous characters for a prompt block, as the other modules clean them. */
const safe = (text) => String(text).replace(/\|/g, '/').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');

/**
 * Writes what a finished Study session leaves behind: the history records, XP and ranks, knowledge, a bond nudge,
 * and the story report. Never throws; returns the lines to show on the result panel.
 *
 * @param {{ partner: string, label: string, subject: string, game: object, rewards: object, lines: {who:string,text:string}[], activityId?: string }} a
 * @returns {string[]}
 */
export function settleStudy({ partner, label, subject, game, rewards, lines, activityId = 'study' }) {
    const s = activitySettings();
    const user = userName();
    const shown = [];
    const extra = [];
    try {
        const id = newTalkId();
        const at = Date.now();
        const date = sceneClock()?.dateText || '';
        const summary = `${label} with ${partner}: ${describeState(game)}.`;
        try { addRecord(activityRecord({ id, label, user, partners: [partner], at, summary })); } catch (err) { console.warn('[Worldkit] could not record the activity', err); }
        recordTalk('activities', activityTalkEntry({ id, at, label, activity: activityId, outcome: rewards.grade, user, partners: [partner], date, lines, result: summary }));

        const type = activeCombatType();
        const mine = personaRecordFor(user);
        const theirs = cardOf(partner);
        if (s.xpOn && type) {
            const ups = [];
            const credit = (record, name, profXp, levelXp) => {
                if (!record || !hasTypeData(record, type.dataKey)) return;
                const rankUps = [];
                if (subject && profXp > 0) {
                    const res = applyProfXp(record, type, subject, profXp);
                    if (res.ok) rankUps.push(...res.rankUps);
                }
                const learned = rankUps.length ? applyUnlocks(record, type, unlocksFor(getTypeData(record, type.dataKey), type)).added : [];
                const line = progressLine({ name, type, rankUps, learned });
                if (line) extra.push(line);
                if (levelXp > 0) {
                    const out = addXp(record, type, levelXp, Date.now(), levelingSettings());
                    if (out.levelsGained) ups.push({ name, from: out.level - out.levelsGained, level: out.level });
                }
            };
            credit(mine, user, rewards.profXp, rewards.levelXp);
            credit(theirs, partner, rewards.partnerProfXp, 0);
            if (ups.length) {
                const report = safe(levelUpReport(ups));
                if (report) queueResult('levelup', report, { append: true });
            }
            if (!mine || !hasTypeData(mine, type.dataKey)) shown.push('You have no combat sheet, so no XP was kept.');
            else shown.push(`+${rewards.profXp} XP in ${(type.proficiencies || []).find(p => p.id === subject)?.label || 'your subject'}`);
        }
        if (mine) mine.actStats = recordPlay(mine.actStats, activityId, rewards.grade, rewards.knowledge);
        if (mine && rewards.knowledge > 0) shown.push(`+${rewards.knowledge} knowledge`);

        if (s.bondOn && rewards.bond) {
            const store = activityStore();
            const day = dayKey(date);
            const person = getPerson(partner);
            if (store && person?.tracked) {
                if (gainedToday(store, day, partner, activityId)) {
                    shown.push(`${partner} has already shared this with you today, so the bond holds steady.`);
                } else {
                    let result = null;
                    editPerson(partner, (p, bondStore) => { result = applyActivityNudge(p, rewards.bond, bondSettings().growth, bondStore.turn); });
                    markGained(store, day, partner, activityId);
                    saveStore();
                    if (result?.delta) shown.push(`${partner} warmed to you a little (${result.meter}).`);
                }
            }
        }

        queueResult('activities', safe(activityReport({ label, user, partners: [partner], grade: rewards.grade, extra })), { append: false });
        saveSettings();
    } catch (err) {
        console.warn('[Worldkit] could not settle the activity', err);
    }
    return [...shown, ...extra];
}
