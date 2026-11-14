import { getSettings, saveSettings } from './settings.js';
import { SYSTEM_PROMPT, debugLog } from './constants.js';
import { importSystemPreset, setActiveSystem, getActiveSystem } from './status-logic.js';

/**
 * Systems shipped with the fork, installed into the library on start-up.
 *
 * One today: the tracker for the Mimostein preset's Internal States. That preset asks the
 * story model to write a hidden block every reply - agendas, locations, bonds, thoughts,
 * body scale, Chekhov's Gun, a GM notebook, world sim - which costs tokens on every turn
 * and has to be hidden again with regexes. Here the same state is kept by the tracker's
 * own extraction pass instead, so the story model writes none of it and still receives it.
 *
 * Built in code rather than shipped as a JSON file so it can borrow the extension's own
 * extraction prompt and move with it, and so one list of fields is the only list.
 */

export const MIMOSTEIN_SYSTEM = 'Mimostein Internal States';

/** Bump when the system below changes, so an installed copy is brought up to date. */
const REVISION = 3;

/** A text stat. */
const text = (name, hint, extra = {}) => ({
    name,
    defaultValue: extra.defaultValue ?? '',
    format: extra.format ?? '<b>{{name}}:</b> {{value}}',
    visible: extra.visible ?? true,
    type: 'text',
    hint,
    maxLength: extra.maxLength ?? '',
    options: extra.options ?? [],
});

/** A bounded number, written "current/max". */
const meter = (name, hint, { min, max, start, color }) => ({
    name,
    defaultValue: `${start}/${max}`,
    maxStatValue: String(max),
    min: String(min),
    format: '<b>{{name}}:</b> {{value}}',
    visible: true,
    type: 'number',
    hint,
    maxLength: '',
    ...(color ? { color } : {}),
});

const globalStats = () => [
    {
        ...text('Turn', 'Message counter. Add exactly 1 every message; this is "ct" in the rules.',
            { defaultValue: '0' }),
        type: 'number',
        min: '0',
    },
    text('Location', 'Where the scene is, specific enough to place everyone.', { defaultValue: 'Unknown' }),
    text('Time', 'Clock time and day.', { defaultValue: 'Morning' }),
    text('Scene Mode', 'LOCKED = intimate, private, deep talk, vulnerable or sexual. '
        + 'ACTIVE = casual, public, domestic or group. TRANSITION = travel or a time skip.',
    { defaultValue: 'ACTIVE', options: ['LOCKED', 'ACTIVE', 'TRANSITION'] }),
    text('World Event', 'One brief ambient detail or off-screen shift. "None" when quiet.',
        { defaultValue: 'None', maxLength: 160 }),
    text('Environment', 'Hazards, magic and weather in effect.', { defaultValue: 'None', maxLength: 160 }),
    text('Physics', 'Spatial positions, distances and lines of sight between the people present.',
        { defaultValue: 'None', maxLength: 220 }),
];

const bodyScale = () => [
    text('Frame & Stature', 'Tier S1-S5, height cm / weight kg, then eye-level contrast with the player. '
        + 'Example: S2, 168 cm / 55 kg, eyes at the player\'s chin.', { maxLength: 200 }),
    text('Tactile & Contact', 'Hand size, wrist and waist span, shoulder width, and how their weight feels '
        + 'against the player.', { maxLength: 220 }),
    text('Proportions & Kinetics', 'Bust or chest tier S1-S5 and hips tier S1-S5, softness versus muscle tone, '
        + 'sway and bounce.', { maxLength: 220 }),
    text('Attire & Posture', 'Current clothes, fabric tension or drape, footwear and exact stance. '
        + 'Rewrite whenever clothing or posture changes.', { maxLength: 240 }),
];

