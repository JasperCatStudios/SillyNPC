import { saveSettingsDebounced } from '../../../../../script.js';
import { normalizeGradient, legacyGradient } from './gradient-style.js';
import { extension_settings } from '../../../../extensions.js';
import {
    EXTENSION_VERSION,
    debugLog,
    GEMINI_IMAGE_MODELS,
    SPEAKER_PALETTE,
    PORTRAIT_SHAPES,
    DEFAULT_PORTRAIT_SHAPE,
    DIALOGUE_FORMAT_PROMPT,
    DEFAULT_MARKER_OPEN,
    DEFAULT_MARKER_CLOSE,
    isLegacyDialoguePrompt,
    buildDialogueFormatPrompt,
    IMAGE_PROMPT_BY_BACKEND
} from './constants.js';
import { resolveImageFolder } from './utils.js';
import { normalizeCombatPrefs, normalizeTypeLibrary } from './combat-types.js';
import { normalizeCombatBlock } from './combat-store.js';

/** statusTracker keys that nothing reads any more. See the migration that removes them from saved settings. */
const OBSOLETE_TRACKER_KEYS = [
    'showGlobalStats', 'summaryThreshold', 'showNpcPortraits', 'extractionContextMessages', 'reviewMode', 'maxChangePolicy',
    'reviewSwingThreshold', 'recordMessageHistory', 'scanButtonEnabled', 'scanCharBudget', 'scanMaxChunks', 'clockStat',
    'clockMaxElapsedMinutes', 'timeRules', 'extractionReasons', 'stripStatusFromHistory', 'sceneInjectionDepth', 'hudEnabled',
    'hudPosition', 'hudLayout', 'hudMeterWidth', 'hudMeterHeight', 'hudRingThickness', 'extractionPrompt', 'hudPortraitSide',
    'hudPortraitShape', 'hudPortraitBorder', 'customCSS', 'renderPosition',
    'extractionMode', 'extractionProfileId', 'extractionMaxTokens', 'scanDepth', 'scanMaxTokens', 'scanProfileId',
    'extractionUseSchema', 'systemRules',
];

