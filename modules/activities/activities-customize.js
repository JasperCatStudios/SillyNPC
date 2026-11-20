import { BUILT_IN_PRESETS, FIRE_EMBLEM_PRESET } from '../../src/activity-presets.js';
import { normalizePreset, GENERIC_PRESET, HUB_TABS, ACTIVITY_KINDS } from '../../src/activity-config-core.js';
import { DEFAULT_TERMS } from '../../src/activity-terms.js';
import {
    copyForEditing, unknownKindHelp, KIND_EXAMPLES, TERM_GUIDE, linesOf, fishToLines, fishFromLines, seedsToLines, seedsFromLines,
    recipesToLines, recipesFromLines, runesFromText,
} from '../../src/activity-customize-core.js';
import { activitySettings, activePreset, allSubjects } from './activities-runtime.js';

/**
 * "Customize an activity" (fork): the part of the Activities tab where a world's activities are given their own content.
 *
 * It changes WHAT an activity is about, never HOW it plays: the rules (matching, timing, scoring) are the same in every
 * world. Fire Emblem is the worked example: its values are shown beside each field, so a world such as Bleach can see what
 * to replace ("Reason" study could be "Kido" study, "the library" could be "the academy"). Every card says what it is for
 * and how to use it. Edits go to the user's own copy of a preset, never to a built-in one, and save as you finish typing.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const FE = normalizePreset(FIRE_EMBLEM_PRESET);
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink'];

/** A card with a clear header, what it is for, how to use it and the Fire Emblem example. Returns { box, body }. */
function card(title, purpose, how, example) {
    const box = el('div', 'sillynpc-setting');
    box.append(el('h4', 'sillynpc-section-title', title));
    box.append(el('p', 'notes', `What it is for: ${purpose}`));
    box.append(el('p', 'notes', `How to use it: ${how}`));
    if (example) box.append(el('p', 'notes', `Fire Emblem example: ${example}`));
    const body = el('div');
    body.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:6px;';
    box.append(body);
    return { box, body };
}

const field = (label, control, hint) => {
    const wrap = el('div', 'sillynpc-setting-row');
    const l = el('label', 'sillynpc-setting-label', label);
    if (hint) l.title = hint;
    const box = el('div');
    box.style.cssText = 'flex: 1 1 auto; display:flex; justify-content:flex-end; max-width:62%;';
    control.style.maxWidth = '100%';
    box.append(control);
    wrap.append(l, box);
    if (hint) wrap.title = hint;
    return wrap;
};

const textInput = (value, placeholder, max, onChange) => {
    const i = el('input', 'text_pole');
    i.type = 'text';
    i.maxLength = max;
    i.placeholder = placeholder || '';
    i.value = value || '';
    i.style.minWidth = '12em';
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
};

const textArea = (value, placeholder, rows, onChange) => {
    const t = el('textarea', 'text_pole');
    t.rows = rows;
    t.placeholder = placeholder || '';
    t.value = value || '';
    t.style.cssText = 'width:100%; min-width:14em;';
    t.addEventListener('change', () => onChange(t.value));
    return t;
};

function checkList(options, chosen, onChange) {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px 14px;';
    const on = new Set(chosen);
    for (const [id, label] of options) {
        const l = el('label');
        l.style.cssText = 'display:inline-flex; gap:5px; align-items:center; min-height:28px;';
        const c = el('input');
        c.type = 'checkbox';
        c.checked = on.has(id);
        c.addEventListener('change', () => { if (c.checked) on.add(id); else on.delete(id); onChange([...on]); });
        l.append(c, document.createTextNode(label));
        wrap.append(l);
    }
    return wrap;
}

/**
 * Draws the customizer into `host`. `changed` saves and tells the rest of the module. It redraws itself only when the
 * structure changes (a copy was made, a preset deleted), never while you type.
 */