const npcStats = () => [
    text('Location', 'Where they are right now (place, coordinates or scene). Off-screen characters '
        + 'keep a real location too.', { defaultValue: 'Unknown', maxLength: 120 }),
    text('Activity', 'What they are doing right now.', { maxLength: 140 }),
    text('Agenda', 'Their current off-screen goal, 1-3 steps: rest, eat, work, study, wander, errands. '
        + 'Assign one on first introduction and a new one whenever it completes.', { maxLength: 140 }),
    text('Agenda Step', 'Progress as "current/max", for example 1/3. Advances by 1 each message while the '
        + 'character is OFF-screen; unchanged while on-screen.', { defaultValue: '0/1', maxLength: 12 }),
    text('Aware', 'Secrets they know. "None" if none.', { defaultValue: 'None', maxLength: 160 }),
    text('Fibs', 'Lies they have told. "None" if none.', { defaultValue: 'None', maxLength: 160 }),
    text('Circle', 'Their allies and close contacts.', { defaultValue: 'None', maxLength: 120 }),

    meter('BOND', 'Relationship with the player, -5 to 20. NEVER raised directly: it rises only when '
        + 'Sparks converts. Drops: -1 for an insult, dismissal or being ignored; -2 for betrayal or cruelty.',
    { min: -5, max: 20, start: 0, color: '#2f9e44' }),
    meter('Sparks', 'Fondness toward the player, 0 to 10. +1 per positive interaction (compliment, defence, '
        + 'gift, sensual touch), at most +2 per message.', { min: 0, max: 10, start: 0, color: '#e64980' }),
    meter('Grudge', 'Resentment toward the player, 0 to 5. +1 per slight (insult, jealousy, cruelty, '
        + 'disagreement), at most +1 per message. A sincere apology resets it to 0.',
    { min: 0, max: 5, start: 0, color: '#c92a2a' }),

    text('Dynamic', 'How they currently get along with the player.',
        { defaultValue: 'In Sync', options: ['In Sync', 'Mild Rub', 'Friction', 'Clash'] }),
    text('Body/Mood', 'Physical state and current mood: fatigue, hunger, heat, cold, soreness, stress, '
        + 'arousal, plus valence, arousal and dominance in plain words.', { maxLength: 200 }),
    text('Thought', 'Raw first-person thought, 10-40 words. About their own cravings, pet peeves, work, '
        + 'pride or goals, not about pleasing the player.', { format: '<b>💭</b> “{{value}}”', maxLength: 300 }),
    text('Stance Lock', 'Attitude they sustain, and any unresolved tension awaiting the player\'s action. '
        + 'Never a joke, tease or plan that has already been spoken aloud.', { maxLength: 220 }),

    ...bodyScale(),
];

const collections = () => [
    {
        id: 'chekhov',
        name: "Chekhov's Gun",
        target: 'player',
        hint: 'Scene-level, not personal: secrets, lies and planted setups waiting to pay off. '
            + 'Age of a bullet is Turn minus Created. Add one only for a meaningful promise, secret or '
            + 'setup. At most 15 active; move to Fired when it happens, and remove unlocked ones at age 12.',
        visible: true,
        fields: [
            { name: 'bullet', label: 'Bullet', type: 'text', isPrimary: true, defaultValue: '' },
            { name: 'weight', label: 'Weight', type: 'text', isPrimary: false, defaultValue: '2', options: ['1', '2', '3'] },
            { name: 'created', label: 'Created (Turn)', type: 'number', isPrimary: false, defaultValue: '0' },
            { name: 'status', label: 'Status', type: 'text', isPrimary: false, defaultValue: 'Active', options: ['Active', 'Locked', 'Fired'] },
            { name: 'lock', label: 'Lock', type: 'text', isPrimary: false, defaultValue: '' },
            { name: 'secret', label: 'Secret', type: 'text', isPrimary: false, defaultValue: 'no', options: ['yes', 'no'] },
        ],
    },
    {
        id: 'gm_notebook',
        name: "GM's Notebook",
        target: 'player',
        hint: 'Scene-level memory scratchpad, max 20 entries (drop the oldest for a 21st). Type R = reminder '
            + '(rules, knowledge limits), T = thread (open plot arc or foreshadowing), D = debug. One or two '
            + 'sentences. Never log BOND, Sparks, Grudge or Chekhov bullets here.',
        visible: true,
        fields: [
            { name: 'note', label: 'Note', type: 'text', isPrimary: true, defaultValue: '' },
            { name: 'type', label: 'Type', type: 'text', isPrimary: false, defaultValue: 'T', options: ['R', 'T', 'D'] },
        ],
    },
];

