import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { extensionName, LOG_PREFIX, PRODUCT_NAME } from './constants.js';
import { getSettings, saveSettings, exportSettingsData, importSettingsData } from './settings.js';
import { 
    createCharacter, 
    deleteCharacter, 
    findCharacter, 
    reorderCharacters,
    moveCharacterToCategory,
    getAllCategories,
    deleteCategory,
    createCategory,
    renameCategory,
    moveCategory,
    getChatCast,
    setChatCast,
    isCharacterInChat,
    addCharacterToChat,
    UNCATEGORISED
} from './characters.js';
import { reprocessAllMessages, triggerReprocess, chatRenderSignature } from './chat.js';
import { syncAllLorebooks, renameLorebookEntry } from './lorebook.js';
import { escapeHtml, offerDownload } from './utils.js';
import { buildPortraitBlock } from './ui-portrait.js';
import { renderLorebookSection, resetLorebookState } from './ui-lorebook-section.js';
import { renderCombatSection } from './ui-combat-section.js';
import { renderProfileView } from './ui-profile.js';
import { renderCharacterExtras } from './ui-character-extras.js';
import { renderThreadsView } from './ui-threads.js';
import { fillCharacter } from './ui-fill.js';
import { renderAppearanceView, renderWritingRulesView, renderAdvancedView } from './ui-settings-tabs.js';
import { renderPromptsView } from './ui-prompts.js';
import { renderConnectionsView } from './connections.js';
import { renderBondsView } from './ui-bonds.js';
import { renderVitalsView } from './ui-vitals.js';
import { renderVectorsView } from './ui-vectors.js';
import { renderStatusView } from './ui-tracker-settings.js';
import { applyFactionTheme, buildFactionBanner, factionPalette, safeWorld } from './ui-faction.js';
import { activeCombatType } from './combat-access.js';
import { renderModulesView } from './ui-modules.js';
import { buildSystemManager } from './ui-system-manager.js';
import { syncOverrideToActiveState, loadStateFromMetadata, hasOpenChat } from './status-logic.js';
import { renderCollectionUI, attachCollectionListeners, resolveCollectionTarget, persistCollectionEdit, updateExtensionTheme, repositionCloseButton, hideEmptySections } from './ui-shared.js';
import { buildBulkBar, buildBulkCheckbox, spliceIndexes } from './ui-bulk-select.js';
import { buildChoiceSelect, isChoiceField } from './ui-shared.js';
import { exportCharacterFile, importCharacterFile } from './ui-transfer.js';
import { buildGridFilterRow } from './ui-grid-filter.js';
import { buildSettingsSearch, buildSettingsIndex, ownText, LABEL_SELECTOR } from './ui-settings-search.js';
import { makeActivatable } from './utils.js';

/** @type {Popup|null} */
let managePopup = null;
let manageRoot = null;
let editingCharId = null;
let activeTab = 'characters';

export async function openManagePopup({ tab = 'characters', charId = null } = {}) {
    const html = await renderExtensionTemplateAsync(extensionName, 'manage');
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    // Taken before the menu can change anything, and compared when it closes.
    const signatureOnOpen = chatRenderSignature();

    managePopup = new Popup(container, POPUP_TYPE.DISPLAY, '', {
        allowVerticalScrolling: false,
        onOpen: (popup) => {
            applyPopupSize();
            updateManageTheme(manageRoot, popup);
            const visualContent = container.querySelector('.sillynpc-manage');
            if (visualContent) repositionCloseButton(popup, visualContent);
        },
        onClose: () => {
            managePopup = null;
            manageRoot = null;
            editingCharId = null;
            // Only when something that affects the chat actually changed. This used to run
            // every time, so opening the menu, reading something and closing it again
            // redrew a hundred messages for nothing - which is the stalled scrolling you
            // felt for a second afterwards.
            //
            // It cannot simply go: editing a character's name or colour only saves, and
            // this redraw is what applies it. A signature catches those without needing
            // every mutation site instrumented.
            if (chatRenderSignature() !== signatureOnOpen) reprocessAllMessages();
        },
    });
    
    manageRoot = container;
    editingCharId = charId;
    charView = 'profile';
    activeTab = tab;
    
    resetLorebookState();
    setupTabBar();
    setupSettingsSearch();
    renderManageView();

    await managePopup.show();
}

function applyPopupSize() {
    const dlg = managePopup?.dlg;
    if (!dlg) return;
    
    // Check if we are on a small screen
    const isMobile = window.innerWidth <= 768;
    const width = isMobile ? 95 : (getSettings().popupWidth ?? 80);
    const height = isMobile ? 90 : (getSettings().popupHeight ?? 80);
    
    dlg.style.setProperty('width', `${width}vw`, 'important');
    dlg.style.setProperty('max-width', '98vw', 'important');
    dlg.style.setProperty('height', `${height}vh`, 'important');
    dlg.style.setProperty('max-height', '98vh', 'important');
    
    if (isMobile) {
        dlg.style.setProperty('margin', '2vh auto', 'important');
    }

    // ─── ADD THESE LINES TO SOLVE THE PROBLEM ────────────────────────
    dlg.style.setProperty('padding', '0px', 'important');          // Removes the 20px padding gap
    dlg.style.setProperty('background', 'transparent', 'important'); // Makes the parent container invisible
    dlg.style.setProperty('border', 'none', 'important');          // Removes any actual borders
    dlg.style.setProperty('box-shadow', 'none', 'important');      // Removes any glowing shadows
}

function setupTabBar() {
    if (!manageRoot) return;
    const tabs = manageRoot.querySelectorAll('.sillynpc-tab');
    
    tabs.forEach(tab => {
        const name = tab.getAttribute('data-tab');
        if (!name) return;
        tab.replaceWith(tab.cloneNode(true));
    });
    
    const freshTabs = manageRoot.querySelectorAll('.sillynpc-tab');
    freshTabs.forEach(tab => {
        const name = tab.getAttribute('data-tab');
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(name);
        });
    });
}

/**
 * The box above the tabs, and what happens when an answer is picked.
 *
 * The index is built the first time somebody searches rather than when the menu opens:
 * it draws every page to make it, and most visits never type anything.
 */
function setupSettingsSearch() {
    const slot = manageRoot.querySelector('#sillynpc-settings-search');
    if (!slot) return;
    // On a narrow screen the tab bar scrolls sideways and squeezed the box to nothing, so the box moves
    // out of it and sits in its own full-width row above; on a wide one it stays at the top of the sidebar.
    const narrow = window.matchMedia?.('(max-width: 768px)');
    const place = () => {
        const layout = manageRoot?.querySelector('.sillynpc-manage-layout');
        const tabs = manageRoot?.querySelector('.sillynpc-tabs');
        if (!layout || !tabs) return;
        if (narrow?.matches) { if (slot.parentElement !== layout) layout.prepend(slot); }
        else if (slot.parentElement !== tabs) tabs.prepend(slot);
    };
    place();
    narrow?.addEventListener?.('change', place);
    slot.replaceChildren();
    slot.append(buildSettingsSearch({
        index: () => buildSettingsIndex(settingsTabs(), moduleRoots),
        onPick: (entry) => {
            // An advanced setting is not drawn until Show Every Setting is on: turn it on rather
            // than take you to a page where the control is missing.
            if (entry.advanced && !getSettings().devMode) {
                getSettings().devMode = true;
                saveSettings();
                try { toastr.info('Show Every Setting was turned on so this one is visible. You can turn it off under Advanced.', 'Worldkit'); } catch { /* no toast */ }
            }
            switchTab(entry.tab);
            // Into the right module or section first (Phone, Combat, Bonds...), then to the line itself.
            if (entry.sub) {
                const nav = [...(manageRoot?.querySelectorAll('.sillynpc-subtab, .sillynpc-charview-tab') || [])].find(b => ownText(b) === entry.sub);
                nav?.click();
            }
            if (entry.key) revealSetting(entry.key);
            else if (!entry.nav && !entry.page) setTimeout(() => revealByName(entry.label), 150);
        },
    }));
}

