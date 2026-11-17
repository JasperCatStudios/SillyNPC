import { getRequestHeaders } from '../../../../../script.js';
import { getSettings } from './settings.js';
import { LOG_PREFIX } from './constants.js';
import { TAG_MODELS } from './tts-text.js';

/**
 * The cloud voice (fork): ElevenLabs through SillyTavern's own routes.
 *
 * SillyTavern already keeps the key (set in its TTS extension panel, by choosing ElevenLabs there) and has
 * the routes /api/speech/elevenlabs/voices and /synthesize, the same ones its TTS extension uses, so nothing
 * is copied and no key is stored here. The model name is passed through to ElevenLabs as it is, which is why
 * models newer than SillyTavern's own dropdown (Eleven v4) work. A voice is the ElevenLabs voice id.
 */

export const ENGINES = Object.freeze({
    alltalk: 'AllTalk',
    elevenlabs: 'ElevenLabs (through SillyTavern)',
});

export const ELEVEN_MODELS = Object.freeze({
    eleven_v4: 'Eleven v4 (understands delivery tags)',
    eleven_v4_turbo: 'Eleven v4 Turbo (understands delivery tags)',
    eleven_v3: 'Eleven v3 (understands delivery tags)',
    eleven_flash_v2_5: 'Flash v2.5',
    eleven_turbo_v2_5: 'Turbo v2.5',
    eleven_multilingual_v2: 'Multilingual v2',
});

export function engineOf(settings = getSettings()) {
    return Object.prototype.hasOwnProperty.call(ENGINES, settings.ttsEngine) ? settings.ttsEngine : 'alltalk';
}

/** Whether the model behind the chosen engine reads [whispers]-style tags instead of speaking them. */
export function engineReadsAudioTags(settings = getSettings()) {
    if (engineOf(settings) === 'elevenlabs') return TAG_MODELS.includes(String(settings.elevenModel || 'eleven_v4'));
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

/** Generates one piece of speech and returns the audio. */
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
    if (!response.ok) {
        throw new Error(`ElevenLabs refused the request (model ${model}, HTTP ${response.status}). The SillyTavern console prints ElevenLabs' own reason. `
            + 'Common causes: no key or a wrong voice id, or a plan that does not include this model; try Eleven v3 or Flash v2.5 to tell which.');
    }
    return await response.blob();
}

/** What makes one generated line different from another on the same engine: the model and its settings. */
export function engineFingerprint(settings = getSettings()) {
    if (engineOf(settings) === 'elevenlabs') {
        return `eleven|${settings.elevenModel}|${settings.elevenStability}|${settings.elevenSimilarity}|${settings.elevenSpeed}`;
    }
    return `alltalk|${settings.alltalkLanguage}`;
}