export const defaultSettings = {
    version: EXTENSION_VERSION,
    enabled: true,
    applyColors: true,
    /**
     * Text size in the menus and sheets, and in the in-chat tracker box, as a multiplier
     * of whatever the chosen theme sets.
     *
     * Two rather than one because they are read in different places and at different
     * distances: the menu is a panel you are working in, and the box sits in the middle of
     * the story where it competes with the prose around it. Somebody who wants the tracker
     * out of the way usually does not want the settings shrunk with it.
     *
     * A multiplier rather than a size, so a theme that ships larger type - Fantasy HUD sets
     * 16px, Terminal 13px - stays proportionally itself.
     */
    menuFontScale: 1.0,
    trackerFontScale: 1.0,
    /* Declared here rather than created part-way through normalizeSettings, which is where
       these five used to appear as "if not set, set it". They worked, because every reader
       tolerates absence - but nothing that enumerates defaultSettings could see them, so
       export, import repair and any future reset-to-defaults all skipped them. That form
       additionally meant a legitimately falsy value could never be stored: harmless for
       five strings, and the wrong idiom to copy. */
    menuStyle: 'default',
    dividerStyle: 'subtle',
    avatarShape: 'rounded',
    avatarSize: 'medium',
    colorStyle: 'text',
    /* Which System Profile is in use, or '' for none. It was not in this file at all - it
       came into being the first time setActiveSystem wrote it - so the same enumeration
       problem applied, and reading the defaults gave no hint that the concept existed. */
    activeSystem: '',
    /** The world opened each time SillyTavern starts. Empty: whichever was in use last. */
    defaultWorld: '',
    /** The Custom look runs the regex scripts whose name starts with this, whether or not they are switched on in SillyTavern. */
    customRegexPrefix: 'Custom - ',
    /** Where the Content Kit is fetched from (git). Empty means the official Worldkit-Content repository. */
    contentKitUrl: 'https://github.com/JasperCatStudios/Worldkit-Content.git',
    /** Each prompt's remembered template choice and the own-text kept aside: { [promptId]: { mode, custom } }. */
    promptPicks: {},
    /**
     * Whether the story model is told how to lay dialogue out.
     *
     * On by default: everything this extension draws in the chat depends on the answer
     * having speaker lines in it, and until now that depended on the user having put a
     * formatting block in their persona.
     */
    dialogueFormatEnabled: true,
    /** Empty means the built-in text; the repair pass fills it in so the box is not blank. */
    dialogueFormatPrompt: '',
    /** 0 puts it after the newest message - the last thing read before answering. */
    dialogueFormatDepth: 0,
    /** Delivery tags ([whisper]...[/whisper]): ask the model for them, and show/voice them. Off until switched on. */
    deliveryTagsEnabled: false,
    /** Empty means the built-in instruction, built from the tag names. */
    deliveryTagsPrompt: '',
    /** Where the instruction goes: position, depth, role, order, and whether SillyTavern's prompt list owns it. */
    deliveryInject: {},
    /** Per tag: how it looks (size, weight, case, spacing, opacity, font, effect). Empty: the starting looks. */
    deliveryStyles: {},
    /** Per tag: what it means, in the words the model is given. Empty: the built-in wording. */
    deliveryMeanings: {},
    /** Take the tags out of what is sent back to the model (older messages), starting this many messages back. */
    deliverySaverOn: false,
    deliverySaverDepth: 2,
    /**
     * Whether this block appears in SillyTavern's own prompt list, to be ordered there.
     *
     * Off by default, and the default is not neutrality for its own sake: IN_CHAT at depth 0
     * puts the block after the newest message, and handing it to the list moves it up among
     * the system prompts until somebody sets In-Chat there. Changing where an existing user's
     * formatting rule sits, without being asked, is not a fix.
     */
    dialogueFormatInPromptList: false,
    /**
     * How the narrator should behave, injected late so a long chat cannot bury it.
     *
     * Off, and empty, by default. Unlike the dialogue format there is no built-in text to
     * fall back on: what a narrator should do is yours to say, and sending an opinion
     * nobody asked for into every message is not a sensible default.
     */
    /** As above. The rules exist because a card's instructions sit too far from the reply. */
    /**
     * Phrases the model leans on, stopped at the sampler where the backend allows it.
     *
     * Travels with the system rather than staying global: what counts as slop is a
     * property of the fiction, and a horror world and a comedy one do not agree about it.
     */
    /** The connection profile Threads reads replies on. Empty is the main API. */
    /** Combat and Games send their result to the story through the prompt (see src/result-injection.js): { combat: {...}, games: {...}, levelup: {...} }. */
    resultInjection: {},
    /** Leveling rules (see combat-level.js): { xpBase, xpStep, xpPerEnemy, maxLevel, difficultyXp }. An empty object is the starting rules. */
    leveling: {},
    /** Hidden identities (see identity-core.js): when to send the secret-identity prompt of a linked character, and where. An empty object is off. */
    identity: {},
    threadsProfileId: '',
    /** Threads: things said and done that are not finished with (promises, threats, debts, secrets, deadlines, plans). Off by default. */
    threadsEnabled: false,
    /** How many open threads ride along with each reply (the highest scoring first). */
    threadsInjectedMax: 8,
    /** How many open threads are kept at all; past this the lowest scoring is deleted. Pinned ones do not count. */
    threadsOpenMax: 20,
    /** How many settled threads stay as a record. Oldest deleted past this. */
    threadsClosedKeep: 10,
    /** Messages until a thread is worth half its kind's weight. */
    threadsHalfLife: 60,
    /** Tokens the Threads reader may reply with. Thinking models spend part of it on reasoning. */
    threadsMaxTokens: 4000,
    banListEnabled: false,
    banList: [],
    /** How far back the scan reads when it goes looking for them. */
    banScanDepth: 50,
    /** The connection profile the ban scan reads the chat on. Empty is the main API. */
    banScanProfileId: '',
    /** Colour a speaker who has no card, from their name. */
    autoColorUnknownSpeakers: true,
    hideSpeakerNames: false,
    caseInsensitive: true,
    /**
     * How speakers are found in a reply (fork).
     * 'marker' - only the speaker tag, by default a name between white square brackets.
     * 'both'   - the tag, and also upstream's bold-colon and name-in-prose matching.
     * 'legacy' - upstream's behaviour alone.
     */
    speakerDetection: 'marker',
    speakerMarkerOpen: DEFAULT_MARKER_OPEN,
    speakerMarkerClose: DEFAULT_MARKER_CLOSE,
    /**
     * Voices (fork). The voices themselves are chosen in SillyTavern's own TTS panel, one
     * per name in its voice map; this only decides who is read and when.
     */
    /**
     * What every module sends along with its own request. Which modules send which is
     * moduleContext[id] = { persona, memory }; a module with no entry sends both.
     */
    moduleContext: {},
    /**
     * The combat module (fork). Follows each System, so a World can have its own type picked.
     * @type {{ enabled: boolean, activeType: string, reviewGrowth: boolean, trackerMap: { health: string, condition: string } }}
     */
    combat: { enabled: false, activeType: '', reviewGrowth: true, trackerMap: { health: '', condition: '' }, migrations: [] },
    /** Custom combat world types, by id. Global: the type library is shared by every System. */
    combatTypes: {},
    contextPersonaMaxChars: 3000,
    /** Extension prompt slots to send: any whose name starts with one of these. */
    contextMemoryKeys: '3_vectfox, summaryception',
    contextMemoryMaxChars: 6000,
    /** AllTalk, spoken to directly. */
    alltalkUrl: 'http://localhost:7851',
    alltalkLanguage: 'en',
    /** Which engine speaks: 'alltalk' or 'elevenlabs' (through SillyTavern). */
    ttsEngine: 'alltalk',
    elevenModel: 'eleven_v4',
    elevenStability: 0.5,
    elevenSimilarity: 0.75,
    elevenSpeed: 1,
    /** Send a line's delivery (whisper, shout...) to engines that understand audio tags. Closing tags are always dropped. */
    ttsToneTags: true,
    /** Delivery tag to ElevenLabs audio tag, as edited by the owner. Empty: the built-in table. */
    ttsToneTable: {},
    /** Voice files for people with no card of their own. */
    ttsVoiceDefault: '',
    ttsVoicePlayer: '',
    ttsVoiceFemale: '',
    ttsVoiceMale: '',
    /** Your own wording for pictures asked for in plain words, per kind (empty: built-in). {NAME} {REQUEST} {LOOK} {SCENE} {STYLE}. */
    phonePromptSelfie: '',
    /** The art style of plain picture requests (empty: natural skin texture), and the lighting words per time of day (empty: built-in). */
    phonePictureStyle: '',
    phoneTimeDawn: '',
    phoneTimeMorning: '',
    phoneTimeMidday: '',
    phoneTimeAfternoon: '',
    phoneTimeEvening: '',
    phoneTimeNight: '',
    phonePromptDrawing: '',
    phonePromptObject: '',
    /** Voices on or off. Off: nothing is read, nothing is tested, and no error toasts about AllTalk. */
    ttsEnabled: false,
    /** Read each new reply aloud, one voice per speaker, when it finishes. */
    ttsAutoSpeak: false,
    /** Whether (parenthesised) thoughts are read. Off: a thought is not said out loud. */
    ttsSpeakThoughts: false,
    /** Whether untagged narration is read, in the TTS panel's default voice. */
    ttsSpeakNarration: false,
    /**
     * Character visuals (fork). Sends each present character's saved image prompt along
     * with the story prompt, so a picture prompt the model writes describes the same
     * person every time instead of inventing a fresh one.
     */
    imagePromptInject: false,
    imagePromptInjectDepth: 1,
    /** The wording around the list; {{list}} is replaced with one line per character. */
    imagePromptInjectTemplate: '',
    /** Set once the fork's one-off settings migration has run. */
    mimoMigrated: 0,
    /**
     * Internal States (fork): 'after' writes the preset's hidden state block with a second
     * request and shows it under the reply, 'inline' leaves it to the preset, 'off' is off.
     */
    internalStatesMode: 'after',
    internalStatesProfileId: '',
    internalStatesMaxTokens: 3000,
    internalStatesContextMessages: 2,
    /** Empty means the built-in instructions and template. */
    internalStatesPrompt: '',
    /** Tell the story model the last known state, and not to write one. */
    internalStatesInject: true,
    internalStatesInjectDepth: 1,
    /**
     * Faces for speakers who have no card, or a card with no portrait.
     *
     * A list rather than the single defaultImage it replaces: one picture meant every
     * stranger in the story wore the same face. Each entry is { src, tags }, and the tags
     * are matched against the speaker's name so a guard draws from the guards.
     *
     * @type {Array<{ src: string, tags: string[] }>}
     */
    defaultImages: [],
    /**
     * How many messages a stranger can be absent before they are somebody else.
     *
     * The guard you speak to across three messages is one guard; the guard two hundred
     * messages later is a different person wearing the same word.
     */
    defaultPortraitRunGap: 12,
    /**
     * Whether the settings only worth touching for a reason are shown.
     *
     * Eighty-one settings is a lot to meet at once, and most of them are budgets and
     * limits whose defaults are right until something specific goes wrong. Hidden rather
     * than removed: every one of them still matters to somebody.
     */
    devMode: false,
    popupWidth: 80,
    popupHeight: 80,
    /** @type {'contain' | 'cover'} */
    defaultImageFit: 'contain',
    /**
     * Which part of a portrait the round frames keep.
     *
     * The HUD portrait and the tracker box's NPC portraits are circles filled with `cover`,
     * so a 2:3 image loses its top and bottom. Centred, that is the head. No single crop
     * suits every picture, so this is the choice - defaulting to the top, where a head is
     * in almost any portrait.
     *
     * @type {'top' | 'center' | 'bottom'}
     */
    portraitFraming: 'top',
    /**
     * Padding above and below a speech block, in pixels.
     *
     * Was a hardcoded 15, which on a block whose height is already set by the avatar read
     * as a band of empty colour rather than as breathing room. Horizontal padding is not
     * settable: text needs clearance from a coloured edge whatever this is.
     */
    speechPadY: 6,
    /** @type {string[]} */
    scanLorebooks: [],
    /** @type {string} */
    defaultLorebook: '',
    contextMessages: 15,
    /**
     * How much story text the lore writer may be shown, whatever the message count says.
     *
     * "Whole chat" meant literally the whole chat, and on a long story that is megabytes
     * in one prompt - the request could not be built at all. The newest messages are taken
     * up to this many characters and the rest dropped, so a long story degrades instead of
     * failing. Roughly ten thousand tokens: this is one request and cannot lean on the
     * several passes the history scan gets.
     */
    loreCharBudget: 40000,
    /**
     * Whether the lore writer may search your Data Bank before writing.
     *
     * Off by default: it needs Vector Storage set up with file indexing on, and does
     * nothing useful without it. SillyTavern's Vector Storage skips quiet prompts
     * outright ("Vectors: Skipping quiet prompt"), so lore generation has never seen the
     * Data Bank by accident - this asks for it deliberately, with /db-search.
     */
    loreUseDataBank: false,
    /**
     * Which connection writes lore. Empty means your main API.
     *
     * Its own setting rather than the tracker's: a small model chosen for returning JSON
     * is not who you want writing prose.
     */
    loreProfileId: '',
    /** Which connection generates combat stats from a lore entry. Empty means your main API. */
    combatProfileId: '',
    /** Your own abilities and edits to built-in ones, per world type. See combat-ability-overlay.js. */
    combatAbilities: {},
    /** Your changes to a world's weapon tiers, kinds and tools, and its Armoury, per world type. See combat-gear-overlay.js. */
    combatGear: {},
    /** How the shared history of fights and games goes into the story prompt. See rivalry-inject-core.js. */
    historyInject: {},
    /**
     * The Bond Tracker: growth rules, levels and gates, milestone presets, how it reaches the
     * story prompt. Repaired on read by normalizeBondSettings in bonds-core.js, so an empty
     * object is every default. The bonds themselves are per chat, in the chat's metadata.
     */
    bonds: {},
    /**
     * The Vitals Tracker: health, hunger and mood per person, per chat. Repaired on read by
     * normalizeVitalsSettings in vitals-core.js, so an empty object is every default - which is off.
     */
    vitals: {},
    /**
     * The Inventory Tracker: what each person carries, and money, per chat. Repaired on read by
     * normalizeInventorySettings in inventory-core.js, so an empty object is every default - off.
     */
    inventory: {},
    /** Your own items and presets for the Item Database ({ items: [], presets: [] }); the built-in ones are in item-database.js. */
    itemDatabase: {},
    /** Which connection reads replies for the inventory. Empty means your main API. */
    inventoryProfileId: '',
    /** The look of each tracker block: { states, bonds, vitals, inventory }, each plain, parchment, persona or tactical. */
    trackerThemes: {},
    /**
     * Faction colours and artwork (faction-theme.js): palettes you add, the default faction, whether pictures are
     * used at all (off means built-in icons only) and the folder they are read from. Presentation only.
     */
    factions: {},
    /** Which connection reads replies for vitals. Empty means your main API. */
    vitalsProfileId: '',
    /**
     * Vectors for the histories (Ollama through SillyTavern's own vector endpoints). Repaired
     * on read by normalizeVectorSettings in vector-core.js, so an empty object is every
     * default - which is off. What is in each chat's collections is in the chat's metadata.
     */
    vectors: {},
    /** Which connection proposes bond changes after a reply. Empty means your main API. */
    bondProfileId: '',
    /**
     * Which connection's API key draws portraits on the Gemini backend. Empty means
     * whichever Google key SillyTavern currently has active.
     *
     * Only the key and the account are taken from the profile, never the model: a
     * connection profile can only name a text model, and the gemini-*-image models are
     * not reachable through one at all.
     *
     * Without this the image request carried no secret_id, so portraits were billed to
     * the globally active key and could not be aimed anywhere else - which made "use a
     * different API for images" impossible however the profiles were configured.
     */
    imageProfileId: '',
    /**
     * Prints one line per request - lore, portrait and the tracker readers - naming the connection,
     * the model and the API key each one resolved to.
     *
     * Off by default because it is noisy. It was previously
     * reachable only by typing SILLYNPC_DEBUG = true into DevTools, which is no use to
     * someone who does not already know it exists.
     */
    debugLogging: false,
    /**
     * Reply budget for lore generation.
     *
     * The default prompt asks for six sections; 500 tokens truncated that reliably.
     */
    loreMaxTokens: 1200,
    /**
     * The lore writer's instructions.
     *
     * Appearance first and in concrete terms, because this text is also what the portrait
     * generator reads. The old version asked for six sections of detail and got a wall of
     * prose that buried the visual description in the middle of it.
     *
     * Macros: {{name}}, {{facts}}, {{lore}}, {{context}}, {{world}}.
     */
    // What each generator has cost so far. Kept out of a System on purpose: a system is
    // a world and its rules, and rolling one back should not rewrite what you spent.
    usage: {},
    generationPrompt: [
        'Write a Lorebook entry for "{{name}}".',
        '',
        'Established facts - treat these as true and do not contradict them:',
        '{{facts}}',
        '',
        'Setting reference:',
        '{{world}}',
        '',
        'Existing entry:',
        '{{lore}}',
        '',
        'Recent story:',
        '{{context}}',
        '',
        'Cover these sections, in this order. Keep each one short.',
        '',
        '- Role: one plain sentence. Who this person is in ordinary terms. Not a title and not an epithet.',
        '- Wants: one sentence. Something concrete they are trying to get, keep or avoid.',
        '- Method: one or two sentences on how this person solve things.',
        '- Limits: one or two sentences. What this person cannot do, does not know, has no authority over, or would refuse to do. Required. Do not leave it vague.',
        '- Standing with the {{user}}: one or two sentences on how they actually treat {{user}} day to day, where they stand to it.',
        '- Ties: one sentence on anyone else who matters to them.',
        '- History: two or three sentences. Where they came from and what has happened to them recently.',
        '',
        'Rules:',
        '- Revise the existing entry rather than starting over. Keep what still holds, drop what the story has overtaken.',
        '- Weigh the whole history, not the most recent scene. A character who was frightened, angry or hurt in the last few messages is not permanently that way. ',
        '- Write what is generally true of them, not what was true five minutes ago.',
        '- Do NOT invent affiliations, factions, agendas, hidden links, secret knowledge or people they answer to.',
        '- Do NOT describe their age, their appearance, their personality or how they speak.',
        '- Do NOT list their spells, items, skills or numbers.',
        '- Invent nothing. If neither the facts nor the story supports a detail, leave it out.',
        '- An entry that is short because little has happened is correct.',
        '- Third person. No preamble and no closing remark.',
        '',
        'TAGS - read this carefully, it matters more than the rest:',
        '- Tags are not topic labels. They are lorebook ACTIVATION KEYS for SillyTavern. Any tag that is an ordinary word will load this entry into unrelated scenes.',
        "- Use ONLY: the character's given name, surname, full name, and nicknames actually used for them in the story.",
        '- NEVER use job titles.',
        '- NEVER use roles or types.',
        '- NEVER use place names.',
        '- NEVER use adjectives or states.',
        '- Do not wrap tags in square brackets.',
        '',
        'Reply in exactly this format:',
        'Tags: comma separated keywords',
        'Content: the entry',
    ].join('\n'),
    imgGenContextMessages: 10,
    /** Folder name under user/images/ for generated portraits. */
    imageSaveRoute: 'sillynpc',
    /** Picture content key to the file already written for it, so one picture is saved once. */
    imageHashes: {},
    /**
     * Where portraits come from.
     * 'sd'     - SillyTavern's /sd command (Stable Diffusion extension, any source).
     * 'gemini' - a Google Gemini image model, called directly through the Chat
     *            Completion backend. Use this when your Google account is entitled to
     *            the Gemini image models but not to Imagen, which the SD extension's
     *            Google source is limited to.
     * @type {'sd' | 'gemini'}
     */
    imageBackend: 'sd',
    /** Model used when imageBackend is 'gemini'. Must be one of GEMINI_IMAGE_MODELS. */
    geminiImageModel: 'gemini-2.5-flash-image',
    /**
     * Shape requested for generated portraits, a key of PORTRAIT_SHAPES.
     *
     * Governs both backends. Replaces geminiImageAspectRatio, which only ever reached the
     * Gemini path while the /sd path carried its own hardcoded pixels that disagreed with it.
     */
    portraitShape: DEFAULT_PORTRAIT_SHAPE,
    personaData: {},
    master_items: {},
    /** The template actually in use. Seeded from the backend default above. */
    imgGenPrompt: '',
    /**
     * Prepended when reference images are attached, and only then.
     *
     * The templates above are descriptions - "A portrait of X. Appearance: ..." - which
     * read as an instruction when they arrive alone. Attach an image and they stop being
     * one: the model sees a picture and a description of it and quite reasonably asks
     * what you would like changed, returning text and no image at all.
     *
     * So the reference has to come with a job. Editable because the wording that stops a
     * model answering conversationally is model-specific and worth tuning.
     */
    imgGenReferencePreamble: [
        '[Reference Image Directive]',
        'Use the attached image(s) strictly as a visual anchor for character identity. Maintain precise consistency with their facial anatomy, eye shape and color, hair color and style, skin tone, and permanent bodily features. ',
        '',
        'Apply the attire, pose, and lighting specified in the main description above. Do not copy any background elements, text, or visual artifacts from the reference image. ',
        '',
        'Generate the image now. Do not output text, descriptions, explanations, or commentary: return only the generated image.',
    ].join('\n'),
    imgGenNegativePrompt: 'speech bubbles, text, logo, watermark, username, signature, frames, panels, comic, multiple characters, crowd, busy background, character sheet, grid, reference sheet',
    /**
     * @type {{
     *   id: string,
     *   name: string,
     *   imageUrl: string,
     *   color: string,
     *   category: string,
     *   imageFit: '' | 'contain' | 'cover',
     *   aliases: { pattern: string, isRegex: boolean }[],
     *   lorebook: { world: string, uid: number } | null,
     * }[]}
     */
    characters: [],
    /**
     * The categories that exist, in the order they are shown.
     *
     * A register rather than something derived from the characters carrying a name. The
     * derived version could not be renamed - there was nothing to rename - and a category
     * ceased to exist the moment its last member left it, so one could not be made ahead
     * of the people going in it either.
     *
     * @type {string[]}
     */
    categories: [],
    /**
     * What a category used to be called, and what it is called now.
     *
     * A chat records which categories it is limited to, by name, in its own file - and
     * only the open one can be written to. Without this, renaming a category would leave
     * every other scoped chat asking for a name nobody carries, and its characters would
     * quietly drop out of it. Read by isCharacterInChat, so an old chat resolves itself
     * the next time it is opened.
     *
     * Kept one hop deep: renaming again rewrites whatever already pointed at the old name.
     *
     * @type {Record<string, string>}
     */
    categoryRenames: {},
    statusTracker: {
        enabled: false,
        showOnlyAtBottom: false,
        globalStats: [],
        npcStats: [],
        playerStats: [],
        collections: [],
        /**
         * How many undo steps to keep per chat. Was a hardcoded 2, then 10.
         *
         * Ten was already thin, and while scene presence was recording steps it was worse
         * than thin: ten of those went by in four seconds during a chat load and took the
         * only remaining copy of a story's stats with them. Presence no longer records, so
         * these are all real changes now - and reaching back a couple of dozen of them is
         * a handful of messages rather than a handful of seconds.
         */
        historyDepth: 25,
        /**
         * Who decides which characters are in the scene.
         * 'speakers' - derived from who actually appears in the message (deterministic)
         * 'ai'       - the model's characters array, the original behaviour
         */
        castMode: 'speakers',
        /** Messages a character may go unseen before leaving the scene. */
        castGraceMessages: 3,
        hudScale: 1.0,
    systemAutoSaveMinutes: 0,
    /**
     * How many checkpoints to keep per system.
     *
     * Each holds a full copy of the world and the configuration, so this is a real
     * cost in settings.json - a world with inline images can be hundreds of KB.
     */
    systemCheckpointsKept: 5,
        hud: {
            position: { x: null, y: null },
        },
        presets: {},
        /**
         * Structure only. Fields render from the field list, in the order the builder
         * shows them, so nothing here names one - a name typed into a template cannot
         * follow the field when it is renamed, and captioning a value in two places is
         * what made a tracker read HP while every other screen read Health.
         *
         * {{globals}}, {{player}} and {{fields}} say where each set goes. A template with none
         * still gets them, appended, which is what every template written before this
         * one will do.
         */
        template: `<div class="sillynpc-status-box">
    <div class="sillynpc-status-header">{{globals}}</div>
    <div class="sillynpc-status-divider"></div>
    <div class="sillynpc-status-player">{{player}}</div>
    <div class="sillynpc-status-characters">
        {{#characters}}
        <div class="sillynpc-status-char">👤 {{name}} — {{fields}}</div>
        {{/characters}}
    </div>
</div>`,
        sceneBindingStat: '',
    },
};

