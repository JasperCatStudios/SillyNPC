/**
 * Weather kind (fork, Scene module): free weather text from a scene header ("Drizzle", "Fog, 34 °F", "snow flurries")
 * as one of a few kinds, with an intensity. Later phases (weather effects, ambience) only need to know the kind.
 *
 * Kinds: blizzard, storm, rain, snow, wind, mist, cloudy, clear, none. Intensity: light, moderate, heavy.
 * Whole words only, so "rainbow" is not rain and "Snowden" is not snow. A word after "no" or "without" does not count
 * ("no rain"). The keyword table is Worldkit's own.
 *
 * Pure: no DOM, no SillyTavern imports. Tested in tests/weather-kind.test.mjs.
 */

export const WEATHER_KINDS = Object.freeze(['blizzard', 'storm', 'rain', 'snow', 'wind', 'mist', 'cloudy', 'clear', 'none']);
export const WEATHER_INTENSITIES = Object.freeze(['light', 'moderate', 'heavy']);

/* Checked in this order, so the more specific kind wins: "blizzard" before "snow", "thunderstorm" before "rain".
   A word may carry its own intensity ("drizzle" is light rain, "downpour" heavy rain). */
const TABLE = [
    ['blizzard', [['blizzard'], ['whiteout', 'heavy'], ['snowstorm'], ['snow storm']]],
    ['storm', [['thunderstorm'], ['thunderstorms'], ['thunder'], ['lightning'], ['storm'], ['storms'], ['stormy'],
        ['tempest'], ['hurricane', 'heavy'], ['typhoon', 'heavy'], ['tornado', 'heavy'], ['hail'], ['hailstorm']]],
    ['snow', [['snow'], ['snowing'], ['snowy'], ['snowfall'], ['snowflakes'], ['flurries', 'light'], ['flurry', 'light'],
        ['sleet'], ['frost', 'light'], ['icy', 'light']]],
    ['rain', [['rain'], ['rains'], ['raining'], ['rainy'], ['rainfall'], ['drizzle', 'light'], ['drizzling', 'light'],
        ['sprinkle', 'light'], ['sprinkling', 'light'], ['mizzle', 'light'], ['shower'], ['showers'],
        ['downpour', 'heavy'], ['pouring', 'heavy'], ['deluge', 'heavy'], ['torrential', 'heavy'], ['monsoon', 'heavy'],
        ['wet', 'light']]],
    ['mist', [['fog'], ['foggy'], ['mist'], ['misty'], ['haze', 'light'], ['hazy', 'light'], ['smog'], ['murk']]],
    ['wind', [['wind'], ['winds'], ['windy'], ['breeze', 'light'], ['breezy', 'light'], ['gust'], ['gusts'], ['gusty'],
        ['gale', 'heavy'], ['gales', 'heavy'], ['blustery'], ['squall', 'heavy']]],
    ['cloudy', [['overcast', 'heavy'], ['cloudy'], ['clouds'], ['cloud'], ['grey skies'], ['gray skies'], ['gloomy']]],
    ['clear', [['clear'], ['sunny'], ['sunshine'], ['sun'], ['fair'], ['cloudless'], ['bright'], ['starry'],
        ['starlit'], ['moonlit'], ['balmy'], ['warm'], ['hot'], ['dry'], ['calm']]],
];

const LIGHT = ['light', 'slight', 'gentle', 'soft', 'faint', 'thin', 'patchy', 'partly', 'scattered', 'occasional',
    'brief', 'mild', 'fine', 'little', 'few', 'passing'];
const HEAVY = ['heavy', 'hard', 'thick', 'dense', 'driving', 'violent', 'severe', 'fierce', 'strong', 'raging',
    'howling', 'pelting', 'lashing', 'freezing', 'bitter', 'biting', 'relentless', 'pounding'];
const NEGATORS = ['no', 'not', 'without', 'zero'];

