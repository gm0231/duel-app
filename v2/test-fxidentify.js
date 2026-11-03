'use strict';
/* test-fxidentify.js — unit checks for the which-effect identification
   (user report 2026-11-03: 発動確認でどの効果か分からない).
   Loads the REAL client.js into a stub DOM (same technique as the
   white-box checks elsewhere: append an export hook to the source,
   run in a vm context) and asserts the desc decoding + text cutting
   against the REAL data.json:
     desc = aux.Stringid(code, idx) = code<<20 | idx   (bundled lua)
     idx n names official text effect n+1.
   Also asserts the yes/no questions' DOM (via the sheet stub):
   EFFECTYN pins the effect, YESNO names card + effect from its
   desc, and the follow-up form names the optional clause. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

// ---- minimal DOM stub: only what client.js touches at load time
function stubEl() {
  const el = {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
  return el;
}
const els = {};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = stubEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  document: documentStub,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} },
  fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  location: { href: 'http://localhost/v2/', search: '' },
  navigator: { userAgent: 'node' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(V2, 'client.js'), 'utf8') +
  '\n;globalThis.__T = { DATA: () => DATA, setDATA: (d) => { DATA = d; }, setFXMAP: (m) => { FXMAP = m; }, descEffect, effectSegments, resolveEffect, followUpClause, stepClause, entryEffect, fxBlockHTML, dismissalName, CIRCLED_NUM };';
vm.runInContext(src, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8')));
const E = require(path.join(V2, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const SID = (code, idx) => code * 1048576 + idx;

// ---- desc decode
ok(T.descEffect(SID(82633039, 1)).idx === 1 && T.descEffect(SID(82633039, 1)).code === 82633039, 'FX1: Stringid decode (Castel idx1)');
ok(T.descEffect(0) === null && T.descEffect(221) === null && T.descEffect(94) === null, 'FX2: desc 0 / system ids (221, 94) do not resolve to a card effect');
ok(T.descEffect(SID(99937011, 16)) === null, 'FX3: idx >= 16 (sprite/registration text) does not resolve');

// ---- segment cutting vs every pool card: segments are numbered 1..k in order
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
let segBad = 0;
for (const [code, t] of Object.entries(data.texts)) {
  const segs = T.effectSegments(+code);
  const markers = (t.text.match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯]：/g) || []).length;
  if (segs.length !== markers) { segBad++; console.log('  seg count mismatch', code, data.names[code], segs.length, 'vs', markers); }
  segs.forEach((s, i) => { if (s.n !== i + 1 || !s.body) { segBad++; console.log('  seg order/body bad', code, s.n); } });
  // for cards whose mapping is proven (identity/override), every
  // mapped effect must resolve to exactly the audited number
  const m = fxmap[code];
  if (m && m.id) for (const s of segs) {
    const fx = T.resolveEffect(+code, SID(+code, s.n - 1));
    if (!fx || fx.n !== s.n) { segBad++; console.log('  identity resolve fail', code, data.names[code], 'effect', s.n); }
  }
  if (m && m.map) for (const [idx, n] of Object.entries(m.map)) {
    const fx = T.resolveEffect(+code, SID(+code, +idx));
    if (!fx || fx.n !== n) { segBad++; console.log('  override resolve fail', code, data.names[code], 'idx', idx, '-> want', n, 'got', fx && fx.n); }
  }
}
ok(segBad === 0, 'FX4: segments numbered in order; identity/override cards resolve every mapped effect to the audited number');

// ---- the multi-effect cards the user named: no number mix-ups
const CASTEL1 = T.resolveEffect(82633039, SID(82633039, 0));
const CASTEL2 = T.resolveEffect(82633039, SID(82633039, 1));
ok(CASTEL1.body.includes('裏側守備表示') && CASTEL2.body.includes('デッキに戻す'), 'FX5: Castel ①=裏側守備 / ②=デッキに戻す (no swap)');
const KELDO2 = T.resolveEffect(63542003, SID(63542003, 1));
ok(KELDO2.body.includes('デッキに戻す'), 'FX6: Keldo ② is the grave-shuffle effect');
const MUDORA2 = T.resolveEffect(99937011, SID(99937011, 1));
ok(MUDORA2.body.includes('デッキに戻す') && !MUDORA2.body.includes('特殊召喚する。その後'), 'FX7: Mudora ② is the grave-shuffle effect');
const TRAP2 = T.resolveEffect(98715423, SID(98715423, 0)); // continuous ① has NO desc; script idx 0 names text ②
ok(TRAP2 && TRAP2.n === 2 && TRAP2.body.includes('手札に加える'), 'FX8: Gravekeeper\'s Trap desc idx0 -> text ② (search), the continuous ① is never an activation candidate');
const TRAP3 = T.resolveEffect(98715423, SID(98715423, 1));
ok(TRAP3 && TRAP3.n === 3 && TRAP3.body.includes('宣言'), 'FX8b: Gravekeeper\'s Trap desc idx1 -> text ③ (declare), NOT the ② search');
const LUCE2 = T.resolveEffect(45409943, SID(45409943, 0));
ok(LUCE2 && LUCE2.n === 2 && LUCE2.body.includes('破壊する'), 'FX8c: Luce desc idx0 -> text ② (printed ① is the continuous protection)');
ok(T.resolveEffect(36898537, SID(36898537, 0)) === null && T.resolveEffect(37706769, SID(37706769, 1)) === null && T.resolveEffect(63101468, SID(63101468, 0)) === null,
  'FX8d: collision cards (Horus/Pluto/Hyperion) get NO number — full text instead of a wrong one');
const KARUDAN2 = T.resolveEffect(86605515, SID(86605515, 1));
ok(KARUDAN2.body.includes('破壊されない'), 'FX9: Karudan desc idx1 -> text ② (trap protection)');

// ---- follow-up form (desc index one past the last numbered effect)
const F = T.resolveEffect(99937011, SID(99937011, 2));
ok(F && F.follow === true, 'FX10: Mudora desc idx2 = optional follow-up of ①');
ok(T.followUpClause(99937011).includes('墓守の罠'), 'FX11: Mudora follow-up clause is the Trap placement sentence');
ok(T.resolveEffect(99937011, SID(99937011, 3)) === null, 'FX12: desc idx3 (beyond follow-up) does not resolve');

// ---- wrong-card desc never borrows another card's effect
ok(T.resolveEffect(63542003, SID(99937011, 1)) === null, 'FX13: desc of a different card does not resolve against this card');

// ---- dismissal label names the effect
ok(T.dismissalName({ code: 99937011, desc: SID(99937011, 1) }) === '剣神官ムドラ の効果②', 'FX14: dismissal label = card + effect number');
ok(T.dismissalName({ code: 99937011, desc: 0 }) === '剣神官ムドラ', 'FX15: dismissal label without desc stays the plain name');

// ---- highlight block structure
const blk = T.fxBlockHTML(82633039, CASTEL2);
ok(blk.includes('聞かれている効果：②') && blk.includes('デッキに戻す') && blk.includes('カード全体のテキスト'), 'FX16: fx block pins ② and keeps the full text one tap away');

// ---- follow-up sub-questions: parent pinned via the context desc
ok(T.stepClause(99937011, 1).includes('墓守の罠'), 'FX17: Mudora ① own step clause is the Trap placement (parent-pinned quote)');
ok(T.stepClause(25926710, 2).includes('セットできる'), 'FX17b: Kelbek ② own step clause is the Trap set');
ok(T.resolveEffect(35026117, SID(35026117, 2)) === null && T.resolveEffect(35026117, SID(35026117, 1)) === null,
  'FX17c: Heavy Tank YESNO (Stringid 2 = "apply the ③ effect?") stays UNNUMBERED — its ① owns a described non-effect registration, so the ask is not mechanically separable');
ok(T.resolveEffect(30100551, SID(30100551, 0)) === null,
  'FX17d: Minerva YESNO (Stringid 0 = follow-up of its undescribed ②) stays unnumbered — its effects own no descriptions at all');

// ---- desc-less Spell/Trap entries = the card activation itself
const TRAPACT = T.entryEffect({ code: 98715423, desc: 0 });
ok(TRAPACT && TRAPACT.act === true && TRAPACT.n === 1 && TRAPACT.body.includes('現世と冥界の逆転'),
  'FX18: desc-less Gravekeeper\'s Trap entry = its card activation (printed rules text), labelled as activation, not as ②');
const MOON = T.entryEffect({ code: 14087893, desc: 0 });
ok(MOON && MOON.act === true && MOON.body.includes('裏側守備表示にする'),
  'FX18b: desc-less Book of Moon entry = its activation effect text');
ok(T.entryEffect({ code: 99937011, desc: 0 }) === null,
  'FX18c: a desc-less MONSTER entry gets no activation fallback (undescribed monster effects stay unnumbered)');
ok(T.entryEffect({ code: 98715423, desc: SID(98715423, 0) }).n === 2,
  'FX18d: described entries still resolve by desc first (Trap entry with desc = ②, not the activation)');

console.log(failures === 0 ? 'ALL FX-IDENTIFY CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
