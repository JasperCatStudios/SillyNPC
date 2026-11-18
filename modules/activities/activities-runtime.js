import { getContext } from '../../../../../extensions.js';
import { getSettings, saveSettings } from '../../src/settings.js';
import { queueResult } from '../../src/result-runtime.js';
import { requestOnConnection } from '../../src/connections.js';
import { contextBlocks } from '../../src/context-blocks.js';
import { DIALOGUE_RULE, dialogueOnly, speakLine } from '../../src/spoken-line.js';
import { hasVoiceFor } from '../../src/tts.js';
import { addRecord, rivalryBlock } from '../../src/rivalry.js';
import { giveItemFor, getInventory, databaseItems } from '../../src/inventory.js';
import { vitalsStore, vitalsSettings, getVitals, setVitalFor } from '../../src/vitals.js';
import { energyCostOf, canAfford, afterSpend, spentText } from '../../src/activity-energy-core.js';
import { findPerson as findVitalsPerson } from '../../src/vitals-core.js';
import { normalizeKnownStore, mergeKnown, teaPool, snackPool } from '../../src/activity-tea-core.js';
import { DEFAULT_KIT_URL, kitFolderName, kitFileUrl } from '../../src/content-kit.js';
import { recordTalk } from '../../src/talk-store.js';
import { newTalkId } from '../../src/talk-log.js';
import { combatPrefs, activeCombatType, personaRecordFor, isPersonaChar, isCombatDisabled } from '../../src/combat-access.js';
import { getTypeData, hasTypeData } from '../../src/combat-store.js';
import { addXp } from '../../src/combat-edit.js';
import { levelUpReport } from '../../src/combat-level.js';
import { levelingSettings } from '../../src/leveling.js';
import { editPerson, getPerson, bondSettings } from '../../src/bonds.js';
import { likesPromptText } from '../../src/likes-core.js';
import { playSound, playLoop, stopLoops, setLoopVolume, loadSoundMap, loadMapAt } from '../../src/sound-runtime.js';
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
import { BUILT_IN_PRESETS } from '../../src/activity-presets.js';
import { touchStreak, streakView, streakBonus, boostXp, runText, totalText } from '../../src/activity-streak-core.js';

/**
 * Activities, the SillyTavern side (fork): settings, the chat's activity record, who can be a partner,
 * the partner's talk, and what a finished activity writes (history, XP, bond, story report). The rules are in
 * the src/activity-*-core.js files; this file only connects them to SillyTavern.
 */

const STORE_KEY = 'sillynpc_activities';


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

/** The proficiencies of the active combat type that are in this list of ids, as { id, label }. */
export function subjectsOf(ids) {
    const type = activeCombatType();
    if (!type) return [];
    const want = new Set(ids || []);
    return (type.proficiencies || []).filter(p => want.has(p.id)).map(p => ({ id: p.id, label: p.label }));
}

let warnedNoVoice = false;

/**
 * Reads the player's own line aloud in their voice, when voices and auto-speak are on. If their character has no voice
 * (and no default voice is set), it says so once instead of staying silent without a reason.
 */
export function speakAsPlayer(text) {
    try {
        const s = getSettings();
        if (!s.ttsEnabled || !s.ttsAutoSpeak || !text) return;
        const me = userName();
        if (hasVoiceFor(me)) { speakLine(me, text); return; }
        if (!warnedNoVoice) {
            warnedNoVoice = true;
            toastr.info(`${me} has no voice yet, so your lines are not read aloud. Pick one on their Worldkit page, or set a default voice.`, 'Worldkit');
        }
    } catch { /* speech is optional */ }
}

/** Today's day key: the story's date when the chat has one, else the device's. */
export function currentDay() {
    return dayKey(sceneClock()?.dateText || '');
}

/** Whether energy costs apply: the Vitals Tracker is on and tracks energy, and the Activities setting is on. */
export function energyActive() {
    try {
        const v = vitalsSettings();
        return Boolean(v.enabled && v.track?.energy !== false && activitySettings().vitalsOn);
    } catch { return false; }
}

/** The player's energy in this chat (0 to 100), or null when it is not known yet. */
export function playerEnergy() {
    try {
        const p = getVitals(userName());
        const e = Number(p?.energy);
        return p && Number.isFinite(e) ? e : null;
    } catch { return null; }
}

