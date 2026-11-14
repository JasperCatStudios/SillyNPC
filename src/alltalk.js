import { getSettings } from './settings.js';
import { LOG_PREFIX, debugLog } from './constants.js';

/**
 * A small AllTalk client (fork).
 *
 * SillyNPC speaks for itself instead of going through SillyTavern's TTS extension, so a
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

/** Generates one piece of speech and returns it as a playable URL. */
async function generate(text, voice) {
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
    return URL.createObjectURL(await audio.blob());
}

/** @type {{ text: string, voice: string, ready: Promise<string>|null }[]} */
const queue = [];
let playing = false;
let current = null;
let epoch = 0;

/** Starts generating a piece in the background, once. */
function prepare(item) {
    if (!item.ready) {
        item.ready = generate(item.text, item.voice);
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
                url = await prepare(item);
            } catch (err) {
                console.warn(LOG_PREFIX, 'Speech failed', err);
                toastr.warning(`Voice could not be generated: ${err.message || err}`, 'SillyNPC');
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

/** Queues text to be read in a voice file. Returns false when there is nothing to read. */
export function speakWith(voice, text) {
    const spoken = String(text ?? '').trim();
    if (!spoken || !voice) return false;
    queue.push({ text: spoken, voice, ready: null });
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
