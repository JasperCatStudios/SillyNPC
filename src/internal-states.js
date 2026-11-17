import { hasReadableText } from './message-content.js';
import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { saveChatDebounced, substituteParams } from '../../../../../script.js';
import { DOMPurify } from '../../../../../lib.js';
import { getRegexedString, regex_placement } from '../../../regex/engine.js';
import { getSettings } from './settings.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { MESSAGE_RENDERED_EVENT } from './beats.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';

/**
 * The preset's Internal States, kept outside the story (fork).
 *
 * The Mimostein preset asks the story model to end every reply with a hidden block - agendas,
 * locations, bonds, thoughts, body scale, Chekhov's Gun, a GM notebook, world sim - and
 * relies on regexes to dress it and to strip old ones from the prompt.
 *
 * Three modes:
 *   inline - nothing happens here. The preset's own prompt makes the story model write the
 *            block in the reply and the preset's regexes handle it, as before.
 *   after  - a second request, on a connection of your choosing, reads the finished reply
 *            and writes the block. It is kept on the message's metadata, never in its text,
 *            and shown in its own section under the reply with the preset's display regexes
 *            applied. The story model is told the last known state instead of writing it.
 *   off    - nothing.
 *
 * Only display regexes run on it (the ones flagged Markdown only). The preset's stripping
 * regexes would delete the block they are meant to dress.
 *
 * Bonds are no longer part of it. They live in the Bond Tracker (bonds-core.js, bonds.js),
 * which clamps how fast a bond may grow instead of trusting the writer to. Blocks written
 * before the move may still carry a BONDS section: the tracker reads it once per chat to bring
 * the numbers over (latestInternalStatesHtml). New blocks have none, so the first new one
 * replaces an old one in what the writer and the story model are shown.
 */

const EXTRA_KEY = 'sillynpc_internal_states';
const INJECT_KEY = 'sillynpc-internal-states';
const GFX_START = '<!-- GFX_START -->';
const GFX_END = '<!-- GFX_END -->';

