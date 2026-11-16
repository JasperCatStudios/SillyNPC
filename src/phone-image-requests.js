/**
 * Picture requests in plain words (fork), for the Phone.
 *
 * Reads what the player typed ("send me a selfie in that dress", "draw me a cartoon cat") and works
 * out whether it asks for a picture, who the picture is of, and what it should show. The Phone still
 * lets the character answer with its own photo message; this only decides what that photo is drawn as.
 *
 * Three kinds of picture:
 *   character  the contact is the subject (a selfie, a photo of them in something). Their look is used.
 *   creative   the contact is only the artist ("draw me a cartoon cat"). Their look is NOT used.
 *   object     a photo of something that is not them (a place or thing from the chat). Their look is NOT used.
 *
 * Adapted from the request handling of EchoText by mattjaybe (MIT, see LICENSE-MIT-EchoText),
 * rewritten as plain functions with no DOM and no SillyTavern imports, so they are tested in node.
 *
 * A chat history here is a list of { who: 'user' | 'char', text }, oldest first.
 */

const norm = (s) => String(s ?? '').trim().toLowerCase();
const MEDIA = 'selfie|photo|picture|image|drawing|portrait|art|comic|sketch|pic|snapshot|hentai|cg|render|illustration|artwork';

const AFFIRMATIVE = [
    /^(yes|yeah|yep|yup|sure|definitely|absolutely|ok|okay|please do|go ahead|show me|i'?d love to|do it|send it|of course|alright|sounds good|yes please)\b/i,
    /\b(show me|please do|go ahead|send it|i want to see|let me see|yes please|send that|i'd love that|go on then|do it|please send)\b/i,
];
const OFFER_VERB = [
    /\b(want to see|wanna see|should i send|should i show|can i send|let me send|i can send|i could send|care to see|i'?ll send|want me to send|let me show|i'?ll show|here'?s a|here is a|i'?ve got a|i have a)\b/i,
];
const OFFER_MEDIA = [/\b(photo|picture|selfie|image|drawing|sketch|portrait|pic|snapshot|snap|shot)\b/i];

/* Ordered most specific first. Every one needs a request verb AND a picture noun (or strong visual
   context), so "show me how" never fires. */
const DIRECT = [
    new RegExp(`\\b(send me|show me|can you send|could you send|let me see|i'?d love to see|share)\\b.{0,80}\\b(${MEDIA})\\b`, 'i'),
    /\bsend (a |me a |some )?(selfie|photo|pic|picture|snap|image|hentai|cg|render|comic|illustration|artwork|drawing|sketch)\b/i,
    /\b(can|could)\s+(you|i)\s+(show|see|get|have)\b.{0,30}\b(selfie|photo|pic|picture|snap|image|drawing|sketch|hentai|cg|render|comic|illustration|artwork)\b/i,
    /\btake (a |me a )?(selfie|photo|pic|picture|snap)\b/i,
    /\bsnap (a |me a )?(photo|pic|picture|selfie|shot)\b/i,
    /\b(draw|sketch|paint|illustrate)\s+(me\s+)?(a\s+|some\s+)?(picture|photo|image|drawing|sketch|portrait|comic|artwork|illustration|hentai|cg|render)\b/i,
    /\b(draw|sketch|paint|illustrate)\s+me(?!\s+in(to)?\b)/i,
    /\b(draw|sketch|paint|illustrate)\s+(yourself|us|something)\b/i,
    /\b(make|create|generate)\s+(me\s+)?(a\s+|some\s+)?(photo|pic|picture|image|drawing|sketch|portrait|artwork|illustration|selfie|hentai|cg|render|comic)\b/i,
    /\bshow me\b.{0,50}\b(you|your)\b.{0,40}\b(wearing|dressed|outfit|in a|looking|with your)\b/i,
    /\bshow me (what |how )you (look|appear)\b/i,
    /\bwhat do you look like\b/i,
    /\bi want (a |some |to see a |to see some )?(photo|pic|picture|selfie|image|hentai|cg|render|illustration|artwork|drawing|sketch|comic) of you\b/i,
    /\bi'?d (love|like) to see\b.{0,50}\b(you|your|a photo|a pic|a picture|a selfie|a drawing|some hentai|a cg|a render|an illustration|an artwork|a comic|a sketch)\b/i,
    /\bi want to see (you|what you)\b/i,
    /\bgot any (photos?|pics?|pictures?|selfies?|hentai|cgs?|renders?|illustrations?|artworks?|comics?|sketches?|drawings?)\b/i,
    /\bany (photos?|pics?|pictures?|selfies?|hentai|cgs?|renders?|illustrations?|artworks?|comics?|sketches?|drawings?) of you\b/i,
    /\b(snap|shot|pic|photo|picture|hentai|cg|render|illustration|artwork|comic|drawing|sketch)\s+of\s+(you|yourself)\b/i,
    /\b(capture|photograph)\s+(yourself|a photo|a pic|a moment)\b/i,
];

/**
 * Does this message ask for a picture?
 * @param {string} text What the player typed.
 * @param {{ who: string, text: string }[]} history The thread so far (the newest message may be the one being tested).
 * @param {{ lookback?: number }} [opts] How many of the contact's last messages may hold an offer.
 * @returns {{ triggered: boolean, type: 'none'|'direct_request'|'offer_response' }}
 */
export function detectImageRequest(text, history = [], opts = {}) {
    const t = norm(text);
    if (!t) return { triggered: false, type: 'none' };
    const lookback = Math.max(1, Number(opts.lookback) || 3);
    const recent = (Array.isArray(history) ? history : []).filter(m => m && m.who === 'char').slice(-lookback);
    const offered = recent.some(m => {
        const s = norm(m.text);
        return OFFER_VERB.some(p => p.test(s)) && OFFER_MEDIA.some(p => p.test(s));
    });
    if (offered && AFFIRMATIVE.some(p => p.test(t))) return { triggered: true, type: 'offer_response' };
    if (DIRECT.some(p => p.test(t))) return { triggered: true, type: 'direct_request' };
    return { triggered: false, type: 'none' };
}

/* ------------------------------------------------------------------ directives */

/**
 * What the player asked the picture to show, with the request wording cut away.
 * "Hey Ava, send me a selfie wearing a red dress" -> "wearing a red dress". '' when nothing is left.
 */
export function extractUserVisualDirectives(userMessage, charName = '') {
    if (!userMessage) return '';
    let text = String(userMessage).trim();
    text = text.replace(/^(can you|could you|please|will you|would you)\s+/i, '');
    if (charName) {
        const name = String(charName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`^(?:hey|hi|hello)\\s+${name}\\s*[,!.\\s]+`, 'i'), '').trim();
        text = text.replace(new RegExp(`^${name}\\s*[,!]\\s*`, 'i'), '').trim();
    }
    text = text.replace(/^(?:hey|hi|hello)\s+\w+\s*[,!\s]+/i, '').trim();

    text = text
        .replace(/^(send me|show me|send|show|share)\s+(me\s+)?(an?\s+)?((?:[\w-]+\s+){0,3})(selfie|photo|picture|pic|image|drawing|sketch|portrait|snap|snapshot|comic|artwork|illustration|hentai|cg|render)\s*(photo|pic|of me|for me|of\s*)?\s*[,.]?\s*/i, '$4')
        .replace(/^(take|snap)\s+(me\s+)?(an?\s+)?((?:[\w-]+\s+){0,3})(selfie|photo|picture|pic|snap|shot)\s*(of\s*)?\s*[,.]?\s*/i, '$4')
        .replace(/^(draw|sketch|paint|illustrate)\s+(me\s+)?(an?\s+)?((?:[\w-]+\s+){0,3})(picture|photo|image|drawing|sketch|portrait|comic|artwork|illustration|hentai|cg|render)\s*(of\s*)?/i, '$4')
        .replace(/^(draw|sketch|paint|illustrate)\s+(me|us|yourself)\s*[,.]?\s*/i, '')
        .replace(/^(make|create|generate)\s+(me\s+)?(an?\s+)?((?:[\w-]+\s+){0,3})(photo|pic|picture|image|drawing|sketch|portrait|artwork|illustration|selfie|comic|hentai|cg|render)\s*(of\s*)?/i, '$4')
        .replace(/^(got any|any)\s+(photos?|pics?|pictures?|selfies?)\s*(of you)?\s*[?]?\s*/i, '')
        .replace(/^i'?d (love|like) to see\s+(you\s+|a photo\s+|a pic\s+|a picture\s+|a selfie\s+)?/i, '')
        .replace(/^i want to see\s+(you\s+|what you\s+)?/i, '')
        .replace(/^(capture|photograph)\s+(yourself|a photo|a pic)\s*(of\s*)?/i, '')
        .trim();
    text = text.replace(/^[?!,.\s]+/, '').trim();

    const connectors = (s) => s
        .replace(/^(the one where|where you|of you|with you|you'?re|you are|that shows?|showing|of yourself|yourself)\s+/i, '')
        .replace(/^you\s+(sleeping|wearing|sitting|standing|lying|lying down|laying|dancing|reading|laughing|smiling|working|playing|eating|drinking|relaxing|posing|looking)\b\s*/i, '$1 ')
        .trim();
    text = connectors(text);

    if (text.length < 8) {
        const q = userMessage.indexOf('?');
        if (q !== -1 && q < userMessage.length - 10) text = connectors(userMessage.slice(q + 1).trim());
        else return '';
    }
    text = text.replace(/^[?!,.\s]+/, '').trim().replace(/[?!.]+$/, '').trim();

    if (/^(photos?|pics?|pictures?|selfies?|images?|snapshots?)$/i.test(text)) return '';
    const original = userMessage.trim().replace(/[?!.,\s]+$/, '').toLowerCase();
    if (text.length < 8 || text.toLowerCase() === original) return '';

    // "what you're wearing" points at the chat; it is resolved from history, never used as a tag.
    if (/^what (you'?re|you are|you'?ve|you have) (wearing|got on|on|dressed in)\b/i.test(text)) return '';
    if (/^what you look like\b/i.test(text)) return '';
    if (/^(your|the) (current |today'?s? )?(outfit|attire|look|clothes|clothing|style|ensemble)\s*[?!.]?\s*$/i.test(text)) return '';
    return text;
}

/** A shot type or setting read from the message ("selfie", "at the beach", "at a café"), or ''. */
export function inferSceneHint(userMessage) {
    const m = norm(userMessage);
    const rules = [
        [/\b(selfie|front[-\s]?facing|front cam)\b/, 'selfie'],
        [/\b(full[\s-]?body|whole body|head to toe)\b/, 'full body shot'],
        [/\b(close.?up|close shot|portrait shot)\b/, 'close-up portrait'],
        [/\b(beach|pool|water|ocean|sea|lake|swimming)\b/, 'at the beach'],
        [/\b(park|garden|nature|forest|woods|trail|hiking)\b/, 'outdoors in nature'],
        [/\b(outside|outdoors|street|city|urban|rooftop|balcony)\b/, 'outdoors'],
        [/\b(sunset|sunrise|golden hour|dusk|dawn)\b/, 'golden hour outdoors'],
        [/\b(snow|winter|cold|snowy)\b/, 'snowy outdoors'],
        [/\b(mirror|bathroom|getting ready)\b/, 'bathroom mirror selfie'],
        [/\b(bedroom|bed|sleeping|waking up|cozy|tucked in)\b/, 'in the bedroom'],
        [/\b(couch|sofa|living room|relaxing|lounging)\b/, 'relaxing at home'],
        [/\b(kitchen|cooking|baking|making food)\b/, 'in the kitchen'],
        [/\b(home|house|apartment|room)\b/, 'indoor candid'],
        [/\b(gym|workout|exercise|yoga|running|jogging|lifting)\b/, 'at the gym'],
        [/\b(coffee|café|cafe|latte|espresso)\b/, 'at a café'],
        [/\b(restaurant|eating|dining|brunch|lunch|dinner)\b/, 'at a restaurant'],
        [/\b(bar|club|party|night out|dancing|nightlife)\b/, 'at a party'],
        [/\b(office|work|desk|computer|meeting)\b/, 'at work'],
        [/\b(shop|shopping|mall|store|trying on)\b/, 'out shopping'],
        [/\b(concert|festival|music|show|performance)\b/, 'at a concert'],
        [/\b(sleeping|asleep|napping|resting)\b/, 'sleeping, peaceful'],
        [/\b(dancing|dance|swaying)\b/, 'dancing'],
        [/\b(reading|with a book|studying)\b/, 'reading'],
        [/\b(smiling|laughing|happy|grinning)\b/, 'smiling'],
        [/\b(photo|pic|picture)\b/, 'photo'],
    ];
    for (const [re, hint] of rules) if (re.test(m)) return hint;
    return '';
}

/** What a plain photo request gets when it names no art style; your own picture style replaces it. */
export const DEFAULT_STYLE_TAG = 'natural skin texture';

/** Quality and style tags for the kind of picture asked for. Plain photos get natural skin texture. */
export function detectStyleTags(userMessage) {
    const m = norm(userMessage);
    if (/\b(nsfw|hentai|ecchi|lewd)\b/.test(m)) return 'nsfw, hentai, explicit, highly detailed anime art, high quality';
    if (/\bcartoon\b/.test(m)) return 'cartoon style, vibrant colors, bold outlines, flat shading, animated, high quality';
    if (/\b(anime|manga)\b/.test(m)) return 'anime style, manga, cel shading, vibrant, highly detailed, high quality';
    if (/\bchibi\b/.test(m)) return 'chibi style, cute, rounded, colorful, high quality';
    if (/\bwatercolou?r\b/.test(m)) return 'watercolor painting, soft edges, flowing colors, artistic, high quality';
    if (/\boil[\s-]?paint/.test(m)) return 'oil painting, rich colors, textured brushwork, classical art, masterpiece';
    if (/\bpixel[\s-]?art\b/.test(m)) return 'pixel art, 8-bit, retro style, crisp pixels';
    if (/\bcomic[\s-]?(book)?\b/.test(m)) return 'comic book style, bold ink lines, vivid colors, dynamic composition, high quality';
    if (/\billustrat/.test(m)) return 'digital illustration, detailed, vibrant, artistic, high quality';
    if (/\bpainting?\b/.test(m)) return 'digital painting, detailed, artistic, high quality';
    if (/\bsketch\b/.test(m) && !/\bsketch\s+(me|yourself)\b/i.test(m)) return 'pencil sketch, detailed linework, graphite, artistic';
    if (/\b(realistic|photorealistic)\b/.test(m)) return 'photorealistic, highly detailed, masterpiece, best quality';
    return DEFAULT_STYLE_TAG;
}

/**
 * Is the contact the subject ('character') or only the artist ('creative')? 'object' is never
 * chosen here, only by the model's reading of a vague request (see parseLlmResolution).
 */
export function classifyImageRequest(userMessage, userDirectives = '') {
    const msg = norm(userMessage);
    const dir = norm(userDirectives);
    const SELF = [
        /\b(selfie|photo of you|pic of you|picture of you)\b/i,
        /\b(send|show|share)\s+(me\s+)?(a\s+)?(selfie|photo|pic|picture|snap)\b/i,
        /\btake\s+(me\s+)?(a\s+)?(selfie|photo|pic)\b/i,
        /\bshow me (what |how )you (look|appear)\b/i,
        /\bwhat do you look like\b/i,
        /\b(draw|sketch|paint|illustrate)\s+yourself\b/i,
    ];
    if (SELF.some(p => p.test(msg))) return 'character';
    if (dir) {
        if (/^(wearing|dressed|in a |in an |at the |at a |on the |on a |with your|with her|with his|sitting|standing|lying|holding|posing|smiling|looking|relaxing|working|dancing|reading)/.test(dir)) return 'character';
        if (/\bof (you|yourself)\b/i.test(dir)) return 'character';
    }
    if (!/\bof (you|yourself)\b/i.test(msg)) {
        const CREATIVE = [
            /\b(draw|sketch|paint|illustrate|create|generate|make|show|send|share)\s+(me\s+)?(an?\s+)?(?:[\w-]+\s+){0,3}(cartoon|comic|illustration|artwork|painting|sketch|drawing|watercolou?r|oil\s*paint|pixel\s*art|chibi|anime|portrait|picture|photo|image|pic|hentai|cg|render)\s+of\s+(?!you\b|yourself\b)/i,
            /\b(draw|sketch|paint|illustrate)\s+(me\s+)?(a|an)\s+(?!(picture|photo|image|selfie|drawing|sketch|portrait|me|yourself)\b)/i,
            /\b(generate|create|make)\s+(me\s+)?(an?\s+)?(?:[\w-]+\s+){0,3}(image|picture|illustration|artwork)\s+of\s+(?!you\b|yourself\b|me\b)/i,
            /\b(paint|draw|sketch|illustrate)\s+me\s+(an?\s+)?(?:[\w-]+\s+){0,3}(watercolou?r|oil\s*paint|cartoon|comic|sketch|illustration)\b/i,
        ];
        if (CREATIVE.some(p => p.test(msg))) return 'creative';
    }
    return 'character';
}

/** The subject of a creative request when the directive came out empty ("Sketch a dragon for me" -> "dragon"). */
export function extractCreativeSubject(userMessage) {
    let text = String(userMessage || '').trim();
    text = text.replace(/^(draw|sketch|paint|illustrate|create|generate|make)\s+(me\s+)?(a\s+|an\s+)?/i, '');
    for (let i = 0; i < 3; i++) text = text.replace(/[\s,?!.]+$/, '').replace(/(^|[\s,])(for\s+(me|us)|please)$/i, '');
    return text.replace(/[\s,?!.]+$/, '').trim();
}

/** Does the request point back at the chat ("wearing that", "what you're wearing") so the chat must be read? */
export function needsContextResolution(userMessage, charName = '') {
    if (!userMessage) return false;
    const msg = norm(userMessage);
    const raw = extractUserVisualDirectives(userMessage, charName);
    const EXPLICIT = [
        /\b(wearing|dressed in|in a|in an)\b.{4,}/i,
        /\bat (the|a)\b.{3,}/i,
        /\b(with|holding|sitting|standing|lying|posing|smiling|looking)\b.{4,}/i,
    ];
    if (raw && raw.length > 12 && EXPLICIT.some(p => p.test(raw))) return false;
    if (/\b(that|this|it|those|these)\b/i.test(msg) && /\b(show|send|photo|pic|picture|selfie|image|drawing|sketch)\b/i.test(msg)) return true;
    if (/\bwhat (you'?re|you are|you'?ve|you have) (wearing|got on|dressed in)\b/i.test(msg)) return true;
    if (/\bwhat you look like\b/i.test(msg)) return true;
    if (/\byour (current |today'?s? )?(outfit|attire|look|clothes|clothing|style|ensemble)\b/i.test(msg)) return true;
    if (/\bhow you (look|are dressed)\b/i.test(msg)) return true;
    const PLAIN = [
        /\b(selfie|front[-\s]?cam)\b/i,
        /\b(send|show|share)\s+(me\s+)?(an?\s+)?(selfie|photo|pic|picture|snap|image)\b/i,
        /\btake\s+(me\s+)?(an?\s+)?(selfie|photo|pic|snap)\b/i,
        /\bsnap\s+(me\s+)?(an?\s+)?(photo|pic|picture|selfie|shot)\b/i,
        /\b(photo|pic|picture|selfie|snap|image)\s+of\s+(you|yourself)\b/i,
        /\bgot any (photos?|pics?|pictures?|selfies?)\b/i,
        /\bany (photos?|pics?|pictures?|selfies?) of you\b/i,
    ];
    if (PLAIN.some(p => p.test(msg))) return false;
    return !raw || raw.length < 4;
}

const OUTFIT = ['wearing', 'dressed', 'adorned', 'clothed', 'clad', 'donning', 'sporting', 'dress', 'outfit', 'coat', 'jacket', 'skirt', 'top', 'shirt',
    'pants', 'jeans', 'gown', 'robe', 'suit', 'blouse', 'sweater', 'cardigan', 'heels', 'shoes', 'boots', 'sandals', 'stockings', 'tights',
    'silk', 'lace', 'velvet', 'sheer', 'satin', 'yellow', 'red', 'blue', 'green', 'black', 'white', 'pink', 'gold', 'cinched', 'waist', 'hem',
    'raincoat', 'sundress', 'royal', 'regal', 'noble', 'formal', 'elegant', 'attire', 'garment', 'cloak', 'cape', 'crown', 'tiara', 'veil', 'corset',
    'bodice', 'kimono', 'regalia', 'costume', 'uniform', 'ensemble', 'tunic', 'embroidered', 'jeweled', 'jewelled', 'sequin', 'beaded', 'tailored', 'fitted'];
const SCENE = ['color', 'colour', 'gradient', 'pattern', 'lavender', 'crimson', 'amber', 'teal', 'emerald', 'violet', 'purple', 'orange', 'silver', 'brown', 'grey', 'gray', 'pale',
    'glow', 'shimmer', 'sparkle', 'gleam', 'bright', 'vivid', 'light', 'shadow', 'dark', 'soft', 'flower', 'flowers', 'field', 'rain', 'sky', 'cloud', 'sunset',
    'sunrise', 'forest', 'ocean', 'mountain', 'snow', 'water', 'garden', 'room', 'floor', 'wall', 'window', 'door', 'table', 'chair', 'bed', 'beautiful', 'looks'];

/**
 * Turns "wearing that" / "what you're wearing" / an empty request into something concrete, from what the
 * contact said recently. Returns the directives unchanged when nothing in the chat helps.
 */
export function resolveContextualDirectives(userDirectives, userMessage, history = []) {
    const REF = [
        /\bwearing that\b/i, /\bin that\b/i, /\bwith that\b/i,
        /\bthat (dress|outfit|look|style|thing|fit|piece|top|skirt|coat|jacket|shirt|suit|gown|robe)\b/i,
        /\bthis (dress|outfit|look|style|thing|fit|piece|top|skirt|coat|jacket|shirt|suit|gown|robe)\b/i,
        /\bwearing it\b/i, /\bin it\b/i,
        /\bwhat (you'?re|you are) wearing\b/i, /\bwhat (you'?ve|you have) (got on|on)\b/i, /\bwhat you look like\b/i,
        /\byour (outfit|attire|look|clothes|clothing|style|ensemble) (today|right now|at the moment|currently)\b/i,
    ];
    const pointing = REF.some(p => p.test(userMessage || ''));
    const vague = !userDirectives || /^(that|this|it|those|these|them)$/i.test(String(userDirectives).trim());
    if (!pointing && !vague) return userDirectives;

    const recent = (Array.isArray(history) ? history : []).filter(m => m && m.who === 'char').slice(-6);
    const has = (text, words) => words.filter(w => text.includes(w)).length;
    let best;
    if (!pointing && vague) {
        const hit = [...recent].reverse().find(m => has(norm(m.text), OUTFIT) > 0);
        const pick = hit || recent[recent.length - 1];
        best = pick ? { text: String(pick.text || '') } : null;
    } else {
        best = recent.map((m, index) => ({ text: String(m.text || ''), hits: has(norm(m.text), OUTFIT), index }))
            .filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits || b.index - a.index)[0] || null;
    }
    if (!best) return userDirectives;

    const sentences = best.text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 8);
    const words = (!pointing && vague) ? [...OUTFIT, ...SCENE] : OUTFIT;
    const chosen = sentences.map(s => ({ s, hits: has(norm(s), words) })).filter(x => x.hits > 0)
        .sort((a, b) => b.hits - a.hits).slice(0, 2).map(x => x.s);
    if (!chosen.length) {
        if (!pointing && vague) {
            const longest = [...sentences].sort((a, b) => b.length - a.length).slice(0, 2);
            if (longest.length) return longest.join('. ');
        }
        return userDirectives;
    }
    const text = chosen.join('. ');
    if (!pointing && vague) return text;
    const subject = /^(i'?m\b|i'?ve\b|i \b|she'?s\b|she \b|he'?s\b|he \b|they'?re\b|they \b)/i.test(text);
    const verb = /^(wearing|dressed|adorned|clothed|clad|sporting|donning)\b/i.test(text);
    return subject || verb ? text : `wearing ${text}`;
}

/* ------------------------------------------------------------ model-assisted reading */

/**
 * The small question put to the text model when a request points back at the chat. The answer is
 * read by parseLlmResolution; any failure falls back to resolveContextualDirectives.
 * @returns {{ system: string, user: string }}
 */
export function llmResolveMessages(userMessage, history, charName, userName = 'User') {
    const recent = (Array.isArray(history) ? history : []).slice(-6)
        .map(m => `${m.who === 'user' ? userName : charName}: ${String(m.text || '').trim()}`).join('\n');
    const system = `You extract image prompt components from a user's image request and its conversational context.
Output ONLY a raw JSON object, no markdown, no explanation, no code fences.

Fields:
- "directives": Concrete visual description of what to show. If the user points at something from the conversation ("that", "what you're wearing", "the thing you described"), resolve it to the actual concrete description from the chat. Short: comma-separated tags or a brief phrase. Empty string if none.
- "scene": Shot type or setting only (for example "selfie", "full body shot", "at a café"). Empty string if none.
- "outfit", "expression", "background", "pose": the clothes, the facial expression, the setting behind and the body pose, when the request or the chat says them. Empty string for any that is not said.
- "mode": one of
  - "character": the picture features ${charName} (selfies, appearance, outfit photos).
  - "object": a photo of something that is NOT ${charName} (a place, a thing described in the chat).
  - "creative": a drawn, painted or illustrated work of art.

Examples:
{"directives":"royal blue regalia, gold embroidery, flowing cape","scene":"selfie","outfit":"royal blue regalia with gold embroidery and a flowing cape","expression":"","background":"","pose":"","mode":"character"}
{"directives":"rug with a gradient of lavender and pale green","scene":"photo","mode":"object"}
{"directives":"cartoon cat with a hat","scene":"","mode":"creative"}
{"directives":"","scene":"selfie","mode":"character"}`;
    const user = `Recent conversation:\n${recent}\n\nUser's image request: "${userMessage}"\n\nOutput JSON only.`;
    return { system, user };
}

/** The model's answer as { directives, scene, mode }, or null when it is not usable. */
export function parseLlmResolution(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const found = raw.match(/\{[\s\S]*?\}/);
    if (!found) return null;
    let parsed;
    try { parsed = JSON.parse(found[0]); } catch { return null; }
    if (!parsed || typeof parsed.directives !== 'string' || typeof parsed.mode !== 'string') return null;
    const mode = ['character', 'creative', 'object'].includes(parsed.mode) ? parsed.mode : 'character';
    const slot = (k) => String(parsed[k] || '').trim();
    return {
        directives: parsed.directives.trim(), scene: String(parsed.scene || '').trim(), mode,
        slots: { outfit: slot('outfit'), expression: slot('expression'), background: slot('background'), pose: slot('pose') },
    };
}

/* ---------------------------------------------------------------------- the pieces */

const CLOTHES = 'clothes|clothing|attire|dress|outfit|shirt|t-shirt|hoodie|suit|uniform|bikini|swimsuit|kimono|yukata|skirt|jacket|coat|sweater|pajamas|pyjamas|lingerie|armou?r|robe|gown|top|jeans|shorts|costume|cosplay|apron|towel|vest|cloak|cape|blouse|hat|scarf|gloves|boots|stockings|leggings|tank|bra|panties';
const MOODS = 'smil\\w*|smirk\\w*|laugh\\w*|grin\\w*|pout\\w*|blush\\w*|wink\\w*|frown\\w*|cry\\w*|sleepy|tired|shy|angry|surprised|serious|playful|flirty|sad|happy|calm|confident|smug|nervous|sultry|bashful|teasing|mischievous';
const SHOTS = /^(selfie|photo|pic|picture|full body shot|close-up portrait|smiling|sleeping, peaceful|dancing|reading)$/i;

/**
 * The pieces of a request a template can ask for by name: outfit, expression, background, pose.
 * Read by plain pattern matching, so a short natural request is enough; whatever is not said is left
 * empty and the template's own default for it is used.
 *
 * @returns {{ outfit: string, expression: string, background: string, pose: string }}
 */
export function extractSlots(userMessage) {
    const text = String(userMessage || '');
    const out = { outfit: '', expression: '', background: '', pose: '' };

    const wear = new RegExp(`\\b(?:wearing|dressed in|dressed as|decked out in|in (?:a|an|her|his|my|your|their|the|some) (?=[\\w\\s-]{0,30}\\b(?:${CLOTHES})\\b))([^,.;!?]*?)(?=\\s+(?:at|in the|on the|by|near|with a|while|and then|sitting|standing|lying)\\b|[,.;!?]|$)`, 'i').exec(text);
    if (wear) out.outfit = wear[1].trim();

    const seen = new Set();
    const moods = [];
    for (const m of text.matchAll(new RegExp(`\\b(${MOODS})\\b`, 'gi'))) {
        const k = m[1].toLowerCase();
        if (!seen.has(k)) { seen.add(k); moods.push(k); }
    }
    const withLook = /\bwith (?:a|an) ([\w\s-]{2,30}?) (?:look|expression|smile|smirk|grin)\b/i.exec(text);
    if (withLook && !seen.has(withLook[1].toLowerCase())) moods.push(withLook[1].toLowerCase());
    const NOUN = { smil: 'a smile', smir: 'a smirk', laug: 'a laugh', grin: 'a grin', pout: 'a pout', blus: 'a blush', wink: 'a wink', frow: 'a frown', cry: 'tears' };
    const said = moods.map((w) => NOUN[w.slice(0, 4)] || NOUN[w.slice(0, 3)] || (/\s/.test(w) ? w : `a ${w} expression`));
    out.expression = [...new Set(said)].join(' and ');

    // The words of an outfit ("your work clothes") are not a place, whatever they say.
    const rest = (wear ? text.replace(wear[0], ' ') : text)
        .replace(/(?:in |wearing )?(?:your |her |his |their |my |the )?(?:[\w-]+ )?(?:clothes|clothing|outfit|attire|uniform|gear)/gi, ' ');
    for (const m of rest.matchAll(/\b(?:at|in|on|by|near|inside|outside|against)\s+(?:the|a|an|my|her|his|their)?\s*([a-z][\w\s'-]{2,40}?)(?=\s+(?:wearing|while|with|and|looking|sitting|standing|until|since|for|because|but)\b|[,.;!?]|$)/gi)) {
        const place = m[1].trim();
        if (new RegExp(`\\b(${CLOTHES})\\b`, 'i').test(place) || SHOTS.test(place)) continue;
        out.background = place;
        break;
    }

    const pose = /\b(sitting|standing|lying(?: down)?|laying(?: down)?|leaning|kneeling|crouching|lounging|stretching|waving|posing|peace sign|hand on (?:her|his|their) hip|arms crossed|looking over (?:her|his|their) shoulder|on (?:her|his|their) (?:back|stomach|side))\b[^,.;!?]*?(?=\s+(?:wearing|at the|in the|with a|while)\b|[,.;!?]|$)/i.exec(text);
    if (pose) out.pose = pose[0].trim();
    return out;
}

/* --------------------------------------------------- time of day, outfits, where they are */

/** The six times of day a picture can be set in, each with its default lighting words (editable in Worldkit's Prompts tab). */
export const TIME_PERIODS = Object.freeze([
    { id: 'dawn', label: 'Dawn', from: 5, to: 8, text: 'soft pale dawn light, a hint of pink and gold at the horizon, quiet and cool' },
    { id: 'morning', label: 'Morning', from: 8, to: 11, text: 'bright fresh morning light, clear and gentle' },
    { id: 'midday', label: 'Midday', from: 11, to: 15, text: 'bright overhead daylight, crisp, with short sharp shadows' },
    { id: 'afternoon', label: 'Afternoon', from: 15, to: 18, text: 'warm slanting afternoon light, long soft shadows' },
    { id: 'evening', label: 'Evening', from: 18, to: 21, text: 'golden hour fading into dusk, a warm orange and violet glow, lamps beginning to light' },
    { id: 'night', label: 'Night', from: 21, to: 5, text: 'night, soft warm lamp light against cool dark shadows, dark windows' },
]);

/** Which time of day an hour (0 to 23) falls in. */
export function periodOfHour(hour) {
    const h = Number(hour);
    if (!Number.isFinite(h)) return 'afternoon';
    const x = ((Math.floor(h) % 24) + 24) % 24;
    for (const p of TIME_PERIODS) if (p.from < p.to ? (x >= p.from && x < p.to) : (x >= p.from || x < p.to)) return p.id;
    return 'night';
}

const OUTFIT_FILLER = new Set(['outfit', 'outfits', 'clothes', 'clothing', 'wear', 'attire', 'look', 'the', 'a', 'an', 'my', 'your', 'her', 'his', 'their', 'of', 'set']);
const wordsOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
const stem = (w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w);

/**
 * The saved outfit a message names ("show me a picture of you in your work clothes" -> "Work"), or null.
 * An outfit matches when every word of its name (leaving out filler like "outfit" and "clothes") is in the message.
 *
 * @param {string} text
 * @param {{ name: string, desc?: string }[]} outfits
 */
export function matchOutfit(text, outfits) {
    const said = new Set(wordsOf(text).map(stem));
    let best = null;
    let bestScore = 0;
    for (const o of Array.isArray(outfits) ? outfits : []) {
        const name = String(o?.name || '').trim();
        if (!name) continue;
        let tokens = wordsOf(name).filter(w => !OUTFIT_FILLER.has(w));
        if (!tokens.length) tokens = wordsOf(name);
        if (!tokens.length || !tokens.every(w => said.has(stem(w)))) continue;
        if (tokens.length > bestScore) { best = o; bestScore = tokens.length; }
    }
    return best;
}

/** Where they are, read from the story: a place named in the recent messages, else the scene header's place. */
export function inferBackground(history, place = '') {
    for (const m of [...(Array.isArray(history) ? history : [])].reverse().slice(0, 8)) {
        const bg = extractSlots(m?.text || '').background;
        if (bg) return bg;
    }
    return String(place || '').trim();
}

/* ------------------------------------------------------------------- the request */

/**
 * What a picture request is, kept on the photo message so the picture is drawn as asked even if it is
 * drawn later or again. Plain data, safe to save. Does NOT hold the contact's look: that is read when
 * the picture is drawn, so changing it on the gallery page takes effect on a redraw.
 *
 * @param {string} userMessage
 * @param {{ who: string, text: string }[]} history
 * @param {{ charName?: string, resolved?: { directives: string, scene: string, mode: string } | null }} [opts]
 *   resolved: the model's reading, when it was asked and answered.
 * @returns {{ mode: string, directives: string, scene: string, style: string, ask: string }}
 */
export function buildImageRequest(userMessage, history = [], opts = {}) {
    const req = buildBaseRequest(userMessage, history, opts);
    if (req.mode === 'character') {
        const named = matchOutfit(`${userMessage} ${req.directives}`, opts.outfits);
        if (named) { req.slots.outfitName = String(named.name); req.slots.outfit = ''; }
    }
    req.inferred = {
        background: req.slots.background ? '' : inferBackground(history, opts.place),
        period: periodOfHour(opts.hour ?? new Date().getHours()),
        weather: String(opts.weather || '').trim(),
    };
    return req;
}

function buildBaseRequest(userMessage, history = [], opts = {}) {
    const charName = opts.charName || '';
    const style = detectStyleTags(userMessage);
    const r = opts.resolved;
    if (r) {
        const mode = r.mode || 'character';
        const scene = r.scene || inferSceneHint(userMessage);
        let directives = r.directives || '';
        if (mode === 'creative' && !directives) directives = extractCreativeSubject(userMessage);
        const found = extractSlots(userMessage);
        const slots = {};
        for (const k of ['outfit', 'expression', 'background', 'pose']) slots[k] = (r.slots && r.slots[k]) || found[k] || '';
        return { mode, directives, scene, style, slots, ask: String(userMessage).slice(0, 300) };
    }
    const raw = extractUserVisualDirectives(userMessage, charName);
    const directives = resolveContextualDirectives(raw, userMessage, history);
    const mode = classifyImageRequest(userMessage, directives);
    return {
        mode,
        directives: mode === 'creative' ? (directives || extractCreativeSubject(userMessage)) : directives,
        scene: inferSceneHint(userMessage),
        style,
        slots: extractSlots(userMessage),
        ask: String(userMessage).slice(0, 300),
    };
}

/**
 * The words to draw, from a stored request. Character pictures are anchored on the contact's look;
 * creative and object pictures never mention them.
 *
 * @param {{ mode: string, directives: string, scene: string, style: string }} req
 * @param {{ charName: string, look?: string, extraStyle?: string }} ctx
 * @returns {{ mode: string, directives: string, sdPrompt: string, contextPrompt: string }}
 */
export function promptsForRequest(req, ctx) {
    const { charName = 'them', look = '', extraStyle = '' } = ctx || {};
    const mode = ['character', 'creative', 'object'].includes(req?.mode) ? req.mode : 'character';
    const directives = String(req?.directives || '').trim();
    const scene = String(req?.scene || '').trim();
    // The art style: one the request named ("cartoon"), else your own picture style, else the plain-photo default.
    const reqStyle = String(req?.style || '').trim();
    const named = reqStyle && reqStyle !== DEFAULT_STYLE_TAG ? reqStyle : '';
    const wanted = [named || String(ctx?.defaultStyle || '').trim(), String(extraStyle || '').trim()].filter(Boolean).join(', ');
    const style = wanted || reqStyle;
    // Only a picture of the contact has an outfit, a place behind them and a time of day.
    const sl = req?.slots || {};
    const isChar = mode === 'character';
    const saved = sl.outfitName ? (ctx?.outfits || []).find(o => o.name === sl.outfitName) : null;
    const outfit = !isChar ? '' : (saved ? String(saved.desc || '') : (String(sl.outfit || '') || String(ctx?.defaultOutfit || '')));
    const background = !isChar ? '' : (String(sl.background || '') || String(req?.inferred?.background || ''));
    const period = TIME_PERIODS.find(p => p.id === req?.inferred?.period);
    const timeText = !isChar || !period ? '' : [String(ctx?.timeTexts?.[period.id] || '').trim() || period.text, String(req?.inferred?.weather || '')].filter(Boolean).join(', ');
    // Your own wording for this kind (Worldkit's Prompts tab); empty means the built-in wording below.
    const own = String(ctx?.templates?.[mode] || '').trim();
    if (own) {
        const map = {
            NAME: charName, REQUEST: directives || scene, LOOK: look, SCENE: scene, STYLE: wanted,
            OUTFIT: outfit, EXPRESSION: String(sl.expression || ''),
            BACKGROUND: background, POSE: String(sl.pose || ''), TIME: timeText,
        };
        // {OUTFIT|their usual outfit}: what the request said, or the text after the bar when it said nothing.
        const text = own.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (x, k, dflt) => (map[k] !== undefined ? (map[k] || dflt || '') : x))
            .replace(/(\s*,){2,}/g, ',').replace(/,\s*([.!?])/g, '$1').replace(/^[\s,]+|[\s,]+$/g, '').replace(/[ \t]+/g, ' ').replace(/ ,/g, ',').trim();
        return { mode, directives, sdPrompt: text, contextPrompt: text };
    }
    let sd;
    let prose;
    if (mode === 'creative') {
        const subject = directives || scene || 'an artistic scene';
        sd = [subject, style];
        prose = [`Generate an image as requested:\n${subject}`, `Style: ${style}`,
            'Render faithfully and clearly. Do not add the character\'s face or appearance unless the subject calls for it.'];
    } else if (mode === 'object') {
        const subject = directives || scene || 'the described subject';
        sd = [subject, style];
        prose = [`Generate a photo of: ${subject}`, ...(scene && scene !== subject ? [`Shot type / setting: ${scene}`] : []),
            `Style: ${style}. Render clearly and faithfully. Do not include ${charName} unless they are part of the subject.`];
    } else {
        sd = [`photo of ${charName}`];
        if (directives) sd.push(directives);
        // A saved outfit, or the default when the request named none (a worn outfit the request spelled out is in its directives).
        const addOutfit = outfit && (saved || !sl.outfit);
        if (addOutfit) sd.push(`wearing ${outfit}`);
        if (look) sd.push(look);
        if (background) sd.push(background);
        if (timeText) sd.push(timeText);
        const shot = scene || (directives ? '' : 'selfie, candid');
        if (shot) sd.push(shot);
        sd.push(style);
        prose = [directives ? `Generate a photo of ${charName} as specifically requested:\n${directives}`
            : `Generate a photo of ${charName}, something they might personally send someone.`];
        if (look) prose.push(`Base appearance (do not override the request):\n${look}`);
        if (addOutfit) prose.push(`Outfit: ${outfit}`);
        if (background) prose.push(`Setting: ${background}`);
        if (timeText) prose.push(`Lighting and time of day: ${timeText}`);
        if (scene) prose.push(`Shot type / setting: ${scene}`);
        prose.push(directives ? `Render with style: ${style}. Fulfil the requested look precisely.`
            : 'Render as a candid, personal photo like a real image sent in a text message.');
    }
    return {
        mode,
        directives,
        sdPrompt: sd.filter(Boolean).join(', '),
        contextPrompt: prose.filter(Boolean).join('\n\n'),
    };
}
