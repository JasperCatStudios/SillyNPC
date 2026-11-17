import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { beatsOfMessage, MESSAGE_RENDERED_EVENT } from './beats.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import { genderOfFace, genderOfName } from './default-portraits.js';
import { alltalkReady, alltalkVoices, speakWith, stopSpeech, toneTable } from './alltalk.js';
import { toneAt } from './tts-text.js';
import { engineOf, elevenReady, elevenVoices, falConfigured, falVoices } from './tts-engines.js';

/**
 * A voice per character (fork), spoken through AllTalk directly.
 *
 * A character's voice is a voice file chosen on their page and kept on their record. Speakers
 * with no card are read in a generic voice for their gender, the player in their own, and
 * anything else in the default - all chosen in the Voices settings.
 *
 * What happens here is who says what. A reply is read by beat: each tagged line goes to its
 * speaker's voice. Only "quoted" speech and (thoughts) are read; actions and description never.
 * Nothing in SillyTavern's own TTS is used, so it can stay off.
 */

/** Settings keys holding the voice file for people who have no card of their own. */
export const VOICE_KEYS = {
    female: 'ttsVoiceFemale',
    male: 'ttsVoiceMale',
    default: 'ttsVoiceDefault',
    player: 'ttsVoicePlayer',
};

/** Whether voices are switched on. Off is the default, and then nothing here speaks or complains. */
export function ttsEnabled() {
    return !!getSettings().ttsEnabled;
}

/** Whether AllTalk answers, and if not, why in one sentence. */
export async function ttsStatus() {
    const engine = engineOf();
    if (engine === 'elevenlabs') {
        return await elevenReady()
            ? { ready: true, reason: '' }
            : { ready: false, reason: 'ElevenLabs gave no voices. The key is set in the SillyTavern TTS extension panel (choose ElevenLabs there once). Reload the page after adding it, and check the server console.' };
    }
    if (engine === 'fal') {
        return falConfigured()
            ? { ready: true, reason: '' }
            : { ready: false, reason: 'No fal key yet. Paste it under Voices in the Worldkit settings.' };
    }
    if (!await alltalkReady()) {
        return { ready: false, reason: 'AllTalk is not answering. Check its address under Voices in the Modules or Writing Rules settings, and that it is running.' };
    }
    return { ready: true, reason: '' };
}

/** The voices the chosen engine offers, as { value, label }. */
export async function voiceChoices() {
    const engine = engineOf();
    if (engine === 'elevenlabs') return elevenVoices();
    if (engine === 'fal') return falVoices();
    return (await alltalkVoices()).map(v => ({ value: v, label: v }));
}

/**
 * What in a beat is spoken: the words inside "quotes", and (thoughts) in parentheses.
 *
 * Nothing else. Actions, description and stage directions are never read, whoever's
 * paragraph they are in.
 *
 * @param {object} beat
 * @returns {{ text: string, thought: boolean }[]} In reading order.
 */
export function spokenSegments(beat) {
    const text = String(beat.text ?? '');
    const out = [];
    const table = toneTable();
    // Delivery marked in the page itself: the display regexes leave data-tone on what they restyle.
    const marked = [...(beat.element?.querySelectorAll?.('[data-tone]') || [])]
        .map(node => ({ tone: String(node.getAttribute('data-tone') || '').toLowerCase(), text: String(node.textContent ?? '') }))
        .filter(node => node.tone && node.text);
    const regex = /"([^"]+)"|“([^”]+)”|«([^»]+)»|\(([^)]+)\)/g;
    for (const m of text.matchAll(regex)) {
        const thought = m[4] !== undefined;
        const spoken = String(m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
        if (!spoken) continue;
        // Tags still in the text (no display regex), else the page's marks.
        const tone = toneAt(text, m.index, table) || (marked.find(node => node.text.includes(spoken))?.tone ?? '');
        out.push({ text: spoken, thought, tone });
    }
    // Some renderers drop the quote marks and keep only a <q> element.
    if (!out.length && beat.element?.querySelectorAll) {
        for (const q of beat.element.querySelectorAll('q')) {
            const spoken = String(q.textContent ?? '').replace(/^["“]|["”]$/g, '').trim();
            if (spoken) out.push({ text: spoken, thought: false });
        }
    }
    return out;
}

/** The voice file for somebody, by their record; '' when none is set. */
function recordVoice(name) {
    const char = (getSettings().characters || []).find(c => c.name === name);
    return String(char?.ttsVoice || '').trim();
}

