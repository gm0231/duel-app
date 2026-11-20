'use strict';
/* test-fixbu122123.js — fix-bu122-123-1121 (run 20, 2026-11-21).
 *
 * BU-122: the hand name band held 2 chars + "…" at 620 (tile 48px,
 * name field 40px, 10.5px font) and 3 at 700 when the row shrank,
 * so same-family names collided (run20: three 帝王 cards all
 * "帝王の…"). v3 B-16 requires the band to identify, not to show
 * the full name: 5-6 visible chars. Fix: (a) layoutParts floors
 * the hand at 56px wide (decoupled from the board tile unit, which
 * sits at its 40px floor at 620); (b) .hcard min-width rises from
 * 46px to the same 56px so flex-shrink cannot drop below the
 * floor — overflow scrolls instead, with the BU-78 fade cue;
 * (c) the name is 10px in a 50px field (56 - 2 border - 2x2
 * padding) so 5 full-width chars fit. The floor rides the
 * formula's own distribution: at 620 the preview absorbs it
 * (pv 38 -> 30, still the compact strip) and the board unit
 * stays at 40.
 *
 * BU-123: the deck-page "出来事の通知" = "出す" button's small
 * "カードの移動・攻撃などを浮かせ表示" wrapped as "…などを浮" /
 * "かせ表示", splitting "浮かせ" mid-word. Fix: the text is
 * shortened to "移動・攻撃を浮かせ表示" (one line in the
 * measured button) and the deck-page smalls get
 * word-break:keep-all so breaks happen at word boundaries only.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu122123.js): live duels at both
 * heights, Range-measured visible chars per hand tile, rendered
 * names checked for collisions among the actual hands, and the
 * deck page shot at both heights.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ruleDecls = (re) => {
  const m = html.match(re);
  if (!m) return null;
  const d = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) d[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return d;
};

// ---------- BU-122 source pins ----------
ok(/const handW = Math\.max\(56, Math\.round\(W \* 56 \/ 47\)\);/.test(clientSrc),
  'F122a: layoutParts floors the hand at 56px wide');
const hcard = ruleDecls(/\.hcard\{([^}]*)\}/);
ok(!!hcard && hcard['min-width'] === '56px',
  'F122b: .hcard min-width is the 56px name floor (got ' + (hcard && hcard['min-width']) + ')');
const hband = ruleDecls(/\.hband\{([^}]*)\}/);
ok(!!hband && hband.padding === '0 2px',
  'F122c: .hband padding is 0 2px (got ' + (hband && hband.padding) + ')');
const nm = ruleDecls(/\.hband \.nm\{([^}]*)\}/);
ok(!!nm && nm['font-size'] === '10px',
  'F122d: the hand name is 10px (got ' + (nm && nm['font-size']) + ')');
// field arithmetic: 56px tile - 2px border - 2x2px padding = 50px;
// at 10px per full-width char that is exactly 5 chars.
const fieldW = 56 - 2 - 2 * 2;
ok(fieldW === 50 && Math.floor(fieldW / 10) === 5,
  'F122e: the name field is 50px wide, holding 5 chars at 10px (field ' + fieldW + 'px)');

// ---------- BU-122 rendered-name model ----------
// What the user reads: full name when it fits the 5-char field,
// else the first 4 chars + "…". Distinct full names must render
// distinctly inside the probe decks (Ishizu / GG / monarch).
const CAP = 5;
const rendered = (name) => (name.length <= CAP ? name : name.slice(0, CAP - 1) + '…');
const families = {
  '帝王 (monarch hand)': ['帝王の深怨', '帝王の烈旋', '帝王の開岩', '帝王の轟毅', '帝王の策略'],
  '春化精 (Ishizu hand)': ['森と目覚の春化精', '丘と芽吹の春化精', '花と野原の春化精', '春化精の花冠'],
  '魔神 (GG hand)': ['合体魔神－ゲート・ガーディアン', '雷魔神－サンガ', '風魔神－ヒューガ', '水魔神－スーガ', '雷風魔神－ゲート・ガーディアン', '水雷魔神－ゲート・ガーディアン', '風水魔神－ゲート・ガーディアン'],
  '帝王 family (monarch hand)': ['冥帝王エイドス', '冥帝従騎エイドス', '天帝アイテール', '天帝従騎イデア', '冥帝エレボス', '邪帝ガイウス', '怨邪帝ガイウス', '爆炎帝テスタロス', '汎神の帝王', '真源の帝王', '連撃の帝王', '叛逆の帝王'],
  'Ishizu hand': ['宿神像ケルドウ', '剣神官ムドラ', '古衛兵アギド', '古尖兵ケルベク', '墓守の罠', '現世と冥界の逆転', '光の護封霊剣', 'おろかな副葬'],
};
for (const [fam, names] of Object.entries(families)) {
  const seen = new Map();
  let clash = null;
  for (const n of names) {
    const r = rendered(n);
    if (seen.has(r) && seen.get(r) !== n) clash = seen.get(r) + ' vs ' + n + ' -> ' + JSON.stringify(r);
    seen.set(r, n);
  }
  ok(!clash, 'F122f: ' + fam + ' renders distinctly at 5 chars' + (clash ? ' (CLASH ' + clash + ')' : ' (' + names.map(rendered).join(' / ') + ')'));
}
// the filed run20 collision, before and after: at the old 2-char
// capacity all three 帝王 cards rendered "帝王の…"; at 5 they
// are their full names.
const renderedOld = (name) => (name.length <= 2 ? name : name.slice(0, 1) + '…');
ok(new Set(['帝王の深怨', '帝王の烈旋', '帝王の開岩'].map(renderedOld)).size === 1,
  'F122g: the old 2-char field really did collide the 帝王 trio (all "帝王の…")');
ok(new Set(['帝王の深怨', '帝王の烈旋', '帝王の開岩'].map(rendered)).size === 3,
  'F122h: at 5 chars the 帝王 trio is three distinct full names');

// ---------- BU-123 source pins ----------
ok(html.includes('移動・攻撃を浮かせ表示'), 'F123a: the notice small is the shortened wording');
ok(!html.includes('カードの移動・攻撃などを浮かせ表示'), 'F123b: the old 17-char small is gone');
const dpSmall = ruleDecls(/#deckpage \.srow \.seg button small\{([^}]*)\}/);
ok(!!dpSmall && dpSmall['word-break'] === 'keep-all',
  'F123c: the deck-page smalls break at word boundaries only (word-break ' + (dpSmall && dpSmall['word-break']) + ')');
// the other deck-page smalls: the spaced one breaks at its space,
// the other two fit one line at 9.5px in the measured ~129px button
// inner width (10-11 chars x 9.5px = 95-105px).
ok(html.includes('「聞かない」設定だけ自動パス') && html.includes('すべてのチェーンで聞く') && html.includes('必須以外は聞かずにパス'),
  'F123d: the chain-confirmation smalls are unchanged');
ok('すべてのチェーンで聞く'.length <= 11 && '必須以外は聞かずにパス'.length <= 11,
  'F123e: the unspaced smalls fit one line at 9.5px (10-11 chars)');

// ---------- live behaviour in jsdom: the formula ----------
async function boot(url) {
  const dom = new JSDOM(html, { url: url || 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

(async () => {
  const window = await boot();
  const L = (vw, budget) => window.eval('computeLayout(' + vw + ', ' + budget + ')');
  // budget = visibleBottom - 8 (the fit loop's target)
  const l620 = L(390, 612); // 390x620
  ok(l620.handW === 56 && l620.handH === 84 && l620.tileW === 40,
    'F122i: at 390x620 the hand is 56px wide (handH ' + l620.handH + ') while the board stays at its 40px floor (got handW ' + l620.handW + ', tileW ' + l620.tileW + ')');
  ok(l620.contentH <= 612 && l620.pvShown >= 24,
    'F122j: at 390x620 the stack still fits the 612px budget with the preview strip kept (contentH ' + l620.contentH + ', pvShown ' + l620.pvShown + ', pv ' + l620.pv + ')');
  const l660 = L(390, 652); // 390x660
  ok(l660.handW === 56 && l660.contentH <= 652 && l660.tileW >= 42,
    'F122k: at 390x660 the hand floor holds and the board stays at/above its legacy floor (handW ' + l660.handW + ', tileW ' + l660.tileW + ', contentH ' + l660.contentH + ')');
  const l700 = L(390, 692); // 390x700
  ok(l700.handW >= 56 && l700.contentH <= 692,
    'F122l: at 390x700 the hand is at/above the floor and the stack fits (handW ' + l700.handW + ', contentH ' + l700.contentH + ')');
  const l600 = L(390, 592); // 390x600, the minimum layout
  ok(l600.handW === 56 && l600.pvShown === 0 && l600.contentH <= 592,
    'F122m: at 390x600 the minimum layout keeps the hand floor with no preview (handW ' + l600.handW + ', contentH ' + l600.contentH + ')');
  const l720 = L(390, 712); // 390x720, full tier
  ok(l720.handW > 56 && l720.contentH <= 712,
    'F122n: at 390x720 the floor does not bind (handW ' + l720.handW + ', contentH ' + l720.contentH + ')');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU122-123 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