/* The weather emoji the header puts in front of the text, for when there are no words. */
const EMOJI = [
    ['\u{1F32A}', 'storm', 'heavy'],      // tornado
    ['⛈', 'storm', 'moderate'],      // cloud with lightning and rain
    ['\u{1F329}', 'storm', 'moderate'],   // cloud with lightning
    ['⚡', 'storm', 'moderate'],      // high voltage
    ['\u{1F328}', 'snow', 'moderate'],    // cloud with snow
    ['❄', 'snow', 'moderate'],       // snowflake
    ['☃', 'snow', 'moderate'],       // snowman
    ['\u{1F326}', 'rain', 'light'],       // sun behind rain cloud
    ['\u{1F327}', 'rain', 'moderate'],    // cloud with rain
    ['☔', 'rain', 'moderate'],       // umbrella with rain
    ['\u{1F4A7}', 'rain', 'light'],       // droplet
    ['\u{1F32B}', 'mist', 'moderate'],    // fog
    ['\u{1F301}', 'mist', 'moderate'],    // foggy
    ['\u{1F32C}', 'wind', 'moderate'],    // wind face
    ['\u{1F4A8}', 'wind', 'moderate'],    // dashing away
    ['\u{1F325}', 'cloudy', 'moderate'],  // sun behind large cloud
    ['⛅', 'cloudy', 'light'],        // sun behind cloud
    ['\u{1F324}', 'clear', 'light'],      // sun behind small cloud
    ['☁', 'cloudy', 'moderate'],     // cloud
    ['☀', 'clear', 'moderate'],      // sun
    ['\u{1F31E}', 'clear', 'moderate'],   // sun with face
    ['\u{1F319}', 'clear', 'moderate'],   // crescent moon
    ['\u{1F315}', 'clear', 'moderate'],   // full moon
    ['⭐', 'clear', 'moderate'],      // star
];

const fold = (text) => String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The words of the text, as a padded string for whole-word lookups. */
function words(text) {
    return ` ${fold(text)} `;
}

/** Whether a keyword stands in the text as whole words and is not negated ("no rain"). */
function findWord(padded, key) {
    let from = 0;
    const needle = ` ${key} `;
    for (;;) {
        const at = padded.indexOf(needle, from);
        if (at < 0) return -1;
        const before = padded.slice(0, at).trim().split(' ').pop();
        if (!NEGATORS.includes(before)) return at;
        from = at + 1;
    }
}

/** The intensity the modifiers in the text give, or '' when none. A heavy word wins over a light one. */
function modifierIntensity(padded) {
    if (HEAVY.some(w => padded.includes(` ${w} `))) return 'heavy';
    if (LIGHT.some(w => padded.includes(` ${w} `))) return 'light';
    return '';
}

/**
 * The kind and intensity of a weather text.
 * @param {string} text e.g. "Light rain, 12 °C"
 * @param {string} [emoji] the emoji in front of it, used when the words say nothing
 * @returns {{ kind: string, intensity: 'light'|'moderate'|'heavy'|'', word: string }}
 */
export function classifyWeather(text, emoji = '') {
    const raw = String(text ?? '');
    const padded = words(raw);
    for (const [kind, keys] of TABLE) {
        const found = keys.filter(([key]) => findWord(padded, key) >= 0);
        if (!found.length) continue;
        // "snow flurries": the kind comes from "snow", the intensity from "flurries".
        const owns = found.map(([, own]) => own).filter(Boolean);
        const own = owns.includes('heavy') ? 'heavy' : owns.includes('light') ? 'light' : '';
        return { kind, intensity: modifierIntensity(padded) || own || 'moderate', word: found[0][0] };
    }
    const marks = `${String(emoji ?? '')}${raw}`;
    for (const [mark, kind, intensity] of EMOJI) {
        if (marks.includes(mark)) return { kind, intensity: modifierIntensity(padded) || intensity, word: mark };
    }
    return { kind: 'none', intensity: '', word: '' };
}

/** Just the kind. */
export function weatherKind(text, emoji = '') {
    return classifyWeather(text, emoji).kind;
}
