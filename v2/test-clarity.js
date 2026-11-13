'use strict';
/* test-clarity.js — selection-clarity round pins (brushup
   backlog BU-15 / BU-21 / BU-22 / BU-23 / BU-24 / BU-28).
   Contract under test:
   - BU-15: the auto-pass chip never sits over the chain dock.
     While the dock is open the chip's bottom is the dock's
     height + margin; when the dock closes the inline bottom is
     dropped (CSS home). Position only — the chip's text, the
     dismissal scopes and BU-04/BU-16 are untouched.
   - BU-22 (R-SEL-2): peeking a sheet down mirrors its answer
     controls into #peekbar; a mirror click answers through the
     ORIGINAL control (handlers + disabled state), and the bar
     dies with the sheet. View-sheet close buttons never mirror.
   - BU-23: the mandatory/optional note on grid sheets is
     derived from the prompt's own terms (cancelable -> 任意,
     min 0 -> 任意, else 必須); the declare grid's "same result"
     line fires ONLY for a literally repeated code (same-name
     different-code cards never trigger it), and the real pool
     (unique codes) shows no such line.
   - BU-21: the position sheet states, in words, that a tap
     commits and cannot be undone (no protocol "back" exists).
   - BU-24: the resolving chain link's chip carries a 解決中
     tag in words, on top of the existing gold frame; resolved
     links keep the .done dim.
   - BU-28: a chain candidate whose effect line is truncated
     prints its guide to the full text （続きは「詳細」で読めます)
     on the line itself; fxTruncated is the exact >28 flag.
   Method: boot the real client in jsdom (harness as
   test-oppinfo), fabricate states/prompts, drive the real
   uiAnswer/uiChain/render paths, assert the DOM contract. */
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

