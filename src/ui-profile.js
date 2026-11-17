import { getSettings } from './settings.js';
import { readLoreEntry } from './character-fill.js';
import { openLightbox } from './ui-portrait.js';
import { bondSettings, getPerson } from './bonds.js';
import { buildStatusCard } from './ui-vitals.js';
import { buildProfileTabs, buildLoreLinkBar } from './ui-profile-tabs.js';
import { applyFactionTheme, buildFactionBanner, safeWorld } from './ui-faction.js';
import { activeCombatType } from './combat-access.js';
import { levelFor, levelName, platonicValue, romanceState, METERS, METER_LABELS } from './bonds-core.js';

/**
 * The character page you land on: what is known about somebody, laid out to be read.
 *
 * The editor is a form, and a form is the right shape for changing things and the wrong
 * shape for looking at them. Opening a character gave you eleven labelled inputs and a
 * lorebook panel with three modes - practical, and nothing you would want to open twice.
 *
 * So the form moved behind a tab and this came in front of it. Nothing here is editable,
 * on purpose: read-only is what lets it be laid out at all, and the Edit tab stays on
 * screen while this scrolls. Everything it shows is written somewhere else - the profile
 * fields on the card, the tracker values wherever they currently live, the entry in the
 * lorebook.
 *
 * Built with createElement throughout rather than innerHTML so the panel can be walked in
 * a test; the fake DOM does not parse markup.
 */

/** One fact as a chip: a name and its value side by side. */
function chip(name, value) {
    const el = document.createElement('span');
    el.className = 'sillynpc-cv-chip';

    const key = document.createElement('span');
    key.className = 'sillynpc-cv-chip-key';
    key.textContent = name;
    el.append(key);

    if (value !== undefined && value !== null && String(value).trim() !== '') {
        const val = document.createElement('span');
        val.className = 'sillynpc-cv-chip-value';
        val.textContent = String(value);
        el.append(val);
    }
    return el;
}

/** A row of chips under a caption, or nothing at all when there are none. */
function chipRow(label, chips) {
    if (!chips.length) return null;

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-cv-block';

    const caption = document.createElement('div');
    caption.className = 'sillynpc-cv-label';
    caption.textContent = label;

    const row = document.createElement('div');
    row.className = 'sillynpc-cv-chips';
    row.append(...chips);

    wrap.append(caption, row);
    return wrap;
}

/**
 * The portrait, or the same placeholder the editor shows when there is none.
 *
 * Deliberately not the editor's portrait block: that one carries four controls, a
 * carousel and a three-way delete, none of which belong on a page that cannot be edited.
 */
function buildPortrait(char) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-cv-portrait';

    if (char.imageUrl) {
        const img = document.createElement('img');
        img.src = char.imageUrl;
        img.alt = char.name || '';
        if (char.imageFit) img.style.objectFit = char.imageFit;
        // The same click the editor's preview has. This one is cropped to the column too,
        // and a portrait you cannot see properly is the one thing on the page somebody
        // actually wants to look at.
        img.title = 'Click to view full size';
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(char.imageUrl));
        wrap.append(img);
    } else {
        const empty = document.createElement('div');
        empty.className = 'sillynpc-cv-portrait-empty';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-user-large';
        const text = document.createElement('span');
        text.textContent = 'no image';
        empty.append(icon, text);
        wrap.append(empty);
    }

    if (char.color) {
        const swatch = document.createElement('span');
        swatch.className = 'sillynpc-cv-colour';
        swatch.style.backgroundColor = char.color;
        swatch.title = 'Speech colour';
        wrap.append(swatch);
    }

    return wrap;
}

/**
 * The short things worth a glance on a character or player page: alias chips, today.
 * Who somebody is lives in their lorebook entry, which the page reads in below.
 *
 * @param {object} char
 * @param {{ extraBadges?: Element[] }} [options] Chips to ride along in the top row.
 * @returns {Element[]} Empty when there is nothing to show.
 */
export function buildProfileBlocks(char, { extraBadges = [] } = {}) {
    const glance = chipRow('At a glance', [...extraBadges]);
    return glance ? [glance] : [];
}

/**
 * Renders the read-only view of one character.
 *
 * @param {object} char
 * @param {HTMLElement} container
 * @returns {Promise<void>} Resolves once the lore entry has been read in.
 */