/** Which voice file reads a beat, or '' when it is not to be read. */
function voiceForBeat(beat) {
    const settings = getSettings();
    const fallback = String(settings[VOICE_KEYS.default] || '').trim();
    if (beat.isNarration) return settings.ttsSpeakNarration ? fallback : '';
    if (beat.isPersona) return String(settings[VOICE_KEYS.player] || '').trim() || fallback;

    const own = recordVoice(beat.speaker);
    if (own) return own;
    // A stranger: the generic voice for their gender - their face, else what their name says.
    const src = beat.avatars?.[0]?.getAttribute?.('src') || '';
    const gender = genderOfFace(src) || genderOfName(beat.speaker || '');
    return String(settings[VOICE_KEYS[gender]] || '').trim() || fallback;
}

/**
 * Reads one rendered message aloud, a voice per speaker.
 *
 * @param {HTMLElement} mesEl A `.mes` from the chat.
 * @returns {Promise<number>} How many pieces were queued.
 */
export async function speakMessage(mesEl) {
    if (!ttsEnabled()) return 0;
    const status = await ttsStatus();
    if (!status.ready) {
        toastr.info(status.reason, PRODUCT_NAME);
        return 0;
    }
    stopSpeech();

    const settings = getSettings();
    let queued = 0;
    for (const beat of beatsOfMessage(mesEl)) {
        const voice = voiceForBeat(beat);
        if (!voice) continue;
        for (const segment of spokenSegments(beat)) {
            if (segment.thought && !settings.ttsSpeakThoughts) continue;
            if (speakWith(voice, segment.text, { tone: segment.tone })) queued++;
        }
    }
    if (!queued) toastr.info('Nothing to read: no "quoted" speech or (thoughts) with a voice set.', PRODUCT_NAME);
    debugLog(`Voices: queued ${queued} piece(s)`);
    return queued;
}

/** Reads a line in somebody's voice, by name. For the phone and the games. */
export async function speakNamed(name, text) {
    if (!ttsEnabled()) return false;
    const settings = getSettings();
    const voice = recordVoice(name) || String(settings[VOICE_KEYS.default] || '').trim();
    if (!voice) {
        toastr.info(`${name} has no voice yet. Pick one on their Worldkit page.`, PRODUCT_NAME);
        return false;
    }
    return speakWith(voice, text);
}

/** Reads one line in a voice file. For the test buttons. */
export async function previewVoice(voice, line = 'This is what I sound like.') {
    if (!ttsEnabled()) {
        toastr.info('Voices are switched off. Turn them on at the top of this page first.', PRODUCT_NAME, { preventDuplicates: true });
        return false;
    }
    const status = await ttsStatus();
    if (!status.ready) {
        toastr.info(status.reason, PRODUCT_NAME);
        return false;
    }
    if (!voice) {
        toastr.info('Pick a voice first.', PRODUCT_NAME);
        return false;
    }
    stopSpeech();
    return speakWith(voice, line);
}

/** A speaker button in the message toolbar: read this message, a voice per speaker. */
function ensureSpeakButton(mesEl) {
    const toolbar = mesEl?.querySelector?.('.extraMesButtons');
    if (!ttsEnabled() || !toolbar || toolbar.querySelector('.sillynpc-speak-btn')) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button sillynpc-speak-btn fa-solid fa-comment-dots';
    btn.title = 'Read aloud, a voice per character';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakMessage(mesEl).catch(err => console.warn(LOG_PREFIX, 'Reading the message failed', err));
    });
    toolbar.insertBefore(btn, toolbar.firstChild);
}

/** The last message read automatically, so a redraw does not read it again. */
let lastSpokenKey = '';
let generationEndedAt = 0;

function onMessageDecorated(mesEl) {
    ensureSpeakButton(mesEl);
    if (!ttsEnabled() || !getSettings().ttsAutoSpeak) return;
    try {
        const id = Number(mesEl?.getAttribute?.('mesid'));
        const chat = getContext()?.chat;
        if (!Array.isArray(chat) || id !== chat.length - 1) return;
        const message = chat[id];
        if (!message || message.is_user || message.is_system) return;

        // Same message, same text: a redraw. A swipe or an edit changes the text.
        const key = `${getContext().chatId}:${id}:${String(message.mes).length}:${String(message.mes).slice(-40)}`;
        if (key === lastSpokenKey) return;
        // Only a reply that has just arrived, not every message in a chat being loaded.
        if (Date.now() - generationEndedAt > 15000) return;
        lastSpokenKey = key;
        speakMessage(mesEl).catch(err => console.warn(LOG_PREFIX, 'Reading the reply failed', err));
    } catch (err) {
        console.warn(LOG_PREFIX, 'Voice auto-read failed', err);
    }
}

/** Wires the events. Called once at start-up. */
export function initTts() {
    eventSource.on(event_types.GENERATION_ENDED, () => { generationEndedAt = Date.now(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => { generationEndedAt = Date.now(); });
    eventSource.on(MESSAGE_RENDERED_EVENT, onMessageDecorated);
    eventSource.on(event_types.CHAT_CHANGED, () => stopSpeech());
}
