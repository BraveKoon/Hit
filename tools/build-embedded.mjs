// server/src 의 읽기 전용 모듈을 하나의 JavaScript 파일로 묶는다 (앱의 JavaScriptCore 에서 실행).
// 사용: node tools/build-embedded.mjs        → ios/HIT/Resources/hit-core.js 를 쓴다
//       import { buildEmbedded } from './build-embedded.mjs' → 문자열만 돌려받는다 (테스트에서 최신인지 비교)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'server/src');
export const OUT = join(ROOT, 'ios/HIT/Resources/hit-core.js');
const ENTRY = 'embedded.js';

const PRELUDE = `
// ── 앱 쪽 준비물: 서버(Node)에 있고 JavaScriptCore 에 없는 것들 ──
if (typeof AbortSignal === 'undefined') {
  globalThis.AbortSignal = { timeout: function (ms) { return { __timeoutMs: ms }; } };
}
if (typeof URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class URLSearchParams {
    constructor(init) { this._p = []; if (init) for (const k of Object.keys(init)) this._p.push([k, String(init[k])]); }
    set(k, v) { const i = this._p.findIndex((e) => e[0] === k); if (i < 0) this._p.push([k, String(v)]); else this._p[i][1] = String(v); }
    get(k) { const e = this._p.find((x) => x[0] === k); return e ? e[1] : null; }
    toString() { return this._p.map((e) => encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]).replace(/%20/g, '+')).join('&'); }
  };
}
// __nativeFetch(url, optionsJson, callback(status, text, error)) 는 앱(Swift)이 넣어 준다.
globalThis.fetch = function (url, init) {
  return new Promise(function (resolve, reject) {
    const opts = { headers: (init && init.headers) || {}, timeoutMs: (init && init.signal && init.signal.__timeoutMs) || 15000 };
    __nativeFetch(String(url), JSON.stringify(opts), function (status, text, error) {
      if (error) {
        const e = new Error(error);
        e.name = error === 'timeout' ? 'TimeoutError' : 'FetchError';
        reject(e);
        return;
      }
      resolve({ ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(text); }, json: function () { return Promise.resolve(JSON.parse(text)); } });
    });
  });
};
`;

function parseModule(name, source) {
  const deps = [];
  const exportsList = [];
  let code = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+)';?[ \t]*$/gm, (_m, names, file) => {
    deps.push(file);
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = __require('${file}');`;
  });
  if (/^import\s/m.test(code)) throw new Error(`${name}: 지원하지 않는 import 형식 (node:* 등) — 읽기 전용 모듈에서 쓰면 안 됩니다`);
  code = code.replace(/^export\s+(async\s+function|function|class|const|let)\s+(\w+)/gm, (_m, kind, id) => {
    exportsList.push(id);
    return `${kind} ${id}`;
  });
  if (/^export\s/m.test(code)) throw new Error(`${name}: 지원하지 않는 export 형식`);
  code += `\n${exportsList.map((id) => `__exports.${id} = ${id};`).join('\n')}\n`;
  return { name, deps, code };
}

export function buildEmbedded() {
  const mods = new Map();
  const order = [];
  (function visit(name, stack = []) {
    if (mods.has(name)) return;
    if (stack.includes(name)) throw new Error(`순환 import: ${[...stack, name].join(' → ')}`);
    const m = parseModule(name, readFileSync(join(SRC, name), 'utf8'));
    for (const d of m.deps) visit(d, [...stack, name]);
    mods.set(name, m);
    order.push(name);
  })(ENTRY);

  const body = order.map((n) => `__define(${JSON.stringify(n)}, function (__require, __exports) {\n${mods.get(n).code}});`).join('\n\n');
  return `// 자동 생성 파일 — 고치지 마세요. node tools/build-embedded.mjs 로 다시 만듭니다. (원본: server/src/*.js)
(function () {
'use strict';
${PRELUDE}
const __defs = {}, __cache = {};
function __define(name, fn) { __defs[name] = fn; }
function __require(name) {
  if (__cache[name]) return __cache[name];
  const exp = (__cache[name] = {});
  __defs[name](__require, exp);
  return exp;
}

${body}

// 앱이 쓰는 입구: __hit.start(now) 로 만들고, __hit.handle("/v1/games?date=…", callback(status, bodyJson)) 로 부른다.
let __app = null;
globalThis.__hit = {
  start: function (nowMs) {
    const { createEmbedded } = __require(${JSON.stringify(ENTRY)});
    __app = createEmbedded({ fetch: globalThis.fetch, now: function () { return Date.now(); } });
    return true;
  },
  handle: function (target, callback) {
    if (!__app) globalThis.__hit.start();
    __app.handle(target).then(function (r) { callback(r.status, r.body); }, function (e) { callback(500, JSON.stringify({ error: String(e && e.message || e) })); });
  },
};
})();
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = buildEmbedded();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(`쓴 파일: ${OUT} (${out.length.toLocaleString()}자)`);
}