/** The settings panels of the modules that live in SillyTavern's own extensions drawer, as roots to index. */
function moduleRoots() {
    const roots = [];
    for (const [sub, selector] of [['Phone', '.rph-settings'], ['Games', '.rpg-game-settings']]) {
        const root = document.querySelector(selector);
        if (root) roots.push({ root, tab: 'modules', tabLabel: 'Modules', sub });
    }
    return roots;
}

/** Scrolls to a line by what it says, for the settings that carry no key. */
function revealByName(text) {
    const want = String(text || '').trim().toLowerCase();
    const hit = [...(manageRoot?.querySelectorAll(LABEL_SELECTOR) || [])].find(el => el.offsetParent !== null && ownText(el).toLowerCase() === want);
    if (!hit) return;
    const mark = hit.closest('.sillynpc-setting, .sillynpc-setting-row') || hit;
    mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    mark.classList.add('sillynpc-setting-found');
    setTimeout(() => mark.classList.remove('sillynpc-setting-found'), 2400);
}

/**
 * Scrolls to a setting and marks it, having just switched to its page.
 *
 * Marked because a page can be long: arriving somewhere with no idea which of thirty rows
 * you were brought for is barely better than not being brought.
 *
 * @param {string} key
 */
function revealSetting(key) {
    const wrap = manageRoot?.querySelector(`[data-setting="${key}"]`);
    if (!wrap) return;
    wrap.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    wrap.classList.add('sillynpc-setting-found');
    // Long enough to find by eye, short enough that it is gone before it becomes part of
    // how the page looks.
    setTimeout(() => wrap.classList.remove('sillynpc-setting-found'), 2400);
}

function switchTab(name) {
    if (!manageRoot) return;
    activeTab = name;
    editingCharId = null;
    resetLorebookState();
    renderManageView();
}

function renderManageView() {
    if (!manageRoot) return;

    // Update tab button states
    const tabs = manageRoot.querySelectorAll('.sillynpc-tab');
    tabs.forEach(t => {
        const tName = t.getAttribute('data-tab');
        t.classList.toggle('active', tName === activeTab);
    });

    // Toggle panel visibility
    const panels = manageRoot.querySelectorAll('.sillynpc-tab-panel');
    panels.forEach(p => {
        const pName = p.getAttribute('data-panel');
        const isCurrent = pName === activeTab;
        p.style.setProperty('display', isCurrent ? 'flex' : 'none', 'important');
    });

    updateManageTheme(manageRoot, managePopup);

    /** Draws one panel, naming it if it goes wrong rather than leaving a blank tab. */
    const draw = (id, render) => {
        const view = manageRoot.querySelector(`#${id}`);
        if (!view) return;
        try {
            render(view);
            // After, not during: a section is empty only once everything in it has had
            // its chance to be drawn or hidden.
            hideEmptySections(view);
        } catch (e) { console.error(LOG_PREFIX, `${id} failed`, e); }
    };

    if (activeTab === 'characters') {
        const gridView = manageRoot.querySelector('#sillynpc-grid-view');
        const editView = manageRoot.querySelector('#sillynpc-editor-view');
        if (editingCharId) {
            if (gridView) gridView.style.display = 'none';
            if (editView) {
                editView.style.display = 'block';
                try { renderEditor(); } catch (e) { console.error(LOG_PREFIX, 'renderEditor failed', e); }
            }
        } else {
            if (gridView) {
                gridView.style.display = 'block';
                try { renderCardGrid(); } catch (e) { console.error(LOG_PREFIX, 'renderCardGrid failed', e); }
            }
            if (editView) editView.style.display = 'none';
        }
    } else {
        const tab = settingsTabs().find(t => t.id === activeTab);
        if (tab) draw(tab.container, tab.render);
    }
}

/**
 * Every tab that draws settings: its id, what it is called, where it draws, and what draws it.
 *
 * A table rather than a chain of branches, because two things need this and they must not
 * disagree: the dispatcher, which draws the tab you clicked, and the search box, which has
 * to know which page a setting is on before you have ever opened it.
 *
 * Characters is not here. It has no settings and its own two-view arrangement, so it stays
 * a case of its own in renderManageView rather than being bent into this shape.
 */
function settingsTabs() {
    return [
        { id: 'modules', label: 'Modules', container: 'sillynpc-modules-view',
          render: v => renderModulesView(v) },
        { id: 'appearance', label: 'Appearance', container: 'sillynpc-appearance-view',
          render: v => renderAppearanceView(v, reprocessAllMessages, updateManageTheme) },
        { id: 'writing', label: 'Writing Rules', container: 'sillynpc-writing-view',
          render: v => renderWritingRulesView(v, reprocessAllMessages) },
        { id: 'threads', label: 'Threads', container: 'sillynpc-threads-view',
          render: v => renderThreadsView(v) },
        { id: 'status', label: 'Tracker', container: 'sillynpc-status-view',
          render: v => renderTrackerView(v),
          // The search reads these too: they are views of this page.
          extras: [
              { sub: 'Bonds', hint: 'How the people in the story feel about you.', render: v => renderBondsView(v) },
              { sub: 'Vitals', hint: 'Health, hunger, energy and mood.', render: v => renderVitalsView(v) },
          ] },
        { id: 'systems', label: 'World Management', container: 'sillynpc-systems-view',
          render: v => renderSystemsView(v) },
        { id: 'connections', label: 'Connections', container: 'sillynpc-connections-view',
          render: v => renderConnectionsView(v) },
        { id: 'vectors', label: 'Vectors', container: 'sillynpc-vectors-view',
          render: v => renderVectorsView(v) },
        { id: 'prompts', label: 'Prompts', container: 'sillynpc-prompts-view',
          render: v => renderPromptsView(v, reprocessAllMessages) },
        { id: 'advanced', label: 'Advanced', container: 'sillynpc-advanced-view',
          render: v => renderAdvancedView(v, {
              applyPopupSize,
              onExport: () => exportData(),
              onImport: () => importData(),
          }) },
    ];
}

/** Which view of the Tracker tab is showing. */
let trackerView = 'tracker';

/**
 * The Tracker tab: the tracker settings, and Bonds as a second view beside them
 * (same pattern as Systems).
 *
 * @param {HTMLElement} view
 */
function renderTrackerView(view) {
    view.replaceChildren();

    const tabs = document.createElement('div');
    tabs.className = 'sillynpc-charview-tabs';
    for (const [id, label, hint] of [
        ['tracker', 'Tracker', 'Internal states, display and the rest of the tracker settings.'],
        ['bonds', 'Bonds', 'How the people in the story feel about you.'],
        ['vitals', 'Vitals', 'Health, hunger, energy and mood. On or off.'],
    ]) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-charview-tab' + (trackerView === id ? ' active' : '');
        tab.dataset.view = id;
        tab.textContent = label;
        tab.title = hint;
        tab.addEventListener('click', () => {
            if (trackerView === id) return;
            trackerView = id;
            renderTrackerView(view);
        });
        tabs.append(tab);
    }
    view.append(tabs);

    const body = document.createElement('div');
    view.append(body);
    try {
        if (trackerView === 'bonds') renderBondsView(body);
        else if (trackerView === 'vitals') renderVitalsView(body);
        else renderStatusView(body);
    } catch (e) {
        console.error(LOG_PREFIX, `Tracker ${trackerView} view failed`, e);
    }
}