/**
 * What an activity costs and whether the player can pay it now. Without the Vitals Tracker nothing costs anything and nothing is
 * blocked; an energy that is not known yet never blocks.
 * @returns {{ active: boolean, cost: number, energy: number|null, ok: boolean }}
 */
export function energyStatus(activity) {
    const active = energyActive();
    const cost = active ? energyCostOf(activity, activitySettings()) : 0;
    const energy = active ? playerEnergy() : null;
    return { active, cost, energy, ok: !active || canAfford(energy, cost) };
}

/** The activity kinds that train a skill and so earn the streak bonus. */
const TRAINING_KINDS = ['memory', 'mastermind', 'drill'];

/**
 * What the screens show about an activity's streak: the days in a row (overall and with this partner), how many times in all,
 * and for a skill-training activity the bonus the next play earns.
 * @returns {{ run: number, withRun: number, total: number, withTotal: number, doneToday: boolean, trains: boolean, bonus: number, text: string, withText: string }}
 */
export function activityStreakInfo(activity, partner) {
    const store = activityStore();
    const v = streakView(store?.streaks, activity.id, partner, currentDay());
    const trains = TRAINING_KINDS.includes(activity.kind);
    // Today's play extends the run by one when it was not done yet today.
    const next = v.doneToday ? v.run : v.run + 1;
    const bonus = trains ? streakBonus(next) : 0;
    return {
        run: v.run, withRun: v.withRun, total: v.total, withTotal: v.withTotal, doneToday: v.doneToday, trains, bonus,
        text: [runText(v.run), totalText(v.total)].filter(Boolean).join(' · '),
        withText: [runText(v.withRun), totalText(v.withTotal)].filter(Boolean).join(' · '),
    };
}

/** The sound map the activities use: the one typed in the Activities pane, else the world preset's. '' means only the main map. */
export function activeSoundMap() {
    return activitySettings().soundMapUrl || activePreset().soundMap || '';
}

/**
 * Starts the music loop (tea time) when music is on. It must follow a tap, because browsers refuse sound otherwise, so it is
 * called from the button that starts the activity. A map without the tag, or no map, is silent.
 */
export function startMusic(tag) {
    const s = activitySettings();
    if (!s.musicOn || !tag) return;
    Promise.resolve(playLoop(tag, { volume: s.musicVolume, mapUrl: activeSoundMap() })).catch(() => { });
}

/** Fades the music out. Safe to call when nothing plays. */
export function stopMusic() {
    try { stopLoops(); } catch { /* sound is optional */ }
}

/** Applies the music volume setting to music that is already playing. */
export function refreshMusicVolume(tag) {
    try { if (tag) setLoopVolume(tag, activitySettings().musicVolume); } catch { /* sound is optional */ }
}

/** Reads the sound map ahead of time, so the music can start at once from the tap that opens the activity. */
export function preloadSounds() {
    try {
        Promise.resolve(loadSoundMap()).catch(() => { });
        Promise.resolve(loadMapAt(activeSoundMap())).catch(() => { });
    } catch { /* sound is optional */ }
}

