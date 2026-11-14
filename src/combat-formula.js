/**
 * The formula language for combat world types (fork).
 *
 * World types are data a user can import from anybody, and they contain formulas: pool
 * maxima, role bindings, roll and damage expressions. So formulas are parsed here rather than
 * handed to eval. There is no eval, no Function, no property access outside the context the
 * caller supplies, and every expression is limited in length, depth, dice and work done.
 *
 * Pure: no DOM, no SillyTavern imports, so it runs under plain Node for testing.
 *
 * Language
 *   numbers            12   0.5
 *   strings            'red'   "red"            (only for ==, != and function arguments)
 *   dice               d20   2d6   d10          (rolled with the supplied rng)
 *   names              stat.str   a.mod.speed   (own properties of the context, dotted)
 *   calls              min(a, b)   has(a, 'red') (the built-ins below plus caller-supplied fns)
 *   operators          + - * / %   < > <= >= == !=   && ||   !   - (unary)   c ? x : y
 */

export const LIMITS = Object.freeze({
    maxLength: 500,
    maxNodes: 200,
    maxDepth: 32,
    maxDice: 10,
    maxSides: 1000,
    maxVisits: 2000,
    maxResult: 1e6,
});

const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);

export class FormulaError extends Error {}

/** mulberry32: a small seeded generator, so a battle can be replayed from its seed. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ------------------------------------------------------------------ tokenizer */

function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const ch = src[i];
        if (/\s/.test(ch)) { i++; continue; }

        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < n && /[0-9]/.test(src[j])) j++;
            // 2d6: digits immediately followed by d and digits.
            if (src[j] === 'd' && /[0-9]/.test(src[j + 1] || '')) {
                let k = j + 1;
                while (k < n && /[0-9]/.test(src[k])) k++;
                tokens.push({ t: 'dice', count: Number(src.slice(i, j)), sides: Number(src.slice(j + 1, k)) });
                i = k;
                continue;
            }
            if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) {
                j++;
                while (j < n && /[0-9]/.test(src[j])) j++;
            }
            tokens.push({ t: 'num', value: Number(src.slice(i, j)) });
            i = j;
            continue;
        }

        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
            const word = src.slice(i, j);
            if (/^d[0-9]+$/.test(word)) tokens.push({ t: 'dice', count: 1, sides: Number(word.slice(1)) });
            else tokens.push({ t: 'id', value: word });
            i = j;
            continue;
        }

        if (ch === '\'' || ch === '"') {
            let j = i + 1;
            while (j < n && src[j] !== ch) j++;
            if (j >= n) throw new FormulaError('Unterminated string');
            tokens.push({ t: 'text', value: src.slice(i + 1, j) });
            i = j + 1;
            continue;
        }

        const two = src.slice(i, i + 2);
        if (['&&', '||', '==', '!=', '<=', '>='].includes(two)) {
            tokens.push({ t: 'op', value: two });
            i += 2;
            continue;
        }
        if ('+-*/%<>!?:(),.'.includes(ch)) {
            tokens.push({ t: 'op', value: ch });
            i++;
            continue;
        }
        throw new FormulaError(`Unexpected character "${ch}"`);
    }
    return tokens;
}

/* --------------------------------------------------------------------- parser */

const BINARY = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3,
    '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6,
};