/**
 * World Management: the worlds you have, the one in use, and the characters that belong to each.
 *
 * Was "Systems", which had a Builder (the stats, collections and fields a world is made of) and a
 * Manager. The Builder is gone; what remains is the manager, and a world carries its cast.
 *
 * @param {HTMLElement} view
 */
function renderSystemsView(view) {
    view.replaceChildren();
    try {
        view.append(buildSystemManager(() => renderManageView()));
    } catch (e) {
        console.error(LOG_PREFIX, 'World Management failed', e);
    }
}


/* ─── Theme Helper ───────────────────────────────────────────────────────── */

/**
 * Updates the extension theme classes on the given root and its parent popup.
 */
function updateManageTheme(root, popupInstance = null) {
    updateExtensionTheme(root, popupInstance);
}

/* ─── Characters Tab ────────────────────────────────────────────────────── */

/**
 * Links every character that has no lorebook entry yet.
 *
 * Auto-sync only ever ran when a character was created from a detected speaker, so
 * anyone added another way, or added before their entry existed, stayed unlinked with no
 * remedy but opening each card in turn.
 */
function buildSyncAllRow(characters) {
    const row = document.createElement('div');
    row.className = 'sillynpc-sync-all-row';

    const unlinked = (characters || []).filter(c => c.name && !c.lorebook).length;

    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = unlinked
        ? `${unlinked} character${unlinked === 1 ? '' : 's'} with no lorebook entry.`
        : 'Every character with a name is linked to a lorebook entry.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu_button';
    btn.disabled = unlinked === 0;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync All';
    btn.title = 'Look through your lorebooks for an entry matching each unlinked '
        + 'character, by name, alias or keyword.';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const { linked, checked } = await syncAllLorebooks();
            if (linked) toastr.success(`Linked ${linked} of ${checked}.`, PRODUCT_NAME);
            else toastr.info(`No matching entries found for ${checked}.`, PRODUCT_NAME);
        } catch (err) {
            console.error(LOG_PREFIX, 'Sync all failed', err);
            toastr.error(String(err.message || err), PRODUCT_NAME);
        }
        renderCardGrid();
    });

    // A category used to exist only while somebody was in it, so there was no way to set
    // one up before deciding who goes in it. It is an empty heading until a card is
    // dropped on it.
    const newCategoryBtn = document.createElement('button');
    newCategoryBtn.type = 'button';
    newCategoryBtn.className = 'menu_button';
    newCategoryBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i> <span>New Category</span>';
    newCategoryBtn.title = 'Add an empty category. Drag characters onto its heading to fill it.';
    newCategoryBtn.addEventListener('click', async () => {
        const name = (await Popup.show.input('New category', 'Enter a name:'))?.trim();
        if (!name) return;
        if (!createCategory(name)) {
            toastr.info(`"${name}" already exists.`, PRODUCT_NAME);
            return;
        }
        renderCardGrid();
    });

    // Bringing a character in from a file. Distinct from the Import in the header above,
    // which reads a whole-settings backup and replaces everything - this one adds to what
    // is here, which is why it sits with the grid rather than beside its opposite.
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'menu_button';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> <span>Import Character</span>';
    importBtn.title = 'Read a character file somebody sent you, and add them to this list.';
    importBtn.addEventListener('click', () => importCharacterFile(() => renderCardGrid()));

    row.append(note, ensureGridBulk().bar, importBtn, newCategoryBtn, btn);
    return row;
}

/**
 * Which of this system's characters the open chat is for.
 *
 * Edited here rather than on the category, because the record lives on the chat: a
 * category holding a list of chat filenames goes stale the moment a chat is renamed, and
 * leaves dead entries behind when one is deleted.
 */
function buildChatScopeRow() {
    const row = document.createElement('div');
    row.className = 'sillynpc-chat-scope';

    if (!hasOpenChat()) {
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = 'Open a chat to choose which characters appear in it.';
        row.append(note);
        return row;
    }

    const cast = getChatCast();
    const scoped = cast.categories !== null;

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'sillynpc-chat-scope-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = scoped;
    toggle.addEventListener('change', () => {
        // Turning it off restores "everybody", which is what an unscoped chat means and
        // what every chat written before this reads as.
        setChatCast(toggle.checked
            ? { categories: getAllCategories(), include: cast.include, exclude: cast.exclude }
            : { categories: null, include: cast.include, exclude: cast.exclude });
        renderCardGrid();
        triggerReprocess();
    });
    toggleLabel.append(toggle, document.createTextNode('Limit this chat to certain categories'));
    row.append(toggleLabel);

    if (!scoped) {
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = 'Every character in this system appears in this chat.';
        row.append(note);
        return row;
    }

    const boxes = document.createElement('div');
    boxes.className = 'sillynpc-chat-scope-categories';
    // Uncategorised is offered like any other category rather than being a special case.
    for (const category of [UNCATEGORISED, ...getAllCategories()]) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = cast.categories.includes(category);
        box.addEventListener('change', () => {
            const next = new Set(getChatCast().categories || []);
            box.checked ? next.add(category) : next.delete(category);
            setChatCast({ categories: [...next], include: cast.include, exclude: cast.exclude });
            renderCardGrid();
            triggerReprocess();
        });
        label.append(box, document.createTextNode(category || 'Uncategorised'));
        boxes.append(label);
    }
    row.append(boxes);

    const help = document.createElement('small');
    help.className = 'notes';
    help.textContent = 'Characters outside this chat are not decorated, not added to the '
        + 'scene cast, and their lore is not injected. Click a dimmed card to let one in '
        + 'anyway, or keep one out.';
    row.append(help);

    return row;
}

function renderCardGrid() {
    const root = manageRoot.querySelector('#sillynpc-card-grid');
    if (!root) return;

    root.replaceChildren();

    // The full list on purpose: you have to be able to see somebody to put them back.
    const characters = getSettings().characters;
    root.appendChild(buildChatScopeRow());
    root.appendChild(buildSyncAllRow(characters));

    const filter = buildGridFilterRow(root);
    root.appendChild(filter.row);
    const groups = new Map();
    groups.set('', []);
    for (const char of characters) {
        const cat = char.category || '';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(char);
    }

    // The register's order, not the alphabet's, and every category in it - including one
    // nobody is in yet, which is the only way to file the first character into it.
    const categoryOrder = ['', ...getAllCategories()];

    for (const cat of categoryOrder) {
        const chars = groups.get(cat) || [];

        // One framed section per category, in its faction's colours and with its banner, the
        // same look as a character's profile.
        const section = document.createElement('section');
        section.className = 'sillynpc-cat-section';
        const world = safeWorld(activeCombatType);
        try {
            applyFactionTheme(section, cat, world);
            if (cat !== '') section.appendChild(buildFactionBanner(cat, world));
        } catch (err) { console.warn('[Worldkit] faction section failed', err); }
        if (cat !== '') {
            section.appendChild(buildCategoryHeading(cat));
        }

        const subgrid = document.createElement('div');
        subgrid.className = 'sillynpc-card-subgrid';
        subgrid.addEventListener('dragover', (e) => {
            if (draggedCharId) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
            }
        });
        subgrid.addEventListener('drop', (e) => {
            if (draggedCharId) {
                e.preventDefault();
                e.stopPropagation();
                moveCharacterToCategory(draggedCharId, cat);
                renderCardGrid();
            }
        });

        for (const char of chars) {
            subgrid.appendChild(buildCard(char));
        }
        if (cat === '') {
            subgrid.appendChild(buildAddCard());
        }
        section.appendChild(subgrid);
        root.appendChild(section);
    }

    // Last, because there is nothing to filter until the cards are in.
    filter.apply();
}

