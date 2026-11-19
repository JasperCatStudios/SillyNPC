/**
 * The shared activity window (fork): one panel with a header, a main area, and the partner's talk on the side.
 * The same layout as the Games and Combat windows, in their black theme. The hub, the setup screens and every
 * activity draw into `main`; the talk panel is shared, so each activity only says what to draw and when the
 * partner speaks.
 *
 * The window has two views. 'hub' uses the whole width (no talk panel). 'play' shows the activity beside the
 * partner's talk (stacked on a phone, with the talk as a one-line strip that opens when tapped).
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {{ onClose?: () => void }} [opts]
 * @returns the window handle
 */
export function createActivityWindow({ onClose } = {}) {
    const root = el('div', 'snpc-act');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', 'Activities');

    const head = el('div', 'snpc-act-head');
    const title = el('span', 'snpc-act-title');
    const closeBtn = el('button', 'snpc-act-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.append(el('i', 'fa-solid fa-xmark'));
    head.append(title, closeBtn);

    const body = el('div', 'snpc-act-body');
    const main = el('div', 'snpc-act-main');

    // Side: the partner and the talk.
    const side = el('div', 'snpc-act-side');
    const partnerRow = el('div', 'snpc-act-partner');
    const avatar = el('img', 'snpc-act-avatar');
    avatar.alt = '';
    avatar.addEventListener('error', () => { avatar.style.display = 'none'; });
    const who = el('div');
    const whoName = el('div', 'snpc-act-partner-name');
    const whoSub = el('small', 'snpc-act-partner-sub');
    who.append(whoName, whoSub);
    partnerRow.append(avatar, who);
    partnerRow.title = 'Tap to make the talk bigger or smaller';
    partnerRow.addEventListener('click', () => root.classList.toggle('is-chat-big'));

    const tabs = el('div', 'snpc-act-tabs');
    tabs.setAttribute('role', 'tablist');
    const chatTab = el('button', 'snpc-act-tab is-active', 'Chat');
    const logTab = el('button', 'snpc-act-tab', 'Log');
    const helpTab = el('button', 'snpc-act-tab', 'How to play');
    for (const [b, v] of [[chatTab, 'chat'], [logTab, 'log'], [helpTab, 'help']]) {
        b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.view = v;
        b.setAttribute('aria-selected', String(v === 'chat'));
    }
    tabs.append(chatTab, logTab, helpTab);

    const chat = el('div', 'snpc-act-chat');
    chat.dataset.view = 'chat';
    chat.setAttribute('role', 'log');
    chat.setAttribute('aria-live', 'polite');

    // How to play: the rules of the activity on screen, written by the activity (setHelp). Shown in place of the chat.
    const help = el('div', 'snpc-act-help');
    help.hidden = true;
    help.setAttribute('role', 'tabpanel');
    help.tabIndex = 0;

    const inputRow = el('div', 'snpc-act-input');
    const input = el('input', 'snpc-act-field');
    input.type = 'text';
    input.placeholder = 'Say something...';
    input.setAttribute('aria-label', 'Say something to your partner');
    const send = el('button', 'snpc-act-send');
    send.type = 'button';
    send.setAttribute('aria-label', 'Send');
    send.append(el('i', 'fa-solid fa-paper-plane'));
    inputRow.append(input, send);

    side.append(partnerRow, tabs, chat, help, inputRow);
    body.append(main, side);
    root.append(head, body);

    /** Every line said or logged, in order: { who, text, kind: 'bot' | 'user' | 'system' }. */
    const lines = [];
    let sayHandler = null;
    let returnFocus = null;

    /** Which side-panel parts the player wants (settings): the table talk and the How to play tab. Both on by default. */
    let panels = { talk: true, howTo: true };
    let isPlay = false;

    const setTab = (view) => {
        const showHelp = view === 'help';
        chat.hidden = showHelp;
        help.hidden = !showHelp;
        if (!showHelp) chat.dataset.view = view;
        for (const b of [chatTab, logTab, helpTab]) {
            const on = b.dataset.view === view;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', String(on));
        }
    };
    /**
     * Shows or hides the parts of the side panel: the chat and its box need the table talk on and someone to talk to; the Log goes with
     * the table talk; the rules tab has its own switch. With both off the whole panel is gone and the activity has the full width.
     */
    const applyPanels = () => {
        const solo = root.classList.contains('is-solo');
        const talk = panels.talk && !solo;
        chatTab.hidden = !talk;
        logTab.hidden = !panels.talk;
        inputRow.hidden = !talk;
        helpTab.hidden = !panels.howTo;
        tabs.hidden = !(panels.talk || panels.howTo);
        side.hidden = !isPlay || !(panels.talk || panels.howTo);
        // The tab on show must be one that can be seen.
        const visible = [[chatTab, 'chat'], [logTab, 'log'], [helpTab, 'help']].filter(([b]) => !b.hidden);
        const active = [chatTab, logTab, helpTab].find(b => b.classList.contains('is-active'));
        if (visible.length && (!active || active.hidden)) setTab(visible[0][1]);
    };

    chatTab.addEventListener('click', () => setTab('chat'));
    logTab.addEventListener('click', () => setTab('log'));
    helpTab.addEventListener('click', () => setTab('help'));

    const submit = () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        api.addLine(api.userName, text, 'user');
        sayHandler?.(text);
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); api.close(); return; }
        if (e.key !== 'Tab') return;
        // Keep the focus inside the panel while it is open.
        const items = [...root.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    const api = {
        root, main, userName: 'You',
        /** Sets the title (with an icon class like 'fa-seedling'). */
        setTitle(text, icon = 'fa-seedling') {
            title.replaceChildren(el('i', `fa-solid ${icon}`), document.createTextNode(` ${text}`));
            root.setAttribute('aria-label', text);
        },
        /** 'hub' (whole width) or 'play' (activity and talk). */
        setView(view) {
            const play = view === 'play';
            root.dataset.view = play ? 'play' : 'hub';
            // The side panel belongs to the play view only; it must come back whenever a game starts.
            isPlay = play;
            applyPanels();
        },
        /** The player's choices for the side panel: { talk, howTo }. Applied at once and kept for the next game. */
        setPanels({ talk = true, howTo = true } = {}) {
            panels = { talk: Boolean(talk), howTo: Boolean(howTo) };
            applyPanels();
        },
        setPartner(name, picture = '', sub = '') {
            whoName.textContent = name || '';
            whoSub.textContent = sub;
            if (picture) { avatar.src = picture; avatar.style.display = ''; } else { avatar.removeAttribute('src'); avatar.style.display = 'none'; }
        },
        setSub(text) { whoSub.textContent = text; },
        /**
         * The How to play tab: a list of { title, text } sections (text may have several paragraphs separated by a blank line).
         * Called by each activity when it starts. The tab the player is on does not change.
         */
        setHelp(sections) {
            help.replaceChildren();
            for (const s of sections || []) {
                if (s.title) help.append(el('h4', 'snpc-act-help-title', s.title));
                for (const para of String(s.text || '').split(/\n\s*\n/)) if (para.trim()) help.append(el('p', 'snpc-act-help-text', para.trim()));
            }
        },
        showHelp() { setTab('help'); },
        /** Playing alone: no chat tab and no box to type in, and the rules open first. Playing with someone puts them back. */
        setSolo(on) {
            root.classList.toggle('is-solo', Boolean(on));
            setTab(on ? 'help' : 'chat');
            applyPanels();
        },
        /** Starts a new conversation (the talk of a new session). */
        resetTalk() { lines.length = 0; chat.replaceChildren(); },
        /** kind: 'bot' (the partner), 'user', 'system' (shows in the Log tab only), 'typing' (removed by removeTyping). */
        addLine(name, text, kind = 'bot') {
            if (kind !== 'typing') lines.push({ who: name, text, kind });
            const row = el('div', `snpc-act-msg ${kind === 'typing' ? 'bot is-typing' : kind}`);
            if (kind === 'bot' || kind === 'typing') row.append(el('b', '', `${name}: `));
            row.append(document.createTextNode(text));
            chat.append(row);
            chat.scrollTop = chat.scrollHeight;
            return row;
        },
        removeTyping() { chat.querySelectorAll('.is-typing').forEach(n => n.remove()); },
        /** The partner's and the player's lines (not the log), for the talk entry kept in the chat history. */
        talk() { return lines.filter(l => l.kind === 'bot' || l.kind === 'user').map(l => ({ who: l.who, text: l.text })); },
        onSay(fn) { sayHandler = fn; },
        setTalkVisible(on) { side.hidden = !on; },
        open(from) {
            returnFocus = from || document.activeElement;
            if (!root.isConnected) document.body.append(root);
            root.classList.add('is-open');
            (closeBtn).focus({ preventScroll: true });
        },
        isOpen: () => root.classList.contains('is-open'),
        close() {
            root.classList.remove('is-open');
            try { returnFocus?.focus?.({ preventScroll: true }); } catch { /* it may be gone */ }
            onClose?.();
        },
    };
    closeBtn.addEventListener('click', () => api.close());
    api.setView('hub');
    return api;
}
