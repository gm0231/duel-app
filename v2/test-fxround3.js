'use strict';
/* test-fxround3.js — fx-ui round 3 (G1/G2/G3 + BU-15/BU-32)
   deterministic checks in jsdom, harness as test-fxround2:
     G1b — a PEEKED card-detail view sheet must be closed by an
     arriving chain prompt. Round 2's F4 check compared
     className === 'on', but a peeked sheet carries 'on peek', so
     the peeked detail survived behind the dock (measured in the
     capture rig: sheetwrap stayed 'on peek' with the dock up).
     G3/BU-32 — in response mode 毎回 ('on'), dismissals are inert
     by design; the dock must not render the 聞かない controls at
     all, must show the respnote instead, and the chip must label
     the settings as inert. In おまかせ ('auto') the controls and
     the standard chip text are unchanged.
     BU-15 — the auto-pass chip is in flow inside #topbar.
     G1a/G2 — delivered-CSS contracts on index.html: the dock
     ground is fully opaque; the dock is a capped flex column
     whose candidate row is the only scrolling part.
   Live geometry + screenshots: fxround3/ capture rig. */
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
const tick = (ms) => new Promise(r => setTimeout(r, ms));

const KELDO = 63542003, MUDORA = 99937011;

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
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'FX3-0: client boots');

  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);
    b.players[0].mzone[0] = mon(${MUDORA}, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'auto';
    return true;
  })()`);

  const dispatchChain = (entry) => window.eval(`(() => {
    const s = duelState; s.chain = [{ code: ${KELDO}, con: 1, loc: 4, seq: 0, desc: 0 }];
    window.__fx3done = false;
    uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries: [${JSON.stringify(entry)}] }, s)
      .then(() => { window.__fx3done = true; });
    return true;
  })()`);
  const waitDock = async () => { for (let i = 0; i < 60 && doc.getElementById('dock').className !== 'on'; i++) await tick(50); return doc.getElementById('dock').className === 'on'; };
  const answerPass = async () => {
    click(doc.querySelector('#dock #chain-pass'));
    for (let i = 0; i < 40 && !window.eval('window.__fx3done'); i++) await tick(50);
    return window.eval('window.__fx3done') === true;
  };

  // ---------- G1b: peeked view sheet + arriving chain prompt ----------
  click(doc.querySelector('.slot[data-zone="1:4:0"]'));
  click(doc.getElementById('preview'));
  const sw = doc.getElementById('sheetwrap');
  ok(sw.classList.contains('on') && sw.dataset.kind === 'view', 'FX3-1: setup — detail view sheet is open');
  click(doc.getElementById('peekbtn'));
  if (!sw.classList.contains('peek')) sw.classList.add('peek'); // same class state the peek toggle produces
  ok(sw.className === 'on peek', 'FX3-2: setup — the view is PEEKED (the state round 2 missed)');
  dispatchChain({ code: MUDORA, con: 0, loc: 8, seq: 0, desc: MUDORA * 1048576 });
  ok(await waitDock(), 'FX3-3: the chain dock dispatched over the peeked view');
  for (let i = 0; i < 30 && sw.classList.contains('on'); i++) await tick(50);
  ok(!sw.classList.contains('on') && doc.getElementById('sheet').innerHTML === '',
    'FX3-4: G1 — the peeked detail view is closed by the prompt arrival (no stale panel behind the dock)');
  ok(await answerPass(), 'FX3-5: the chain prompt still answers normally');

  // ---------- G3 / BU-32: 毎回 mode renders no inert controls ----------
  window.eval(`(() => { fxSettings.resp = 'on'; return true; })()`);
  dispatchChain({ code: KELDO, con: 0, loc: 16, seq: 1, desc: KELDO * 1048576 });
  ok(await waitDock(), 'FX3-6: dock opens in 毎回 mode');
  ok(!doc.querySelector('#dock [data-dismiss]') && !doc.querySelector('#dock [data-dueldismiss]'),
    'FX3-7: BU-32 — 毎回 mode renders NO 聞かない controls (they cannot take effect)');
  const note = doc.querySelector('#dock .respnote');
  ok(!!note && note.textContent.includes('毎回') && note.textContent.includes('おまかせ'),
    'FX3-8: BU-32 — the dock states plainly that 聞かない is inert in 毎回 mode');
  ok(await answerPass(), 'FX3-9: pass still answers in 毎回 mode');

  // chip labelling under 毎回
  window.eval(`(() => { dismissedDuel.set('fx3-probe', { code: ${KELDO}, desc: 0 }); updateAutoPassChip(); return true; })()`);
  const chip = doc.getElementById('autopass');
  ok(chip.textContent.includes('毎回モードでは無効'), 'FX3-10: BU-32 — the chip labels registered dismissals as inert in 毎回 mode');

  // ---------- G3: おまかせ mode is unchanged ----------
  window.eval(`(() => { fxSettings.resp = 'auto'; updateAutoPassChip(); return true; })()`);
  ok(chip.textContent.includes('自動パス設定中：1 件'), 'FX3-11: chip text is the standard one in おまかせ mode');
  dispatchChain({ code: MUDORA, con: 0, loc: 8, seq: 0, desc: MUDORA * 1048576 });
  ok(await waitDock(), 'FX3-12: dock opens in おまかせ mode');
  ok(!!doc.querySelector('#dock [data-dueldismiss]') && !!doc.querySelector('#dock [data-dismiss]') && !doc.querySelector('#dock .respnote'),
    'FX3-13: おまかせ mode keeps both 聞かない controls and no respnote');
  ok(await answerPass(), 'FX3-14: pass answers in おまかせ mode');
  window.eval(`(() => { dismissedDuel.delete('fx3-probe'); updateAutoPassChip(); return true; })()`);

  // ---------- BU-15: chip placement ----------
  ok(chip.parentElement === doc.getElementById('topbar'), 'FX3-15: BU-15 — the chip is in flow inside #topbar');
  ok(chip.style.bottom === '', 'FX3-16: BU-15 — the chip carries no inline positioning');

  // ---------- G1a / G2: delivered CSS contracts ----------
  const dockRule = (html.match(/#dock\{[^}]*\}/) || [''])[0];
  ok(/background:#171208[;}]/.test(dockRule), 'FX3-17: G1 — dock ground is the fully opaque #171208 (no alpha)');
  const dockOn = (html.match(/#dock\.on\{[^}]*\}/) || [''])[0];
  ok(/display:flex/.test(dockOn) && /max-height:calc\(100dvh - 108px\)/.test(dockOn),
    'FX3-18: G2 — the open dock is a flex column capped at 100dvh - 108px');
  const candsRule = (html.match(/#dock \.cands\{[^}]*\}/) || [''])[0];
  ok(/overflow-y:auto/.test(candsRule) && /min-height:0/.test(candsRule),
    'FX3-19: G2 — only the candidate row scrolls inside the dock; the pass row stays pinned');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL FXROUND3 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