const MUDORA = 99937011, KELDO = 63542003, KELBEK = 25926710;

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    // serve the REAL fxmap.json for its own URL: effect
    // identification (BU-28's line) only exists when FXMAP
    // loads, exactly as in production.
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
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CL0a: client boots');
  ok(!!doc.getElementById('peekbar'), 'CL0b: #peekbar exists in the sheet wrap');
  const C = window.__clarity;
  // fx-ui round 3 (BU-15): syncChipPos left the __clarity surface —
  // the chip moved in-flow into the top bar and has no position to
  // sync any more (see CL9).
  ok(!!C && typeof C.syncChipPos === 'undefined' && typeof C.syncPeekBar === 'function' && typeof C.gridReqNote === 'function' && typeof C.announceDupNote === 'function' && typeof C.fxTruncated === 'function', 'CL0c: __clarity surface exists (syncChipPos retired in fx-ui round 3)');
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  const waitFor = async (fn, label) => { for (let i = 0; i < 60 && !fn(); i++) await new Promise(r => setTimeout(r, 50)); ok(!!fn(), label); };

  // ---------- BU-23: derived requirement notes (unit) ----------
  ok(C.gridReqNote({ cancelable: true, prompt: { min: 1 } }) === '（任意：選ばずにやめることもできます）', 'CL1a: cancelable grid -> 任意 (can abandon)');
  ok(C.gridReqNote({ cancelable: false, prompt: { min: 0 } }).includes('0枚でも決定できます'), 'CL1b: min 0 grid -> 任意 (confirm empty)');
  ok(C.gridReqNote({ cancelable: false, prompt: { min: 2 } }) === '（必須）', 'CL1c: min>0, no cancel -> 必須');
  ok(C.gridReqNote({ cancelable: false, prompt: {} }) === '（必須）', 'CL1d: sum-style prompt (no min) -> 必須');

  // ---------- BU-23: the note lands on the real grid sheet ----------
  window.eval(`window.__select.open({ name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: false, retryCount: 0, context: null,
    cards: [ { code: ${KELDO}, con: 0, loc: 16, seq: 0, releaseParam: 0 }, { code: ${MUDORA}, con: 0, loc: 16, seq: 1, releaseParam: 0 } ] })`);
  ok(doc.getElementById('gsub').textContent.includes('（必須）'), 'CL2a: mandatory SELECT_CARD sheet says 必須');
  window.eval(`window.__select.open({ name: 'SELECT_CARD', player: 0, min: 1, max: 2, cancelable: true, retryCount: 0, context: null,
    cards: [ { code: ${KELDO}, con: 0, loc: 16, seq: 0, releaseParam: 0 }, { code: ${MUDORA}, con: 0, loc: 16, seq: 1, releaseParam: 0 } ] })`);
  ok(doc.getElementById('gsub').textContent.includes('選ばずにやめることもできます'), 'CL2b: cancelable SELECT_CARD sheet says it can be abandoned');

  // ---------- BU-22: peek mirrors on the grid sheet ----------
  click(doc.getElementById('peekbtn'));
  const bar = doc.getElementById('peekbar');
  ok(doc.getElementById('sheetwrap').classList.contains('peek') && bar.classList.contains('onbar'), 'CL3a: peeking raises the answer band');
  const mirrors = [...bar.querySelectorAll('button')];
  const confirmMirror = mirrors.find(b => b.textContent.includes('決定'));
  ok(!!confirmMirror && confirmMirror.disabled === true, 'CL3b: grid confirm is mirrored WITH its disabled state (0 of 1 selected)');
  ok(mirrors.some(b => b.textContent.includes('選ばずにやめる')), 'CL3c: the cancel answer is mirrored too');
  click(doc.getElementById('peekbtn')); // un-peek
  ok(!bar.classList.contains('onbar') && bar.children.length === 0, 'CL3d: un-peeking empties the band');
  window.eval('sheetClose()');

  // ---------- BU-23: declare grid ----------
  ok(C.announceDupNote([101, 202, 303]) === '', 'CL4a: unique codes -> no same-result line');
  ok(C.announceDupNote([101, 202, 101]) === '同名カードはどれを選んでも同じです。', 'CL4b: a literally repeated code -> the line fires');
  window.eval(`(() => { window.__clAnnDone = false;
    uiAnswer({ name: 'ANNOUNCE_CARD', player: 0, opcodes: [], retryCount: 0, context: null },
      { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [], turnPlayer: 0, log: [] }).then(() => { window.__clAnnDone = true; });
    return true; })()`);
  await waitFor(() => doc.querySelector('#sheet [data-code]'), 'CL4c: declare grid opens');
  const annSub = doc.querySelector('#sheet .sub').textContent;
  ok(annSub.includes('（必須）'), 'CL4d: declare sheet says 必須 (no cancel path exists)');
  ok(!annSub.includes('どれを選んでも同じ'), 'CL4e: the real pool (unique codes) shows NO same-result line');
  click(doc.querySelector('#sheet [data-code]'));
  click(doc.getElementById('announce-ok'));
  await waitFor(() => window.eval('window.__clAnnDone'), 'CL4f: declaration still answers as before');

  // ---------- BU-21: position sheet states the commitment ----------
  window.eval(`(() => { window.__clPosDone = false;
    uiAnswer({ name: 'SELECT_POSITION', player: 0, code: ${MUDORA}, mask: 0x1 | 0x4, retryCount: 0, context: null },
      { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [], turnPlayer: 0, log: [] }).then(() => { window.__clPosDone = true; });
    return true; })()`);
  await waitFor(() => doc.querySelector('#sheet [data-pos]'), 'CL5a: position sheet opens');
  ok(doc.querySelector('#sheet .sub').textContent.includes('取り消すことはできません'), 'CL5b: position sheet states the tap is final and cannot be undone');
  click(doc.querySelector('#sheet [data-pos]'));
  await waitFor(() => window.eval('window.__clPosDone'), 'CL5c: position answer still resolves');

  // ---------- BU-22: yes/no answered from the peek band ----------
  window.eval(`(() => { window.__clYn = null;
    uiAnswer({ name: 'SELECT_EFFECTYN', player: 0, code: ${MUDORA}, desc: ${MUDORA} * 1048576 + 0, loc: 4, retryCount: 0, context: null },
      { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [], turnPlayer: 0, log: [] }).then(b => { window.__clYn = b; });
    return true; })()`);
  await waitFor(() => doc.getElementById('yn-yes'), 'CL6a: yes/no sheet opens');
  click(doc.getElementById('peekbtn'));
  const ynMirrors = [...doc.getElementById('peekbar').querySelectorAll('button')];
  const noMirror = ynMirrors.find(b => b.textContent.trim() === '発動しない');
  ok(!!noMirror && ynMirrors.some(b => b.textContent.trim() === '発動する'), 'CL6b: both yes/no answers are mirrored in the band while peeked');
  click(noMirror);
  await waitFor(() => window.eval('window.__clYn') !== null, 'CL6c: the mirrored answer resolves the prompt (board-side answering works)');
  ok(doc.getElementById('peekbar').children.length === 0, 'CL6d: the band dies with the answered sheet');

  // ---------- BU-24: resolving link tag on the chain bar ----------
  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    b.chain = [ { code: ${MUDORA}, con: 0, loc: 4, seq: 0, desc: 0, solved: true }, { code: ${KELDO}, con: 0, loc: 16, seq: 0, desc: 0 } ];
    b.solvingLink = 2;
    duelState = b; render(b);
    return true;
  })()`);
  const chips = doc.querySelectorAll('#chainbar .link');
  ok(chips.length === 2, 'CL7a: both chain links render as chips');
  ok(chips[1].classList.contains('solving') && chips[1].querySelector('.solvingtag') && chips[1].querySelector('.solvingtag').textContent === '解決中', 'CL7b: the resolving chip carries the 解決中 tag in words');
  ok(chips[0].classList.contains('done') && !chips[0].querySelector('.solvingtag'), 'CL7c: the resolved chip keeps its dim and gets no tag');

  // ---------- BU-28: truncation flag + the guide on the dock ----------
  ok(C.fxTruncated({ body: 'あ'.repeat(29) }) === true && C.fxTruncated({ body: '短い効果' }) === false, 'CL8a: fxTruncated is the exact >28-chars flag');
  const probe = window.eval(`(() => {
    const cands = [${MUDORA}, ${KELDO}, ${KELBEK}];
    for (const code of cands) for (let idx = 0; idx < 3; idx++) {
      const e = { code, con: 0, loc: 16, seq: 0, desc: code * 1048576 + idx };
      const fx = entryEffect(e, 'chain');
      if (fx && fxTruncated(fx)) return { code, idx };
    }
    return null;
  })()`);
  ok(!!probe, 'CL8b: probe found a pool effect whose excerpt truncates');
  if (probe) {
    window.eval(`(() => { window.__clChain = null;
      const entry = { code: ${probe.code}, con: 0, loc: 16, seq: 0, desc: ${probe.code} * 1048576 + ${probe.idx} };
      const st = { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [{ code: ${KELDO}, con: 1, loc: 4, seq: 0, desc: 0 }], turnPlayer: 1, log: [] };
      uiAnswer({ name: 'SELECT_CHAIN', player: 0, forced: false, entries: [entry], retryCount: 0 }, st).then(b => { window.__clChain = b; });
      return true; })()`);
    await waitFor(() => doc.querySelector('#dock .cand .fxline'), 'CL8c: chain dock opens with the candidate effect line');
    // layout-fix J4 (supersedes the BU-28 pin): the dock candidate
    // line carries the effect's FULL body — the 28-char excerpt
    // showed the cost clause and cut the effect itself away behind
    // the guide, so 発動/パス was judged half-blind. The guide is
    // gone; the whole body must be present in the line.
    const fullBody = window.eval(`(() => { const e = { code: ${probe.code}, con: 0, loc: 16, seq: 0, desc: ${probe.code} * 1048576 + ${probe.idx} }; const fx = entryEffect(e, 'chain'); return fx ? fx.body : ''; })()`);
    const fxText = doc.querySelector('#dock .cand .fxline').textContent.replace(/\s+/g, ' ');
    ok(!!fullBody && fxText.includes(fullBody.replace(/\s+/g, ' ')) && !fxText.includes('続きは'), 'CL8d: layout-fix J4 — the dock line carries the FULL effect body (no truncation, no guide)');
    click(doc.getElementById('chain-pass'));
    await waitFor(() => window.eval('window.__clChain') !== null, 'CL8e: chain prompt still passes as before');
  }

  // ---------- BU-15: chip placement ----------
  // fx-ui round 3 REWRITE of this block. The round-B mechanism (the
  // chip floats over the board at home, and rides above the open
  // dock via syncAutoPassChipPos) still left the chip covering the
  // preview strip's last line and the pile row in live play. The
  // chip is now IN FLOW as the top bar's third item: it cannot
  // overlay anything, dock open or closed. The invariant pinned
  // here replaces the ride-above geometry: the chip lives in
  // flow inside the header (BU-73: row 2) and no inline bottom
  // is ever set.
  window.eval(`(() => {
    dismissedDuel.set('cl-probe', { code: ${MUDORA}, desc: 0 });
    updateAutoPassChip();
    return true;
  })()`);
  const chip = doc.getElementById('autopass');
  ok(chip.className === 'on' && chip.textContent.includes('自動パス設定中：1 件'), 'CL9a: chip shows the auto-pass state');
  ok(chip.closest('#header') === doc.getElementById('header') && chip.parentElement.classList.contains('hd-row2'), 'CL9b: BU-73 — chip lives in flow in header row 2 (cannot overlay board, preview or dock)');
  window.eval(`(() => { document.getElementById('dock').className = 'on'; updateAutoPassChip(); return true; })()`);
  ok(chip.style.bottom === '' && chip.closest('#header') === doc.getElementById('header'), 'CL9c: dock open -> chip stays in the header, no inline positioning');
  window.eval('dockClose()');
  ok(doc.getElementById('dock').className === '' && chip.style.bottom === '', 'CL9d: dock closed -> chip unchanged (no position state to restore)');
  window.eval(`(() => { dismissedDuel.delete('cl-probe'); updateAutoPassChip(); return true; })()`);

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CLARITY CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
