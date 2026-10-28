"""Swift Codable 모델(ios/Shared)과 서버 JSON 샘플을 대조한다.
- Swift 의 non-optional 필드는 JSON 에 반드시 있고 null 이 아니어야 한다
- 타입(Int/Double/String/Bool/배열/중첩 구조체)이 맞아야 한다
- 앱 → 서버 방향(NotificationPrefs)은 키 집합이 서로 같아야 한다
"""
import json, re, subprocess, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'ios/Shared/Models.swift').read_text() + (root / 'ios/Shared/GameActivityAttributes.swift').read_text()

# 문자열 enum (enum X: String … { case a, b }) 은 허용 값 목록으로 검사
string_enums = {}
for m in re.finditer(r'enum\s+(\w+)\s*:\s*String[^{]*\{', src):
    i, depth, j = m.end(), 1, m.end()
    while depth:
        depth += {'{': 1, '}': -1}.get(src[j], 0); j += 1
    cases = []
    for c in re.finditer(r'^\s*case\s+([\w, ]+)$', src[i:j-1], re.M):
        cases += [x.strip() for x in c.group(1).split(',') if x.strip()]
    string_enums[m.group(1)] = cases

structs = {}
for m in re.finditer(r'(?:struct|enum)\s+(\w+)[^{]*\{', src):
    name, i, depth = m.group(1), m.end(), 1
    j = i
    while depth:
        depth += {'{': 1, '}': -1}.get(src[j], 0); j += 1
    body = src[i:j-1]
    # 이 수준(중첩 타입·메서드 본문 제외)의 줄만 보고, 저장 프로퍼티만 고른다.
    fields, d = {}, 0
    for line in body.split('\n'):
        line = re.sub(r'\s*//.*$', '', line)  # 줄 끝 주석
        if d == 0:
            m2 = re.match(r'^\s*(?:let|var)\s+(\w+)\s*(?::\s*([\w\[\]?]+))?\s*(=\s*(.+))?$', line)
            computed = '{' in line.split('=')[0] if m2 else False
            if m2 and not computed:
                typ = m2.group(2)
                if typ is None and m2.group(4):
                    lit = m2.group(4).strip()
                    typ = 'Bool' if lit in ('true', 'false') else 'Int' if lit.isdigit() else 'String' if lit.startswith('"') else None
                if typ: fields[m2.group(1)] = typ
        d += line.count('{') - line.count('}')
    if name not in structs or fields:
        structs[name] = fields
structs['ContentState'] = structs.pop('ContentState', None) or {}

samples = json.loads(subprocess.check_output(['node', '--disable-warning=ExperimentalWarning', str(root / 'tools/contract-samples.mjs')]))
errors = []

def check(value, typ, path):
    optional = typ.endswith('?')
    t = typ.rstrip('?')
    if value is None:
        if not optional: errors.append(f'{path}: Swift {typ} 인데 null')
        return
    if t.startswith('['):
        if not isinstance(value, list): errors.append(f'{path}: 배열이어야 함'); return
        for k, v in enumerate(value): check(v, t[1:-1], f'{path}[{k}]')
    elif t == 'Int':
        if not (isinstance(value, int) and not isinstance(value, bool)): errors.append(f'{path}: Int 인데 {value!r}')
    elif t == 'Double':
        if not isinstance(value, (int, float)) or isinstance(value, bool): errors.append(f'{path}: Double 인데 {value!r}')
    elif t == 'String':
        if not isinstance(value, str): errors.append(f'{path}: String 인데 {value!r}')
    elif t == 'Bool':
        if not isinstance(value, bool): errors.append(f'{path}: Bool 인데 {value!r}')
    elif t in string_enums:
        if value not in string_enums[t]: errors.append(f'{path}: {t} 에 없는 값 {value!r} (가능: {", ".join(string_enums[t])})')
    elif t in structs:
        obj(value, t, path)
    else:
        errors.append(f'{path}: 검사 못하는 타입 {t}')

def obj(value, name, path):
    if not isinstance(value, dict): errors.append(f'{path}: 객체여야 함'); return
    for field, typ in structs[name].items():
        if field not in value:
            if not typ.endswith('?'): errors.append(f'{path}.{field}: 서버 JSON 에 없음 (Swift {typ})')
            continue
        check(value[field], typ, f'{path}.{field}')

for name, items in samples.items():
    for k, item in enumerate(items):
        obj(item, name, f'{name}#{k}')

# 앱이 서버로 보내는 알림 설정 키는 서버 기본값과 같아야 한다
swift_prefs, server_prefs = set(structs['NotificationPrefs']), set(samples['NotificationPrefs'][0])
if swift_prefs != server_prefs:
    errors.append(f'NotificationPrefs 키 불일치: 앱만 {swift_prefs - server_prefs}, 서버만 {server_prefs - swift_prefs}')
# 라이브 액티비티: 서버가 보내는 키가 Swift 에 없으면 iOS 가 디코딩은 하지만 정보가 버려진다 → 정확히 같아야 함
for name in ('ContentState', 'GameActivityAttributes'):
    extra = set(samples[name][0]) - set(structs[name])
    if extra: errors.append(f'{name}: 서버만 보내는 키 {extra}')

checked = {n: len(v) for n, v in samples.items()}
if errors:
    print('계약 불일치:'); [print('  -', e) for e in errors]; sys.exit(1)
print('서버 JSON ↔ Swift 모델 일치:', ', '.join(f'{n}×{c}' for n, c in checked.items()))
print('검사한 Swift 구조체:', ', '.join(sorted(n for n, f in structs.items() if f)))
