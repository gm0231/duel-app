'use strict';
/* test-chainbadge.js — BU-74 (chain-confirm badge tray) + BU-76
   (peek return buttons enlarged everywhere).
   Contract under test:
   - The prompt GATE is unchanged: zero-option prompts and
     prompts whose every candidate is dismissed still resolve
     without showing anything (silent pass), and an all-duel-
     dismissed prompt still takes uiChain's visible flash path.
     The tray appears exactly where the dock used to be the
     first thing shown.
   - First stage = the tray (#chainui): cause line + the
     ACTIVATABLE candidates only as floating mini cards +
     チェーンする / しない badges + a 盤面を見る chip.
   - しない answers with exactly the pass bytes (i32resp(-1))
     through the same finishPrompt path as the dock's パス.
   - チェーンする opens the existing dock (className exactly
     'on'); candidate answers there are byte-identical to before.
   - Peek on the tray toggles: tray retreats, the chip reads
     選択に戻る and stays in its seat; the prompt is not answered.
   - Forced prompts: the tray carries no しない (pass is illegal).
   - BU-76: the peek toggles at all three sites (#peekbtn,
     #dock .dockpeekbtn, #ctpeek) are >= 52px tall with the gold
     primary-button treatment (CSS source pins).
   Method: boot the real client in jsdom (harness as
   test-clarity), fabricate states/prompts, drive the real
   uiAnswer/uiChain paths, assert the DOM contract. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const MUDORA = 99937011, KELDO = 63542003, KELBEK = 25926710, AGIDO = 16135253, KURIBOH = 40640057;

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    if (String(url).includes('fxmap.json')) return { ok: true, status: 200, json: async () => fxmap, arrayBuffer: async () => wasmBuf };
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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const ev = (expr) => window.eval(expr);
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  const tick = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, label) => { for (let i = 0; i < 60 && !fn(); i++) await tick(50); ok(!!fn(), label); return !!fn(); };

  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CB0a: client boots');
  ok(!!doc.getElementById('chainui') && !!doc.getElementById('chaintray') && !!doc.getElementById('ctpeek'),
    'CB0b: the tray host, tray and peek chip exist in the static DOM');

  // a renderable fabricated board: opponent Keldo on the field is
  // the chain's top link; the human seat answers.
  ev(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [{}], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 1, log: [], dlog: [] };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'auto';
    dismissedChains = new Set(); dismissedDuel = new Map();
    return true;
  })()`);

  const E1 = { code: MUDORA, con: 0, loc: 8, seq: 0, desc: MUDORA * 1048576 };
  const dispatch = (prompt) => ev(`(() => {
    const s = duelState; s.chain = [{ code: ${KELDO}, con: 1, loc: 4, seq: 0, desc: 0 }];
    window.__cbDone = false; window.__cbBytes = null;
    uiAnswer(${JSON.stringify(prompt)}, s).then(b => { window.__cbDone = true; window.__cbBytes = Array.from(b); });
    return true;
  })()`);
  const trayOn = () => doc.getElementById('chainui').classList.contains('on');
  const dockOn = () => doc.getElementById('dock').className === 'on';
  const passBytes = () => ev('Array.from(E.i32resp(-1))');
  const trayRecords = () => ev('window.__fx.log.filter(r => r.kind === "chaintray").map(r => r.action)');

  // ---------- CB1: show decision -> tray first, dock NOT yet ----------
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await waitFor(trayOn, 'CB1a: a live chain prompt raises the tray');
  ok(!dockOn(), 'CB1b: the dock is NOT open at the first stage');
  ok(!ev('window.__cbDone'), 'CB1c: the prompt is unanswered while the tray waits');
  const causeTxt = doc.querySelector('#chaintray .ct-cause-txt');
  ok(!!causeTxt && causeTxt.textContent.includes('相手の') && causeTxt.textContent.includes('宿神像ケルドウ')
    && causeTxt.textContent.includes('チェーンできます'),
    'CB1d: the cause line names the opponent card being answered (got: ' + (causeTxt ? causeTxt.textContent : 'none') + ')');
  ok(!!doc.querySelector('#chaintray .ct-cause-art'), 'CB1e: the cause card art rides the tray');
  const minis = doc.querySelectorAll('#chaintray .ct-card');
  ok(minis.length === 1 && minis[0].textContent.includes('剣神官ムドラ'),
    'CB1f: the one activatable candidate floats as a mini card');
  ok(!!doc.querySelector('#chaintray .ct-yes') && !!doc.querySelector('#chaintray .ct-no'),
    'CB1g: both badges are present on a non-forced prompt');
  ok(trayRecords().join(',') === 'show', 'CB1h: fxRecord logged the tray show');

  // ---------- CB2: peek toggles, prompt untouched ----------
  click(doc.getElementById('ctpeek'));
  ok(doc.getElementById('chainui').classList.contains('peek')
    && doc.getElementById('ctpeek').textContent === '選択に戻る',
    'CB2a: peek retreats the tray; the chip stays and reads 選択に戻る');
  ok(!ev('window.__cbDone'), 'CB2b: peeking does not answer the prompt');
  click(doc.getElementById('ctpeek'));
  ok(!doc.getElementById('chainui').classList.contains('peek')
    && doc.getElementById('ctpeek').textContent === '盤面を見る',
    'CB2c: a second tap returns the tray');
  ok(trayRecords().join(',') === 'show,peek,peek', 'CB2d: peek toggles are recorded');

  // ---------- CB3: しない == the dock pass, byte for byte ----------
  click(doc.querySelector('#chaintray .ct-no'));
  await waitFor(() => ev('window.__cbDone'), 'CB3a: しない answers the prompt');
  ok(JSON.stringify(ev('window.__cbBytes')) === JSON.stringify(passBytes()),
    'CB3b: the answer bytes are exactly the pass bytes (i32resp -1)');
  ok(!trayOn() && !dockOn(), 'CB3c: neither tray nor dock survives the answer');
  ok(trayRecords().join(',') === 'show,peek,peek,pass', 'CB3d: the pass through the tray is recorded');

  // ---------- CB4: チェーンする opens the existing dock ----------
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await waitFor(trayOn, 'CB4a: the tray returns for the next prompt');
  click(doc.querySelector('#chaintray .ct-yes'));
  await waitFor(dockOn, 'CB4b: チェーンする opens the chain dock');
  ok(!trayOn(), 'CB4c: the tray is gone once the dock owns the question');
  const act = doc.querySelector('#dock [data-chainact="0"]');
  ok(!!act, 'CB4d: the dock candidate carries its 発動する button as before');
  click(act);
  await waitFor(() => ev('window.__cbDone'), 'CB4e: the candidate answers from the dock');
  ok(JSON.stringify(ev('window.__cbBytes')) === JSON.stringify(ev('Array.from(E.i32resp(0))')),
    'CB4f: the candidate answer bytes are unchanged (i32resp 0)');
  ok(trayRecords().filter(a => a === 'chain').length === 1, 'CB4g: the chain choice is recorded');

  // ---------- CB5: forced prompt — no しない anywhere ----------
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: true, entries: [E1], retryCount: 0 });
  await waitFor(trayOn, 'CB5a: a forced prompt also starts at the tray');
  ok(!doc.querySelector('#chaintray .ct-no'), 'CB5b: a forced prompt has NO しない badge (pass is illegal)');
  ok(!!doc.querySelector('#chaintray .ct-yes'), 'CB5c: the forced tray still offers チェーンする');
  click(doc.querySelector('#chaintray .ct-yes'));
  await waitFor(dockOn, 'CB5d: the forced dock opens');
  ok(!doc.getElementById('chain-pass'), 'CB5e: the forced dock still has no pass button');
  click(doc.querySelector('#dock [data-chainact="0"]'));
  await waitFor(() => ev('window.__cbDone'), 'CB5f: the forced prompt answers by candidate');

  // ---------- CB6: gate invariance — nothing shown, as before ----------
  // zero entries: silent pass at the uiAnswer choke point
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [], retryCount: 0 });
  await waitFor(() => ev('window.__cbDone'), 'CB6a: a zero-entry prompt resolves at once');
  ok(!trayOn() && !dockOn(), 'CB6b: zero entries show neither tray nor dock');
  // the only candidate chain-dismissed: silent pass inside uiChain
  ev(`(() => { const e = { code: ${MUDORA}, con: 0, loc: 8, seq: 0, desc: ${MUDORA} * 1048576 }; dismissedChains = new Set([chainKey(e)]); return true; })()`);
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await waitFor(() => ev('window.__cbDone'), 'CB6c: an all-chain-dismissed prompt resolves without asking');
  ok(!trayOn() && !dockOn(), 'CB6d: chain-dismissed shows neither tray nor dock');
  ev('(() => { dismissedChains = new Set(); return true; })()');
  // the only candidate duel-dismissed: uiChain's visible flash path
  ev(`(() => { const e = { code: ${MUDORA}, con: 0, loc: 8, seq: 0, desc: ${MUDORA} * 1048576 }; dismissedDuel = new Map([[duelKey(e), { code: e.code, desc: e.desc, loc: e.loc }]]); return true; })()`);
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await tick(120);
  ok(!trayOn() && !dockOn(), 'CB6e: the duel-dismissed flash path shows neither tray nor dock');
  await waitFor(() => ev('window.__cbDone'), 'CB6f: the flash path still auto-passes after its delay');
  ok(doc.getElementById('autopass').textContent.includes('自動パス'), 'CB6g: the auto-pass flash fired as before');
  ev('(() => { dismissedDuel = new Map(); return true; })()');
  // resp 'on' (毎回): dismissals are inert — the tray still asks
  ev(`(() => { fxSettings.resp = 'on'; const e = { code: ${MUDORA}, con: 0, loc: 8, seq: 0, desc: ${MUDORA} * 1048576 }; dismissedDuel = new Map([[duelKey(e), { code: e.code, desc: e.desc, loc: e.loc }]]); return true; })()`);
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await waitFor(trayOn, 'CB6h: 毎回 mode asks at the tray even for a dismissed class');
  click(doc.querySelector('#chaintray .ct-no'));
  await waitFor(() => ev('window.__cbDone'), 'CB6i: 毎回 mode still passes from the tray');
  ev('(() => { fxSettings.resp = "auto"; dismissedDuel = new Map(); return true; })()');

  // ---------- CB7: mini cards = activatable candidates only; cap + chip ----------
  const E2 = { code: KELDO, con: 0, loc: 16, seq: 1, desc: KELDO * 1048576 };
  const E3 = { code: KELBEK, con: 0, loc: 16, seq: 2, desc: KELBEK * 1048576 };
  ev(`(() => { const e2 = { code: ${KELDO}, con: 0, loc: 16, seq: 1, desc: ${KELDO} * 1048576 }; dismissedChains = new Set([chainKey(e2)]); return true; })()`);
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1, E2, E3], retryCount: 0 });
  await waitFor(trayOn, 'CB7a: mixed-dismissal prompt raises the tray');
  const minis7 = doc.querySelectorAll('#chaintray .ct-card');
  ok(minis7.length === 2 && ![...minis7].some(m => m.textContent.includes('宿神像ケルドウ')),
    'CB7b: the chain-dismissed candidate does NOT float (it cannot be activated)');
  click(doc.querySelector('#chaintray .ct-no'));
  await waitFor(() => ev('window.__cbDone'), 'CB7c: pass answers');
  ev('(() => { dismissedChains = new Set(); return true; })()');
  const fiveCodes = [MUDORA, KELDO, KELBEK, AGIDO, KURIBOH];
  const five = fiveCodes.map((c, i) => ({ code: c, con: 0, loc: 2, seq: i, desc: c * 1048576 }));
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: five, retryCount: 0 });
  await waitFor(trayOn, 'CB7d: five-candidate prompt raises the tray');
  ok(doc.querySelectorAll('#chaintray .ct-card').length === 4 && !!doc.querySelector('#chaintray .ct-more'),
    'CB7e: mini cards cap at 4; the rest collapse into the count chip');
  ok((doc.querySelector('#chaintray .ct-more') || { textContent: '' }).textContent.includes('1'),
    'CB7f: the chip states how many more candidates there are');
  click(doc.querySelector('#chaintray .ct-no'));
  await waitFor(() => ev('window.__cbDone'), 'CB7g: pass answers');

  // ---------- CB8: BU-76 — peek toggles are primary-grade everywhere ----------
  const cssRule = (sel) => {
    // anchor at a line start so a longer selector that merely
    // ENDS in the same id (e.g. "#chainui.peek #ctpeek{...}")
    // is not mistaken for the base rule
    const i = html.indexOf('\n  ' + sel);
    if (i < 0) return '';
    const open = html.indexOf('{', i), close = html.indexOf('}', open);
    return html.slice(open + 1, close);
  };
  const minH = (rule) => { const m = rule.match(/min-height:\s*(\d+)px/); return m ? +m[1] : 0; };
  const rPeek = cssRule('#peekbtn{'), rDock = cssRule('#dock .dockpeekbtn{'), rTray = cssRule('#ctpeek{');
  ok(minH(rPeek) >= 52, 'CB8a: the sheet peek toggle is >= 52px tall (got ' + minH(rPeek) + ')');
  ok(minH(rDock) >= 52, 'CB8b: the dock peek toggle is >= 52px tall (got ' + minH(rDock) + ')');
  ok(minH(rTray) >= 52, 'CB8c: the tray peek chip is >= 52px tall (got ' + minH(rTray) + ')');
  ok(/linear-gradient\(#e6c877/.test(rPeek) && /linear-gradient\(#e6c877/.test(rDock) && /linear-gradient\(#e6c877/.test(rTray),
    'CB8d: all three peek toggles carry the gold primary treatment');

  // ---------- CB9: BU-84 — the tray waits out a cut-in ----------
  ev('(() => { document.getElementById("fxcutin").className = "on"; return true; })()');
  const recBefore = trayRecords().length;
  dispatch({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [E1], retryCount: 0 });
  await tick(450); // several defer polls (100 ms) pass under the cut-in
  ok(!trayOn() && !dockOn(), 'CB9a: while a cut-in owns #fxcutin the tray does NOT surface');
  ok(!ev('window.__cbDone'), 'CB9b: the prompt stays unanswered behind the cut-in');
  ok(trayRecords().slice(recBefore).join(',') === 'defer-cutin',
    'CB9c: the deferral is recorded (got: ' + trayRecords().slice(recBefore).join(',') + ')');
  ev('(() => { document.getElementById("fxcutin").className = ""; return true; })()');
  await waitFor(trayOn, 'CB9d: once the cut-in releases, the tray arrives');
  ok(trayRecords().filter(a => a === 'show').length >= 1, 'CB9e: the deferred tray shows normally');

  // ---------- CB10: BU-81 — the dock pass is real; its line says its true scope ----------
  click(doc.querySelector('#chaintray .ct-yes'));
  await waitFor(dockOn, 'CB10a: the dock opens from the deferred tray');
  const sub = doc.querySelector('#dock .sub');
  ok(!!sub && sub.textContent.includes('この確認では発動しません') && sub.textContent.includes('新しい確認が来ることがあります'),
    'CB10b: the pass line states the pass answers THIS question and a new one may come (got: ' + (sub ? sub.textContent : 'none') + ')');
  ok(!sub || !sub.textContent.includes('このタイミングでは何も発動しません'),
    'CB10c: the old over-promising line is gone');
  click(doc.getElementById('chain-pass'));
  await waitFor(() => ev('window.__cbDone'), 'CB10d: the dock pass answers the prompt');
  ok(JSON.stringify(ev('window.__cbBytes')) === JSON.stringify(passBytes()),
    'CB10e: the dock pass bytes are exactly the tray しない bytes (i32resp -1)');
  ev('(() => { const h = document.getElementById("fxcutin"); if (h) h.className = ""; return true; })()');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CHAINBADGE CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