function parse(tokens) {
    let pos = 0;
    let nodes = 0;
    let dice = 0;
    const peek = () => tokens[pos];
    const isOp = (v) => tokens[pos]?.t === 'op' && tokens[pos].value === v;
    const take = () => tokens[pos++];
    const count = () => {
        if (++nodes > LIMITS.maxNodes) throw new FormulaError('Expression is too large');
    };

    function expression(depth) {
        if (depth > LIMITS.maxDepth) throw new FormulaError('Expression is nested too deeply');
        const cond = binary(1, depth + 1);
        if (isOp('?')) {
            take();
            const yes = expression(depth + 1);
            if (!isOp(':')) throw new FormulaError('Expected ":" in conditional');
            take();
            const no = expression(depth + 1);
            count();
            return { k: 'cond', cond, yes, no };
        }
        return cond;
    }

    function binary(minPrec, depth) {
        if (depth > LIMITS.maxDepth) throw new FormulaError('Expression is nested too deeply');
        let left = unary(depth + 1);
        for (;;) {
            const tok = peek();
            if (!tok || tok.t !== 'op') break;
            const prec = BINARY[tok.value];
            if (!prec || prec < minPrec) break;
            take();
            const right = binary(prec + 1, depth + 1);
            count();
            left = { k: 'bin', op: tok.value, left, right };
        }
        return left;
    }

    function unary(depth) {
        if (depth > LIMITS.maxDepth) throw new FormulaError('Expression is nested too deeply');
        if (isOp('-') || isOp('!')) {
            const op = take().value;
            const arg = unary(depth + 1);
            count();
            return { k: 'un', op, arg };
        }
        return primary(depth + 1);
    }

    function primary(depth) {
        const tok = take();
        if (!tok) throw new FormulaError('Unexpected end of expression');
        count();
        if (tok.t === 'num') return { k: 'num', value: tok.value };
        if (tok.t === 'text') return { k: 'text', value: tok.value };
        if (tok.t === 'dice') {
            dice += tok.count;
            if (tok.count < 1 || tok.sides < 1 || tok.sides > LIMITS.maxSides || dice > LIMITS.maxDice) {
                throw new FormulaError('Dice are out of range');
            }
            return { k: 'dice', count: tok.count, sides: tok.sides };
        }
        if (tok.t === 'id') {
            if (BLOCKED.has(tok.value)) throw new FormulaError(`"${tok.value}" is not allowed`);
            if (isOp('(')) {
                take();
                const args = [];
                if (!isOp(')')) {
                    for (;;) {
                        args.push(expression(depth + 1));
                        if (isOp(',')) { take(); continue; }
                        break;
                    }
                }
                if (!isOp(')')) throw new FormulaError('Expected ")"');
                take();
                return { k: 'call', name: tok.value, args };
            }
            const path = [tok.value];
            while (isOp('.')) {
                take();
                const seg = take();
                if (!seg || seg.t !== 'id') throw new FormulaError('Expected a name after "."');
                if (BLOCKED.has(seg.value)) throw new FormulaError(`"${seg.value}" is not allowed`);
                path.push(seg.value);
                count();
            }
            return { k: 'id', path };
        }
        if (tok.t === 'op' && tok.value === '(') {
            const inner = expression(depth + 1);
            if (!isOp(')')) throw new FormulaError('Expected ")"');
            take();
            return inner;
        }
        throw new FormulaError(`Unexpected "${tok.value}"`);
    }

    const ast = expression(0);
    if (pos < tokens.length) throw new FormulaError('Unexpected trailing input');
    return ast;
}

function collectRefs(ast, out = { names: new Set(), calls: new Set() }) {
    switch (ast.k) {
        case 'id': out.names.add(ast.path.join('.')); break;
        case 'call': out.calls.add(ast.name); ast.args.forEach(a => collectRefs(a, out)); break;
        case 'un': collectRefs(ast.arg, out); break;
        case 'bin': collectRefs(ast.left, out); collectRefs(ast.right, out); break;
        case 'cond': collectRefs(ast.cond, out); collectRefs(ast.yes, out); collectRefs(ast.no, out); break;
        default: break;
    }
    return out;
}

const cache = new Map();

/**
 * @param {string} expr
 * @returns {{ ok: boolean, ast?: object, error?: string, names?: string[], calls?: string[] }}
 */
export function compile(expr) {
    const src = String(expr ?? '');
    if (cache.has(src)) return cache.get(src);
    let result;
    try {
        if (!src.trim()) throw new FormulaError('Expression is empty');
        if (src.length > LIMITS.maxLength) throw new FormulaError('Expression is too long');
        const ast = parse(tokenize(src));
        const refs = collectRefs(ast);
        result = { ok: true, ast, names: [...refs.names], calls: [...refs.calls] };
    } catch (err) {
        result = { ok: false, error: err instanceof FormulaError ? err.message : 'Could not read expression' };
    }
    if (cache.size > 2000) cache.clear();
    cache.set(src, result);
    return result;
}

/* ------------------------------------------------------------------ evaluator */

const BUILTINS = {
    min: (...a) => Math.min(...a.map(Number)),
    max: (...a) => Math.max(...a.map(Number)),
    floor: (x) => Math.floor(Number(x)),
    ceil: (x) => Math.ceil(Number(x)),
    round: (x) => Math.round(Number(x)),
    abs: (x) => Math.abs(Number(x)),
    clamp: (x, lo, hi) => Math.min(Math.max(Number(x), Number(lo)), Number(hi)),
};

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function clampResult(v) {
    if (typeof v !== 'number') return v;
    if (!Number.isFinite(v)) return 0;
    return Math.max(-LIMITS.maxResult, Math.min(LIMITS.maxResult, v));
}