/** Plays a sound by id; a missing map or tag is silent. */
export function sfx(name) {
    try { Promise.resolve(playSound(name, { mapUrl: activeSoundMap() })).catch(() => { }); } catch { /* sound is optional */ }
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
 * Writes what any finished activity leaves behind: the history records, XP and ranks, play tally, a bond nudge, an
 * item, and the story report. Never throws; returns the lines to show on the result panel.
 *
 * rewards: { grade, profXp?, partnerProfXp?, levelXp?, knowledge?, bonds?: { meter, amount }[], item?: { name, qty, kind, note } }
 * @param {{ activityId: string, label: string, partner: string, subject?: string, summary: string, rewards: object, lines: {who:string,text:string}[], extra?: string[] }} a
 * @returns {string[]}
 */
export function settleActivity({ activityId, label, partner, subject = '', summary, rewards, lines, extra: extraReport = [] }) {
    const s = activitySettings();
    const user = userName();
    const shown = [];
    const extra = [...extraReport];
    const bonds = rewards.bonds || [];
    const grade = rewards.grade === 'failed' ? 'poor' : rewards.grade;
    // An empty partner means the activity was played alone.
    const alone = !String(partner || '').trim();
    try {
        const id = newTalkId();
        const at = Date.now();
        const date = sceneClock()?.dateText || '';
        // Played alone there is nobody to record a game against and no talk to keep.
        if (!alone) {
            try { addRecord(activityRecord({ id, label, user, partners: [partner], at, summary })); } catch (err) { console.warn('[Worldkit] could not record the activity', err); }
            recordTalk('activities', activityTalkEntry({ id, at, label, activity: activityId, outcome: grade, user, partners: [partner], date, lines, result: summary }));
        }

        // The streak: today counts, and a skill-training activity pays a bonus for the days in a row.
        let streakRun = 0;
        const streakStore = activityStore();
        if (streakStore) {
            const touched = touchStreak(streakStore.streaks, activityId, partner, dayKey(date));
            streakStore.streaks = touched.streaks;
            streakRun = touched.run;
            saveStore();
            if (touched.newDay && touched.run > 1) shown.push(`${runText(touched.run)} for ${label}.`);
        }
        const trains = Boolean(subject) && (rewards.profXp || 0) > 0;
        const profXp = trains ? boostXp(rewards.profXp, streakRun) : (rewards.profXp || 0);
        if (trains && streakBonus(streakRun) > 0) shown.push(`Streak bonus: +${streakBonus(streakRun)}% skill XP.`);

        const type = activeCombatType();
        const mine = personaRecordFor(user);
        const theirs = alone ? null : cardOf(partner);
        if (s.xpOn && type && (rewards.profXp || rewards.levelXp)) {
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
            credit(mine, user, profXp, rewards.levelXp || 0);
            credit(theirs, partner, rewards.partnerProfXp || 0, 0);
            if (ups.length) {
                const report = safe(levelUpReport(ups));
                if (report) queueResult('levelup', report, { append: true });
            }
            if (!mine || !hasTypeData(mine, type.dataKey)) shown.push('You have no combat sheet, so no XP was kept.');
            else if (subject && profXp) shown.push(`+${profXp} XP in ${(type.proficiencies || []).find(p => p.id === subject)?.label || 'your subject'}`);
            else if (rewards.levelXp) shown.push(`+${rewards.levelXp} XP`);
        }
        if (mine) mine.actStats = recordPlay(mine.actStats, activityId, grade, rewards.knowledge || 0);
        if (mine && rewards.knowledge > 0) shown.push(`+${rewards.knowledge} knowledge`);

        if (s.itemsOn && rewards.item) {
            try {
                giveItemFor(user, rewards.item);
                shown.push(`You received ${rewards.item.name}${rewards.item.note ? ` (${rewards.item.note})` : ''}.`);
                extra.push(`${user} came away with ${rewards.item.name}${rewards.item.note ? `, ${rewards.item.note}` : ''}.`);
            } catch (err) { console.warn('[Worldkit] could not give the item', err); }
        }

        if (s.bondOn && bonds.length && !alone) {
            const store = activityStore();
            const day = dayKey(date);
            const person = getPerson(partner);
            if (store && person?.tracked) {
                if (gainedToday(store, day, partner, activityId)) {
                    shown.push(`${partner} has already shared this with you today, so the bond holds steady.`);
                } else {
                    const results = [];
                    editPerson(partner, (p, bondStore) => {
                        for (const nudge of bonds) results.push(applyActivityNudge(p, nudge, bondSettings().growth, bondStore.turn));
                    });
                    markGained(store, day, partner, activityId);
                    saveStore();
                    if (results.some(r => r?.delta)) shown.push(`${partner} warmed to you a little.`);
                }
            }
        }

        // The energy it cost (only while the Vitals Tracker is on and tracks energy).
        if (energyActive()) {
            const act = (activePreset().activities || []).find(a => a.id === activityId);
            const cost = energyCostOf(act, s);
            const before = playerEnergy();
            if (cost > 0 && before !== null) {
                const after = afterSpend(before, cost);
                setVitalFor(user, 'energy', after);
                shown.push(spentText(before, after));
            }
            // The partner spends the same amount, when they have a vitals record (nobody is added to the tracker for this).
            if (cost > 0 && !alone) {
                try {
                    const theirEnergy = Number(getVitals(partner)?.energy);
                    if (getVitals(partner) && Number.isFinite(theirEnergy)) {
                        const left = afterSpend(theirEnergy, cost);
                        setVitalFor(partner, 'energy', left);
                        shown.push(`${partner}: ${spentText(theirEnergy, left).toLowerCase()}`);
                    }
                } catch { /* the partner's vitals are optional */ }
            }
        }

        queueResult('activities', safe(activityReport({ label, user, partners: alone ? [] : [partner], grade, extra })), { append: false });
        saveSettings();
    } catch (err) {
        console.warn('[Worldkit] could not settle the activity', err);
    }
    return shown;
}

/** Study: the rune memory game's settle step. */
export function settleStudy({ partner, label, subject, game, rewards, lines, activityId = 'study' }) {
    return settleActivity({
        activityId, label, partner, subject, lines,
        summary: `${label}${partner ? ` with ${partner}` : ' alone'}: ${describeState(game)}.`,
        rewards: { ...rewards, bonds: rewards.bond ? [rewards.bond] : [] },
    });
}

/* ------------------------------------------------------------------ tea: what is known, the tea list, what can be brought */

const KNOWN_KEY = 'sillynpc_tea_known';

/** What this chat has learned about each guest's tastes: { guest: [{ cat, value, side }] }. */
export function teaKnown() {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta || !ctx.chatId) return {};
    meta[KNOWN_KEY] = normalizeKnownStore(meta[KNOWN_KEY]);
    return meta[KNOWN_KEY];
}

