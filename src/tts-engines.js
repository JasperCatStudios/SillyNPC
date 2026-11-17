import { getRequestHeaders } from '../../../../../script.js';
import { getSettings } from './settings.js';
import { LOG_PREFIX } from './constants.js';
import { TAG_MODELS } from './tts-text.js';

/**
 * The cloud voices (fork): ElevenLabs through SillyTavern's own routes, and fal.ai for testing.
 *
 * ElevenLabs: SillyTavern already keeps the key (API Connections, ElevenLabs) and has the routes
 * /api/speech/elevenlabs/voices and /synthesize, the same ones its TTS extension uses, so nothing is
 * copied and no key is stored here. A voice is the ElevenLabs voice id.
 *
 * fal.ai: the key is pasted into Worldkit's Voices settings and kept in this browser's SillyTavern
 * settings only; it is never written into the extension's files. The browser calls fal directly
 * (SillyTavern has no fal speech route). Meant for the owner's own testing. A voice is a name such
 * as Rachel; the endpoint is a setting.
 */

export const ENGINES = Object.freeze({
    alltalk: 'AllTalk',
    elevenlabs: 'ElevenLabs (through SillyTavern)',
    fal: 'fal.ai (ElevenLabs, for testing)',
});

export const ELEVEN_MODELS = Object.freeze({
    eleven_v4: 'Eleven v4 (understands delivery tags)',
    eleven_v4_turbo: 'Eleven v4 Turbo (understands delivery tags)',
    eleven_v3: 'Eleven v3 (understands delivery tags)',
    eleven_flash_v2_5: 'Flash v2.5',
    eleven_turbo_v2_5: 'Turbo v2.5',
    eleven_multilingual_v2: 'Multilingual v2',
});

export const FAL_DEFAULT_ENDPOINT = 'elevenlabs/tts/eleven-v4';

/** Voice names the fal ElevenLabs endpoint lists as examples; any other name can be typed in. */
export const FAL_VOICES = Object.freeze([
    'Rachel', 'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte',
    'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill',
]);

export function engineOf(settings = getSettings()) {
    return Object.prototype.hasOwnProperty.call(ENGINES, settings.ttsEngine) ? settings.ttsEngine : 'alltalk';
}

/** Whether the model behind the chosen engine reads [whispers]-style tags instead of speaking them. */
export function engineReadsAudioTags(settings = getSettings()) {
    const engine = engineOf(settings);
    if (engine === 'elevenlabs') return TAG_MODELS.includes(String(settings.elevenModel || 'eleven_v4'));
    if (engine === 'fal') return /eleven-v[34]/i.test(String(settings.falEndpoint || FAL_DEFAULT_ENDPOINT));
    return false;
}

/* ------------------------------------------------------------------ ElevenLabs */

export async function elevenVoices() {
    try {
        const response = await fetch('/api/speech/elevenlabs/voices', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (Array.isArray(data?.voices) ? data.voices : [])
            .filter(v => v?.voice_id)
            .map(v => ({ value: String(v.voice_id), label: String(v.name || v.voice_id) }));
    } catch (err) {
        console.warn(LOG_PREFIX, 'ElevenLabs voices unavailable', err);
        return [];
    }
}

export async function elevenReady() {
    return (await elevenVoices()).length > 0;
}

/** Generates one piece of speech and returns a playable URL. */
export async function generateEleven(text, voiceId) {
    const s = getSettings();
    const model = String(s.elevenModel || 'eleven_v4');
    const request = {
        model_id: model,
        text,
        voice_settings: {
            stability: Number(s.elevenStability ?? 0.5),
            similarity_boost: Number(s.elevenSimilarity ?? 0.75),
            speed: Number(s.elevenSpeed ?? 1),
        },
    };
    const response = await fetch('/api/speech/elevenlabs/synthesize', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ voiceId, request }),
    });
    if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}. The key may be missing or the voice id wrong (see the server console).`);
    return URL.createObjectURL(await response.blob());
}

/* ------------------------------------------------------------------------ fal */

export function falConfigured() {
    return String(getSettings().falKey || '').trim() !== '';
}

export async function falVoices() {
    return FAL_VOICES.map(v => ({ value: v, label: v }));
}

/** Generates one piece of speech through fal and returns a playable URL. */
export async function generateFal(text, voice) {
    const s = getSettings();
    const key = String(s.falKey || '').trim();
    if (!key) throw new Error('No fal key is set in the Voices settings.');
    const endpoint = String(s.falEndpoint || FAL_DEFAULT_ENDPOINT).trim().replace(/^\/+|\/+$/g, '');
    const response = await fetch(`https://fal.run/${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
        // v4 takes similarity_boost; the older v3 endpoint does not list it, so it is only sent to v4.
        body: JSON.stringify({
            text,
            voice: voice || 'Rachel',
            stability: Number(s.elevenStability ?? 0.5),
            ...(/eleven-v4/i.test(endpoint) ? { similarity_boost: Number(s.elevenSimilarity ?? 0.75) } : {}),
        }),
    });
    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 160);
        throw new Error(`fal answered ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json();
    const url = String(data?.audio?.url || '');
    if (!url) throw new Error('fal returned no audio.');
    const audio = await fetch(url);
    if (!audio.ok) throw new Error(`Could not fetch the audio (${audio.status}).`);
    return URL.createObjectURL(await audio.blob());
}
