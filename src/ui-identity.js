import { getSettings, saveSettings } from './settings.js';
import { promptListAvailable } from './prompt-slot.js';
import { identitySettings, saveIdentitySettings, currentIdentityText } from './identity.js';
import {
    IDENTITY_MODES, IDENTITY_POSITIONS, IDENTITY_ROLES, DEFAULT_IDENTITY_INSTRUCTION,
    normalizeLink, linkedCard, linkedFrom, buildIdentityBlock,
} from './identity-core.js';

/**
 * Hidden identities, the screens (fork). Two parts:
 *   - the "Identity" tab on a character's profile: who they secretly are (another character card) and the
 *     prompt for this identity. Each of the two cards has its own prompt.
 *   - Writing Rules, Hidden Identities: when the secret is sent to the story model (off, always while one of
 *     them is in the scene, or a chance each reply) and where it is placed, like the other injections.
 *
 * Text boxes save as they are typed and nothing redraws, so typing is never interrupted.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const row = (labelText, control, hint) => {
    const wrap = el('div', 'sillynpc-setting-row');
    const label = el('label', 'sillynpc-setting-label', hint ? `${labelText} ⓘ` : labelText);
    if (hint) { label.title = hint; control.title = hint; }
    wrap.append(label, control);
    return wrap;
};

function select(table, value, onChange) {
    const s = el('select', 'text_pole');
    for (const [k, v] of Object.entries(table)) s.append(new Option(v, k));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

function number(value, min, max, onChange) {
    const i = el('input', 'text_pole');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.style.width = '6em';
    i.value = String(value);
    i.addEventListener('change', () => onChange(Number(i.value)));
    return i;
}

/* ------------------------------------------------------------------ the profile tab */

/**
 * @param {object} char the character card (the saved object)
 * @returns {HTMLElement}
 */
export function buildIdentityCard(char) {
    const card = el('div', 'snpc-identity-card');
    const body = el('div');
    card.append(body);

    const draw = () => {
        body.replaceChildren();
        const everyone = getSettings().characters || [];
        const link = normalizeLink(char.identity);
        const other = linkedCard(char, everyone);

        body.append(el('p', 'notes',
            'Link this card to another one when they are secretly the same person: an alter ego, a disguise, a double life. '
            + 'While either of the two is in the scene, the story model is told never to reveal it, along with the prompt you write here for this identity. '
            + 'Each card has its own image, lore and prompt, and nothing switches: who is in the scene decides what is sent.'));

        const pick = el('select', 'text_pole');
        pick.append(new Option('Nobody (no secret)', ''));
        for (const c of everyone.filter(c => c !== char && c.id !== char.id && c.name).sort((a, b) => a.name.localeCompare(b.name))) pick.append(new Option(c.name, c.id));
        pick.value = other?.id || '';
        pick.addEventListener('change', () => {
            const chosen = everyone.find(c => c.id === pick.value);
            const prompt = normalizeLink(char.identity)?.prompt || '';
            char.identity = chosen ? { withId: chosen.id, withName: chosen.name, prompt } : (prompt ? { withId: '', withName: '', prompt } : null);
            saveSettings();
            draw();
        });
        body.append(row(`${char.name || 'This character'} is secretly`, pick));
        if (link && (link.withId || link.withName) && !other) {
            body.append(el('small', 'notes', `The card "${link.withName || 'unknown'}" is not in the list any more, so nothing is sent until you pick another.`));
        }

        // The other side: say whether it points back, and offer to make it so.
        if (other) {
            const back = linkedCard(other, everyone);
            if (back?.id === char.id) {
                body.append(el('small', 'notes', `${other.name} is linked back to ${char.name}. Open their profile to edit their own prompt.`));
            } else {
                const line = el('div');
                line.append(el('small', 'notes', `${other.name} is not linked back yet, so their side sends nothing. `));
                const make = el('button', 'menu_button', `Link ${other.name} back`);
                make.type = 'button';
                make.addEventListener('click', () => {
                    const prompt = normalizeLink(other.identity)?.prompt || '';
                    other.identity = { withId: char.id, withName: char.name, prompt };
                    saveSettings();
                    draw();
                });
                line.append(make);
                body.append(line);
            }
        }
        const incoming = linkedFrom(char, everyone).filter(c => c.id !== other?.id);
        if (incoming.length) body.append(el('small', 'notes', `Also linked to this card from: ${incoming.map(c => c.name).join(', ')}.`));

        // This identity's own prompt.
        const prompt = el('textarea', 'text_pole');
        prompt.rows = 6;
        prompt.maxLength = 2000;
        prompt.placeholder = 'How this identity behaves and what it is for. For example: how they speak, what they hide, what they must never do or say, '
            + 'what the other identity does that this one does not. <<name>> is this card, <<other>> the one they secretly are.';
        prompt.value = link?.prompt || '';
        prompt.addEventListener('input', () => {
            const cur = normalizeLink(char.identity) || { withId: '', withName: '', prompt: '' };
            char.identity = normalizeLink({ ...cur, prompt: prompt.value });
            saveSettings();
        });
        body.append(el('label', 'sillynpc-setting-label', `Prompt for ${char.name || 'this identity'}`), prompt);
        body.append(el('small', 'notes', 'Sent only while this card is in the scene, after the general instruction in Writing Rules > Hidden Identities.'));

        // Preview of what would go for this card alone.
        const preview = el('button', 'menu_button', 'Preview what is sent for this card');
        preview.type = 'button';
        const out = el('pre');
        out.style.cssText = 'white-space:pre-wrap; word-break:break-word; display:none; font-size:.85em; user-select:text; margin-top:6px;';
        preview.addEventListener('click', () => {
            const text = buildIdentityBlock(everyone, [char.name], identitySettings());
            out.textContent = text || 'Nothing: this card is not linked to another card that exists.';
            out.style.display = '';
        });
        body.append(preview, out);
    };
    draw();
    return card;
}