/**
 * The card grid's bulk selection, kept across the redraws that ticking a card causes.
 *
 * Built lazily rather than at module load: it calls renderCardGrid, which is not defined
 * until this module has finished evaluating.
 */
let gridBulk = null;

function ensureGridBulk() {
    if (gridBulk) return gridBulk;
    gridBulk = buildBulkBar({
        noun: 'character',
        allIds: () => (getSettings().characters || []).map(c => c.id),
        onDelete: (ids) => {
            for (const id of ids) deleteCharacter(id);
            toastr.success(`Deleted ${ids.length} character(s).`, PRODUCT_NAME);
        },
        onRefresh: () => renderCardGrid(),
        extra: [
            {
                label: 'Export selected',
                icon: 'fa-file-export',
                title: 'Write the chosen characters to one file you can send to somebody else.',
                onRun: (ids) => exportCharacterFile(
                    ids.map(id => findCharacter(id)).filter(Boolean)),
            },
        ],
    });
    return gridBulk;
}

let draggedCharId = null;
/**
 * The category heading being dragged, if one is.
 *
 * Separate from draggedCharId rather than one "what is being dragged": a heading is both
 * a drop target for a card and a draggable thing itself, and the two must not be mistaken
 * for each other - dropping a heading on a heading reorders, dropping a card on one files
 * the character.
 */
let draggedCategory = null;

/**
 * One category's heading: its name, what can be done to it, and where cards land.
 *
 * @param {string} cat
 * @returns {HTMLElement}
 */
function buildCategoryHeading(cat) {
    const heading = document.createElement('div');
    heading.className = 'sillynpc-category-heading';
    heading.draggable = true;
    heading.dataset.category = cat;
    try { applyFactionTheme(heading, cat, safeWorld(activeCombatType)); } catch { /* presentation only */ }

    heading.addEventListener('dragstart', (e) => {
        draggedCategory = cat;
        heading.classList.add('dragging');
        e.dataTransfer.setData('text/plain', cat);
        e.dataTransfer.effectAllowed = 'move';
        // SillyTavern's global handler reads a loose drag as a file upload.
        e.stopPropagation();
    });
    heading.addEventListener('dragend', (e) => {
        heading.classList.remove('dragging');
        draggedCategory = null;
        // Both states: a drag that ends outside any heading leaves whichever one it last
        // hovered still lit, and the two are different classes.
        manageRoot.querySelectorAll('.drag-over, .drag-over-category')
            .forEach(el => el.classList.remove('drag-over', 'drag-over-category'));
        e.stopPropagation();
    });

    heading.addEventListener('dragover', (e) => {
        const takesIt = draggedCharId || (draggedCategory && draggedCategory !== cat);
        if (!takesIt) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        heading.classList.add(draggedCategory ? 'drag-over-category' : 'drag-over');
    });
    heading.addEventListener('dragleave', () => {
        heading.classList.remove('drag-over', 'drag-over-category');
    });
    heading.addEventListener('drop', (e) => {
        const card = draggedCharId;
        const category = draggedCategory;
        if (!card && !category) return;
        e.preventDefault();
        e.stopPropagation();
        heading.classList.remove('drag-over', 'drag-over-category');
        // A card lands in this category; a heading takes this one's place in the order.
        if (card) moveCharacterToCategory(card, cat);
        else if (category !== cat) moveCategory(category, cat);
        renderCardGrid();
    });

    const label = document.createElement('span');
    label.className = 'sillynpc-category-label';
    label.textContent = cat;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'sillynpc-category-rename';
    renameBtn.title = `Rename category "${cat}"`;
    renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    renameBtn.addEventListener('click', async () => {
        const typed = (await Popup.show.input(`Rename "${cat}"`, 'New name:', cat))?.trim();
        if (!typed || typed === cat) return;

        // Merging is not undone by renaming back, so it is asked about rather than done
        // quietly because two names happened to collide.
        if (getAllCategories().includes(typed)) {
            const merge = await Popup.show.confirm(`Merge into "${typed}"?`,
                `"${typed}" already exists. Everyone in "${cat}" will join it, and the two `
                + 'cannot be separated again by renaming.');
            if (!merge) return;
        }

        renameCategory(cat, typed);
        renderCardGrid();
        // A renamed category can change who is in the open chat, and every card shows
        // whether they are.
        triggerReprocess();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'sillynpc-category-delete';
    deleteBtn.title = `Delete category "${cat}"`;
    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    deleteBtn.addEventListener('click', async () => {
        const confirmed = await Popup.show.confirm(`Delete category "${cat}"?`, 'Characters will be moved to uncategorized.');
        if (!confirmed) return;
        deleteCategory(cat);
        renderCardGrid();
        triggerReprocess();
    });

    heading.append(label, renameBtn, deleteBtn);
    return heading;
}

function buildCard(char) {
    const card = document.createElement('div');
    card.className = 'sillynpc-card';
    card.dataset.id = char.id;
    // The whole card wears its faction's colours, not just a stripe: the grid is the page the Characters button opens.
    try { applyFactionTheme(card, char.category, safeWorld(activeCombatType)); } catch { /* presentation only */ }

    // Shown but dimmed rather than hidden: a character you cannot see is one you cannot
    // let back in, and "where did everyone go" is the wrong thing to learn from a filter.
    const inChat = !hasOpenChat() || isCharacterInChat(char);
    if (!inChat) card.classList.add('sillynpc-card-out-of-chat');
    card.title = (char.name || '(unnamed)')
        + (inChat ? '' : ' — not in this chat');
    // Was role + tabindex and no key handler: it took focus, announced itself as a
    // button and did nothing when pressed. This adds the half that was missing.
    makeActivatable(card, { label: card.title });
    card.setAttribute('draggable', 'true');

    if (char.imageUrl) {
        const img = document.createElement('img');
        img.className = 'sillynpc-card-img';
        img.src = char.imageUrl;
        img.setAttribute('draggable', 'false');
        img.onerror = () => img.remove();
        card.appendChild(img);
    } else {
        const fallback = document.createElement('div');
        fallback.className = 'sillynpc-card-fallback';
        fallback.textContent = (char.name || '?').slice(0, 2).toUpperCase();
        card.appendChild(fallback);
    }
    
    if (char.color) {
        const stripe = document.createElement('div');
        stripe.className = 'sillynpc-card-color-stripe';
        stripe.style.backgroundColor = char.color;
        card.appendChild(stripe);
    }

    const label = document.createElement('div');
    label.className = 'sillynpc-card-label';
    label.textContent = char.name || '(unnamed)';
    card.appendChild(label);

    // While selecting, the card carries a checkbox instead of its own trash: two ways to
    // delete on one card, asking different questions, is how a tick becomes a deletion.
    if (gridBulk?.isActive()) {
        card.appendChild(buildBulkCheckbox(gridBulk, char.id));
    } else {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'sillynpc-card-delete';
        deleteBtn.title = 'Delete character';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await Popup.show.confirm(`Delete "${char.name || 'this character'}"?`)) {
                deleteCharacter(char.id);
                renderCardGrid();
            }
        });
        card.appendChild(deleteBtn);
    }

    // Only worth offering once a chat is actually being scoped; on an unscoped chat
    // everybody is already in and the control would mean nothing.
    if (hasOpenChat() && getChatCast().categories !== null) {
        const scopeBtn = document.createElement('button');
        scopeBtn.type = 'button';
        scopeBtn.className = 'sillynpc-card-scope';
        scopeBtn.title = inChat ? 'Keep out of this chat' : 'Let into this chat';
        scopeBtn.innerHTML = inChat
            ? '<i class="fa-solid fa-eye"></i>'
            : '<i class="fa-solid fa-eye-slash"></i>';
        scopeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cast = getChatCast();
            setChatCast({
                categories: cast.categories,
                include: inChat ? cast.include.filter(x => x !== char.id)
                                : [...cast.include, char.id],
                exclude: inChat ? [...cast.exclude, char.id]
                                : cast.exclude.filter(x => x !== char.id),
            });
            renderCardGrid();
            triggerReprocess();
        });
        card.appendChild(scopeBtn);
    }

    card.addEventListener('click', () => {
        // While selecting, the whole card is the tick target. Opening the editor from a
        // click meant to choose a card is the opposite of what the mode is for.
        if (gridBulk?.isActive()) {
            gridBulk.toggle(char.id, !gridBulk.isSelected(char.id));
            renderCardGrid();
            return;
        }
        openEditor(char.id);
    });
    
    // Drag & Drop
    card.addEventListener('dragstart', (e) => {
        draggedCharId = char.id;
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', char.id);
        e.dataTransfer.effectAllowed = 'move';
        // Stop propagation to prevent SillyTavern's global drag/drop from thinking this is a file upload
        e.stopPropagation();
    });
    card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
        draggedCharId = null;
        manageRoot.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        e.stopPropagation();
    });
    card.addEventListener('dragover', (e) => {
        if (draggedCharId && draggedCharId !== char.id) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        }
    });
    card.addEventListener('dragleave', (e) => {
        card.classList.remove('drag-over');
        e.stopPropagation();
    });
    card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over');
        if (draggedCharId && draggedCharId !== char.id) {
            reorderCharacters(draggedCharId, char.id);
            renderCardGrid();
        }
    });

    return card;
}