export function initSettings() {
    if (!extension_settings.sillynpc) {
        extension_settings.sillynpc = structuredClone(defaultSettings);
    }
    normalizeSettings(extension_settings.sillynpc);
}

/**
 * Is version a older than version b? Dotted numbers, missing parts count as zero.
 *
 * Anything unparsable answers false - "not older" - so a settings file with a version this
 * cannot read is left alone rather than migrated on a guess.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function versionBelow(a, b) {
    const parse = (v) => String(v ?? '').split('.').map(n => Number.parseInt(n, 10));
    const left = parse(a);
    const right = parse(b);
    if (left.some(Number.isNaN) || right.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i] ?? 0;
        const r = right[i] ?? 0;
        if (l !== r) return l < r;
    }
    return false;
}

/**
 * Were these settings last written before HUD and Tracker became two separate flags?
 *
 * 0.5.2 is where the split shipped, and it shipped the migration unguarded - so anyone who
 * has opened the extension since has already been through it. Running it again on them
 * would clear a HUD box they have ticked in the meantime, which is the bug this answers.
 *
 * settings.version still holds the version this file was last written under: normalizeSettings
 * stamps the current one at the end of its pass, well after this is read.
 *
 * @param {object} settings
 * @returns {boolean}
 */
function settingsPredateHudFlagSplit(settings) {
    return versionBelow(settings.version, '0.5.2');
}

