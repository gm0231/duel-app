'use strict';
/* test-fixoldbu2.js — the 2026-11-16 fix-oldbu2 pins (follow-up to the
   fix-oldbu-1116 live re-verification, which FAILED two items):
   BU-47 (deck summary orphan, REDO): the fix-oldbu-1116 split
     (decks on line 1, turn alone on line 2) failed live play —
     the screen still read 「先攻」 alone on line 2, the exact
     orphan the item was about. A lone word on its own line IS the
     orphan, wrapped or deliberate. The turn now rides MY line
     (自分：<deck> ／ 先攻) and line 2 carries the whole opponent
     entry, so neither line is a single word. These pins are
     STRICTER than the old F47b/c: they assert the turn is on my
     line AND that no line is a lone word.
   BU-39 (chain-dim, deferred-tray hole): the dock-stage dim was
     measured live at opacity 0.5 on 861/861 non-candidate cards,
     but the dock COVERS the hand (measured: 100% overlap), so the
     dim is only ever visible at the TRAY stage — where the live
     re-verification saw bright hands. Cause: a BU-84-deferred
     tray (cut-in active at prompt arrival) re-shows AFTER uiChain
     returned, so the render at the end of uiChain ran while the
     tray was still hidden (dim guard off) and no render followed
     — measured 9 tray moments / 5 duels with every hand card lit
     (26 cards). Fix: render(duelState) right after the deferred
     re-show. G39 pins the fix at source level; the live evidence
     is the probe (probe-bu39.js, 5 duels, 0 violations after the
     fix — see RECORD.md). Card facts: none needed beyond the deck
     names (MILLENNIUM PROPHECY / ゲート・ガーディアン). */
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ================= stub DOM (same rig as test-fixoldbu.js) =================
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
const trailer = '\n;globalThis.__T = { updateDeckSum,' +
  ' setDATA: (d) => { DATA = d; },' +
  ' setFXMAP: (m) => { FXMAP = m; },' +
  ' setDecks: (my, op, first) => { myDeckKey = my; opDeckKey = op; firstChoice = first; },' +
  ' setSaved: (k, v) => { SAVED_DECKS[k] = v; },' +
  ' decksumEl: () => document.getElementById(\'decksum\') };';
vm.runInContext(clientSrc + trailer, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
T.setDATA(data);
T.setFXMAP(fxmap);

// ================= BU-47: the turn rides MY line =================
const strip = (s) => s.replace(/<[^>]+>/g, '');
ok(clientSrc.includes("el.innerHTML = nbHTML(line1) + '<br>' + nbHTML(line2);"),
  'G47a: the summary splits my-line (deck + turn) and opponent-line with a <br>');
ok(clientSrc.includes("let line1 = '自分：' + deckDisplayName(myDeckKey) + ' ／ ' + turn;"),
  'G47a: line 1 is my deck + the turn');
ok(clientSrc.includes("const line2 = '相手：' + deckDisplayName(opDeckKey);"),
  'G47a: line 2 is the whole opponent entry');
ok(clientSrc.includes('while (el.scrollHeight > 38 && fs > 10.5)'),
  'G47d: the shrink-to-fit loop stays retargeted to two lines (38px)');
{
  T.setDecks('ishizu', 'gg', 'first');
  T.updateDeckSum();
  const parts = T.decksumEl().innerHTML.split('<br>').map(strip);
  ok(parts.length === 2, 'G47b: the summary has exactly two lines (got ' + parts.length + ')');
  ok(parts[0].trim() === '自分：MILLENNIUM PROPHECY ／ 先攻',
    'G47b: line 1 is my deck + the turn (got ' + JSON.stringify(parts[0]) + ')');
  ok(parts[1].trim() === '相手：ゲート・ガーディアン',
    'G47b: line 2 is the whole opponent entry (got ' + JSON.stringify(parts[1]) + ')');
  // the anti-orphan assertion: neither line may be a lone word —
  // each line must carry a deck entry (a '：' plus more than the
  // label). The old layout failed exactly this: line 2 was 先攻 alone.
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].trim();
    ok(t.includes('：') && t.replace(/[^A-Za-z0-9\u3040-\u30FF\u4E00-\u9FFF]/g, '').length > 4,
      'G47b: line ' + (i + 1) + ' is not a lone word (got ' + JSON.stringify(t) + ')');
  }
}
{
  T.setDecks('ishizu', 'gg', 'second');
  T.updateDeckSum();
  const parts = T.decksumEl().innerHTML.split('<br>').map(strip);
  ok(parts[0].trim() === '自分：MILLENNIUM PROPHECY ／ 後攻', 'G47c: 後攻 rides my line (got ' + JSON.stringify(parts[0]) + ')');
  ok(parts[1].trim() === '相手：ゲート・ガーディアン', 'G47c: opponent line unchanged for 後攻');
  T.setDecks('ishizu', 'gg', 'random');
  T.updateDeckSum();
  const partsR = T.decksumEl().innerHTML.split('<br>').map(strip);
  ok(partsR[0].trim() === '自分：MILLENNIUM PROPHECY ／ 先攻・後攻ランダム', 'G47c: 先攻・後攻ランダム rides my line (got ' + JSON.stringify(partsR[0]) + ')');
  ok(partsR[1].trim() === '相手：ゲート・ガーディアン', 'G47c: opponent line unchanged for ランダム');
}
{
  // the unsupported-cards note (my deck's) rides line 1 with the turn
  T.setSaved('ishizu', { name: 'MILLENNIUM PROPHECY', poolOk: false, unsupported: ['《死者蘇生》'] });
  T.setDecks('ishizu', 'gg', 'first');
  T.updateDeckSum();
  const parts = T.decksumEl().innerHTML.split('<br>').map(strip);
  ok(parts[0].includes('未対応：《死者蘇生》'), 'G47e: the unsupported note rides line 1 (got ' + JSON.stringify(parts[0]) + ')');
  ok(parts[1].trim() === '相手：ゲート・ガーディアン', 'G47e: opponent line unchanged with the note');
  T.setSaved('ishizu', undefined);
}