function buildAddCard() {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sillynpc-card sillynpc-card-add';
    card.title = 'Add character';
    card.innerHTML = '<i class="fa-solid fa-plus"></i>';
    card.addEventListener('click', () => {
        const char = createCharacter();
        // Made while a chat is open, so they belong to it - the same as a card made from a
        // message. Without this, somebody created for the scene you are in is invisible in
        // it the moment that chat is limited to categories.
        addCharacterToChat(char.id);
        openEditor(char.id);
    });
    return card;
}

function openEditor(id) {
    editingCharId = id;
    charView = 'profile';
    activeTab = 'characters';
    resetLorebookState();
    renderManageView();
}

/* ─── Editor View ────────────────────────────────────────────────────────── */

/**
 * Which face of a character is showing: what is known, or the form that changes it.
 *
 * Reset to 'profile' every time a character is opened, so arriving somewhere always means
 * arriving at the readable page. Changing it does not persist: coming back to somebody
 * later is arriving again.
 *
 * @type {'profile'|'edit'}
 */
let charView = 'profile';

/**
 * The two tabs, in their own class.
 *
 * NOT `.sillynpc-tab` with a `data-tab`, which is what the popup's own tab bar uses:
 * setupTabBar binds a click to every one of those inside manageRoot and renderManageView
 * strips `active` off any whose data-tab is not the open panel. An inner tab wearing that
 * class would switch the whole popup and then lose its own highlight on the next draw.
 */
function buildViewTabs(char) {
    const bar = document.createElement('div');
    bar.className = 'sillynpc-charview-tabs';

    for (const [view, label] of [['profile', 'Profile'], ['edit', 'Edit']]) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-charview-tab' + (charView === view ? ' active' : '');
        tab.dataset.view = view;
        tab.textContent = label;
        tab.addEventListener('click', () => {
            if (charView === view) return;
            charView = view;
            renderEditor();
        });
        bar.append(tab);
    }
    return bar;
}

/** The roster beside the detail: search, and a click switches character without going Back. */
let railFilter = '';
// Switching character rebuilds the page, so where the list was scrolled to is remembered here.
let railScroll = 0;
function buildRosterRail(current) {
    const rail = document.createElement('div');
    rail.className = 'sillynpc-roster-rail';
    rail.addEventListener('scroll', () => { railScroll = rail.scrollTop; }, { passive: true });
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'text_pole';
    search.placeholder = 'Search characters';
    search.value = railFilter;
    const list = document.createElement('div');
    list.className = 'sillynpc-roster-list';
    const draw = () => {
        list.replaceChildren();
        const q = railFilter.trim().toLowerCase();
        for (const c of getSettings().characters || []) {
            if (q && !String(c.name || '').toLowerCase().includes(q) && !String(c.category || '').toLowerCase().includes(q)) continue;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'sillynpc-roster-item' + (c.id === current.id ? ' active' : '');
            try { item.style.setProperty('--fx-accent', factionPalette(c.category, safeWorld(activeCombatType)).accent); } catch { /* presentation only */ }
            if (c.imageUrl) {
                const face = document.createElement('img');
                face.className = 'sillynpc-roster-face';
                face.src = c.imageUrl;
                face.alt = '';
                face.loading = 'lazy';
                face.addEventListener('error', () => face.remove(), { once: true });
                item.append(face);
            } else {
                const blank = document.createElement('span');
                blank.className = 'sillynpc-roster-face';
                blank.style.background = c.color || 'rgba(128,128,128,.3)';
                item.append(blank);
            }
            const name = document.createElement('span');
            name.textContent = c.name || '(unnamed)';
            item.append(name);
            item.title = c.category ? `${c.name} · ${c.category}` : (c.name || '');
            item.addEventListener('click', () => {
                if (c.id === current.id) return;
                editingCharId = c.id;
                renderEditor();
            });
            list.append(item);
        }
    };
    search.addEventListener('input', () => { railFilter = search.value; draw(); });
    draw();
    rail.append(search, list);
    return rail;
}

/** Lays out the roster rail beside the character's detail (the sticky header and the page). */
function mountDetail(editView, char, ...nodes) {
    const layout = document.createElement('div');
    layout.className = 'sillynpc-editor-layout';
    const detail = document.createElement('div');
    detail.className = 'sillynpc-editor-detail';
    const world = safeWorld(activeCombatType);
    try {
        applyFactionTheme(detail, char.category, world);
    } catch (err) {
        console.warn('[Worldkit] faction theme failed', err);
        try { applyFactionTheme(detail, '', null); } catch { /* the plain look is all that is left */ }
    }
    try {
        if (charView === 'edit') detail.append(buildFactionBanner(char.category, world));
    } catch (err) { console.warn('[Worldkit] faction banner failed', err); }
    detail.append(...nodes);
    const rail = buildRosterRail(char);
    layout.append(rail, detail);
    editView.append(layout);
    rail.scrollTop = railScroll;
}

