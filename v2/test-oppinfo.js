'use strict';
/* test-oppinfo.js — regression for the opponent-info round
   (user request 2026-11-04: "tap an opponent's card and see
   its info — face-up public info only").
   Contract under test:
   - Board tap on an opponent FACE-UP monster / spell / trap
     puts that card in the resident preview; tapping the
     preview opens the full read-only detail. Nothing is ever
     answered by looking.
   - An opponent FACE-DOWN card NEVER resolves to info: the
     single guard is boardCardAt() — face-up, or the player's
     own card. Tapping a face-down opponent slot changes
     nothing and leaks nothing.
   - Mid-selection (SELECT_CARD grid sheet up, sheet peeked
     down), a board info tap (peekInfoTap) floats the read-only
     detail over the board and leaves the selection EXACTLY as
     it was: same selected cards, prompt still pending, nothing
     confirmed or cancelled.
   - During placement (placeCtx), a tap on a zone the
     placement does not target is an info tap into the resident
     preview; the placement state is untouched.
   Method: boot the real client in jsdom (harness as
   test-cardart), paint a fabricated board through render(),
   dispatch real click events, and drive a synthetic
   SELECT_CARD through uiAnswer. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const KELDO = 63542003, MUDORA = 99937011, KELBEK = 25926710, ZOLGA = 31525442, TAIYOU = 38699854;

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'OI0: client boots');
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  const slot = (key) => doc.querySelector('.slot[data-zone="' + key + '"]');
  const pvState = () => window.eval('(() => previewState && { code: previewState.code, con: previewState.con })()');
  const pvText = () => doc.getElementById('preview').textContent;

  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);   // opponent face-up monster
    b.players[1].mzone[1] = mon(${KELBEK}, 0x8);  // opponent face-down monster (identity must stay hidden)
    b.players[1].szone[0] = mon(${TAIYOU}, 0x5);  // opponent face-up spell
    b.players[1].szone[1] = mon(${ZOLGA}, 0xa);   // opponent face-down trap zone (identity must stay hidden)
    b.players[0].mzone[0] = mon(${MUDORA}, 0x1);  // own face-up monster
    duelState = b; render(b);
    return true;
  })()`);

  // ---- the guard itself ----
  const guard = window.eval(`(() => ({
    oppFU: window.__oppinfo.boardCardAt('1:4:0'),
    oppFDmon: window.__oppinfo.boardCardAt('1:4:1'),
    oppFUst: window.__oppinfo.boardCardAt('1:8:0'),
    oppFDst: window.__oppinfo.boardCardAt('1:8:1'),
    own: window.__oppinfo.boardCardAt('0:4:0'),
    empty: window.__oppinfo.boardCardAt('1:4:3'),
  }))()`);
  ok(guard.oppFU && guard.oppFU.code === KELDO && guard.oppFU.ref.con === 1, 'OI1a: boardCardAt resolves the opponent face-up monster');
  ok(guard.oppFUst && guard.oppFUst.code === TAIYOU, 'OI1b: boardCardAt resolves the opponent face-up spell');
  ok(guard.oppFDmon === null, 'OI1c: boardCardAt refuses the opponent face-down monster');
  ok(guard.oppFDst === null, 'OI1d: boardCardAt refuses the opponent face-down spell/trap');
  ok(guard.own && guard.own.code === MUDORA && guard.empty === null, 'OI1e: own card resolves; empty zone does not');

  // ---- board taps: face-up opponent info into the resident preview ----
  click(slot('1:4:0'));
  ok(pvState() && pvState().code === KELDO && pvState().con === 1 && pvText().includes('宿神像ケルドウ'), 'OI2a: tapping the opponent face-up monster previews it');
  ok(doc.getElementById('infopop').className !== 'on', 'OI2b: a plain board tap only previews (no pop, no answer)');
  click(doc.getElementById('preview'));
  const sheetTxt = doc.getElementById('sheet').textContent;
  ok(doc.getElementById('sheetwrap').dataset.kind === 'view' && sheetTxt.includes('宿神像ケルドウ') && sheetTxt.includes('現世と冥界の逆転'), 'OI2c: preview tap opens the full read-only detail of the opponent card');
  click(doc.getElementById('sheet-cancel'));
  click(slot('1:8:0'));
  ok(pvState() && pvState().code === TAIYOU && pvText().includes('太陽の書'), 'OI2d: tapping the opponent face-up spell/trap previews it');

  // ---- board taps: face-down opponent cards leak nothing ----
  click(slot('0:4:0')); // sentinel: own Mudora in the preview
  ok(pvState() && pvState().code === MUDORA, 'OI3a: sentinel preview set (own Mudora)');
  click(slot('1:4:1'));
  ok(pvState() && pvState().code === MUDORA && !pvText().includes('ケルベク'), 'OI3b: tapping the opponent face-down monster changes nothing and leaks nothing');
  click(slot('1:8:1'));
  ok(pvState() && pvState().code === MUDORA && !pvText().includes('ゾルガ'), 'OI3c: tapping the opponent face-down spell/trap changes nothing and leaks nothing');

  // ---- mid-selection: peek info tap leaves the selection untouched ----
  const selReady = window.eval(`(() => {
    window.__oiResolved = false;
    const prompt = { name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: true, retryCount: 0, context: null,
      cards: [ { code: ${KELDO}, con: 1, loc: 4, seq: 0, releaseParam: 0 }, { code: ${MUDORA}, con: 0, loc: 4, seq: 0, releaseParam: 0 } ] };
    uiAnswer(prompt, duelState).then(() => { window.__oiResolved = true; });
    return true;
  })()`);
  for (let i = 0; i < 60 && !doc.querySelector('[data-grid]'); i++) await new Promise(r => setTimeout(r, 50));
  ok(!!doc.querySelector('[data-grid]'), 'OI4a: SELECT_CARD grid sheet is up');
  click(doc.querySelector('[data-grid="0"]'));
  ok(doc.querySelector('[data-grid="0"]').classList.contains('sel'), 'OI4b: one candidate selected');
  click(doc.getElementById('peekbtn'));
  ok(doc.getElementById('sheetwrap').classList.contains('peek'), 'OI4c: sheet peeked down to the board');
  const peekHit = window.eval(`window.__oppinfo.peekInfoTap('1:8:0')`);
  ok(peekHit === true && doc.getElementById('infopop').className === 'on' && doc.getElementById('infopop').textContent.includes('太陽の書'), 'OI4d: peek info tap on a NON-candidate opponent face-up card floats its detail');
  const midSel = window.eval(`(() => ({ prompt: !!currentPrompt, resolved: window.__oiResolved }))()`);
  ok(midSel.prompt === true && midSel.resolved === false && doc.querySelector('[data-grid="0"]').classList.contains('sel'), 'OI4e: selection untouched — still selected, prompt still pending, nothing answered');
  const peekMiss = window.eval(`window.__oppinfo.peekInfoTap('1:4:1')`);
  ok(peekMiss === false, 'OI4f: peek info tap on an opponent face-down card is refused');
  click(doc.getElementById('infopop-close'));
  ok(doc.getElementById('infopop').className !== 'on' && window.eval('!!currentPrompt'), 'OI4g: closing the detail returns to the pending selection');
  click(doc.getElementById('peekbtn')); // back to the sheet
  click(doc.getElementById('grid-confirm'));
  for (let i = 0; i < 40 && !window.eval('window.__oiResolved'); i++) await new Promise(r => setTimeout(r, 50));
  ok(window.eval('window.__oiResolved') === true, 'OI4h: the selection can still be confirmed after looking');

  // ---- placement: a non-target zone tap is info only ----
  window.eval(`(() => { placeCtx = { avail: new Set(['0:4:2']), chosen: new Map(), count: 1, retry: false, title: 'probe' }; return true; })()`);
  click(slot('1:4:0'));
  ok(pvState() && pvState().code === KELDO, 'OI5a: during placement, tapping the opponent face-up monster previews it');
  ok(window.eval('placeCtx && placeCtx.chosen.size') === 0, 'OI5b: the placement is untouched');
  click(slot('0:4:0')); // own Mudora sentinel again
  click(slot('1:4:1'));
  ok(pvState() && pvState().code === MUDORA && window.eval('placeCtx && placeCtx.chosen.size') === 0, 'OI5c: during placement, the opponent face-down tap leaks nothing and places nothing');
  window.eval('placeCtx = null');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL OPPINFO CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