export async function renderProfileView(char, container) {
    if (!container || !char) return;
    container.replaceChildren();
    container.className = 'sillynpc-charview';
    // The faction decides the colours; its banner runs across the top. Neither is needed for any control to work.
    // The world picked in Combat may carry its own factions and banner (set in the world editor).
    const world = safeWorld(activeCombatType);
    try {
        applyFactionTheme(container, char.category, world);
    } catch (err) {
        console.warn('[Worldkit] faction theme failed', err);
        try { applyFactionTheme(container, '', null); } catch { /* the plain look is all that is left */ }
    }
    try {
        container.append(buildFactionBanner(char.category, world));
    } catch (err) { console.warn('[Worldkit] faction banner failed', err); }

    const body = document.createElement('div');
    body.className = 'sillynpc-cv-body';

    // ── Left: the portrait ──────────────────────────────────────────────────
    const left = document.createElement('div');
    left.className = 'sillynpc-cv-left';
    left.append(buildPortrait(char));

    if (char.category) {
        const cat = document.createElement('div');
        cat.className = 'sillynpc-cv-category';
        cat.textContent = char.category;
        left.append(cat);
    }

    // ── Right: everything that is written down ──────────────────────────────
    const right = document.createElement('div');
    right.className = 'sillynpc-cv-right';

    const aliasNames = (char.aliases || [])
        .filter(a => a?.pattern && !a.isRegex)
        .map(a => a.pattern);
    const blocks = buildProfileBlocks(char, {
        extraBadges: aliasNames.length ? [chip('Also called', aliasNames.join(', '))] : [],
    });

    if (blocks.length) {
        right.append(...blocks);
    } else {
        const empty = document.createElement('p');
        empty.className = 'notes sillynpc-cv-empty';
        empty.textContent = 'Who they are lives in their lorebook entry. Link or write one '
            + 'under Edit, in the Lorebook section.';
        right.append(empty);
    }

    // The lorebook link, then the row of tabs: Combat, Equipment, Voice and Visual Prompt. They edit in
    // place, so the Edit tab is only needed for the rest. A change here redraws the page so the lore text
    // and chips below stay true.
    const redrawProfile = () => { renderProfileView(char, container).catch(err => console.error('[Worldkit] profile redraw failed', err)); };
    try {
        right.append(buildLoreLinkBar(char, { onChange: redrawProfile }));
        right.append(buildProfileTabs(char, { onChange: undefined }));
    } catch (err) {
        console.warn('[Worldkit] could not draw the profile tabs', err);
    }

    // Mood, hunger, health and energy, each with its own reset. Redrawn in place after a reset.
    const statusHost = document.createElement('div');
    statusHost.className = 'sillynpc-cv-status';
    const drawStatus = () => statusHost.replaceChildren(buildStatusCard(char, { onChange: drawStatus }));
    try { drawStatus(); } catch (err) { console.warn('[Worldkit] could not draw the status card', err); }
    // Status and Relationship sit side by side as two cards.
    const cards = document.createElement('div');
    cards.className = 'sillynpc-cv-cards';
    const relCard = document.createElement('div');
    relCard.className = 'sillynpc-cv-card sillynpc-cv-relationship';
    const relTitle = document.createElement('div');
    relTitle.className = 'snpc-vit-title';
    relTitle.textContent = 'Relationship';
    relCard.append(relTitle);
    cards.append(statusHost, relCard);
    right.append(cards);

    // Where they stand with the player, from the Bonds tab. Read only here; it is edited there.
    try {
        const bonds = bondSettings();
        const person = bonds.enabled ? getPerson(char.name) : null;
        if (person) {
            // The level is read from the character's own edge (the lower of affection and trust);
            // person.value mirrors it, and stays the fallback for a store not yet migrated.
            const edge = person.edges?.toPlayer;
            const value = edge ? platonicValue(edge) : (Number(person.value) || 0);
            const { level, next } = levelFor(value, bonds.levels);
            const chips = [chip('Bond', `${levelName(level, person)} (${value})`)];
            if (edge) for (const k of METERS) chips.push(chip(METER_LABELS[k], String(edge[k])));
            if (next) chips.push(chip('Next', `${levelName(next, person)} at ${next.min}`));
            // Romance only while their side is switched on and the bond is Open.
            const romance = romanceState(person, 'toPlayer', bonds.romanceLevels);
            if (romance.active) chips.push(chip('Romance', `${romance.level ? romance.level.name : 'none yet'} (desire ${romance.desire})`));
            if (!person.tracked) chips.push(chip('Tracking', 'off'));
            const bondRow = chipRow('Bond', chips);
            if (bondRow) relCard.append(bondRow);
            const recent = person.history.slice(-4);
            if (recent.length) {
                const marks = recent.map(m => chip(m.label || m.type, m.date));
                const historyRow = chipRow('Milestones', marks);
                if (historyRow) relCard.append(historyRow);
            }
        }
    } catch (err) {
        console.warn('[Worldkit] could not read the bond for the profile', err);
    }
    if (relCard.children.length === 1) {
        const none = document.createElement('small');
        none.className = 'notes';
        none.textContent = bondSettings().enabled ? 'No bond with you yet.' : 'The Bond Tracker is off.';
        relCard.append(none);
    }

    // ── The lore entry, read in after the rest is on screen ─────────────────
    //
    // In the same column as everything else rather than full width below. Its own section
    // would need a full-width rhythm to sit in, and there is nothing else out there - so
    // it just read as a block that had come loose from its heading.
    const loreBlock = document.createElement('div');
    loreBlock.className = 'sillynpc-cv-lore';
    right.append(loreBlock);

    body.append(left, right);
    container.append(body);

    if (char.lorebook?.world) {
        const text = await readLoreEntry(char);
        if (text) {
            const heading = document.createElement('div');
            heading.className = 'sillynpc-cv-label';
            heading.textContent = `Lore · ${char.lorebook.world}`;

            const content = document.createElement('div');
            content.className = 'sillynpc-cv-lore-text';
            content.textContent = text;

            loreBlock.append(heading, content);
        }
    }

}