/**
 * Fills in missing keys and runs every schema migration.
 *
 * This used to live inside initSettings() behind an "already on the current
 * version" early return, so settings arriving from an import were never
 * repaired: an older export whose characters lack an aliases array would then
 * throw in chat.js (char.aliases.filter) and kill all avatar injection.
 *
 * It is now a standalone pass, run unconditionally on startup and again after
 * every import.
 *
 * @param {object} settings The live extension_settings.sillynpc object.
 */
/**
 * Brings a list of stat definitions up to the current shape.
 *
 * Type, and the lower bound, arrived when meters were introduced. hint and maxLength
 * joined them later, for the opposite kind of field: a free-text one had nothing said
 * about it at all, so the reader was shown a name and a long previous value and carried on
 * writing it. Both default to blank, which is no hint and no limit - what every field
 * already had.
 *
 * 'bar' becomes 'number'. The type used to name the drawing rather than the content, which
 * is why a field could be "a meter" while holding a date and why switching one back to Text
 * left the HUD still drawing a meter. What it always meant was "this holds a quantity";
 * whether a meter is drawn is now read from the value, where the ceiling is.
 *
 * Exported and called from two places, because a schema arrives by two doors: the settings
 * on load, and a saved system preset on switch. A migration that only covers one of them
 * silently misses every system somebody saved before it.
 *
 * @param {object[]} list Mutated in place. Missing or non-array is a no-op.
 */