/** Adds what a session revealed to this chat's record. Returns the entries that were new. */
export function rememberTaste(guest, entries) {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta || !ctx.chatId || !entries?.length) return [];
    const { store, added } = mergeKnown(meta[KNOWN_KEY], guest, entries);
    meta[KNOWN_KEY] = store;
    if (added.length) saveStore();
    return added;
}

/** The tea names for the picker: the item database's items in the preset's tea category, else the preset's own short list. */
export function teaNames(preset) {
    const want = String(preset?.tea?.category || 'Tea').toLowerCase();
    let names = [];
    try { names = databaseItems().filter(i => String(i.category).toLowerCase() === want).map(i => i.name); } catch { /* no database yet */ }
    // Every tea any character in the cast has a taste for is on the list too, so no guest's favourite is missing.
    const cast = (getSettings().characters || []).map(c => c?.prefs);
    return teaPool(names, cast, preset?.tea?.fallback || []);
}

/** The snacks to choose from: the preset's own tea-time snacks plus every food the cast has a taste for. */
export function snackNames(preset) {
    const cast = (getSettings().characters || []).map(c => c?.prefs);
    return snackPool(cast, preset?.tea?.snacks || []);
}

/**
 * The places a Tea Time picture may be found, best first: the art folder in the user's own profile (where the README says to copy
 * it) and the installed Content Kit. `file` is relative to art/activities/tea/.
 */
export function teaArtUrls(file) {
    const kit = String(getSettings().contentKitUrl || '').trim() || DEFAULT_KIT_URL;
    return [`/user/images/worldkit-art/activities/tea/${file}`, kitFileUrl(kitFolderName(kit), `art/activities/tea/${file}`)];
}

/**
 * Puts a Tea Time picture in an <img>, trying each place in turn; when none has it, calls onMissing (the screen then shows a plain
 * icon instead, so a missing art folder never breaks anything).
 */
export function loadArt(img, file, onMissing) {
    const urls = teaArtUrls(file);
    let at = 0;
    img.addEventListener('error', () => {
        at += 1;
        if (at < urls.length) img.src = urls[at]; else onMissing?.();
    });
    img.src = urls[0];
}

/** What the player can bring to a guest: the items in their inventory in this chat. */
export function bringChoices() {
    try {
        return (getInventory(userName())?.items || []).filter(i => i?.name).map(i => ({ name: i.name, qty: i.qty }));
    } catch { return []; }
}

/** Whether the guest is in a low mood (halves positive gains): a plainly gloomy mood word held fairly strongly. */
export function guestLowMood(name) {
    try {
        const store = vitalsStore();
        const p = store && findVitalsPerson(store, name);
        if (!p) return false;
        const gloomy = /\b(sad|gloomy|miserable|depress|upset|angry|furious|anxious|grief|despair|sorrow|bitter|hurt)/i.test(p.mood?.word || '');
        return gloomy && (p.mood?.level || 0) >= 40;
    } catch { return false; }
}