function renderEditor() {
    const char = findCharacter(editingCharId);
    if (!char) { editingCharId = null; renderManageView(); return; }

    const editView = manageRoot.querySelector('#sillynpc-editor-view');
    if (!editView) return;
    
    editView.replaceChildren();

    const header = document.createElement('div');
    header.className = 'sillynpc-editor-header';
    
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'menu_button sillynpc-back-btn';
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
    backBtn.addEventListener('click', () => { editingCharId = null; renderManageView(); });
    
    const title = document.createElement('h3');
    title.className = 'sillynpc-editor-title';
    title.textContent = char.name || '(unnamed)';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'menu_button sillynpc-delete-btn';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteBtn.addEventListener('click', async () => {
        if (await Popup.show.confirm(`Delete "${char.name || 'this character'}"?`)) {
            deleteCharacter(char.id); editingCharId = null; renderManageView();
        }
    });
    
    // Between the title and delete: it acts on this whole card, like they do.
    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'menu_button sillynpc-fill-btn';
    fillBtn.innerHTML = '<i class="fa-solid fa-fill-drip"></i> <span>Fill</span>';
    fillBtn.title = 'Give this character a lore entry, tracker fields and a portrait, '
        + 'reading the story for what is missing.';
    fillBtn.addEventListener('click', () => fillCharacter(char, { onSave: () => renderEditor() }));

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'menu_button sillynpc-export-char-btn';
    exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i>';
    exportBtn.title = 'Write this character to a file - portraits and lore entry included - '
        + 'so it can be sent to somebody else.';
    exportBtn.addEventListener('click', () => exportCharacterFile([char]));

    header.append(backBtn, title, fillBtn, exportBtn, deleteBtn);

    // Header and tabs travel together so they can stay put while the page scrolls: a long
    // profile used to put Back, Fill and the tab switch off the top of the screen.
    const sticky = document.createElement('div');
    sticky.className = 'sillynpc-editor-sticky';
    sticky.append(header, buildViewTabs(char));

    // Profile is the whole body when it is showing: the form below is built only for the
    // Edit tab, so nothing hidden is being assembled and wired on every draw.
    if (charView === 'profile') {
        const view = document.createElement('div');
        mountDetail(editView, char, sticky, view);
        renderProfileView(char, view)
            .catch(err => console.error(LOG_PREFIX, 'renderProfileView failed', err));
        return;
    }

    const main = document.createElement('div');
    main.className = 'sillynpc-editor-main';
    
    // Left Column
    const left = document.createElement('div');
    left.className = 'sillynpc-editor-left';
    
    // Shared with the player sheet, which has the same picture, gallery and controls.
    const { preview, buttons: imgBtns } = buildPortraitBlock(char, { onChange: renderEditor });
    
    const fitField = document.createElement('div');
    fitField.className = 'sillynpc-editor-field';
    fitField.innerHTML = '<label>Image fit in chat</label>';
    const fitSelect = document.createElement('select');
    fitSelect.className = 'text_pole fit-select';
    fitSelect.innerHTML = `
        <option value="">(use default)</option>
        <option value="contain" ${char.imageFit === 'contain' ? 'selected' : ''}>Show full image</option>
        <option value="cover" ${char.imageFit === 'cover' ? 'selected' : ''}>Fill avatar (crop)</option>
    `;
    fitSelect.addEventListener('change', (e) => { char.imageFit = e.target.value; saveSettings(); });
    fitField.appendChild(fitSelect);
    
    const colorField = document.createElement('div');
    colorField.className = 'sillynpc-editor-field';
    colorField.innerHTML = '<label>Speech color</label>';
    colorField.appendChild(buildColorControl(char, 'color', '#ffffff', () => renderEditor()));

    // Optional extras. Empty means "the speech color", so a character with only the colour above set looks
    // exactly as before. With them, the text, the border accent and the background highlight can differ - a
    // highlight the same colour as the text on it is unreadable.
    const advanced = document.createElement('details');
    advanced.className = 'sillynpc-color-advanced';
    const advSummary = document.createElement('summary');
    advSummary.textContent = 'Advanced colors';
    advanced.appendChild(advSummary);
    // Dialogue text and its gradient are one group: the gradient runs from the dialogue colour to a second one,
    // so the two only make sense together.
    const textGroup = document.createElement('fieldset');
    textGroup.className = 'sillynpc-color-group';
    const textLegend = document.createElement('legend');
    textLegend.textContent = 'Dialogue text';
    textGroup.appendChild(textLegend);
    const textField = document.createElement('div');
    textField.className = 'sillynpc-editor-field';
    textField.innerHTML = '<label>Text color</label>';
    textField.appendChild(buildColorControl(char, 'colorText', char.color || '#ffffff'));
    const textNote = document.createElement('small');
    textNote.className = 'notes';
    textNote.textContent = 'The color of the words themselves.';
    textField.appendChild(textNote);
    textGroup.appendChild(textField);
    const gradLabel = document.createElement('label');
    gradLabel.className = 'checkbox_label';
    const gradBox = document.createElement('input');
    gradBox.type = 'checkbox';
    gradBox.checked = Boolean(char.colorGradient);
    gradLabel.append(gradBox, ' Gradient text: fade from the text color to a second color');
    textGroup.appendChild(gradLabel);
    const gradSecond = document.createElement('div');
    gradSecond.className = 'sillynpc-editor-field';
    gradSecond.style.display = gradBox.checked ? '' : 'none';
    gradSecond.innerHTML = '<label>Gradient ends in</label>';
    gradSecond.appendChild(buildColorControl(char, 'colorText2', char.color || '#ffffff'));
    gradBox.addEventListener('change', () => {
        char.colorGradient = gradBox.checked;
        gradSecond.style.display = gradBox.checked ? '' : 'none';
        saveSettings();
    });
    textGroup.appendChild(gradSecond);
    advanced.appendChild(textGroup);

    for (const [key, text, help] of [
        ['colorBorder', 'Border accent', 'The stripe at the left of a line (Left Border Accent, Subtle Gradient and Full Highlight styles).'],
        ['colorBg', 'Background highlight', 'The tint behind a line (Soft Background, Subtle Gradient and Full Highlight styles).'],
    ]) {
        const field = document.createElement('div');
        field.className = 'sillynpc-editor-field';
        field.innerHTML = `<label>${text}</label>`;
        field.appendChild(buildColorControl(char, key, char.color || '#ffffff'));
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = help;
        field.appendChild(note);
        advanced.appendChild(field);
    }
    colorField.appendChild(advanced);
    
    const catContainer = document.createElement('div');
    catContainer.className = 'sillynpc-editor-field category-field-container';
    
    left.append(preview, imgBtns, fitField, colorField, catContainer);
    
    const vDivider = document.createElement('div');
    vDivider.className = 'sillynpc-editor-vdivider';
    
    // Right Column
    const right = document.createElement('div');
    right.className = 'sillynpc-editor-right';
    
    const nameField = document.createElement('div');
    nameField.className = 'sillynpc-editor-field';
    nameField.innerHTML = '<label>Name</label>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text_pole name-input';
    nameInput.value = char.name;
    nameInput.placeholder = 'e.g. Herald Vesper';
    nameInput.addEventListener('input', (e) => {
        char.name = e.target.value;
        title.textContent = char.name || '(unnamed)';
        saveSettings();
    });
    /* The lorebook follows the name, but only once you have finished typing it.

       Renaming used to change the settings and nothing else, so the entry kept the title
       and the keywords it was created with - and since keywords are what SillyTavern
       matches on to decide whether an entry fires at all, renaming a character quietly
       switched their lore off. It still answered only to the name they used to have.

       On 'change' rather than 'input': the handler above runs on every keystroke, and
       rewriting a lorebook file per character typed is not something to do to somebody's
       data. The old name survives as a keyword either way - mergeKeywords adds - which is
       right, because the chat above still says it. */
    nameInput.addEventListener('change', () => {
        renameLorebookEntry(char).catch(err =>
            console.error(LOG_PREFIX, 'Could not rename the lorebook entry', err));
    });
    nameField.appendChild(nameInput);
    
    const extrasContainer = document.createElement('div');
    extrasContainer.className = 'sillynpc-editor-field sillynpc-extras-container';

    const loreContainer = document.createElement('div');
    loreContainer.className = 'lorebook-section-container';
    
    const aliasField = document.createElement('div');
    aliasField.className = 'sillynpc-editor-field';
    aliasField.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Name patterns (aliases)</label>
            <small class="notes">Extra names that should also resolve to this character.</small>
        </div>
    `;
    const aliasList = document.createElement('div');
    aliasList.className = 'sillynpc-alias-list';
    char.aliases.forEach((alias, i) => aliasList.appendChild(buildAliasRow(char, i)));
    
    const addAliasBtn = document.createElement('button');
    addAliasBtn.type = 'button';
    addAliasBtn.className = 'menu_button add-alias-btn';

    addAliasBtn.style.whiteSpace = 'nowrap';
    addAliasBtn.style.width = 'fit-content';

    addAliasBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add alias';
    addAliasBtn.style.whiteSpace = 'nowrap';
    addAliasBtn.style.width = 'auto';
    addAliasBtn.style.minWidth = 'max-content';
    addAliasBtn.addEventListener('click', () => {
        char.aliases.push({ pattern: '', isRegex: false }); saveSettings(); renderEditor();
    });
    aliasField.append(aliasList, addAliasBtn);
    
    const overridesContainer = document.createElement('div');
    overridesContainer.className = 'sillynpc-editor-field overrides-field-container';

    const collectionsContainer = document.createElement('div');
    collectionsContainer.className = 'sillynpc-editor-field collections-field-container';

    const combatContainer = document.createElement('div');
    combatContainer.className = 'sillynpc-editor-field sillynpc-combat-section';
    
    // The lorebook link goes right under the name: it is who they are, and the phone, the
    // games and everything else that describes somebody reads it from here.
    right.append(nameField, loreContainer, aliasField, extrasContainer, overridesContainer,
        collectionsContainer, combatContainer);
    
    main.append(left, vDivider, right);
    mountDetail(editView, char, sticky, main);

    renderCategorySelect(char, catContainer);
    renderCharacterExtras(char, extrasContainer);
    renderLorebookSection(char, loreContainer, { onChange: renderEditor });
    renderOverridesSection(char, overridesContainer);
    renderCollectionsSection(char, collectionsContainer);
    renderCombatSection(char, combatContainer, { onChange: renderEditor });
}

function renderCollectionsSection(char, container) {
    if (!container) return;
    
    const settings = getSettings().statusTracker;
    const collections = settings.collections.filter(col => col.target === 'npc' || col.target === 'all');
    
    if (collections.length === 0) return;

    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Current Collections</label>
            <small class="notes">Manage inventory and other collections for this NPC in the current chat.</small>
        </div>
        <div class="sillynpc-npc-collections-tabs sillynpc-sheet-tabs" style="margin-top: 10px;">
            ${collections.map((col, idx) => `
                <div class="sillynpc-tab ${idx === 0 ? 'active' : ''}" data-tab="${escapeHtml(col.id)}">${escapeHtml(col.name)}</div>
            `).join('')}
        </div>
        <div class="sillynpc-npc-collections-content" style="margin-top: 10px;">
            <!-- Collection UI will be rendered here -->
        </div>
    `;

    const contentArea = container.querySelector('.sillynpc-npc-collections-content');
    const tabs = container.querySelectorAll('.sillynpc-tab');
    
    let currentCollectionId = collections[0].id;

    // Off by default every time the editor opens: seeing a card's stored belongings is
    // a deliberate act, not a mode you can forget you left on.
    let editOffstage = false;

    /** Holds the ticked rows across the redraws that ticking one causes. */
    let collectionBulk = null;

    const refreshCollection = () => {
        const state = loadStateFromMetadata();
        const charInState = state.characters.find(c => c.name.toLowerCase() === char.name.toLowerCase());

        // Off stage, the character's belongings still exist - they are kept on the card as
        // statusCollections, which is what seeds them when they next walk into a scene. The
        // editor used to refuse to show them at all, so the only way to correct an
        // inventory was to drag the character into the scene first.
        if (!charInState && !editOffstage) {
            const notice = document.createElement('p');
            notice.className = 'notes';
            notice.textContent = `${char.name || 'This character'} is not in the current scene, `
                + 'so these are the belongings stored on their card rather than live values.';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu_button';
            btn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit stored collections';
            btn.addEventListener('click', async () => {
                const ok = await Popup.show.confirm(
                    'Edit belongings for a character who is not in the scene?',
                    'These are the values stored on the card. They are copied into the scene '
                    + 'the next time this character appears, so an edit made now is what they '
                    + 'will arrive with. If they are already in another chat, that chat keeps '
                    + 'its own live values and is not changed.',
                );
                if (!ok) return;
                editOffstage = true;
                refreshCollection();
            });

            contentArea.replaceChildren(notice, btn);
            return;
        }

        // A card-backed actor, shaped like a scene one so the same renderer and listeners
        // work unchanged rather than needing an off-stage variant.
        const actor = charInState || {
            name: char.name,
            stats: char.statusOverrides || {},
            collections: char.statusCollections || (char.statusCollections = {}),
        };

        // Built once per editor rather than per redraw: the handle holds the selection,
        // and rebuilding it with the panel would forget every tick.
        if (!collectionBulk) {
            collectionBulk = buildBulkBar({
                noun: 'item',
                allIds: () => {
                    const list = resolveCollectionTarget(actor, false).target
                        ?.collections?.[currentCollectionId] || [];
                    return list.map((_, i) => i);
                },
                onDelete: (ids) => {
                    const where = resolveCollectionTarget(actor, false);
                    const list = where.target?.collections?.[currentCollectionId];
                    if (!list) return;
                    // Descending, or the first splice shifts every index chosen after it.
                    const removed = spliceIndexes(list, ids);
                    persistCollectionEdit(`Dropped ${removed} item(s)`, where, false);
                },
                onRefresh: () => refreshCollection(),
            });
        }

        contentArea.innerHTML = renderCollectionUI(currentCollectionId, actor, settings, {
            bulk: collectionBulk,
        });
        attachCollectionListeners(contentArea, actor, () => {
            // Edits to a card-backed actor have to be written back to the card; a scene
            // actor is already part of the state the tracker saves.
            if (!charInState) saveSettings();
            refreshCollection();
        }, collectionBulk);
    };


    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCollectionId = tab.dataset.tab;
            refreshCollection();
        });
    });

    refreshCollection();
}

