import { LEVELING_DEFAULTS, DIFFICULTY_XP_DEFAULTS, xpToNext, normalizeLeveling } from './combat-level.js';
import { levelingSettings, saveLevelingSettings } from './leveling.js';

/**
 * The leveling rules on the Combat tab (fork): how much XP the first level takes, how much more each later level
 * takes, how much a fight gives per enemy, and the highest level. A line under the boxes shows what the numbers
 * come to. Values are saved as they are typed; nothing redraws, so typing is never interrupted. What is sent to the
 * story when someone levels up is the panel under this one.
 *
 * @returns {HTMLElement}
 */
export function buildLevelingPanel() {
    const cfg = levelingSettings();
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting-group sillynpc-leveling';
    wrap.dataset.setting = 'combat.leveling';

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const preview = el('small', 'notes');
    const refresh = () => {
        const c = normalizeLeveling(cfg);
        const at = (l) => `level ${l} to ${l + 1}: ${xpToNext(l, c)} XP`;
        const fights = Math.ceil(xpToNext(1, c) / Math.max(1, c.xpPerEnemy));
        const harder = c.difficultyXp[5];
        preview.textContent = `${at(1)}; ${at(10)}; ${at(50)}. `
            + (c.xpPerEnemy > 0 ? `One enemy per fight gives ${c.xpPerEnemy} XP, so level 2 takes about ${fights} fights at the plain amount (a difficulty 5 fight gives ${Math.round(c.xpPerEnemy * harder / 100)}). ` : 'Fights give no XP. ')
            + (c.maxLevel > 0 ? `Nobody goes past level ${c.maxLevel}.` : 'There is no highest level.');
    };

    const numberRow = (labelText, key, min, hint) => {
        const row = el('div', 'sillynpc-setting-row');
        const label = el('label', 'sillynpc-setting-label', `${labelText} ⓘ`);
        label.title = hint;
        const input = el('input', 'text_pole');
        input.type = 'number';
        input.min = String(min);
        input.style.width = '7em';
        input.title = hint;
        input.value = String(cfg[key]);
        input.addEventListener('input', () => {
            if (input.value === '') return;
            cfg[key] = Number(input.value);
            saveLevelingSettings();
            refresh();
        });
        input.addEventListener('change', () => { input.value = String(levelingSettings()[key]); refresh(); });
        row.append(label, input);
        return row;
    };

    wrap.append(el('h4', 'sillynpc-combat-heading', 'Leveling'));
    wrap.append(el('small', 'notes', 'Everyone who fights gets XP for each enemy on the other side, win or lose. Filling the bar raises the level by one and carries the extra XP over.'));
    wrap.append(
        numberRow('XP for level 2', 'xpBase', 1, 'The XP it takes to go from level 1 to level 2.'),
        numberRow('Extra XP per level', 'xpStep', 0, 'Added to what each later level takes. 0 means every level takes the same. 50 means level 2 to 3 takes 50 more than level 1 to 2, and so on.'),
        numberRow('XP per enemy', 'xpPerEnemy', 0, 'What a fight gives for each enemy on the other side. 0 turns XP from fights off.'),
        numberRow('Highest level', 'maxLevel', 0, 'Nobody levels past this. 0 means there is no highest level.'),
    );
    // XP by the difficulty chosen on the fight's setup screen (1 easy, 5 hard).
    const diffBox = el('div', 'sillynpc-setting-row');
    const diffLabel = el('label', 'sillynpc-setting-label', 'XP by difficulty, % ⓘ');
    diffLabel.title = 'How much of a fight\'s XP each difficulty gives, in percent. Difficulty 1 is the easiest on the setup screen and 5 the hardest. 100 is the plain amount; 0 gives none. A fight set to a difficulty a world does not use gives the plain amount.';
    diffBox.append(diffLabel);
    [1, 2, 3, 4, 5].forEach((n) => {
        const input = el('input', 'text_pole');
        input.type = 'number';
        input.min = '0';
        input.max = '1000';
        input.style.width = '5em';
        input.title = `Difficulty ${n}`;
        input.value = String(cfg.difficultyXp[n]);
        input.addEventListener('input', () => {
            if (input.value === '') return;
            levelingSettings().difficultyXp[n] = Number(input.value);
            saveLevelingSettings();
            refresh();
        });
        input.addEventListener('change', () => { input.value = String(levelingSettings().difficultyXp[n]); });
        const cell = el('span');
        cell.style.cssText = 'display:inline-flex; align-items:center; gap:2px; margin-right:6px;';
        cell.append(el('small', 'notes', String(n)), input);
        diffBox.append(cell);
    });
    wrap.append(diffBox);
    wrap.append(preview);

    const reset = el('button', 'menu_button', 'Back to the starting numbers');
    reset.type = 'button';
    reset.addEventListener('click', () => {
        Object.assign(cfg, LEVELING_DEFAULTS, { difficultyXp: { ...DIFFICULTY_XP_DEFAULTS } });
        saveLevelingSettings();
        const plain = [LEVELING_DEFAULTS.xpBase, LEVELING_DEFAULTS.xpStep, LEVELING_DEFAULTS.xpPerEnemy, LEVELING_DEFAULTS.maxLevel];
        wrap.querySelectorAll('input').forEach((input, i) => { input.value = String(i < 4 ? plain[i] : DIFFICULTY_XP_DEFAULTS[i - 3]); });
        refresh();
    });
    wrap.append(reset);
    refresh();
    return wrap;
}
