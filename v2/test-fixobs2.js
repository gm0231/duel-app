'use strict';
/* test-fixobs2.js — the 2026-11-16 fix-obs2 pins (triage-1116-obs2
   follow-ups, observations E/F — both ruled "not a defect", with
   three confusion-reducing improvements recorded in the triage
   REPORT's 修正案):
   (1) the C-27 suppression auto-answer rode the same flash as
   auto-pass (「自動パス：〈カード名〉」), so a suppressed effect
   looked auto-passed while never appearing in the manager — the
   flash now says 「省略中：〈カード名〉」 and auto-pass is untouched;
   (2) the auto-pass manager lists the suppressed effects (no 解除
   — the button wording 「このデュエル中は省略する」 is a duel-long
   decision, so non-cancellable by design);
   (3) C-27 gets its first regression pins (there were none).
   Method: client.js in a stub DOM via vm (same technique as
   test-chainpass) — drive the real uiAnswer / flash / manager paths
   with synthetic prompts. Card facts: 剣神官ムドラ 99937011 (effect
   ①, desc = code * 2^20), 宿神像ケルドウ 63542003. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));

// ---- stub DOM (test-chainpass technique) ----
function stubEl() {
  return {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, removeAttribute() {}, remove() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
}
const els = {};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = stubEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  TextEncoder, TextDecoder,
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
vm.runInContext(fs.readFileSync(path.join(V2, 'engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });
const trailer = '\n;globalThis.__T = { uiAnswer, flashAutoPass, flashSuppressed, updateAutoPassChip, openDismissManager, effectYnKey,' +
  ' setDATA: (d) => { DATA = d; },' +
  ' setFXMAP: (m) => { FXMAP = m; },' +
  ' setDismissed: (chains, duel) => { dismissedChains = chains; dismissedDuel = duel; },' +
  ' suppress: (p) => { duelNoConfirm.add(effectYnKey(p)); },' +
  ' suppressedSize: () => duelNoConfirm.size,' +
  ' clearSuppressed: () => { duelNoConfirm = new Set(); },' +
  ' setFlashExpired: () => { autoPassFlashUntil = 0; },' +
  ' answerCurrent: (bytes) => { if (currentPrompt) { const cp = currentPrompt; currentPrompt = null; cp.resolve(bytes); } } };';
vm.runInContext(clientSrc + trailer, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
const E = sandbox.Engine;
T.setDATA(data);
T.setFXMAP(fxmap);

const MUDORA = 99937011, KELDO = 63542003;
const effYn = (code) => ({ name: 'SELECT_EFFECTYN', code, loc: 8, seq: 0, desc: code * 1048576 });
const state1 = { chain: [], turnPlayer: 0, turnCount: 1, phaseName: 'MAIN1' };
const bytesOf = (v) => JSON.stringify(Array.from(v || []));

(async () => {
  const apEl = els.autopass || (els.autopass = stubEl());
  const sheetEl = els.sheet || (els.sheet = stubEl());

  // FO-1: a suppressed EFFECTYN auto-answers 0, shows nothing, and
  // flashes its own label (not the auto-pass label).
  T.clearSuppressed();
  T.setDismissed(new Set(), new Map());
  const p1 = effYn(MUDORA);
  T.suppress(p1);
  ok(T.suppressedSize() === 1, 'FO-1a: suppressing adds one entry to duelNoConfirm');
  sheetEl.innerHTML = ''; apEl.textContent = '';
  let settled1 = false, val1 = null;
  const pr1 = T.uiAnswer(p1, state1);
  pr1.then(v => { settled1 = true; val1 = v; }, () => { settled1 = true; });
  await tick(50);
  ok(settled1, 'FO-1b: suppressed EFFECTYN settles without an answer tap');
  ok(bytesOf(val1) === bytesOf(E.i32resp(0)), 'FO-1c: the auto-answer is 発動しない (i32resp 0)');
  ok(sheetEl.innerHTML === '', 'FO-1d: no sheet is shown for a suppressed EFFECTYN');
  ok(apEl.textContent.includes('省略中：') && apEl.textContent.includes('剣神官ムドラ'),
    'FO-1e: the flash says 省略中：〈card〉 (got ' + JSON.stringify(apEl.textContent) + ')');
  ok(!apEl.textContent.includes('自動パス'), 'FO-1f: the suppressed flash never says 自動パス');
  T.setFlashExpired();

  // FO-2: the same EFFECTYN, unsuppressed, shows the yes/no sheet
  // with the suppress button (the only way to enter duelNoConfirm).
  T.clearSuppressed();
  sheetEl.innerHTML = '';
  let settled2 = false;
  const pr2 = T.uiAnswer(p1, state1);
  pr2.then(() => { settled2 = true; }, () => { settled2 = true; });
  await tick(50);
  ok(!settled2, 'FO-2a: unsuppressed EFFECTYN waits for an answer');
  ok(sheetEl.innerHTML.includes('この効果の確認を、このデュエル中は省略する'),
    'FO-2b: the sheet carries the 省略する button');
  ok(sheetEl.innerHTML.includes('剣神官ムドラ'), 'FO-2c: the sheet names the card');
  T.answerCurrent(E.i32resp(0));
  await tick(20);
  ok(settled2, 'FO-2d: answering settles the prompt');

  // FO-3: flashAutoPass itself is untouched — same label, same name.
  apEl.textContent = '';
  T.flashAutoPass('剣神官ムドラ');
  ok(apEl.textContent.includes('自動パス：') && apEl.textContent.includes('剣神官ムドラ'),
    'FO-3: flashAutoPass still says 自動パス：〈card〉 (got ' + JSON.stringify(apEl.textContent) + ')');
  T.setFlashExpired();

  // FO-4: the manager lists the suppressed effect (with its effect
  // number), carries no 解除 for it, and states it cannot be cancelled.
  T.clearSuppressed();
  T.setDismissed(new Set(), new Map());
  T.suppress(effYn(MUDORA));
  T.suppress(effYn(KELDO));
  sheetEl.innerHTML = '';
  T.openDismissManager();
  const mgr = sheetEl.innerHTML;
  ok(mgr.includes('剣神官ムドラ の効果①') && mgr.includes('宿神像ケルドウ の効果①'),
    'FO-4a: the manager lists both suppressed effects with their effect numbers');
  ok(mgr.includes('省略中の確認'), 'FO-4b: the manager has the 省略中の確認 section');
  ok(mgr.includes('取り消しはできません'), 'FO-4c: the manager states suppression cannot be cancelled');
  ok(!mgr.includes('data-undismiss'), 'FO-4d: no 解除 button exists for a suppressed effect');
  ok(mgr.includes('省略中の確認はありません') === false, 'FO-4e: the empty note is gone while entries exist');
  // an auto-pass row still carries its 解除, next to the new section.
  T.setDismissed(new Set(), new Map([['99937011|fx1', { code: MUDORA, desc: MUDORA * 1048576, loc: 8 }]]));
  sheetEl.innerHTML = '';
  T.openDismissManager();
  const mgr2 = sheetEl.innerHTML;
  ok(mgr2.includes('data-undismiss="99937011|fx1"'),
    'FO-4f: an auto-pass row still un-dismisses by class key');
  ok(mgr2.includes('省略中の確認（このデュエル）') && mgr2.includes('剣神官ムドラ の効果①'),
    'FO-4g: both sections coexist in one manager sheet');

  // FO-5: the pill is the only way into the manager, and it used
  // to appear for auto-pass entries only — a suppression-only
  // duel left the manager (and its new omitted list) unreachable.
  // Suppression alone now raises the pill with its own label; the
  // auto-pass count still wins when both exist (CL9a / FX3-11);
  // with neither, the pill stays off. (In this stub DOM
  // appendChild is a no-op, so the two-span label text is pinned
  // by source below; the className is the behavioural pin here.)
  T.clearSuppressed();
  T.setDismissed(new Set(), new Map());
  T.suppress(effYn(MUDORA));
  apEl.className = ''; apEl.textContent = '';
  T.updateAutoPassChip();
  ok(apEl.className === 'on',
    'FO-5a: suppression alone raises the pill (class ' + JSON.stringify(apEl.className) + ')');
  ok(/else if \(duelNoConfirm\.size\) \{\n[\s\S]*?ap1 = '省略中：' \+ duelNoConfirm\.size \+ ' 件';\n\s*ap2 = '（タップで管理）';/.test(clientSrc),
    'FO-5b: the suppression-only pill label is 省略中：N 件（タップで管理）');
  ok(/if \(dismissedDuel\.size\) \{[\s\S]*?\} else if \(duelNoConfirm\.size\) \{/.test(clientSrc),
    'FO-5c: the auto-pass branch is checked first, so with both the auto-pass count wins on the pill');
  T.setDismissed(new Set(), new Map([['99937011|fx1', { code: MUDORA, desc: MUDORA * 1048576, loc: 8 }]]));
  apEl.className = ''; apEl.textContent = '';
  T.updateAutoPassChip();
  ok(apEl.className === 'on', 'FO-5d: with both, the pill is on (auto-pass label, pinned by CL9a / FX3-11)');
  T.clearSuppressed();
  T.setDismissed(new Set(), new Map());
  apEl.className = ''; apEl.textContent = '';
  T.updateAutoPassChip();
  ok(apEl.className === '' && apEl.textContent === '',
    'FO-5e: with neither, the pill stays off');

  // FO-9: suppressing raises the pill AT ONCE — before this pin,
  // nothing called updateAutoPassChip at suppression time, so the
  // pill (the only way into the manager) stayed hidden until the
  // same effect was asked again and flashed (measured in the live
  // probe: pill class '' after suppressing カルドゥーン, manager
  // reachable only by clicking a display:none element).
  ok(/duelNoConfirm\.add\(effectYnKey\(prompt\)\); updateAutoPassChip\(\);/.test(clientSrc),
    'FO-9: the 省略する handler refreshes the pill immediately after adding the suppression');
  ok(/duelNoConfirm\.has\(effectYnKey\(prompt\)\)\) \{ flashSuppressed\(cardName\(prompt\.code\)\)/.test(clientSrc),
    'FO-6: uiAnswer answers a suppressed EFFECTYN through flashSuppressed (not flashAutoPass)');
  ok(/dismissedDuel = new Map\(\);\n\s*duelNoConfirm = new Set\(\); \/\/ C-27 suppression restarts with the duel/.test(clientSrc),
    'FO-7: the duel-start reset clears duelNoConfirm next to dismissedDuel');
  ok(/function flashAutoPass\(names\) \{ flashChip\(names, '自動パス：'\); \}/.test(clientSrc) &&
    /function flashSuppressed\(names\) \{ flashChip\(names, '省略中：'\); \}/.test(clientSrc),
    'FO-8: flashAutoPass keeps its (names) signature and label; flashSuppressed carries the 省略中： label');

  console.log(failures === 0 ? 'ALL FIXOBS2 CHECKS PASSED' : failures + ' FIXOBS2 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