// ================= BU-39: the deferred tray re-renders =================
{
  // the defer timer lives in showChainTray; extract it and pin the
  // re-render INSIDE the re-show branch (after the second
  // showChainTray call), not on the defer-entry path.
  const iFn = clientSrc.indexOf('function showChainTray(');
  const iNext = clientSrc.indexOf('function chainTrayYes(', iFn);
  const body = clientSrc.slice(iFn, iNext);
  const iReshow = body.indexOf('showChainTray(prompt, cause, liveIdx, openDock);', body.indexOf('setInterval'));
  ok(iReshow > 0, 'G39a: the defer timer re-shows the tray');
  const after = body.slice(iReshow);
  ok(after.includes('if (renderableState(duelState)) render(duelState);'),
    'G39a: the deferred re-show is followed by a board re-render (so the hand dims)');
  ok(after.indexOf('if (renderableState(duelState)) render(duelState);') < after.indexOf('}, 100);'),
    'G39a: the re-render is inside the timer callback, before it ends');
  // regression guard: the dim still requires a live SELECT_CHAIN
  // prompt AND an open dock/tray — the fix must not have loosened it.
  ok(clientSrc.includes("if (!currentPrompt || !currentPrompt.prompt || currentPrompt.prompt.name !== 'SELECT_CHAIN') return null;"),
    'G39b: the dim guard still requires a live SELECT_CHAIN prompt');
  ok(clientSrc.includes("(chainDimKeys && !chainDimKeys.has(key) ? ' dim' : '')"),
    'G39b: non-candidate hand cards still get the dim class');
  // the renderable guard (pre-existing fix-oldbu-1116 regression):
  // the uiChain renders must skip stub-rig states whose players
  // lack .hand/.mzone/.szone, or render() throws reading .length
  // (test-clarity / test-layoutfix3 failed on pristine main).
  ok(clientSrc.includes('function renderableState(s) {'),
    'G39c: a renderable-state helper exists');
  ok(clientSrc.includes('if (renderableState(state)) render(state);'),
    'G39c: the uiChain-end render skips non-renderable states');
  ok(clientSrc.includes('if (isFirstDraw && renderableState(state)) render(state);'),
    'G39c: the dock first-draw render skips non-renderable states');
}

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures ? 1 : 0);
