/**
 * The floating buttons for Games, Combat and the Phone (the three modules each put their own button into this one holder).
 * Drag it anywhere; on letting go it snaps to the left or right edge and the spot is remembered on this device
 * (same idea as the Megumin Suite launcher). A tap still opens the button's window: only a drag of more than a few
 * pixels counts as moving it. Pure browser code, no SillyTavern imports.
 */

const HOLDER_ID = 'rpg-buttons-container';
const STORAGE_KEY = 'worldkit_buttons_position';
const DRAG_THRESHOLD = 6;
const NARROW = 900;

let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }

const gutter = () => (window.innerWidth <= NARROW ? 12 : 20);

/** Puts the holder where it belongs: the saved spot, or bottom right (above the chat box on a phone). */
function place(holder) {
    holder.style.left = holder.style.right = holder.style.top = holder.style.bottom = '';
    const g = gutter();
    if (saved && Number.isFinite(saved.topPercent)) {
        const max = Math.max(10, window.innerHeight - holder.offsetHeight - 10);
        const top = Math.min(max, Math.max(10, (saved.topPercent / 100) * window.innerHeight));
        holder.style.top = `${top}px`;
        holder.style[saved.side === 'left' ? 'left' : 'right'] = `${g}px`;
    } else {
        holder.style.right = `${g}px`;
        holder.style.bottom = window.innerWidth <= NARROW ? '110px' : '20px';
    }
}

function wireDrag(holder) {
    let start = null;
    let moved = false;

    holder.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const box = holder.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
        moved = false;
    });

    document.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        holder.classList.add('is-dragging');
        const left = Math.min(window.innerWidth - holder.offsetWidth, Math.max(0, start.left + dx));
        const top = Math.min(window.innerHeight - holder.offsetHeight - 10, Math.max(10, start.top + dy));
        holder.style.left = `${left}px`;
        holder.style.top = `${top}px`;
        holder.style.right = holder.style.bottom = 'auto';
        if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const finish = () => {
        if (!start) return;
        start = null;
        if (!moved) return;
        holder.classList.remove('is-dragging');
        const box = holder.getBoundingClientRect();
        const side = box.left + box.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
        saved = { side, topPercent: (box.top / window.innerHeight) * 100 };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* private window: it just will not be remembered */ }
        place(holder);
        // The drag ends in a click on whichever button was under the finger: swallow that one.
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        holder.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => holder.removeEventListener('click', swallow, { capture: true }), 0);
    };
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
}

/** The holder every module adds its button to. Made once; safe to call from anywhere. */
export function ensureButtonRow() {
    let holder = document.getElementById(HOLDER_ID);
    if (holder) return holder;
    holder = document.createElement('div');
    holder.id = HOLDER_ID;
    document.body.append(holder);
    place(holder);
    wireDrag(holder);
    window.addEventListener('resize', () => place(holder));
    // A button showing or hiding changes the height: keep a saved spot on screen.
    // (Its own style changes are ignored, or placing it would trigger itself.)
    new MutationObserver((records) => {
        if (holder.classList.contains('is-dragging')) return;
        if (records.every(r => r.target === holder)) return;
        place(holder);
    }).observe(holder, { childList: true, attributes: true, subtree: true, attributeFilter: ['style'] });
    return holder;
}