function renderCategorySelect(char, container) {
    if (!container) return;
    container.innerHTML = `<label>Category</label><select class="text_pole category-select"></select>`;
    const select = container.querySelector('select');
    const categories = getAllCategories();
    
    let html = `<option value="">(none)</option>`;
    categories.forEach(cat => html += `<option value="${escapeHtml(cat)}" ${char.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`);
    if (char.category && !categories.includes(char.category)) {
        html += `<option value="${escapeHtml(char.category)}" selected>${escapeHtml(char.category)}</option>`;
    }
    html += `<option value="__new__">+ New category…</option>`;
    select.innerHTML = html;

    select.addEventListener('change', async () => {
        if (select.value === '__new__') {
            const name = (await Popup.show.input('New category', 'Enter a name:'))?.trim();
            if (name) {
                // Into the register as well as onto this character, or the category would
                // last only as long as they stayed in it.
                createCategory(name);
                char.category = name;
                saveSettings();
            }
            renderEditor();
        } else {
            char.category = select.value; saveSettings();
        }
    });
}

function renderOverridesSection(char, container) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Initial Status Overrides</label>
            <small class="notes">Leave blank to use global default values.</small>
        </div>
    `;

    const stats = getSettings().statusTracker.npcStats || [];
    if (stats.length === 0) {
        const p = document.createElement('p');
        p.className = 'notes';
        p.textContent = 'No character stats defined in Status Settings.';
        container.appendChild(p);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'sillynpc-overrides-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gap = '8px';
    grid.style.marginTop = '8px';

    stats.forEach(stat => {
        const row = document.createElement('div');
        row.className = 'sillynpc-override-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';

        const label = document.createElement('div');
        label.style.flex = '0 0 80px';
        label.style.fontWeight = 'bold';
        label.textContent = stat.name;

        // Parse currentValue (e.g. "50/100" or "50")
        const currentValue = char.statusOverrides?.[stat.name] || '';
        let valPart = currentValue;
        let maxPart = '';
        if (typeof currentValue === 'string' && currentValue.includes('/')) {
            const parts = currentValue.split('/');
            valPart = parts[0];
            maxPart = parts[1];
        }

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'text_pole override-val-input';
        valInput.style.flex = '2';
        valInput.placeholder = `Val (Def: ${stat.defaultValue || ''})`;
        valInput.value = valPart;

        const slashLabel = document.createElement('span');
        slashLabel.textContent = '/';
        slashLabel.style.opacity = '0.5';

        const maxInput = document.createElement('input');
        maxInput.type = 'text';
        maxInput.className = 'text_pole override-max-input';
        maxInput.style.flex = '1';
        maxInput.placeholder = `Max (Def: ${stat.maxStatValue || ''})`;
        maxInput.value = maxPart;

        const updateOverride = () => {
            const v = valInput.value.trim();
            const m = maxInput.value.trim();
            
            if (!char.statusOverrides) char.statusOverrides = {};
            
            if (v === '' && m === '') {
                delete char.statusOverrides[stat.name];
            } else if (m !== '') {
                char.statusOverrides[stat.name] = `${v}/${m}`;
            } else {
                char.statusOverrides[stat.name] = v;
            }
            
            saveSettings();
            
            const finalValue = char.statusOverrides[stat.name] || '';
            syncOverrideToActiveState(char.name, stat.name, finalValue);
            triggerReprocess();
        };

        if (isChoiceField(stat)) {
            const select = buildChoiceSelect(stat.options, currentValue);
            select.style.flex = '3';
            select.addEventListener('change', () => {
                if (!char.statusOverrides) char.statusOverrides = {};
                const chosen = select.value;
                if (chosen === '') delete char.statusOverrides[stat.name];
                else char.statusOverrides[stat.name] = chosen;

                saveSettings();
                syncOverrideToActiveState(char.name, stat.name, chosen);
                triggerReprocess();
            });
            row.append(label, select);
            grid.appendChild(row);
            return;
        }

        valInput.addEventListener('input', updateOverride);
        maxInput.addEventListener('input', updateOverride);

        row.append(label, valInput, slashLabel, maxInput);
        grid.appendChild(row);
    });

    container.appendChild(grid);
}

function buildAliasRow(char, index) {
    const alias = char.aliases[index];
    const row = document.createElement('div');
    row.className = 'sillynpc-alias-row';
    row.innerHTML = `
        <input type="text" class="text_pole sillynpc-alias-pattern" value="${escapeHtml(alias.pattern)}" placeholder="Pattern">
        <label class="checkbox_label sillynpc-alias-regex"><input type="checkbox" ${alias.isRegex ? 'checked' : ''}> <span>Regex</span></label>
        <button type="button" class="menu_button delete-btn"><i class="fa-solid fa-trash"></i></button>
    `;
    const input = row.querySelector('input[type="text"]');
    const check = row.querySelector('input[type="checkbox"]');
    const validate = () => {
        input.classList.remove('sillynpc-invalid');
        if (alias.isRegex && alias.pattern) { try { new RegExp(alias.pattern); } catch { input.classList.add('sillynpc-invalid'); } }
    };
    input.addEventListener('input', () => { alias.pattern = input.value; saveSettings(); validate(); });
    check.addEventListener('change', () => { alias.isRegex = check.checked; saveSettings(); validate(); });
    row.querySelector('.delete-btn').addEventListener('click', () => { char.aliases.splice(index, 1); saveSettings(); renderEditor(); });
    validate();
    return row;
}

function exportData() {
    offerDownload(exportSettingsData(),
        `sillynpc-export-${new Date().toISOString().slice(0, 10)}.json`);
}

async function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const confirm = await Popup.show.confirm('Import Data', 'This will overwrite your current Worldkit characters and settings. Continue?');
            if (!confirm) return;

            importSettingsData(text);
            renderManageView();
            toastr.success('Imported successfully.');
        } catch (err) {
            console.error(LOG_PREFIX, 'Import failed', err);
            toastr.error(`Import failed: ${err.message}`);
        }
    };
    input.click();
}

/**
 * A colour control: swatch, picker, a box for typing a hex code, and a clear button. The picker and the
 * box stay in step; a typed code is only kept once it is a valid hex (3 or 6 digits, # optional).
 * Writes char[key] ('' when cleared) and saves.
 */
function buildColorControl(char, key, fallback = '#ffffff', onClear = null) {
    const normalise = (value) => {
        let t = String(value || '').trim();
        if (!t) return '';
        if (t[0] !== '#') t = `#${t}`;
        if (/^#[0-9a-f]{3}$/i.test(t)) t = `#${[...t.slice(1)].map(c => c + c).join('')}`;
        return /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : null;
    };
    const row = document.createElement('div');
    row.className = 'sillynpc-color-row';
    const swatch = document.createElement('div');
    swatch.className = 'sillynpc-color-swatch';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'sillynpc-color-input';
    const hexBox = document.createElement('input');
    hexBox.type = 'text';
    hexBox.className = 'text_pole sillynpc-color-hex';
    hexBox.placeholder = '#rrggbb';
    hexBox.maxLength = 7;
    hexBox.style.cssText = 'width:7em; flex:none;';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'menu_button clear-color-btn';
    clear.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    clear.title = 'Clear';
    const show = () => {
        const v = normalise(char[key]) || '';
        swatch.style.backgroundColor = v || 'transparent';
        picker.value = v || normalise(fallback) || '#ffffff';
        hexBox.value = v;
        hexBox.style.borderColor = '';
    };
    const set = (v) => { char[key] = v; saveSettings(); show(); };
    picker.addEventListener('input', () => set(picker.value));
    hexBox.addEventListener('input', () => {
        const v = normalise(hexBox.value);
        if (v === null) { hexBox.style.borderColor = '#d9534f'; return; }
        hexBox.style.borderColor = '';
        char[key] = v;
        saveSettings();
        swatch.style.backgroundColor = v || 'transparent';
        picker.value = v || normalise(fallback) || '#ffffff';
    });
    hexBox.addEventListener('change', show);
    clear.addEventListener('click', () => { set(''); onClear?.(); });
    show();
    row.append(swatch, picker, hexBox, clear);
    return row;
}
