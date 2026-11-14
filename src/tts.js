import { eventSource, event_types } from '../../../../events.js';
import { extension_settings } from '../../../../extensions.js';
import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { getActiveCharacters } from './characters.js';
import { beatsOfMessage, MESSAGE_RENDERED_EVENT } from './beats.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import { genderOfFace, genderOfName } from './default-portraits.js';

/** Voice-map names for speakers with no card, by gender. */
export const GENERIC_VOICES = { female: 'Generic Female', male: 'Generic Male' };

/**
 * A voice per character, through SillyTavern's own TTS (fork).
 *
 * The voices are not chosen here. SillyTavern's TTS panel already has a voice map - one
 * dropdown per name, for whichever provider is selected - and this adds every character in
 * the chat to it, so each of them gets a row beside the chat's own. Picking a voice is
 * done there, with the provider's own voice list, and is saved with its other settings.
 *
 * What happens here is who says what. A reply is read by beat: each tagged line goes to
 * its speaker's voice, and the narration between them to the panel's default voice when
 * that is asked for. SillyTavern's own auto-generation reads the whole reply as one
 * speaker, so it is switched off while this one is in charge.
 *
 * All of it rests on three functions the TTS extension does not export unpatched. See
 * patches/st-tts-voice-names.diff. Without the patch this stays quiet rather than failing:
 * ttsStatus() says what is missing.
 */

const DEFAULT_VOICE = '[Default Voice]';

/** @type {Promise<object|null>|null} */
let moduleLoad = null;

/** The TTS extension's module, or null when it is not there or is not the patched one. */
async function ttsModule() {
    if (!moduleLoad) {
        moduleLoad = import('../../../tts/index.js')
            .then(mod => (typeof mod.speakAs === 'function'
                && typeof mod.registerVoiceNames === 'function' ? mod : null))
            .catch(() => null);
    }
    return moduleLoad;
}

/**
 * Whether voices can work, and if not, why in one sentence.
 *
 * @returns {Promise<{ ready: boolean, reason: string }>}
 */
export async function ttsStatus() {
    const mod = await ttsModule();
    if (!mod) {
        return {
            ready: false,
            reason: "SillyTavern's TTS extension is missing the small patch SillyNPC needs "
                + '(patches/st-tts-voice-names.diff in this extension).',
        };
    }
    if (!extension_settings.tts?.enabled) {
        return { ready: false, reason: "Enable SillyTavern's TTS under Extensions -> TTS first." };
    }
    return { ready: true, reason: '' };
}

/**
 * The names that should have a row in the TTS voice map: every character in this chat.
 *
 * @returns {string[]}
 */
function voiceNames() {
    return [
        ...getActiveCharacters().map(char => String(char.name || '').trim()).filter(Boolean),
        ...Object.values(GENERIC_VOICES),
    ];
}

/** The provider's voices, the one mapped to a name, and a way to change it. */
export async function voiceChoices() {
    const mod = await ttsModule();
    return mod && typeof mod.listVoices === 'function' ? mod.listVoices() : [];
}
export async function getVoice(name) {
    const mod = await ttsModule();
    return mod && typeof mod.getVoiceFor === 'function' ? mod.getVoiceFor(name) : '';
}
export async function setVoice(name, voice) {
    const mod = await ttsModule();
    if (!mod || typeof mod.setVoiceFor !== 'function') return false;
    await syncVoiceNames();
    return mod.setVoiceFor(name, voice);
}

/** Puts this chat's characters into SillyTavern's voice map. Safe to call as often as you like. */
export async function syncVoiceNames() {
    const mod = await ttsModule();
    if (!mod) return;
    try {
        await mod.registerVoiceNames(voiceNames());
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not add characters to the voice map', err);
    }
}

/**
 * Whether SillyTavern's own reading of new replies should stand down.
 *
 * Left alone when this is off, so enabling the extension changes nothing until you ask.
 */