export const INTERNAL_STATES_SYSTEM = [
    'You maintain the hidden "Internal States" of a roleplay for its story model. You are given the PREVIOUS STATE, recent messages and the LATEST MESSAGE. Output ONLY the updated state block in the exact template below. No commentary, no code fences.',
    '',
    'Style: telegraphic and dense. Every section must appear; write "None" for an empty one. Exactly one blank line between nested <details> blocks. No markdown code blocks inside the HTML. Carry unchanged facts forward from the previous state. Never invent events the message does not state.',
    '',
    'RULES',
    '- Turn: [ct] is the number given as TURN.',
    '- Agendas: assign each named NPC an agenda on first introduction (1-3 mundane steps). OFF-screen NPCs advance Step by 1 each turn; on completion apply its effect and assign a new agenda. ON-screen NPCs do not advance.',
    '- Locations: every named NPC has a current location and activity.',
    "- Chekhov's Gun: format [BULLET: desc] (weight: 1-3, age: n/12) [depends: prereq] [secret]. Age unlocked bullets +1 per turn. A bullet may not fire before age 4 unless a time lock is reached. Weight 3 fires at age >= 4, weight 2 at >= 6, weight 1 at >= 8, when characters, location and scene fit. Never fire a disruptive bullet in a LOCKED scene unless it concerns that moment. Prune unlocked bullets at age >= 12. Max 15 active; resolved ones move to Fired. Load a new bullet only for a meaningful promise, secret or setup.",
    '- Body scale (S1-S5): keep the four lines for {{user}} and each on-screen NPC. Frame & Stature, Tactile & Contact Scale, Proportions & Kinetics (bust/chest and hips tiers), Attire Fit & Posture. Format units as cm, kg, ft, in; never use double quotes or pipe symbols inside values.',
    '- Internal thoughts (up to 3 NPCs, prefer on-screen): (In Sync / Mild Rub / Friction / Clash), Body/Mood (somatic load and VAD), a raw first-person Thought of 10-40 words that does not orbit {{user}}, and a Stance Lock. An annoyed or hurt NPC stays so until {{user}} resolves it; never lock already-spoken jokes, teases or plans into Stance Lock.',
    "- GM's Notebook: max 20 entries, [R] reminder, [T] thread, [D] debug, one or two sentences each; prune the oldest. Never log Chekhov bullets here.",
    '- World Sim: Scene Mode is LOCKED (intimate, private, deep, vulnerable, NSFW), ACTIVE (casual, domestic, public, group) or TRANSITION (travel, time skip), plus one brief Event.',
    '',
    'TEMPLATE',
    GFX_START,
    '<internal_states>',
    '<details>',
    '  <summary>🎬 INTERNAL STATES (Turn: [ct]) </summary>',
    '',
    '  <details>',
    '    <summary>👤 NPC AGENDAS</summary>',
    '    - <b>[NPC Name]</b> | Agenda: [task] | (Step [current]/[max]) | Aware: [secrets] | Fibs: [lies_told] | Circle: [allies]',
    '  </details>',
    '',
    '  <details>',
    '    <summary>👤 NPC LOCATIONS</summary>',
    '    - <b>[NPC Name]</b> | Location: [coords/scene, current activity]',
    '  </details>',
    '',
    "<details><summary>🔫 CHEKHOV'S GUN</summary>- <b>Active:</b> [active bullets or None]<br>- <b>Locked:</b> [locked bullets or None]<br>- <b>Fired:</b> [fired bullets or None]</details>",
    '',
    '<details><summary>🧍 BODY SCALE</summary><br>- <b>[Character Name]</b><br>&nbsp;&nbsp;• <b>🧍🏻‍♀️ Frame & Stature:</b> [S1–S5] [Height cm / Weight kg] — [Direct physical & eye-level contrast to {{user}}]<br>&nbsp;&nbsp;• <b>🤝 Tactile & Contact Scale:</b> [Hand size, wrist/waist span, shoulder width & weight feel against {{user}}]<br>&nbsp;&nbsp;• <b>📐 Proportions & Kinetics:</b> Bust/Chest: [S1–S5] / Hips & Ass: [S1–S5] — [Softness vs. muscle tone, sway & bounce]<br>&nbsp;&nbsp;• <b>👗 Attire Fit & Posture:</b> [Current clothes, fabric tension/drape over frame, footwear & exact stance]<br></details>',
    '',
    '<details><summary>🧠 INTERNAL THOUGHTS</summary><br>- <b>[NPC Name]</b> ([In Sync / Mild Rub / Friction / Clash]) — <b>Body/Mood:</b> [Somatic load & VAD] — <b>Thought: </b> "[Raw 1st-person thought]" — <b>Stance Lock:</b> [Sustained demeanor & unspoken carryover]<br></details>',
    '',
    "<details><summary>📓 GM'S NOTEBOOK</summary>",
    '- [R] No active notes.',
    '</details>',
    '',
    '<details><summary>🌎 WORLD SIM</summary>- <b>Scene Mode:</b> [LOCKED / ACTIVE / TRANSITION]<br>- <b>Event:</b> [Brief description of ambient detail or off-screen shift]</details>',
    '',
    '  <details>',
    '    <summary>🌌 PHYSICS, ENGINE & WORLD</summary>',
    '    - <b>Env:</b> [hazards/magic/weather]<br>',
    '    - <b>Physics:</b> [spatial positioning, distances, line-of-sight]',
    '  </details>',
    '',
    '</details>',
    '</internal_states>',
    GFX_END,
].join('\n');

function mode() {
    const m = getSettings().internalStatesMode;
    return m === 'inline' || m === 'off' ? m : 'after';
}

function systemPrompt() {
    return substituteParams(String(getSettings().internalStatesPrompt ?? '').trim() || INTERNAL_STATES_SYSTEM);
}

/** What is stored for this message's current swipe, or null. */
function stored(message) {
    const bag = message?.extra?.[EXTRA_KEY];
    return bag?.[String(message.swipe_id ?? 0)] ?? null;
}

function store(message, record) {
    message.extra = message.extra || {};
    message.extra[EXTRA_KEY] = message.extra[EXTRA_KEY] || {};
    message.extra[EXTRA_KEY][String(message.swipe_id ?? 0)] = record;
    saveChatDebounced();
}

