"""Tiny binding-expression language shared by the screens (mirrored in prototype/ui-runtime.js).

Template:  "Day {world.time.day}"  |  exact "{expr}" returns the raw value.
Expr:      paths (a.b.0.c, $param.x, list.length), numbers, 'str' / "str", true/false/null,
           ! - * / + < <= > >= == != && || ?: (right-assoc), parentheses.
Filters:   {expr|int} |fixed1 |pct |time (hours->HH:MM) |deg |upper
"""
import re, math

TOK = re.compile(r"\s*(?:(\d+\.?\d*)|('(?:[^'])*'|\"(?:[^\"])*\")|([A-Za-z_$][\w$]*(?:\.[\w$]+)*)|(==|!=|<=|>=|&&|\|\||[!<>+\-*/?:()]))")


def tokenize(s):
    pos, out = 0, []
    while pos < len(s):
        m = TOK.match(s, pos)
        if not m or m.end() == pos:
            if s[pos:].strip() == '':
                break
            raise ValueError(f'bad expr {s!r} at {pos}')
        pos = m.end()
        if m.group(1): out.append(('num', float(m.group(1))))
        elif m.group(2): out.append(('str', m.group(2)[1:-1]))
        elif m.group(3): out.append(('id', m.group(3)))
        else: out.append(('op', m.group(4)))
    return out


def resolve(path, scope):
    if path in ('true', 'false', 'null'):
        return {'true': True, 'false': False, 'null': None}[path]
    parts = path.split('.')
    cur = None; found = False
    for sc in scope:
        if parts[0] in sc:
            cur = sc[parts[0]]; found = True; break
    if not found:
        return None
    for p in parts[1:]:
        if cur is None:
            return None
        if p == 'length' and isinstance(cur, (list, str)):
            cur = len(cur); continue
        if isinstance(cur, list):
            try: cur = cur[int(p)]
            except (ValueError, IndexError): return None
        elif isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return None
    return cur


PREC = {'||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6}


def evaluate(src, scope):
    toks = tokenize(src); i = [0]

    def peek(): return toks[i[0]] if i[0] < len(toks) else (None, None)
    def nxt(): t = peek(); i[0] += 1; return t

    def primary():
        k, v = nxt()
        if k == 'num': return v
        if k == 'str': return v
        if k == 'id': return resolve(v, scope)
        if v == '(':
            r = ternary(); nxt(); return r
        if v == '!': return not truthy(primary())
        if v == '-': return -(num(primary()))
        raise ValueError(f'unexpected {v!r} in {src!r}')

    def binary(minp):
        left = primary()
        while True:
            k, op = peek()
            if k != 'op' or op not in PREC or PREC[op] < minp:
                return left
            nxt(); right = binary(PREC[op] + 1)
            left = apply(op, left, right)

    def ternary():
        c = binary(1)
        k, v = peek()
        if v == '?':
            nxt(); a = ternary(); nxt(); b = ternary()
            return a if truthy(c) else b
        return c
    return ternary()


def truthy(v):
    return bool(v) and v != 0


def num(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0


def apply(op, a, b):
    if op == '&&': return b if truthy(a) else a
    if op == '||': return a if truthy(a) else b
    if op == '==': return a == b or (isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9)
    if op == '!=': return not apply('==', a, b)
    if op == '+':
        if isinstance(a, str) or isinstance(b, str): return f'{"" if a is None else a}{"" if b is None else b}'
        return num(a) + num(b)
    a, b = num(a), num(b)
    return {'<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b, '-': a - b, '*': a * b, '/': a / b if b else 0}[op]


CHANNEL_IDS = {'0': 'global', '1': 'local', '2': 'party', '3': 'clan', '4': 'trade', '5': 'whisper', '6': 'system'}


def fmt(v, f):
    if f == 'int': return str(int(round(num(v))))
    if f == 'fixed1': return f'{num(v):.1f}'
    if f == 'pct': return f'{int(round(num(v) * 100))}%'
    if f == 'deg': return f'{int(num(v))}°'
    if f == 'upper': return str(v).upper()
    if f == 'channel':  # net ChatChannel id -> theme.chat.channelIds key
        return CHANNEL_IDS.get(str(int(num(v))), str(v)) if isinstance(v, (int, float)) else str(v)
    if f == 'tickclock':  # tick @20Hz -> session clock HH:MM (adapter may override tickHz)
        sec = int(num(v) / 20); return f'{sec // 3600:02d}:{sec // 60 % 60:02d}'
    if f == 'time':
        h = num(v); hh = int(h) % 24; mm = int((h - int(h)) * 60); return f'{hh:02d}:{mm:02d}'
    return '' if v is None else str(v)


PIPE = re.compile(r'(?<!\|)\|(?!\|)')
BR = re.compile(r'\{([^{}]+)\}')


def value(s, scope):
    """Evaluate a binding: exact '{expr}' -> raw value; template -> string; non-str -> itself."""
    if not isinstance(s, str):
        return s
    m = BR.fullmatch(s)
    if m:
        parts = PIPE.split(m.group(1))
        v = evaluate(parts[0], scope)
        if isinstance(v, str) and '{' in v:  # derived template (screen.derive) -> evaluate in the same scope
            v = value(v, scope)
        return fmt(v, parts[1].strip()) if len(parts) > 1 else v
    if '{' not in s:
        return s

    def rep(mm):
        parts = PIPE.split(mm.group(1))
        v = evaluate(parts[0], scope)
        if len(parts) > 1: return fmt(v, parts[1].strip())
        if isinstance(v, float) and v.is_integer(): v = int(v)
        return '' if v is None else str(v)
    return BR.sub(rep, s)