export function applyAutoGenerationHandover() {
    if (!extension_settings.tts) return;
    extension_settings.tts.delegate_auto_generation =
        !!getSettings().ttsAutoSpeak;
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
    const regex = /"([^"]+)"|“([^”]+)”|«([^»]+)»|\(([^)]+)\)/g;
    for (const m of text.matchAll(regex)) {
        const thought = m[4] !== undefined;
        const spoken = String(m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
        if (spoken) out.push({ text: spoken, thought });
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

/** Which gender a stranger is: the face they wear, else what their name says. */
function strangerGender(beat) {
    const src = beat.avatars?.[0]?.getAttribute?.('src') || '';
    return genderOfFace(src) || genderOfName(beat.speaker || '');
}

/**
 * Which voice-map name reads a beat, or null when it is not to be read.
 *
 * A speaker with a card has a row of their own. One without is read in the generic voice for
 * their gender, or the default voice when that is not known - a line that vanishes from a
 * scene being read aloud is worse than one in an imperfect voice.
 */
function voiceFor(beat) {
    const settings = getSettings();
    if (beat.isNarration) return settings.ttsSpeakNarration ? DEFAULT_VOICE : null;
    if (beat.isPersona) return getContext().name1 || DEFAULT_VOICE;

    const known = new Set(voiceNames());
    if (known.has(beat.speaker)) return beat.speaker;
    const gender = strangerGender(beat);
    return gender ? GENERIC_VOICES[gender] : DEFAULT_VOICE;
}

/**
 * Reads one rendered message aloud, a voice per speaker.
 *
 * @param {HTMLElement} mesEl A `.mes` from the chat.
 * @returns {Promise<number>} How many pieces were queued.
 */
export async function speakMessage(mesEl) {
    const status = await ttsStatus();
    if (!status.ready) {
        toastr.info(status.reason, 'SillyNPC');
        return 0;
    }
    const mod = await ttsModule();
    mod.stopSpeaking();

    const settings = getSettings();
    let queued = 0;
    for (const beat of beatsOfMessage(mesEl)) {
        const voice = voiceFor(beat);
        if (!voice) continue;
        for (const segment of spokenSegments(beat)) {
            if (segment.thought && !settings.ttsSpeakThoughts) continue;
            if (mod.speakAs(voice, segment.text)) queued++;
        }
    }
    if (!queued) toastr.info('Nothing to read: no "quoted" speech or (thoughts) found.', 'SillyNPC');
    debugLog(`Voices: queued ${queued} piece(s)`);
    return queued;
}

/** Reads one line in a character's voice. For the test button on a card. */
export async function previewVoice(name, line = 'This is what I sound like.') {
    const status = await ttsStatus();
    if (!status.ready) {
        toastr.info(status.reason, 'SillyNPC');
        return false;
    }
    const mod = await ttsModule();
    await syncVoiceNames();
    mod.stopSpeaking();
    return mod.speakAs(name, line);
}

/** The last message id that was read automatically, so a redraw does not read it again. */
let lastSpokenKey = '';

/** A speaker button in the message toolbar: read this message, a voice per speaker. */
function ensureSpeakButton(mesEl) {
    const toolbar = mesEl?.querySelector?.('.extraMesButtons');
    const present = toolbar?.querySelector('.sillynpc-speak-btn');
    if (!toolbar || present) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button sillynpc-speak-btn fa-solid fa-comment-dots';
    btn.title = 'Read aloud, a voice per character';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speakMessage(mesEl).catch(err => console.warn(LOG_PREFIX, 'Reading the message failed', err));
    });
    toolbar.insertBefore(btn, toolbar.firstChild);
}

function onMessageDecorated(mesEl) {
    const settings = getSettings();
    ensureSpeakButton(mesEl);
    // Cheap when nothing changed, and this is where a card created from the chat shows up.
    syncVoiceNames();
    if (!settings.ttsAutoSpeak) return;
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

let generationEndedAt = 0;

/** Wires the events. Called once at start-up. */
export function initTts() {
    eventSource.on(event_types.GENERATION_ENDED, () => { generationEndedAt = Date.now(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => { generationEndedAt = Date.now(); });
    eventSource.on(MESSAGE_RENDERED_EVENT, onMessageDecorated);
    eventSource.on(event_types.CHAT_CHANGED, () => { syncVoiceNames(); applyAutoGenerationHandover(); });
    syncVoiceNames();
    applyAutoGenerationHandover();
}