export function renderCustomize(host, { changed }) {
    const s = activitySettings();

    const draw = () => {
        host.replaceChildren();
        const active = activePreset();
        const raw = s.presets[active.id] || null;

        const head = el('div');
        head.append(el('h3', 'sillynpc-section-title', 'Customize an activity'));
        head.append(el('p', 'notes', 'Change what the activities are about, not how they play. The rules stay the same in every world; only the names, words and lists change. '
            + 'For example, in Fire Emblem the Study game trains Reason; in a Bleach world the same game can be Kido study, in a different room, with different wording.'));
        if (!raw) {
            // Said first and plainly: the cards below do not exist until the owner has their own copy.
            const first = el('p', 'notes');
            first.style.cssText = 'border-left: 3px solid var(--SmartThemeQuoteColor, #7aa7d9); padding: 6px 10px; border-radius: 4px; background: rgba(128, 128, 128, .1);';
            first.append(el('b', '', `Start here: "${active.name}" is built in and cannot be changed. `),
                document.createTextNode('Make an editable copy of it first (the button just below). Your copy is picked for you, and the editing cards then appear under it.'));
            head.append(first);
        } else {
            head.append(el('p', 'notes', `You are editing your copy "${raw.name || active.id}". Each card below says what it is for and shows the Fire Emblem version so you know what to replace. Changes save as you finish typing.`));
        }
        host.append(head);

        /* ---------------- 1. your preset */
        const mine = card(raw ? 'Your editable copy' : 'Step 1: make an editable copy',
            raw ? `A preset is one world's set of activities and wording. This is your own copy, so everything below can be changed. The built-in presets stay as they are.`
                : `The preset in use, ${active.name}, is built in and read-only. To change anything, you first need your own copy of it to edit.`,
            raw ? 'Rename it below, or make another copy to try a variation. Your copy is used while it is chosen under World preset above.'
                : `Press "Make an editable copy of ${active.name}". The copy is chosen for you automatically and the cards for names, wording, study and the rest appear below it.`,
            'the Fire Emblem preset has six activities, its own wording and its own lists. Copy it and change them for your world.');
        const copy = el('button', 'menu_button', raw ? 'Make another copy' : `Make an editable copy of ${active.name}`);
        copy.style.cssText = 'white-space: normal; max-width: 100%;';
        copy.type = 'button';
        copy.addEventListener('click', () => {
            const source = raw || (BUILT_IN_PRESETS[active.id] ? JSON.parse(JSON.stringify(BUILT_IN_PRESETS[active.id])) : JSON.parse(JSON.stringify(GENERIC_PRESET)));
            const taken = [...Object.keys(BUILT_IN_PRESETS), 'generic', ...Object.keys(s.presets)];
            const made = copyForEditing(source, taken);
            s.presets[made.id] = made;
            s.presetId = made.id;
            changed();
            draw();
        });
        mine.body.append(field('Copy', copy));
        if (raw) {
            mine.body.append(field('Preset name', textInput(raw.name || active.id, active.name, 60, (v) => { raw.name = v || active.id; changed(); })));
            const del = el('button', 'menu_button', 'Delete this preset');
            del.type = 'button';
            del.addEventListener('click', () => {
                if (!window.confirm(`Delete "${raw.name || active.id}"? This cannot be undone.`)) return;
                delete s.presets[active.id];
                s.presetId = '';
                changed();
                draw();
            });
            mine.body.append(field('Delete', del, 'Removes your copy. Built-in presets are not affected.'));
        }
        host.append(mine.box);
        if (!raw) return;

        const edit = (fn) => { fn(raw); changed(); };
        const ensure = (key) => { if (!raw[key] || typeof raw[key] !== 'object' || Array.isArray(raw[key])) raw[key] = {}; return raw[key]; };
        if (!Array.isArray(raw.activities) || !raw.activities.length) raw.activities = JSON.parse(JSON.stringify(active.activities));

        /* ---------------- 2. activity names and tiles */
        const names = card('Activity names and tiles', 'What each tile on the Activities hub is called and says, and which tab it is on.',
            'Change the name and the one-line description, pick an icon (a Font Awesome name such as fa-flask), give it a looping music tag, choose the tab, or switch a tile off. The kind of activity (its rules) stays the same.',
            'the Study tile is called "Study" with "Match the runes in the library"; the Brewing tile uses fa-flask. A Bleach world might call them "Kido practice" and "Spirit study".');
        for (const a of raw.activities) {
            const fe = FE.activities.find(x => x.id === a.id);
            const inner = el('div');
            inner.style.cssText = 'border:1px solid var(--sillynpc-border, #a4947d55); border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;';
            const known = ACTIVITY_KINDS.includes(a.kind);
            inner.append(el('strong', '', `${a.label || a.id}  (${a.kind}${known ? '' : ', not known'})`));
            if (!known) {
                inner.append(el('p', 'notes', unknownKindHelp(a.kind)));
                const sel = el('select', 'text_pole');
                sel.append(new Option('Keep as it is', ''));
                for (const k of ACTIVITY_KINDS) sel.append(new Option(`Treat as ${k}: ${KIND_EXAMPLES[k]}`, k));
                sel.addEventListener('change', () => { if (sel.value) { a.kind = sel.value; changed(); draw(); } });
                inner.append(field('Treat as', sel));
            }
            inner.append(field('Name', textInput(a.label, fe?.label || '', 40, (v) => { a.label = v || a.id; changed(); })));
            inner.append(field('Description', textInput(a.blurb, fe?.blurb || '', 120, (v) => { a.blurb = v; changed(); })));
            inner.append(field('Icon', textInput(a.icon, fe?.icon || 'fa-star', 40, (v) => { a.icon = v; changed(); }), 'A Font Awesome icon name, for example fa-flask or fa-fish.'));
            inner.append(field('Music loop', textInput(a.music, fe?.music || 'a looping sound tag', 60, (v) => { if (v) a.music = v; else delete a.music; changed(); }), 'A looping sound tag from your sound map, played while this activity is open. Empty means no music.'));
            const tab = el('select', 'text_pole');
            for (const [id, label] of HUB_TABS) tab.append(new Option(label, id));
            tab.value = a.tab || (fe?.tab || 'leisure');
            tab.addEventListener('change', () => { a.tab = tab.value; changed(); });
            inner.append(field('Tab', tab));
            const off = el('input');
            off.type = 'checkbox';
            off.checked = Boolean(a.off);
            off.addEventListener('change', () => { if (off.checked) a.off = true; else delete a.off; changed(); });
            inner.append(field('Switched off', off, 'A tile that is off is not shown on the hub.'));
            names.body.append(inner);
        }
        host.append(names.box);

        /* ---------------- 3. wording */
        const terms = ensure('terms');
        const groups = [...new Set(TERM_GUIDE.map(t => t.group))];
        const wording = card('Wording', 'The words the activities use for people, places and things, so each world can speak in its own voice.',
            'Type your own word in any box; leave a box empty to use the neutral default. The grey text in each box is the Fire Emblem word.',
            'the examiner is "Professor", the place of study is "the library", a matching piece is a "rune". A Bleach world might use "Captain", "the academy" and "tile".');
        for (const g of groups) {
            const sub = el('div');
            sub.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
            sub.append(el('strong', '', g));
            for (const t of TERM_GUIDE.filter(x => x.group === g)) {
                sub.append(field(t.label, textInput(terms[t.key], FE.terms?.[t.key] || DEFAULT_TERMS[t.key], 40, (v) => { if (v) terms[t.key] = v; else delete terms[t.key]; changed(); }), `Shows in: ${t.where}. Neutral default: ${DEFAULT_TERMS[t.key]}.`));
            }
            if (g === 'People and exams') {
                // Who may examine: any partner, only characters carrying a tag, or only someone who already holds the skill at the rank asked.
                const rule = el('select', 'text_pole');
                for (const [v, label] of [['partner', 'Any partner'], ['tag', 'Only characters with a tag'], ['any-with-rank', 'Only someone who holds the skill at that rank']]) rule.append(new Option(label, v));
                rule.value = ['partner', 'tag', 'any-with-rank'].includes(terms.examinerRule) ? terms.examinerRule : 'partner';
                const tagBox = textInput(terms.examinerTag, 'mentor', 40, (v) => { if (v) terms.examinerTag = v.toLowerCase(); else delete terms.examinerTag; changed(); });
                const tagRow = field('Examiner tag', tagBox, 'The tag a character needs (add it to their Tags on their Worldkit page). Not case sensitive.');
                const showTag = () => { tagRow.hidden = rule.value !== 'tag'; };
                rule.addEventListener('change', () => { terms.examinerRule = rule.value; changed(); showTag(); });
                showTag();
                sub.append(field('Who may examine', rule, 'Who can set the exam: any partner you pick, only characters with the tag below, or only someone who already holds that skill at the rank you are testing for.'), tagRow);
            }
            wording.body.append(sub);
        }
        host.append(wording.box);

        /* ---------------- 4. study */
        const subjects = allSubjects();
        const study = ensure('study');
        const studyCard = card('Study subjects and tiles', 'Which skills the Study matching game trains, and the symbols on its tiles.',
            'Tick the skills your world studies. Skills come from your combat type, so rename them there if you want "Kido" instead of "Reason". Optionally list your own tile symbols (up to 12, each up to 4 characters).',
            'Study trains Reason, Faith and Authority. A Bleach world would tick Kido and Healing Kido (and maybe Zanjutsu for sword theory), and could use kanji as tile symbols.');
        if (subjects.length) studyCard.body.append(field('Skills studied', checkList(subjects.map(p => [p.id, p.label]), study.profs || [], (v) => { study.profs = v; changed(); }), 'Studying trains the ticked skills.'));
        else studyCard.body.append(el('p', 'notes', 'No combat type is active, so there are no skills to tick yet. Pick one under Combat first.'));
        studyCard.body.append(field('Tile symbols', textInput((study.runes || []).join(' '), (FE.study.runes || []).join(' ') || 'built-in symbols', 60, (v) => { study.runes = runesFromText(v); changed(); }), 'Separate symbols with spaces. Empty uses the built-in symbols.'));
        host.append(studyCard.box);

        /* ---------------- 5. brewing */
        const potion = ensure('potion');
        const potionNames = (potion.names && typeof potion.names === 'object' && !Array.isArray(potion.names)) ? potion.names : (potion.names = {});
        const brew = card('Brewing', 'The clue puzzle where you work out a hidden recipe: what the potion is, what a failure is, and what the ingredients are called.',
            'Name the finished item and the failed one, then rename the eight ingredients (they keep their colours and shapes). Tick the skills Brewing trains.',
            `the recipe is "${FE.potion.recipe}", a failure is "${FE.potion.failed}", and the red ingredient is "${FE.potion.names.red}". A Bleach world could brew a "Soul Candy".`);
        brew.body.append(field('Finished item', textInput(potion.recipe, FE.potion.recipe, 40, (v) => { potion.recipe = v; changed(); })));
        brew.body.append(field('Failed item', textInput(potion.failed, FE.potion.failed, 40, (v) => { potion.failed = v; changed(); })));
        for (const c of COLORS) {
            brew.body.append(field(`Ingredient: ${c}`, textInput(potionNames[c], FE.potion.names[c] || '', 24, (v) => { if (v) potionNames[c] = v; else delete potionNames[c]; changed(); })));
        }
        if (subjects.length) brew.body.append(field('Skills trained', checkList(subjects.map(p => [p.id, p.label]), potion.profs || [], (v) => { potion.profs = v; changed(); })));
        host.append(brew.box);

        /* ---------------- 6. tea time */
        const tea = ensure('tea');
        const teaCard = card('Tea Time', 'The hosting game: which drinks and snacks the host can offer, and the music.',
            'Set the item category the drinks come from, list snacks (one per line) and fallback drinks used when your item database has none. The music is a sound tag.',
            'drinks come from the "Tea" category of the item pack; snacks are cakes and tarts; the music tag is activity_tea_music. A Bleach world could serve "Sake" and "Mochi".');
        teaCard.body.append(field('Drink category', textInput(tea.category, 'Tea', 24, (v) => { tea.category = v || 'Tea'; changed(); }), 'Items in this category of your item database are offered as drinks.'));
        teaCard.body.append(field('Music tag', textInput(tea.music, 'activity_tea_music', 60, (v) => { tea.music = v; changed(); }), 'A tag from your sound map. Empty means no music.'));
        const restore = (tea.restore && typeof tea.restore === 'object' && !Array.isArray(tea.restore)) ? tea.restore : (tea.restore = {});
        for (const [k, label, dflt] of [['drink', 'Hunger a drink restores', 4], ['snack', 'Hunger a snack restores', 8]]) {
            teaCard.body.append(field(label, textInput(restore[k], String(dflt), 3, (v) => { const n = Number(v); if (v !== '' && Number.isFinite(n)) restore[k] = Math.max(0, Math.min(100, Math.round(n))); else delete restore[k]; changed(); }), 'Only used while the Vitals Tracker is on and tracks hunger. A cooked dish uses its own value from the lists below.'));
        }
        teaCard.body.append(el('strong', '', 'Snacks (one per line)'));
        teaCard.body.append(textArea((tea.snacks || GENERIC_PRESET.tea.snacks).join('\n'), '', 6, (v) => { tea.snacks = linesOf(v, 30, 40); changed(); }));
        teaCard.body.append(el('strong', '', 'Fallback drinks (one per line)'));
        teaCard.body.append(textArea((tea.fallback || GENERIC_PRESET.tea.fallback).join('\n'), '', 4, (v) => { tea.fallback = linesOf(v, 30, 40); changed(); }));
        host.append(teaCard.box);

        /* ---------------- 7. cooking, fishing, gardening lists */
        const harvest = ensure('harvest');
        const base = normalizePreset(raw).harvest;
        const lists = card('Cooking, fishing and gardening lists', 'The dishes you can cook, the fish you can catch and the seeds you can plant.',
            'One entry per line, parts separated by the | sign. Leave a box empty to use the built-in list. Item names matter: a dish or fish with the same name as an item in your database becomes that item.',
            'a fish line is "Carp | 12 | 1 | 3" (name, how often it bites, difficulty 1 to 3, size 1 to 9); a seed line is "Carrot Seeds | Carrot | 2 | 3 | food" (seed, what it grows, days, yield, food or plant); a dish line is "Roast Fish | Crisp. | carp, trout | 30" (dish, description, one group of words per ingredient, hunger it restores when eaten while the Vitals Tracker is on).');
        lists.body.append(el('strong', '', 'Dishes: name | description | ingredient words (separate ingredients with ;) | hunger restored 0-100'));
        lists.body.append(textArea(recipesToLines(harvest.recipes || base.recipes), '', 8, (v) => { const r = recipesFromLines(v); if (r.length) harvest.recipes = r; else delete harvest.recipes; changed(); }));
        lists.body.append(el('strong', '', 'Fish: name | how often | difficulty 1-3 | size 1-9'));
        lists.body.append(textArea(fishToLines(harvest.fish || base.fish), '', 8, (v) => { const r = fishFromLines(v); if (r.length) harvest.fish = r; else delete harvest.fish; changed(); }));
        lists.body.append(el('strong', '', 'Seeds: seed | grows | days 1-3 | yield 1-5 | food or plant | free'));
        lists.body.append(textArea(seedsToLines(harvest.seeds || base.seeds), '', 8, (v) => { const r = seedsFromLines(v); if (r.length) harvest.seeds = r; else delete harvest.seeds; changed(); }));
        host.append(lists.box);
    };

    draw();
    return draw;
}