export function normaliseStatDefs(list) {
    if (!Array.isArray(list)) return;
    for (const stat of list) {
        if (!stat) continue;
        stat.type = (stat.type === 'number' || stat.type === 'bar') ? 'number' : 'text';
        if (stat.min === undefined) stat.min = '';
        if (typeof stat.hint !== 'string') stat.hint = '';
        if (stat.maxLength === undefined) stat.maxLength = '';
    }
}

export function normalizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const currentVersion = defaultSettings.version;

    // Renames have to run before the defaults loop below. That loop fills in every absent
    // key, so by the time it has finished, portraitShape always exists and there is no way
    // left to tell "the user never set this" from "the user chose the default".
    //
    // The old geminiImageAspectRatio only ever reached the Gemini path, while /sd carried
    // its own hardcoded pixels that disagreed with it; portraitShape governs both. Ratios
    // the old setting allowed but the new table does not list (3:2, 4:3, 16:9) have no /sd
    // pixel equivalent worth inventing, so they fall through to the default.
    if (settings.geminiImageAspectRatio !== undefined) {
        if (settings.portraitShape === undefined
            && Object.hasOwn(PORTRAIT_SHAPES, settings.geminiImageAspectRatio)) {
            settings.portraitShape = settings.geminiImageAspectRatio;
        }
        delete settings.geminiImageAspectRatio;
    }

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(value);
        }
    }

    // The instructions the reader is given are shown in the settings, not hidden behind a
    // button, so seed the box with the built-in text on first run. Empty still means the
    // built-in, which is what someone who clears the box is asking for; this only fills a
    // box that has never been touched.
    //
    // The cost is that a later version improving the built-in will not reach anyone who
    // has been seeded - Restore recommended is how they take the new text.
    // Same reason as the extraction instructions: the box shows what is actually sent
    // rather than sitting blank until someone presses Restore.
    if (!String(settings.dialogueFormatPrompt || '').trim()) {
        settings.dialogueFormatPrompt = DIALOGUE_FORMAT_PROMPT;
    }

    // Fork, once: a prompt seeded by upstream asks for the bold-colon layout, which this
    // fork no longer reads by default. Replaced a single time; after that it is yours.
    if (!settings.mimoMigrated) {
        settings.dialogueFormatPrompt = buildDialogueFormatPrompt(
            settings.speakerMarkerOpen || DEFAULT_MARKER_OPEN,
            settings.speakerMarkerClose || DEFAULT_MARKER_CLOSE);
        settings.mimoMigrated = 1;
    }
    // A prompt that still asks for the old bold-name-and-colon layout is replaced by the tag version while detection is
    // on its default (the tag), so a first run never shows, or sends, a layout nothing reads any more.
    if ((settings.speakerDetection ?? 'marker') === 'marker' && isLegacyDialoguePrompt(settings.dialogueFormatPrompt)) {
        settings.dialogueFormatPrompt = buildDialogueFormatPrompt(
            settings.speakerMarkerOpen || DEFAULT_MARKER_OPEN,
            settings.speakerMarkerClose || DEFAULT_MARKER_CLOSE);
    }

    if (settings.imageBackend !== 'gemini') settings.imageBackend = 'sd';
    if (!GEMINI_IMAGE_MODELS.includes(settings.geminiImageModel)) {
        settings.geminiImageModel = defaultSettings.geminiImageModel;
    }

    if (!Object.hasOwn(PORTRAIT_SHAPES, settings.portraitShape)) {
        settings.portraitShape = DEFAULT_PORTRAIT_SHAPE;
    }

    // The token and character limits are free-entry numbers now, with no slider to keep
    // them sane, so a blank or half-typed field can reach here as '' or NaN. Repair on
    // read rather than blocking entry, so the user can clear the box and retype.
    // Zero means something for one of these and nothing for the others: 0 recent messages
    // is the "Lore Only" image setting, but a 0-token reply budget or a 0-character excerpt
    // is just a broken request. Number('') is 0, so a cleared box lands here too and has to
    // be told apart from a deliberate zero.
    for (const key of ['loreCharBudget', 'loreMaxTokens']) {
        const value = Number(settings[key]);
        if (!Number.isFinite(value) || value <= 0) settings[key] = defaultSettings[key];
        else settings[key] = Math.floor(value);
    }
    {
        const value = Number(settings.imgGenContextMessages);
        if (!Number.isFinite(value) || value < 0 || String(settings.imgGenContextMessages).trim() === '') {
            settings.imgGenContextMessages = defaultSettings.imgGenContextMessages;
        } else {
            settings.imgGenContextMessages = Math.floor(value);
        }
    }

    if (typeof settings.popupWidth !== 'number' || settings.popupWidth < 20) settings.popupWidth = 80;
    if (typeof settings.popupHeight !== 'number' || settings.popupHeight < 20) settings.popupHeight = 80;

    if (settings.keywords) {
        delete settings.keywords;
        saveSettings();
    }
    
    // The save route is a folder name, and only ever was: the upload endpoint reduces it
    // to one segment under user/images/. Storing the raw text meant the value in the file,
    // the value in the box and the value actually used were three different strings for
    // as long as the setting lived - "images/sillynpc" sat there while sillynpc was
    // written. Cleaned once here, so they are one string from then on.
    //
    // No guard for an absent one: resolveImageFolder answers with the default, which is
    // what the defaults loop above would have filled in anyway.
    settings.imageSaveRoute = resolveImageFolder(settings.imageSaveRoute);

    // The fal.ai test engine was removed. Its key was pasted into these settings, so it is deleted from the saved
    // file rather than left behind, and the file is rewritten at once so the key does not wait for the next change.
    if ('falKey' in settings || 'falEndpoint' in settings || settings.ttsEngine === 'fal') {
        delete settings.falKey;
        delete settings.falEndpoint;
        if (settings.ttsEngine === 'fal') settings.ttsEngine = 'elevenlabs';
        saveSettings();
    }

    settings.combat = normalizeCombatPrefs(settings.combat);
    settings.combatTypes = normalizeTypeLibrary(settings.combatTypes);

    debugLog('Processing characters');
    if (!Array.isArray(settings.characters)) settings.characters = [];
    for (const char of settings.characters) {
        if (!Array.isArray(char.aliases)) char.aliases = [];
        // Repaired where it exists; never added to a character that has no combat data.
        if (char.combat !== undefined) char.combat = normalizeCombatBlock(char.combat);
        // Portraits predate the list. One rule covers both seeding it for a character
        // that never had one and adopting a portrait set outside it - and, because it
        // checks first, running twice does not duplicate.
        if (!Array.isArray(char.images)) char.images = [];
        if (char.imageUrl && !char.images.includes(char.imageUrl)) char.images.push(char.imageUrl);
        if (!('lorebook' in char)) char.lorebook = null;
        if (typeof char.color !== 'string') char.color = '';
        // Optional extras on top of the main colour. Empty means "use the main colour".
        for (const key of ['colorText', 'colorBorder', 'colorBg', 'colorText2']) {
            if (typeof char[key] !== 'string') char[key] = '';
        }
        if (typeof char.colorGradient !== 'boolean') char.colorGradient = false;
        // The gradient for the profile page (banner, name, labels, portrait frame). null means none.
        char.gradient = normalizeGradient(char.gradient) || legacyGradient(char);
        // The old two-colour switch has become the gradient above; it is turned off so that removing the gradient later
        // is not undone by reading the old switch again.
        char.colorGradient = false;
        if (typeof char.category !== 'string') char.category = '';
        if (typeof char.imageFit !== 'string') char.imageFit = '';
        if (!char.statusOverrides || typeof char.statusOverrides !== 'object') char.statusOverrides = {};
        // The profile fields (age, appearance, personality, warmth, speech) are gone - the
        // linked lorebook entry is who somebody is. Any 'profile' / 'aiProfileFields' an old
        // save still carries is left in place, unread, rather than deleted.
        // Fork: the picture prompt for this character, and what to keep out of it.
        if (typeof char.imagePrompt !== 'string') char.imagePrompt = '';
        if (typeof char.imageNegative !== 'string') char.imageNegative = '';
        if (typeof char.ttsVoice !== 'string') char.ttsVoice = '';
    }

    // The register, seeded from whoever is already carrying a category name. An existing
    // install opens with exactly the categories it had, in the order it showed them -
    // alphabetical - with nothing to set up. A name on a character that is missing from
    // the register is added rather than dropped, so a category cannot be lost to the two
    // falling out of step.
    if (!Array.isArray(settings.categories)) settings.categories = [];
    settings.categories = settings.categories.filter(c => typeof c === 'string' && c.trim());
    {
        const known = new Set(settings.categories);
        const strays = [...new Set(settings.characters
            .map(c => c.category)
            .filter(name => name && !known.has(name)))].sort();
        settings.categories.push(...strays);
    }
    if (!settings.categoryRenames || typeof settings.categoryRenames !== 'object'
        || Array.isArray(settings.categoryRenames)) {
        settings.categoryRenames = {};
    }

    // Cards used to be created with no accent colour and nothing ever filled one in, so
    // whether a speaker was coloured depended on having set it by hand. Existing cards are
    // given one now, skipping every shade already spoken for so nobody shares.
    {
        const taken = new Set(settings.characters
            .map(c => String(c.color || '').trim().toLowerCase()).filter(Boolean));
        for (const char of settings.characters) {
            if (String(char.color || '').trim()) continue;
            let start = 0;
            for (const ch of String(char.name || '')) {
                start = (start * 31 + ch.codePointAt(0)) % SPEAKER_PALETTE.length;
            }
            let chosen = SPEAKER_PALETTE[start];
            for (let i = 0; i < SPEAKER_PALETTE.length; i++) {
                const candidate = SPEAKER_PALETTE[(start + i) % SPEAKER_PALETTE.length];
                if (!taken.has(candidate.toLowerCase())) { chosen = candidate; break; }
            }
            char.color = chosen;
            taken.add(chosen.toLowerCase());
        }
    }

    // The fallback portrait was one picture; it is a pool now. Migrated rather than
    // dropped, and checked first so running twice does not add it again.
    //
    // Whatever it was stays as it was, data URI and all: turning one into a file on disk
    // needs a write, and this pass cannot wait for one. repairDefaultImages does that
    // afterwards.
    if (!Array.isArray(settings.defaultImages)) settings.defaultImages = [];
    if (typeof settings.defaultImage === 'string' && settings.defaultImage) {
        if (!settings.defaultImages.some(entry => entry?.src === settings.defaultImage)) {
            settings.defaultImages.unshift({ src: settings.defaultImage, tags: [] });
        }
        delete settings.defaultImage;
    }
    settings.defaultImages = settings.defaultImages
        .filter(entry => entry && typeof entry.src === 'string' && entry.src)
        .map(entry => ({
            src: entry.src,
            tags: (Array.isArray(entry.tags) ? entry.tags : [])
                .map(tag => String(tag).trim()).filter(Boolean),
        }));


    if (typeof settings.speakerIgnoreList !== 'string') settings.speakerIgnoreList = '';

    // A new default only reaches new installs, and the reason for raising this was an
    // existing chat that could not reach far enough back. Exactly 10 was the old shipped
    // value rather than a number anyone chose, so it moves up; anything else is left as
    // set.
    if (settings.statusTracker?.historyDepth === 10) settings.statusTracker.historyDepth = 25;

    debugLog('Status tracker migration');

    // Schema Migration: Migrate old displayStyle to unified menuStyle
    if (settings.statusTracker && settings.statusTracker.displayStyle) {
        const legacyThemeMap = {
            'modern': 'modern-dark',
            'minimal': 'default',
            'compact': 'default'
        };
        let style = settings.statusTracker.displayStyle;
        if (legacyThemeMap[style]) {
            style = legacyThemeMap[style];
        }
        if (settings.menuStyle === 'default' && style !== 'default') {
            settings.menuStyle = style;
        }
        delete settings.statusTracker.displayStyle;
        saveSettings();
    }

    // One look: the dark Worldkit frame. The theme chooser is gone, so whatever an older
    // save chose is put back to it.
    settings.menuStyle = 'default';

    if (!settings.statusTracker) {
        settings.statusTracker = structuredClone(defaultSettings.statusTracker);
    } else {
        // Ensure all default status tracker settings exist
        for (const [key, value] of Object.entries(defaultSettings.statusTracker)) {
            if (settings.statusTracker[key] === undefined) {
                settings.statusTracker[key] = structuredClone(value);
            }
        }
        
        for (const listName of ['globalStats', 'npcStats', 'playerStats']) {
            normaliseStatDefs(settings.statusTracker[listName]);
        }

        // The same field a stat has had all along, on a collection. A stat could say how it
        // should be written and a collection could not say what it holds - so "pictures"
        // reached the reader as the bare word, and the prompt had nothing to offer but
        // guidance about inventories. Blank until somebody writes one.
        for (const col of settings.statusTracker.collections || []) {
            if (col && typeof col.hint !== 'string') col.hint = '';
        }

        // Migrate stats to have visible property
        if (Array.isArray(settings.statusTracker.globalStats)) {
            for (const stat of settings.statusTracker.globalStats) {
                if (stat && stat.visible === undefined) stat.visible = true;
            }
        }
        
        // Phase 1 Migration: characterStats -> npcStats
        if (settings.statusTracker.characterStats && !settings.statusTracker.npcStats) {
            settings.statusTracker.npcStats = settings.statusTracker.characterStats;
            delete settings.statusTracker.characterStats;
        }

        if (Array.isArray(settings.statusTracker.npcStats)) {
            for (const stat of settings.statusTracker.npcStats) {
                if (stat && stat.visible === undefined) stat.visible = true;
            }
        }
        
        // Initialize playerStats and collections if they don't exist
        if (!settings.statusTracker.playerStats) {
            settings.statusTracker.playerStats = structuredClone(defaultSettings.statusTracker.playerStats);
        } else {
            // Ensure all player stats have format and maxStatValue
            for (const stat of settings.statusTracker.playerStats) {
                if (stat.format === undefined) stat.format = '{{value}}';
                if (stat.maxStatValue === undefined) stat.maxStatValue = '';
            }

            /* The two flags used to be one decision: the HUD drew a stat only when it was
               Primary AND visible, and visible did nothing at all on a stat that was not
               Primary. They are separate places now - HUD and Tracker - and the HUD no
               longer consults visible.

               So a stat that was Primary with visible off, which appeared nowhere, would
               start appearing on the HUD. Clearing Primary keeps it where it was.

               Once, and only for settings that predate the split. Everything else in this
               pass is idempotent by shape - it turns a string into an object, or fills a
               key that is absent - so running it on every load costs nothing. This one is
               not: Primary with Tracker off is a perfectly ordinary choice afterwards, and
               re-running turned it into a checkbox that would not stay ticked. Ticking HUD
               on a stat whose Tracker was off survived until the next reload, then cleared
               itself, which shipped in 0.5.2.

               The version stamp at the end of this pass is what makes it once: after any
               normalisation the stored version is the current one, so this never matches
               again. A separate "already done" marker was tried alongside it and removed -
               it could not fire in any case the version gate did not already cover, and a
               guard that cannot fail is a guard nothing tests. */
            if (settingsPredateHudFlagSplit(settings)) {
                for (const stat of settings.statusTracker.playerStats) {
                    if (stat.isPrimary && stat.visible === false) stat.isPrimary = false;
                }
            }
        }
        if (!settings.statusTracker.collections) {
            settings.statusTracker.collections = structuredClone(defaultSettings.statusTracker.collections);
        } else {
            // Migrate collections fields from strings to objects
            for (const col of settings.statusTracker.collections) {
                if (Array.isArray(col.fields) && col.fields.length > 0 && typeof col.fields[0] === 'string') {
                    debugLog(`Migrating collection "${col.id}" fields to object format.`);
                    col.fields = col.fields.map(fieldName => ({
                        name: fieldName,
                        type: fieldName === 'quantity' ? 'number' : 'text',
                        label: fieldName.charAt(0).toUpperCase() + fieldName.slice(1),
                        isMultiline: fieldName === 'description',
                        isPrimary: fieldName === 'name',
                        defaultValue: fieldName === 'quantity' ? '1' : ''
                    }));
                }
            }
        }
        if (!settings.statusTracker.hud) {
            settings.statusTracker.hud = structuredClone(defaultSettings.statusTracker.hud);
        }
    }

    debugLog('Presets migration');
    // Phase 5 Migration: Old presets to System Profiles
    if (settings.statusTracker.presets && typeof settings.statusTracker.presets === 'object') {
        const legacyThemeMap = {
            'modern': 'modern-dark',
            'minimal': 'default',
            'compact': 'default'
        };
        for (const [name, preset] of Object.entries(settings.statusTracker.presets)) {
            if (!preset) continue; // Skip null presets
            // If it doesn't have a 'metadata' or 'config' field, it's an old preset
            if (!preset.config || !preset.metadata) {
                debugLog(`Migrating legacy preset "${name}" to System Profile format.`);
                const profile = {
                    version: '2.0.0',
                    metadata: {
                        name: name,
                        description: 'Migrated from legacy preset.',
                        author: 'System'
                    },
                    config: {
                        globalStats: preset.globalStats || [],
                        npcStats: preset.npcStats || preset.characterStats || [],
                        playerStats: preset.playerStats || [],
                        collections: preset.collections || [],
                        systemRules: settings.statusTracker.systemRules,
                        displayStyle: settings.statusTracker.displayStyle,
                        template: settings.statusTracker.template,
                        customCSS: settings.statusTracker.customCSS,
                        sceneBindingStat: settings.statusTracker.sceneBindingStat,
                        hudEnabled: settings.statusTracker.hudEnabled,
                        hudPosition: settings.statusTracker.hudPosition,
                        hudScale: settings.statusTracker.hudScale
                    }
                };
                settings.statusTracker.presets[name] = profile;
            }
            const migratedPreset = settings.statusTracker.presets[name];
            if (migratedPreset && migratedPreset.config && migratedPreset.config.displayStyle) {
                if (legacyThemeMap[migratedPreset.config.displayStyle]) {
                    migratedPreset.config.displayStyle = legacyThemeMap[migratedPreset.config.displayStyle];
                }
            }
        }
    }

    // The Threads settings used to live inside statusTracker. They are their own settings now; the old values are
    // copied over once and the old keys left where they are.
    if (settings.statusTracker && !settings.threadsMoved) {
        for (const key of ['threadsEnabled', 'threadsInjectedMax', 'threadsOpenMax', 'threadsClosedKeep', 'threadsHalfLife']) {
            if (settings.statusTracker[key] !== undefined) settings[key] = settings.statusTracker[key];
        }
        settings.threadsMoved = true;
    }

    // The ban scan used the tracker's extraction connection; it has its own now. A connection somebody chose for the
    // tracker is copied over once so the scan keeps running where it did.
    if (!settings.banScanMoved) {
        if (!settings.banScanProfileId && settings.statusTracker?.extractionProfileId) {
            settings.banScanProfileId = settings.statusTracker.extractionProfileId;
        }
        settings.banScanMoved = true;
    }

    // The original SillyNPC default tracker (stat extraction on every message, the status box in the chat, its
    // prompt injection) is switched off for good: it has no settings page any more. Its saved data is left alone.
    // Who is in the scene is still kept by speaker detection (castMode), which this switch does not touch.
    if (settings.statusTracker) settings.statusTracker.enabled = false;

    // Settings of the old tracker that nothing reads any more (its HUD, review rules, scan limits, clock and
    // extraction prompt). Dropped from what is saved so they stop travelling with every settings file; the worlds
    // saved in presets keep whatever they hold.
    if (settings.statusTracker) {
        for (const key of OBSOLETE_TRACKER_KEYS) delete settings.statusTracker[key];
        delete settings.statusTracker.hudMeterStyle;
    }

    if (!settings.personaData) {
        settings.personaData = {};
    }
    if (!settings.master_items) {
        settings.master_items = {};
    } else {
        // Cleanup hardcoded "New Item X" from Master Database
        for (const colId in settings.master_items) {
            const items = settings.master_items[colId];
            if (!items) continue;
            for (const itemName in items) {
                if (/^new item \d+$/i.test(itemName)) {
                    debugLog('Removing hardcoded item from Master DB:', itemName);
                    delete items[itemName];
                }
            }
        }
    }
    settings.version = currentVersion;
    debugLog('initSettings completed');
}