/** The newest stored state before a given message, for continuity. */
function previousState(chat, beforeId) {
    for (let i = beforeId - 1; i >= 0; i--) {
        const record = stored(chat[i]);
        if (record) return record;
    }
    return null;
}

/**
 * The newest Internal States block in a chat, as stored, or ''. For the Bond Tracker's one-off
 * migration of the BONDS section older blocks carried.
 */
export function latestInternalStatesHtml(chat) {
    const record = previousState(Array.isArray(chat) ? chat : [], Array.isArray(chat) ? chat.length : 0);
    return record ? String(record.html ?? '') : '';
}

function htmlToText(html) {
    return String(html ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(summary|details|div|p)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Pulls the block out of a reply that may carry prose or a code fence around it. */
function extractBlock(raw) {
    let text = String(raw ?? '')
        .replace(/<(think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/```(?:html|xml|markdown)?/gi, '')
        .trim();
    const start = text.indexOf(GFX_START);
    const end = text.lastIndexOf(GFX_END);
    if (start !== -1 && end > start) return text.slice(start, end + GFX_END.length);
    const inner = text.indexOf('<internal_states>');
    if (inner !== -1) {
        const close = text.lastIndexOf('</internal_states>');
        const body = close > inner ? text.slice(inner, close + '</internal_states>'.length) : text.slice(inner);
        return `${GFX_START}\n${body}\n${GFX_END}`;
    }
    // The model kept the details but dropped the markers: wrap what is there, as long as it
    // is plainly the block (its title) and not prose that happens to mention it.
    const title = text.search(/<details>\s*<summary>[^<]*INTERNAL STATES/i);
    if (title !== -1) {
        const close = text.lastIndexOf('</details>');
        if (close > title) {
            return `${GFX_START}\n<internal_states>\n${text.slice(title, close + '</details>'.length)}\n</internal_states>\n${GFX_END}`;
        }
    }
    return '';
}

async function request(userPrompt) {
    const settings = getSettings();
    const context = getContext();
    const maxTokens = Number(settings.internalStatesMaxTokens) || 3000;
    const system = systemPrompt();
    const profileId = settings.internalStatesProfileId;

    if (profileId) {
        try {
            const result = await context.ConnectionManagerRequestService.sendRequest(
                profileId,
                [{ role: 'system', content: system }, { role: 'user', content: userPrompt }],
                maxTokens,
                { extractData: true, includePreset: false },
                {},
            );
            return typeof result === 'string' ? result : (result?.content ?? '');
        } catch (err) {
            console.warn(LOG_PREFIX, 'Internal States connection unavailable, using the main API:', err);
        }
    }
    const raw = await context.generateRawData({ prompt: userPrompt, systemPrompt: system, responseLength: maxTokens });
    return typeof raw === 'string' ? raw : (raw?.content ?? '');
}

const inFlight = new Set();
/** Why the last attempt at a message failed, shown in its section. */
const failures = new Map();
/** Messages whose block is open for editing, by "id:swipe". */
const editing = new Set();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits until the reply has finished.
 *
 * The event that starts this fires as the message is rendered, which with some setups is
 * while the generation is still being wound up, and a second request started then competes
 * with it. The stop button is shown for exactly as long as a generation is running.
 */
async function waitUntilIdle() {
    await sleep(600);
    for (let i = 0; i < 180; i++) {
        const stop = document.getElementById('mes_stop');
        if (!stop || getComputedStyle(stop).display === 'none') return;
        await sleep(500);
    }
}

/**
 * Generates the block for one message and shows it.
 *
 * @param {number} messageId
 * @param {{ force?: boolean }} [options] force replaces what is stored.
 */
export async function generateInternalStates(messageId, { force = false } = {}) {
    const context = getContext();
    const chat = context.chat;
    const message = chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    if (!hasReadableText(message)) return;   // nothing written yet (a blank greeting, a chat just opening)
    if (!force && (stored(message) || String(message.mes).includes(GFX_START))) return;

    const key = `${context.chatId}:${messageId}:${message.swipe_id ?? 0}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    failures.delete(key);
    drawSection(document.querySelector(`#chat .mes[mesid="${messageId}"]`));
    setBusy(messageId, true);

    try {
        await waitUntilIdle();
        console.log(LOG_PREFIX, `Internal States: writing for message ${messageId}`);
        const previous = previousState(chat, messageId);
        const ct = (Number(previous?.ct) || 0) + 1;
        const depth = Math.max(0, Number(getSettings().internalStatesContextMessages ?? 2));
        const recent = chat.slice(Math.max(0, messageId - depth), messageId)
            .map(m => `${m.name}: ${String(m.mes)}`).join('\n\n');

        const userPrompt = [
            `TURN: ${ct}`,
            '',
            'PREVIOUS STATE:',
            previous ? htmlToText(previous.html) : '(none yet - this is the first turn; initialise every section)',
            '',
            recent ? `RECENT MESSAGES:\n${recent}\n` : '',
            `LATEST MESSAGE (${message.name}):`,
            message.mes,
        ].join('\n');

        const reply = await request(userPrompt);
        const block = extractBlock(reply);
        if (!block) {
            const seen = String(reply ?? '').trim();
            console.warn(LOG_PREFIX, 'Internal States reply had no block. Start of it:', seen.slice(0, 600));
            throw new Error(seen
                ? `The reply did not contain a state block (it began: "${seen.slice(0, 80).replace(/\s+/g, ' ')}").`
                : 'The reply was empty (the model returned nothing; a thinking model may have used all its tokens, so try raising the Internal States max tokens).');
        }

        // The turn the model wrote, falling back to the one it was given.
        const written = /Turn:\s*(\d+)/i.exec(block);
        store(message, { html: block, ct: written ? Number(written[1]) : ct, at: Date.now() });
        debugLog(`Internal States written for message ${messageId} (turn ${ct})`);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Internal States failed', err);
        failures.set(key, String(err?.message || err));
        toastr.warning(`Internal States could not be written: ${err?.message || err}`, PRODUCT_NAME);
    } finally {
        inFlight.delete(key);
        setBusy(messageId, false);
        drawSection(document.querySelector(`#chat .mes[mesid="${messageId}"]`));
    }
}

function setBusy(messageId, busy) {
    const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    mesEl?.classList.toggle('sillynpc-is-busy', busy);
    const label = mesEl?.querySelector('.sillynpc-is-status');
    if (label) label.textContent = busy ? 'writing…' : '';
}

/** The block dressed by the preset's display regexes, then made safe to insert. */
function dress(html) {
    // GM's Notebook entries sit on their own lines in the text, which HTML runs together:
    // put a break between one "- [R]/[T]/[D]" entry and the next (not after one already broken).
    let out = String(html ?? '').replace(/(?<!<br\s*\/?>|<\/summary>)[ \t]*\n[ \t]*-[ \t]*\[([RTD])\]/g, '<br>- [$1]');
    {
        try {
            out = getRegexedString(out, regex_placement.AI_OUTPUT, { isMarkdown: true });
        } catch (err) {
            debugLog('Preset regexes failed on the Internal States block', err);
        }
    }
    // Whatever the regexes left as markup is used as it is; anything that is still
    // an HTML comment (the markers) goes, and the result is sanitised like a message is.
    out = out.replace(/<!--[\s\S]*?-->/g, '');
    return DOMPurify.sanitize(out, { ADD_TAGS: ['details', 'summary'] });
}

/** Draws, or removes, the Internal States section under one message. */
export function drawSection(mesEl) {
    if (!mesEl) return;
    mesEl.querySelector(':scope .sillynpc-internal-states')?.remove();
    if (mode() !== 'after') return;

    const id = Number(mesEl.getAttribute('mesid'));
    const message = getContext().chat?.[id];
    if (!message || message.is_user || message.is_system) return;

    const record = stored(message);
    const tail = `:${id}:${message.swipe_id ?? 0}`;
    const busy = [...inFlight].some(k => k.endsWith(tail));
    const failure = [...failures].find(([k]) => k.endsWith(tail))?.[1] || '';
    if (!record && !busy && !failure) return;

    const section = document.createElement('div');
    section.className = 'sillynpc-internal-states';

    const bar = document.createElement('div');
    bar.className = 'sillynpc-is-bar';
    const title = document.createElement('span');
    title.className = 'sillynpc-is-title';
    title.textContent = 'Internal States';
    const status = document.createElement('span');
    status.className = 'sillynpc-is-status notes';
    status.textContent = busy ? 'writing…' : (failure ? `failed: ${failure}` : '');
    const redo = document.createElement('div');
    redo.className = 'mes_button fa-solid fa-arrows-rotate';
    redo.title = 'Write the Internal States again';
    redo.addEventListener('click', (e) => {
        e.stopPropagation();
        generateInternalStates(id, { force: true });
    });
    const pen = document.createElement('div');
    pen.className = 'mes_button fa-solid fa-pen-to-square';
    pen.title = 'Edit the Internal States';
    pen.style.display = record ? '' : 'none';
    pen.addEventListener('click', (e) => {
        e.stopPropagation();
        editing.add(`${id}:${message.swipe_id ?? 0}`);
        drawSection(mesEl);
    });
    bar.append(title, status, pen, redo);
    redo.style.marginLeft = '0';
    pen.style.marginLeft = 'auto';
    section.append(bar);

    if (record && editing.has(`${id}:${message.swipe_id ?? 0}`)) {
        const box = document.createElement('textarea');
        box.className = 'text_pole sillynpc-is-edit';
        box.rows = 14;
        box.value = record.html;
        const row = document.createElement('div');
        row.className = 'sillynpc-is-edit-row';
        const save = document.createElement('div');
        save.className = 'menu_button';
        save.textContent = 'Save';
        save.addEventListener('click', () => {
            store(message, { ...record, html: box.value, edited: true });
            editing.delete(`${id}:${message.swipe_id ?? 0}`);
            drawSection(mesEl);
        });
        const cancel = document.createElement('div');
        cancel.className = 'menu_button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => {
            editing.delete(`${id}:${message.swipe_id ?? 0}`);
            drawSection(mesEl);
        });
        row.append(save, cancel);
        section.append(box, row);
    } else if (record) {
        const body = document.createElement('div');
        // Not "mes_text": SillyTavern's editor does find('.mes_text') and puts its edit box in every match, which
        // left empty copies of it and erased the message when Done was pressed.
        body.className = 'sillynpc-is-body';
        body.innerHTML = dress(record.html);
        // Not nested in a details of its own when the preset's regexes already made one.
        if (!body.querySelector('details')) {
            const wrap = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = `Turn ${record.ct}`;
            wrap.append(summary, ...body.childNodes);
            body.append(wrap);
        }
        section.append(body);
    }

    const anchor = mesEl.querySelector('.sillynpc-status-box') || mesEl.querySelector('.mes_text');
    anchor?.insertAdjacentElement('afterend', section);
}

/** Tells the story model the last known state, in plain text, instead of asking it to write one. */
export function applyInternalStatesPrompt() {
    const settings = getSettings();
    let text = '';
    if (settings.enabled && mode() === 'after' && settings.internalStatesInject !== false) {
        const chat = getContext().chat || [];
        const last = previousState(chat, chat.length);
        if (last) {
            text = '### INTERNAL STATES (last known, tracked separately)\n'
                + `${htmlToText(last.html)}\n`
                + 'Use this as ground truth for agendas, locations and secrets. '
                + 'Do NOT write an internal states block in your reply.';
        }
    }
    placeWritingPrompt(INJECT_KEY, text, {
        depth: Number(settings.internalStatesInjectDepth ?? 1),
        name: 'SillyNPC - Internal States',
    });
}

export function initInternalStates() {
    eventSource.on(event_types.GENERATION_STARTED, (_t, _o, dryRun) => {
        if (dryRun) return;
        try { applyInternalStatesPrompt(); } catch (err) { debugLog('Internal States prompt failed', err); }
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        if (mode() !== 'after') return;
        generateInternalStates(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });
    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        if (mode() !== 'after') return;
        generateInternalStates(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });
    eventSource.on(MESSAGE_RENDERED_EVENT, drawSection);
}