/** What the reader is told beyond the extension's own rules. */
const INTERNAL_STATES_PROMPT = [
    '### INTERNAL STATES',
    'This system mirrors a roleplay preset\'s hidden state block. Keep every field below current.',
    '- Turn: add exactly 1 to the global Turn every message. Call the new value ct.',
    '- Scene Mode: choose one every message from the definitions in the field notes.',
    '- Locations: every character present gets Location and Activity. Absent named characters keep a real Location.',
    '- Agendas: an OFF-screen character advances Agenda Step by 1 each message. When Step reaches max, apply the outcome (travel updates Location, research plants a Chekhov bullet, rest heals, reconcile triggers a repair scene) and assign a new agenda. An ON-screen character\'s Step does not advance, but their agenda must fit the scene.',
    '- Thoughts: refresh Dynamic, Body/Mood, Thought and Stance Lock for up to three on-screen characters, preferring those who speak or act. Physical discomfort drains patience. Thoughts do not orbit the player. An annoyed or hurt character stays that way until the player resolves it by concrete action or apology; do not melt it mid-reply. Once a grievance has been spoken aloud, carry it as behaviour, not as repeated words.',
    '- Relationships (BOND, Sparks, Grudge toward the player): BOND is never raised directly. When ct is divisible by 5: if Sparks >= 7, BOND +1 and Sparks reset to 0; otherwise, if there was no positive interaction, Sparks -1 (not below 0). When ct is divisible by 3: if Grudge >= 5, BOND -1 and Grudge reset to 0; otherwise if Grudge > 0, Grudge -1. While Grudge >= 3, halve any positive BOND gain. BOND stays within -5..20.',
    '- Body scale: keep the four body fields for the player and for every present character. Rewrite Attire & Posture whenever clothing or stance changes; the rest change rarely.',
    "- Chekhov's Gun: a bullet may fire only when ct minus its Created is at least 4 (weight 3), 6 (weight 2) or 8 (weight 1), or when its Lock time is reached, and only if the present characters and Scene Mode make it fit. A disruptive bullet never fires during a LOCKED scene unless it concerns that very moment. Set Status to Fired once it happens in the story. Convert a future time reference into a Lock such as T:18:30. Remove an unlocked bullet at age 12 or when it is contradicted.",
    "- GM's Notebook: only items with no other slot. Add, change or remove entries to keep the scene's open questions current.",
    '- Never write these numbers or labels into the story; they are for tracking only.',
].join('\n');

/**
 * The extension's own rules with the generic Standing and Condition sections swapped for
 * this system's. Those two refer to stats this system does not have, and a rule about a
 * stat that does not exist is a rule the model will try to satisfy.
 */
function extractionPrompt() {
    const start = SYSTEM_PROMPT.indexOf('### STANDING');
    const end = SYSTEM_PROMPT.indexOf('### TIMING & ACTION COSTS');
    if (start === -1 || end === -1 || end < start) {
        return `${SYSTEM_PROMPT}\n\n${INTERNAL_STATES_PROMPT}`;
    }
    return `${SYSTEM_PROMPT.slice(0, start)}${INTERNAL_STATES_PROMPT}\n\n${SYSTEM_PROMPT.slice(end)}`;
}

/** The system, in the shape importSystemPreset takes. */
export function buildMimosteinSystem() {
    return {
        version: '2.1.0',
        metadata: {
            name: MIMOSTEIN_SYSTEM,
            description: "Tracks everything in the Mimostein preset's Internal States: agendas, "
                + 'locations, bonds, thoughts, body scale, Chekhov\'s Gun, GM notebook and world sim.',
            author: 'SillyNPC fork',
            forkRevision: REVISION,
        },
        config: {
            statusTracker: {
                globalStats: globalStats(),
                showGlobalStats: true,
                npcStats: npcStats(),
                playerStats: bodyScale(),
                collections: collections(),
                extractionPrompt: extractionPrompt(),
                extractionContextMessages: 2,
                castMode: 'speakers',
                reviewMode: 'off',
                showOnlyAtBottom: true,
                clockStat: 'Time',
                systemRules: 'Keep the internal state faithful to the story. Do not invent events.',
            },
        },
    };
}

/**
 * Puts the shipped systems into the library, and makes the first one the active system the
 * first time it is installed.
 *
 * Activation happens once. The outgoing system is captured by the switch itself, so nothing
 * is lost, but it is also not something to repeat after you have chosen to leave it.
 */
export async function installBundledSystems() {
    const settings = getSettings();
    const st = settings.statusTracker;
    const presets = st.presets || {};
    const installed = presets[MIMOSTEIN_SYSTEM];
    const current = Number(installed?.metadata?.forkRevision ?? 0);
    if (current >= REVISION) return;

    const wasActive = getActiveSystem() === MIMOSTEIN_SYSTEM;
    importSystemPreset(JSON.stringify(buildMimosteinSystem()));
    debugLog(`Installed system "${MIMOSTEIN_SYSTEM}" revision ${REVISION}`);

    // The extraction reply carries more fields than a stock system's, and the stock
    // 1200-token budget truncates it mid-object. A budget is yours and is not part of a
    // system, so it is raised here rather than shipped.
    if (Number(st.extractionMaxTokens) > 0 && Number(st.extractionMaxTokens) < 2500) {
        st.extractionMaxTokens = 3000;
    }

    if (!installed && !settings.mimoSystemOffered) {
        settings.mimoSystemOffered = true;
        if (setActiveSystem(MIMOSTEIN_SYSTEM)) {
            toastr.success(`"${MIMOSTEIN_SYSTEM}" is installed and active. Your previous system was kept.`, 'SillyNPC');
        }
    } else if (wasActive) {
        toastr.info(`"${MIMOSTEIN_SYSTEM}" was updated. Switch to another system and back to load the new fields.`, 'SillyNPC');
    }
    saveSettings();
}
