// Pure helpers for the phone's "let characters see my photos" feature. No SillyTavern, no DOM.

export const MAX_VISION_IMAGES = 4;
export const VISION_SIDE = 1024;
export const VISION_QUALITY = 0.8;

/** The player's messages after the last character message (the part nobody has answered yet). */
export function unansweredTail(thread) {
    const list = Array.isArray(thread) ? thread : [];
    let start = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] && list[i].who === 'char') { start = i + 1; break; }
    }
    return list.slice(start).filter(m => m && m.who === 'user');
}

/**
 * Which stored pictures the model should look at: the newest `max` photos of the unanswered tail,
 * oldest first. Each pick names the key to try first (the larger copy when there is one), the
 * thumbnail key to fall back to, and the inline thumbnail of a message that never reached the store.
 */
export function pickVisionImages(thread, { max = MAX_VISION_IMAGES } = {}) {
    const limit = Math.max(0, Math.floor(Number(max)) || 0);
    const picks = [];
    for (const m of unansweredTail(thread)) {
        const key = typeof m.visKey === 'string' && m.visKey ? m.visKey : (typeof m.imgKey === 'string' && m.imgKey ? m.imgKey : '');
        const inline = typeof m.img === 'string' && m.img.startsWith('data:image/') ? m.img : '';
        if (!key && !inline) continue;
        picks.push({
            ts: m.ts,
            key,
            fallbackKey: key && m.imgKey && m.imgKey !== key ? m.imgKey : '',
            inline,
        });
    }
    return limit ? picks.slice(-limit) : [];
}

/** The user turn: plain text when there are no pictures, an OpenAI-style content array otherwise. */
export function buildVisionContent(text, imageUrls) {
    const urls = (Array.isArray(imageUrls) ? imageUrls : []).filter(u => typeof u === 'string' && u);
    if (!urls.length) return String(text ?? '');
    return [
        { type: 'text', text: String(text ?? '') },
        ...urls.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
}

/** Size after fitting the longest side into `side` (never enlarges). */
export function fitSize(width, height, side = VISION_SIDE) {
    const w = Number(width), h = Number(height);
    if (!(w > 0) || !(h > 0)) return { w: 1, h: 1 };
    const k = Math.min(1, side / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Keys of the extra (large) copies among messages that are leaving a thread. */
export function visionKeysOf(list) {
    const out = [];
    for (const m of list || []) if (m && typeof m.visKey === 'string' && m.visKey) out.push(m.visKey);
    return out;
}

/** A failed request is worth retrying without pictures unless the player cancelled or time ran out. */
export function shouldRetryWithoutImages(err, imageCount) {
    if (!(imageCount > 0)) return false;
    const name = err && err.name;
    return name !== 'AbortError' && name !== 'TimeoutError';
}
