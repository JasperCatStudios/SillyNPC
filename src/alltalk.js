import { getSettings } from './settings.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import { applyPhonetics, speechFor, cleanToneTable, inlineNames, DEFAULT_TONE_TAGS } from './tts-text.js';
import { engineOf, engineReadsAudioTags, engineFingerprint, generateEleven } from './tts-engines.js';
import { getCached, putCached, hasCached } from './tts-cache.js';
import { contentKey } from './image-dedupe.js';
import { ELEVEN_TAGS } from './eleven-tags.js';

/** The delivery tags in force: the owner's table when they have edited it, else the starting one. */
export function toneTable(settings = getSettings()) {
    const own = cleanToneTable(settings.ttsToneTable);
    return Object.keys(own).length ? own : DEFAULT_TONE_TAGS;
}

/** The standalone (inline) delivery tags in force: pacing and reaction tags that have no closing tag. */
/**
 * The table used to read a line aloud: the saved list on top of every tag Worldkit knows, so a known tag that is not in the
 * saved list is still understood (turned into the engine's audio tag, or dropped) instead of being spoken as a word.
 */
export function speechTable(settings = getSettings()) {
    const known = {};
    for (const t of ELEVEN_TAGS) known[t.name] = t.word;
    return { ...DEFAULT_TONE_TAGS, ...known, ...toneTable(settings) };
}

/** The standalone tag names for reading aloud (the same wider list). */
export function speechInline(settings = getSettings()) {
    return inlineNames(speechTable(settings), settings.deliveryInline);
}

export function toneInline(settings = getSettings()) {
    return inlineNames(toneTable(settings), settings.deliveryInline);
}

/**
 * A small AllTalk client (fork).
 *
 * Worldkit speaks for itself instead of going through SillyTavern's TTS extension, so a
 * voice belongs to a character rather than to a name in somebody else's voice map, and
 * nothing in SillyTavern has to be changed. Only AllTalk is spoken to, over its own HTTP
 * API: /api/ready, /api/voices and /api/tts-generate.
 *
 * Playback is a queue of one: pieces are generated one ahead of the one playing, so a
 * speaker change is not a pause, and stopping clears everything.
 */

function base() {
    return String(getSettings().alltalkUrl || 'http://localhost:7851').trim().replace(/\/+$/, '');
}

/** Whether the server answers. */
export async function alltalkReady() {
    try {
        const response = await fetch(`${base()}/api/ready`);
        return response.ok && String(await response.text()).trim() === 'Ready';
    } catch {
        return false;
    }
}

/** The voice files the server offers. */
export async function alltalkVoices() {
    try {
        const response = await fetch(`${base()}/api/voices`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data?.voices) ? data.voices.map(String) : [];
    } catch (err) {
        console.warn(LOG_PREFIX, 'AllTalk voices unavailable', err);
        return [];
    }
}

/** Generates one piece of speech with whichever engine is chosen, as a playable URL. */
async function generate(text, voice) {
    const engine = engineOf();
    if (engine === 'elevenlabs') return generateEleven(text, voice);
    return generateAlltalk(text, voice);
}

