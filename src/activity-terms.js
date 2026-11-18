/**
 * Activities wording (fork): the words the Activities module shows and sends, without the I/O.
 *
 * No role or exam word is written into the module's code. "Professor", "certification exam",
 * "seal" and the rest are terms read from the world preset's `terms` block, so a Bleach world can
 * say Captain, Lieutenant or Mentor and "Promotion trial" with no code change. A key the preset
 * does not set uses the neutral default below. See docs/ACTIVITIES-PLAN.md section 11.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const TERM_MAX_CHARS = 40;

/** The neutral defaults, one per key. A preset overrides any of them. */
export const DEFAULT_TERMS = Object.freeze({
    examiner: 'Examiner',
    examinerPlural: 'Examiners',
    exam: 'Exam',
    examVerb: 'Take the exam',
    passed: 'Passed',
    credential: 'Badge',
    credentialPlural: 'Badges',
    classWord: 'Class',
    changeClass: 'Change class',
    knowledge: 'Knowledge',
    studyPlace: 'the study room',
    tea: 'tea',
    guest: 'guest',
});

/** Tier names, lowest first. A preset may list as many as it has credentials. */
export const DEFAULT_CREDENTIAL_TIERS = Object.freeze(['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']);

export const EXAMINER_RULES = Object.freeze(['partner', 'tag', 'any-with-rank']);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, TERM_MAX_CHARS);

/**
 * A preset's terms, repaired: only known keys, trimmed and capped, an empty value dropped (so the
 * default shows). A plural that is missing is not invented here; term() derives it.
 */
export function normalizeTerms(raw) {
    const r = obj(raw);
    const out = {};
    for (const key of Object.keys(DEFAULT_TERMS)) {
        const v = text(r[key]);
        if (v) out[key] = v;
    }
    const tiers = (Array.isArray(r.credentialTiers) ? r.credentialTiers : []).map(text).filter(Boolean).slice(0, 12);
    if (tiers.length) out.credentialTiers = tiers;
    const rule = EXAMINER_RULES.includes(r.examinerRule) ? r.examinerRule : 'partner';
    out.examinerRule = rule;
    if (rule === 'tag') {
        const tag = text(r.examinerTag).toLowerCase();
        if (tag) out.examinerTag = tag;
    }
    return out;
}

/** Fills {name}-style placeholders from vars; one that has no value is left as written. */
function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, (whole, k) => (vars[k] === undefined || vars[k] === null ? whole : String(vars[k])));
}

/** The plural of a term that has no plural of its own: a plain "s". */
const pluralise = (s) => (/s$/i.test(s) ? s : `${s}s`);

/**
 * One term. `preset` is a world preset (or just its terms block); `key` is a DEFAULT_TERMS key.
 * Placeholders in the text ({examiner}, {exam}, {credential}, {classWord} and any in vars) are
 * filled from the other terms and then from vars. An unknown key returns ''.
 */
export function term(preset, key, vars = {}) {
    const t = normalizeTerms(preset?.terms ?? preset);
    let value = t[key];
    if (value === undefined) {
        if (key === 'examinerPlural' && t.examiner) value = pluralise(t.examiner);
        else if (key === 'credentialPlural' && t.credential) value = pluralise(t.credential);
        else value = DEFAULT_TERMS[key];
    }
    if (value === undefined) return '';
    const own = {
        examiner: t.examiner ?? DEFAULT_TERMS.examiner,
        exam: t.exam ?? DEFAULT_TERMS.exam,
        credential: t.credential ?? DEFAULT_TERMS.credential,
        classWord: t.classWord ?? DEFAULT_TERMS.classWord,
    };
    return fill(value, { ...own, ...vars });
}

/** A sentence template with placeholders filled from the preset's terms and vars. */
export function termText(preset, template, vars = {}) {
    const t = normalizeTerms(preset?.terms ?? preset);
    const own = {};
    for (const key of Object.keys(DEFAULT_TERMS)) own[key] = term(preset, key);
    own.examinerRule = t.examinerRule;
    return fill(template, { ...own, ...vars });
}

/** The credential tier names, lowest first. */
export function credentialTiers(preset) {
    const t = normalizeTerms(preset?.terms ?? preset);
    return [...(t.credentialTiers || DEFAULT_CREDENTIAL_TIERS)];
}

/**
 * Whether a card may examine under the preset's rule.
 * card: { tags?: string[], rank?: number } where rank is the card's rung index in the exam subject.
 * 'partner' always allows; 'tag' needs the preset's tag among the card's tags (case-insensitive);
 * 'any-with-rank' needs minRank (a rung index) reached.
 */
export function canExamine(preset, card, { minRank = 0 } = {}) {
    const t = normalizeTerms(preset?.terms ?? preset);
    if (t.examinerRule === 'partner') return true;
    if (t.examinerRule === 'tag') {
        if (!t.examinerTag) return false;
        return (Array.isArray(card?.tags) ? card.tags : []).some(x => String(x).trim().toLowerCase() === t.examinerTag);
    }
    return Number(card?.rank) >= minRank;
}