/* ------------------------------------------------------------------ Writing Rules */

/**
 * @param {() => void} rerender redraws the Writing Rules tab (used when a choice changes which controls show)
 * @returns {HTMLElement}
 */
export function buildIdentitySettings(rerender) {
    const wrap = el('div', 'sillynpc-identity-settings');
    const heading = el('h4', 'sillynpc-subsection-title', 'Hidden Identities');
    wrap.append(heading);
    wrap.append(el('p', 'notes',
        'For characters you linked as one secret person (profile, Identity tab). When one of them is in the scene, the story model is told never to reveal it, '
        + 'with that card\'s own prompt. Off sends nothing.'));

    const cfg = identitySettings();
    const set = (patch, redraw = false) => { Object.assign(identitySettings(), patch); saveIdentitySettings(); if (redraw) rerender?.(); };

    wrap.append(row('Send it', select(IDENTITY_MODES, cfg.mode, v => set({ mode: v }, true)),
        'Always: every reply while one of the two is in the scene. Random: each reply has a chance, with a cooldown, so the secret is brought up now and then.'));
    if (cfg.mode === 'off') return wrap;
    if (cfg.mode === 'random') {
        wrap.append(row('Chance each reply, %', number(cfg.chance, 0, 100, v => set({ chance: v })), '100 means every reply.'));
        wrap.append(row('Cooldown (replies)', number(cfg.cooldown, 0, 50, v => set({ cooldown: v })), 'At least this many replies between two times. Not used at 100%.'));
    }

    if (promptListAvailable()) {
        const box = el('input');
        box.type = 'checkbox';
        box.checked = cfg.inList;
        box.addEventListener('change', () => set({ inList: box.checked }, true));
        const label = el('label', 'checkbox_label');
        label.append(box, el('span', '', "Manage In SillyTavern's Prompt List"));
        wrap.append(label);
    }
    if (!cfg.inList) {
        wrap.append(row('Where', select(IDENTITY_POSITIONS, cfg.position, v => set({ position: v }, true))));
        if (cfg.position === 'chat') wrap.append(row('Messages back', number(cfg.depth, 0, 100, v => set({ depth: v })), '0 is right after the newest message'));
        wrap.append(row('Role', select(IDENTITY_ROLES, cfg.role, v => set({ role: v }))));
    } else {
        wrap.append(row('Order', number(cfg.order, 0, 1000, v => set({ order: v })), 'Blocks at the same depth are sorted by this. Position, depth and role are set in the prompt list.'));
    }

    const instr = el('textarea', 'text_pole');
    instr.rows = 5;
    instr.maxLength = 1200;
    instr.value = cfg.instruction || DEFAULT_IDENTITY_INSTRUCTION;
    instr.addEventListener('input', () => {
        const v = instr.value.trim();
        set({ instruction: v && v !== DEFAULT_IDENTITY_INSTRUCTION ? v : '' });
    });
    const reset = el('button', 'menu_button', 'Restore default');
    reset.type = 'button';
    reset.addEventListener('click', () => { instr.value = DEFAULT_IDENTITY_INSTRUCTION; set({ instruction: '' }); });
    wrap.append(el('label', 'sillynpc-setting-label', 'General instruction'), instr,
        el('small', 'notes', '<<name>> is the card in the scene and <<other>> the one they secretly are. It goes first, then the card\'s own prompt.'), reset);

    const preview = el('button', 'menu_button', 'Preview what would be sent now');
    preview.type = 'button';
    const out = el('pre');
    out.style.cssText = 'white-space:pre-wrap; word-break:break-word; display:none; font-size:.85em; user-select:text; margin-top:6px;';
    preview.addEventListener('click', () => {
        out.textContent = currentIdentityText() || 'Nothing: nobody in the scene right now has a link to another card.';
        out.style.display = '';
    });
    wrap.append(preview, out);
    return wrap;
}