/** Generates one piece of speech through AllTalk and returns it as a playable URL. */
async function generateAlltalk(text, voice) {
    const settings = getSettings();
    const body = new URLSearchParams({
        text_input: text,
        text_filtering: 'standard',
        character_voice_gen: voice,
        narrator_enabled: 'false',
        narrator_voice_gen: voice,
        text_not_inside: 'character',
        language: String(settings.alltalkLanguage || 'en'),
        output_file_name: 'sillynpc_output',
        output_file_timestamp: 'true',
        autoplay: 'false',
        autoplay_volume: '0.8',
    });
    const response = await fetch(`${base()}/api/tts-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
        body,
    });
    if (!response.ok) throw new Error(`AllTalk answered ${response.status}`);
    const data = await response.json();
    const path = String(data?.output_file_url || '');
    if (!path) throw new Error('AllTalk returned no audio.');
    // Version 1 returns a full address, version 2 a path on the server.
    const url = /^https?:/i.test(path) ? path : `${base()}${path}`;
    const audio = await fetch(url);
    if (!audio.ok) throw new Error(`Could not fetch the audio (${audio.status}).`);
    return await audio.blob();
}

/** @type {{ text: string, voice: string, key: string, ready: Promise<Blob>|null }[]} */
const queue = [];
let playing = false;
let current = null;
let epoch = 0;

/** The saved audio when this exact line in this exact voice was made before, else a new request (then saved). */
async function obtain(item) {
    const saved = await getCached(item.key);
    if (saved) {
        debugLog('Voice: replaying a saved line');
        return saved;
    }
    const blob = await generate(item.text, item.voice);
    putCached(item.key, blob).then(() => document.dispatchEvent(new Event('worldkit-tts-saved')));
    return blob;
}

/** Starts getting a piece in the background, once. */
function prepare(item) {
    if (!item.ready) {
        item.ready = obtain(item);
        item.ready.catch(() => { /* reported where it is awaited */ });
    }
    return item.ready;
}

async function pump() {
    if (playing) return;
    playing = true;
    const mine = epoch;
    try {
        while (queue.length && mine === epoch) {
            const item = queue.shift();
            // The next piece is made while this one plays.
            if (queue[0]) prepare(queue[0]);
            let url;
            try {
                url = URL.createObjectURL(await prepare(item));
            } catch (err) {
                console.warn(LOG_PREFIX, 'Speech failed', err);
                toastr.warning(`Voice could not be generated: ${err.message || err}`, PRODUCT_NAME, { preventDuplicates: true });
                continue;
            }
            if (mine !== epoch) { URL.revokeObjectURL(url); break; }
            await new Promise((resolve) => {
                const audio = new Audio(url);
                current = audio;
                const done = () => { URL.revokeObjectURL(url); if (current === audio) current = null; resolve(); };
                audio.addEventListener('ended', done, { once: true });
                audio.addEventListener('error', done, { once: true });
                audio.play().catch(done);
            });
        }
    } finally {
        playing = false;
        // Something was queued after this run was told to stop.
        if (queue.length) pump();
    }
}

/** What would be sent to the engine for a line, and the key its audio is saved under; null when there is nothing to say. */
function lineFor(voice, text, tone = '') {
    const settings = getSettings();
    const said = applyPhonetics(String(text ?? ''), settings.characters || []);
    const spoken = speechFor(said, {
        tone,
        table: speechTable(settings),
        inline: speechInline(settings),
        audioTags: settings.ttsToneTags !== false && engineReadsAudioTags(settings),
    }).trim();
    if (!spoken || !voice) return null;
    return { spoken, key: contentKey(`${engineFingerprint(settings)}|${voice}|${spoken}`) };
}

/** Whether this line in this voice is already saved, so pressing its button plays it at no cost. */
export async function isLineSaved(voice, text, tone = '') {
    const line = lineFor(voice, text, tone);
    return line ? hasCached(line.key) : false;
}

/** Queues text to be read in a voice file. Returns false when there is nothing to read. */
export function speakWith(voice, text, { tone = '' } = {}) {
    const settings = getSettings();
    if (!settings.ttsEnabled) return false;
    // Names are said the way their cards spell them out; delivery tags become the engine's audio
    // tag (Eleven v3) or vanish (everything else). Closing tags never reach an engine.
    const said = applyPhonetics(String(text ?? ''), settings.characters || []);
    const line = lineFor(voice, text, tone);
    if (!line) return false;
    const { spoken, key } = line;
    queue.push({ text: spoken, voice, key, ready: null });
    debugLog(`AllTalk queued ${spoken.length} characters in ${voice}`);
    pump();
    return true;
}

/** Stops what is playing and empties the queue. */
export function stopSpeech() {
    epoch++;
    queue.length = 0;
    if (current) {
        const audio = current;
        current = null;
        try { audio.pause(); } catch { /* already gone */ }
        // A paused clip never ends on its own; this lets the queue move on and clean up.
        audio.dispatchEvent(new Event('ended'));
    }
}