/**
 * Runs a formula. Never throws: anything that goes wrong (an unknown function, a blown
 * budget, a bad expression) yields 0, so a broken imported type cannot stop a fight.
 * Validation, which does report errors, is validateExpr.
 *
 * @param {string|object} exprOrCompiled
 * @param {object} [ctx] Variables, as plain nested objects.
 * @param {{ rng?: () => number, fns?: Record<string, Function> }} [opts]
 * @returns {number|string|boolean}
 */
export function run(exprOrCompiled, ctx = {}, opts = {}) {
    const compiled = typeof exprOrCompiled === 'string' ? compile(exprOrCompiled) : exprOrCompiled;
    if (!compiled?.ok) return 0;
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const fns = opts.fns || {};
    let visits = 0;

    const lookup = (path) => {
        let cur = ctx;
        for (const seg of path) {
            if (cur === null || typeof cur !== 'object' && typeof cur !== 'function') return 0;
            if (!hasOwn(cur, seg)) return 0;
            cur = cur[seg];
        }
        return cur === undefined || cur === null ? 0 : cur;
    };

    const ev = (node) => {
        if (++visits > LIMITS.maxVisits) throw new FormulaError('Expression did too much work');
        switch (node.k) {
            case 'num': case 'text': return node.value;
            case 'dice': {
                let total = 0;
                for (let i = 0; i < node.count; i++) total += 1 + Math.floor(rng() * node.sides);
                return total;
            }
            case 'id': return lookup(node.path);
            case 'un': {
                const v = ev(node.arg);
                return node.op === '-' ? -num(v) : (v ? 0 : 1);
            }
            case 'cond': return ev(node.cond) ? ev(node.yes) : ev(node.no);
            case 'bin': {
                if (node.op === '&&') return ev(node.left) && ev(node.right) ? 1 : 0;
                if (node.op === '||') return ev(node.left) || ev(node.right) ? 1 : 0;
                const l = ev(node.left);
                const r = ev(node.right);
                switch (node.op) {
                    case '+': return num(l) + num(r);
                    case '-': return num(l) - num(r);
                    case '*': return num(l) * num(r);
                    case '/': return num(r) === 0 ? 0 : num(l) / num(r);
                    case '%': return num(r) === 0 ? 0 : num(l) % num(r);
                    case '==': return l === r || (num(l) === num(r) && typeof l !== 'string' && typeof r !== 'string') ? 1 : 0;
                    case '!=': return l === r || (num(l) === num(r) && typeof l !== 'string' && typeof r !== 'string') ? 0 : 1;
                    case '<': return num(l) < num(r) ? 1 : 0;
                    case '>': return num(l) > num(r) ? 1 : 0;
                    case '<=': return num(l) <= num(r) ? 1 : 0;
                    case '>=': return num(l) >= num(r) ? 1 : 0;
                    default: return 0;
                }
            }
            case 'call': {
                const fn = hasOwn(fns, node.name) ? fns[node.name]
                    : (hasOwn(BUILTINS, node.name) ? BUILTINS[node.name] : null);
                if (typeof fn !== 'function') throw new FormulaError(`Unknown function "${node.name}"`);
                return fn(...node.args.map(ev));
            }
            default: return 0;
        }
    };

    try {
        return clampResult(ev(compiled.ast));
    } catch {
        return 0;
    }
}

/**
 * Checks an expression without running it.
 *
 * @param {string} expr
 * @param {{ names?: (name: string) => boolean, calls?: string[] }} [allow]
 *   names: whether a dotted name (e.g. "stat.str") may be referenced.
 *   calls: function names allowed in addition to the built-ins.
 * @returns {{ ok: boolean, error?: string, names?: string[], calls?: string[] }}
 */
export function validateExpr(expr, allow = {}) {
    const compiled = compile(expr);
    if (!compiled.ok) return { ok: false, error: compiled.error };
    if (typeof allow.names === 'function') {
        const bad = compiled.names.find(n => !allow.names(n));
        if (bad) return { ok: false, error: `Unknown name "${bad}"`, names: compiled.names, calls: compiled.calls };
    }
    const okCalls = new Set([...Object.keys(BUILTINS), ...(allow.calls || [])]);
    const badCall = compiled.calls.find(c => !okCalls.has(c));
    if (badCall) return { ok: false, error: `Unknown function "${badCall}"`, names: compiled.names, calls: compiled.calls };
    return { ok: true, names: compiled.names, calls: compiled.calls };
}