/**
 * The portrait template to send.
 *
 * An empty stored template means "whatever suits my backend", so someone who never
 * customised it gets tags for Stable Diffusion and description for Gemini, and changing
 * backend changes the prompt with it. A customised one is always used as written.
 *
 * @param {'sd'|'gemini'} [backend] Defaults to the configured one.
 * @returns {string}
 */
export function resolveImagePrompt(backend) {
    const custom = String(getSettings().imgGenPrompt ?? '').trim();
    return custom || recommendedImagePrompt(backend);
}

/**
 * The suggested portrait template for a backend, ignoring anything customised.
 *
 * Separate from resolveImagePrompt on purpose: that one answers "what do I send", and
 * a customised template rightly wins there. This answers "what would you suggest", which
 * is what a Restore button needs - asking the other question hands someone back the very
 * text they were trying to replace.
 *
 * @param {'sd'|'gemini'} [backend] Defaults to the configured one.
 * @returns {string}
 */
export function recommendedImagePrompt(backend) {
    const which = (backend ?? getSettings().imageBackend) === 'gemini' ? 'gemini' : 'sd';
    return IMAGE_PROMPT_BY_BACKEND[which];
}

export function getSettings() {
    if (!extension_settings.sillynpc) {
        initSettings();
    }
    return extension_settings.sillynpc;
}

export function saveSettings() {
    saveSettingsDebounced();
}

/**
 * Returns a JSON string of all settings for export.
 */
export function exportSettingsData() {
    return JSON.stringify(getSettings(), null, 4);
}

/**
 * Imports settings from a JSON string.
 */
export function importSettingsData(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data.characters || !Array.isArray(data.characters)) {
        throw new Error('Invalid export file: missing characters array.');
    }
    
    // Merge, then repair. Imported files can be from any older version, so they
    // must go through the same migration pass as settings loaded at startup.
    Object.assign(getSettings(), data);
    normalizeSettings(getSettings());
    saveSettings();
    return true;
}

