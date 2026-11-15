'use strict';
/* test-turnfx.js — BU-92 turn-change banner + input lock (jsdom;
   NODE_PATH=<dir with jsdom>). Synthetic: drives window.__fx.process
   with fabricated state pairs whose turnPlayer flips, asserting the
   banner's text / record / defer / cut / lock wiring deterministically.
   Live-browser lifecycle + hit-test measurement lives in the probe
   (turnfx-1115/probe-turnfx.js), not here. */
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

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
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

function fakeState(mut) {
  const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const st = { players: [P(), P()], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: null, turnPlayer: 0 };
  if (mut) mut(st);
  return st;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
  const window = await boot();
  const doc = window.document;
  const fx = window.__fx;
  const step = (st) => { const before = fx.log.length; fx.process([], st); return fx.log.slice(before); };
  const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
  const turnEl = () => doc.querySelector('#fxlayer .fx-turn');

  ok(!!fx && typeof fx.turnBannerText === 'function' && typeof fx.turnCut === 'function', 'TF0: __fx turn surface exists');
  fx.reset();

  // baseline (HP = 0 in a fresh boot): BU-98 — the opening turn
  // banners like any other turn start (it used to stay silent,
  // which read as the same invisibility defect as the flips)
  let base = step(fakeState());
  ok(has(base, 'turnbanner', r => r.turn === 1 && r.mine === true) && !!turnEl(), 'TF1: the opening turn (baseline snapshot) fires its banner {turn:1, mine:true}');
  fx.turnCut();

  // flip to the opponent, turn 2, draw phase in the same batch
  let recs = step(fakeState(s => { s.turnPlayer = 1; s.turnCount = 2; s.phaseName = 'DRAW'; }));
  ok(has(recs, 'turnbanner', r => r.turn === 2 && r.mine === false), 'TF2: flip records turnbanner {turn:2, mine:false}');
  ok(!!turnEl() && turnEl().classList.contains('opp'), 'TF3: banner node is in #fxlayer with the opponent seat class');
  ok(fx.turnBannerText().includes('相手のターン') && fx.turnBannerText().includes('ターン 2'), 'TF4: banner reads 相手のターン / ターン 2');
  ok(window.getComputedStyle(turnEl()).pointerEvents === 'auto', 'TF5: the banner veil takes pointer events (the input lock)');
  ok(!doc.querySelector('.fx-phase'), 'TF6: the draw-phase banner defers behind the live turn banner');

  // the phase banner follows once the turn banner retires (~1.3 s)
  let phaseSeen = false;
  for (let i = 0; i < 70 && !phaseSeen; i++) { await sleep(50); if (doc.querySelector('.fx-phase')) phaseSeen = true; }
  ok(phaseSeen, 'TF7: the deferred phase banner appears after the turn banner retires');
  for (let i = 0; i < 40 && turnEl(); i++) await sleep(50);
  ok(!turnEl(), 'TF8: the turn banner removes itself (lock released) after its span');

  // flip back to the human, turn 3
  recs = step(fakeState(s => { s.turnPlayer = 0; s.turnCount = 3; s.phaseName = 'DRAW'; }));
  ok(has(recs, 'turnbanner', r => r.turn === 3 && r.mine === true), 'TF9: flip back records turnbanner {turn:3, mine:true}');
  ok(!!turnEl() && turnEl().classList.contains('mine') && fx.turnBannerText().includes('自分のターン'), 'TF10: banner reads 自分のターン with the human seat class');

  // cut: the release path the decision-UI openers call
  fx.turnCut();
  ok(!turnEl() && fx.turnBannerText() === null, 'TF11: turnCut removes the banner and releases the lock at once');

  // no flip -> no banner
  recs = step(fakeState(s => { s.turnPlayer = 0; s.turnCount = 3; s.phaseName = 'MAIN1'; }));
  ok(!has(recs, 'turnbanner') && !turnEl(), 'TF12: no turn change, no banner');

  // defer: a decision UI (sheet) is open at the flip
  doc.getElementById('sheetwrap').classList.add('on');
  recs = step(fakeState(s => { s.turnPlayer = 1; s.turnCount = 4; s.phaseName = 'DRAW'; }));
  ok(!has(recs, 'turnbanner') && !turnEl(), 'TF13: with a decision UI open the banner waits (no lock over a prompt)');
  doc.getElementById('sheetwrap').classList.remove('on');
  let deferredShown = false;
  for (let i = 0; i < 20 && !deferredShown; i++) { await sleep(60); if (turnEl()) deferredShown = true; }
  ok(deferredShown && fx.turnBannerText().includes('相手のターン'), 'TF14: the deferred banner fires once the UI closes');
  fx.turnCut();

  // BU-98 (turnfxfix-1115): a prompt presented at the very moment
  // of the flip to the HUMAN's turn must not cut the banner. The
  // prompt funnel (humanAnswerer) awaits fx.turnHold() before any
  // opener runs; here the hold stands in for that prompt. The
  // banner must run its full span at full opacity, and the hold
  // must resolve only after the banner has retired.
  recs = step(fakeState(s => { s.turnPlayer = 0; s.turnCount = 5; s.phaseName = 'DRAW'; }));
  ok(has(recs, 'turnbanner', r => r.turn === 5 && r.mine === true) && !!turnEl(), 'TF18: flip to the human at turn 5 births the gold banner');
  const bornAt = Date.now();
  let holdResolved = false, holdResolvedAt = 0;
  const holdP = fx.turnHold().then(() => { holdResolved = true; holdResolvedAt = Date.now(); });
  let maxOpSeen = 0, elGoneAt = 0, resolvedWhileUp = false;
  for (let i = 0; i < 120; i++) {
    await sleep(25);
    const el = turnEl();
    if (el) {
      const inner = el.querySelector('.fx-turn-in');
      const op = inner ? parseFloat(inner.style.opacity || '0') : 0;
      if (op > maxOpSeen) maxOpSeen = op;
      if (holdResolved) resolvedWhileUp = true;
    } else if (!elGoneAt) elGoneAt = Date.now();
    if (holdResolved && elGoneAt) break;
  }
  await holdP;
  ok(!resolvedWhileUp && holdResolved, 'TF19: the prompt hold never resolves while the banner is up (the prompt waits)');
  ok(maxOpSeen >= 0.99, 'TF20: the banner reaches full opacity under the waiting prompt (max ' + maxOpSeen + ')');
  ok(elGoneAt - bornAt >= 1100 && elGoneAt - bornAt <= 2400, 'TF21: the banner lives its full span before the prompt proceeds (life ' + (elGoneAt - bornAt) + ' ms)');
  // (order vs elGoneAt is a sampling race between the hold's 40 ms
  // poll and this loop's 25 ms poll; the span is the substance —
  // TF19 already pins "never resolved while the element was up")
  ok(holdResolvedAt - bornAt >= 1100 && holdResolvedAt - bornAt <= 2600, 'TF22: the hold resolves only after the full span — the prompt is presented after, not instead (at ' + (holdResolvedAt - bornAt) + ' ms)');

  // BU-98 follow-up: in the real flow the engine emits the
  // virgin turn-0 state first, so the opening turn arrives as a
  // 0 -> 1 transition with the SAME turn player (no flip). It
  // must banner too.
  fx.reset();
  step(fakeState(s => { s.turnCount = 0; s.turnPlayer = 0; s.phaseName = ''; }));
  ok(fx.log.length === 0 && !turnEl(), 'TF24: the virgin turn-0 snapshot stays silent');
  recs = step(fakeState(s => { s.turnCount = 1; s.turnPlayer = 0; s.phaseName = 'DRAW'; }));
  ok(has(recs, 'turnbanner', r => r.turn === 1 && r.mine === true) && !!turnEl(), 'TF25: the 0 -> 1 transition fires the opening banner {turn:1, mine:true}');
  fx.turnCut();

  // wiring: humanAnswerer awaits the hold before the confirm
  // sheet / uiAnswer (source-level pin, same spirit as TF16)
  const haIdx = clientSrc.indexOf('humanAnswerer: async');
  const haLine = haIdx >= 0 ? clientSrc.slice(haIdx, haIdx + 400) : '';
  ok(haLine.includes('await fxTurnBannerHold()') && haLine.indexOf('fxTurnBannerHold') < haLine.indexOf('showPendingConfirms'), 'TF23: humanAnswerer awaits fxTurnBannerHold() before showPendingConfirms/uiAnswer');

  // a decided duel never banners
  recs = step(fakeState(s => { s.turnPlayer = 0; s.turnCount = 5; s.winner = 1; }));
  ok(!has(recs, 'turnbanner') && !turnEl(), 'TF15: no banner once the duel is decided');

  // wiring: the cut is called from the reset + the four decision-UI
  // openers + the safety/display paths (source-level pin; the live
  // hit-test is the probe's job)
  const cuts = (clientSrc.match(/fxTurnBannerCut\(\)/g) || []).length;
  ok(cuts >= 8, 'TF16: fxTurnBannerCut is wired at >=8 sites (got ' + cuts + ')');
  ok(fx.error === null, 'TF17: __fx.error stayed null');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
