'use strict';
/* test-fx.js — presentation FX verification (jsdom; NODE_PATH=<dir with jsdom>).
   Part 1 (synthetic): drives window.__fx.process with fabricated state
   pairs so every round-A grammar is asserted deterministically:
     portal per summon method (fusion / xyz / synchro / generic), material
     convergence, revival = portal with NO flight, departures fly to the
     pile they actually went to, deck returns vanish in place, control
     changes slide, Xyz detach peels, stat changes flash, phase banners,
     draws fly deck -> hand.
   Part 2 (live): two full clicked duels (same clicker discipline as
   test-ui) assert the layer fires on real play, __fx.error stays null,
   and the duel still completes (the FX layer must never break a duel).
   Round-B checks are appended at the end of both parts. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
const pickByType = (bit, extra) => {
  for (const [code, c] of Object.entries(data.cards)) if ((c.type & bit) && (!extra || extra(c))) return +code;
  return null;
};
const FUSION = pickByType(0x40), XYZ = pickByType(0x800000), SYNCHRO = pickByType(0x2000);
const isMainMonster = (c) => (c.type & 0x1) && !(c.type & 0x4802040) && c.level === 4; // any lv4 main-deck monster (the pool has no vanilla 0x11)
const NORMAL = (() => { for (const [code, c] of Object.entries(data.cards)) if (isMainMonster(c)) return +code; return null; })();
const NORMAL2 = (() => { let n = 0; for (const [code, c] of Object.entries(data.cards)) if (isMainMonster(c) && ++n === 2) return +code; return null; })();

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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

// ---- synthetic state factory (shape mirrors engine.js state) ----
function fakeState(mut) {
  const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const st = { players: [P(), P()], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: null, turnPlayer: 0 };
  if (mut) mut(st);
  return st;
}
const mon = (code, mats) => ({ code, pos: 1, materials: mats || 0, curAtk: data.cards[code].atk, curDef: data.cards[code].def });

async function playDuel(window, opts) { // compact clicker, same discipline as test-ui
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const q = (sel, root) => (root || doc).querySelector(sel);
  const obs = { ticks: 0, stalls: 0 };
  let lastDom = '';
  const t0 = Date.now();
  while (Date.now() - t0 < opts.timeoutMs) {
    obs.ticks++;
    if ($('result').style.display === 'flex') { obs.resultTitle = $('resultTitle').textContent; return obs; }
    const sheetOn = $('sheetwrap').className === 'on';
    const dockOn = $('dock').className === 'on';
    let acted = false;
    const click = (el) => { if (el) { el.click(); acted = true; } };
    if (sheetOn) {
      const sheet = $('sheet');
      const inc = q('[data-inc]', sheet);
      const counterOk = q('#counter-confirm', sheet);
      if (inc && counterOk && counterOk.disabled) click(inc);
      else if (counterOk && !counterOk.disabled) click(counterOk);
      else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
      else if (q('[data-action-idx]', sheet)) click(q('[data-action-idx]', sheet));
      else if (q('[data-code]', sheet)) click(q('[data-code]', sheet));
      else if (q('[data-pos]', sheet)) click(q('[data-pos]', sheet));
      else if (q('.posbtn', sheet)) click(q('.posbtn', sheet));
      else if (q('#yn-yes', sheet)) click(q('#yn-yes', sheet));
      else if (q('[data-num]', sheet)) click(q('[data-num]', sheet));
      else if (q('[data-bit]', sheet)) click(q('[data-bit]', sheet));
      else if (q('[data-unselect]', sheet)) click(q('[data-unselect]', sheet));
      else if (q('#unselect-finish', sheet)) click(q('#unselect-finish', sheet));
      else if (q('#sort-ok', sheet)) click(q('#sort-ok', sheet));
      else if (q('#fb-auto', sheet)) click(q('#fb-auto', sheet));
      else if (q('[data-pile-act]', sheet)) click(q('[data-pile-act]', sheet));
      else if (q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet)) click(q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet));
      else if (q('.optbtn', sheet)) click(q('.optbtn', sheet));
      else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
      else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
    } else if (dockOn) {
      click(q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
    } else if ($('placehint').className === 'on') {
      click(q('.slot.hl'));
    } else if (!$('phasebtn').disabled) {
      click($('phasebtn'));
    } else {
      click(q('[data-act]'));
    }
    const domNow = doc.body.innerHTML.length + '|' + (sheetOn ? 's' : '') + (dockOn ? 'd' : '') + $('logline').textContent;
    if (domNow === lastDom && !acted) obs.stalls++; else obs.stalls = 0;
    lastDom = domNow;
    if (obs.stalls > 400) { obs.stalled = true; return obs; }
    await new Promise(r => setTimeout(r, 30));
  }
  obs.timedOut = true;
  return obs;
}

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

  // ================= Part 1: synthetic grammar =================
  {
    const window = await boot();
    const doc = window.document;
    const fx = window.__fx;
    ok(!!fx && typeof fx.process === 'function', 'FX0: window.__fx surface exists (log/process/reset)');
    ok(!!doc.getElementById('fxlayer') && !!doc.getElementById('fxcutin'), 'FX0b: #fxlayer and #fxcutin are in the page');
    fx.reset();
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));

    // baseline: two materials on my field
    let st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].mzone[1] = mon(NORMAL2); });
    step(st);
    ok(fx.log.length === 0, 'FX1: first snapshot is a silent baseline');

    // fusion summon: materials -> grave, boss appears
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL, NORMAL2]; });
    let recs = step(st, [{ kind: 'spsummon', code: FUSION, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'fusion' && r.code === FUSION), 'FX2: fusion summon spawns the fusion (blue-violet vortex) portal');
    ok(recs.filter(r => r.kind === 'converge').length === 2, 'FX3: both fusion materials converge into the summon point');

    // xyz summon with 2 materials, then one detach
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].mzone[3] = mon(XYZ, 2); s.players[0].grave = [NORMAL, NORMAL2]; });
    recs = step(st, [{ kind: 'spsummon', code: XYZ, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'xyz'), 'FX4: xyz summon spawns the galaxy-ring portal');
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].mzone[3] = mon(XYZ, 1); s.players[0].grave = [NORMAL, NORMAL2]; });
    recs = step(st, []);
    ok(has(recs, 'peel'), 'FX5: losing an overlay unit peels a material layer off the tile');

    // destruction: xyz leaves to the grave with a flight + white flash
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL, NORMAL2, XYZ]; });
    recs = step(st, [{ kind: 'destroy', code: XYZ, con: 0, fromLoc: 4, battle: false }]);
    ok(has(recs, 'flight', r => r.to === 'grave' && r.code === XYZ), 'FX6: a destroyed monster flies to the graveyard pile');
    ok(has(recs, 'destroyflash'), 'FX7: destruction flashes white at the vacated zone');

    // revival: a monster returns from the grave — portal, never a flight
    st = fakeState(s => { s.players[0].mzone[1] = mon(NORMAL); s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; });
    recs = step(st, [{ kind: 'spsummon', code: NORMAL, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'revive'), 'FX8: revival uses the revive portal (zone lights, card appears)');
    ok(!recs.some(r => r.kind === 'flight'), 'FX9: revival does NOT fly from the graveyard');

    // phase banner
    st = fakeState(s => { s.players[0].mzone[1] = mon(NORMAL); s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; s.phaseName = 'MAIN1'; });
    recs = step(st, []);
    ok(has(recs, 'phase', r => r.phase === 'main1'), 'FX10: entering MAIN1 fires the phase banner');
    ok(!!doc.querySelector('.fx-phase'), 'FX10b: the banner node is in #fxlayer');

    // stat change flash
    st = fakeState(s => { const m = mon(NORMAL); m.curAtk += 500; s.players[0].mzone[1] = m; s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; s.phaseName = 'MAIN1'; });
    recs = step(st, []);
    ok(has(recs, 'statflash'), 'FX11: an ATK change flashes the stat strip once');

    // control change: the monster slides to the other field
    st = fakeState(s => { const m = mon(NORMAL); m.curAtk += 500; s.players[1].mzone[0] = m; s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; s.phaseName = 'MAIN1'; });
    recs = step(st, []);
    ok(has(recs, 'controlslide'), 'FX12: a control change slides the card across the board');

    // deck return: vanishes in place
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; s.phaseName = 'MAIN1'; s.players[1].deckCount = 41; });
    recs = step(st, []);
    ok(has(recs, 'vanish', r => r.to === 'deck'), 'FX13: a deck return vanishes in place (no flight)');
    ok(!recs.some(r => r.kind === 'flight'), 'FX13b: deck return spawns no flight ghost');

    // draw: deck -> hand flight
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL2, XYZ]; s.phaseName = 'MAIN1'; s.players[1].deckCount = 41; s.players[0].hand = [{ code: NORMAL2 }]; s.players[0].deckCount = 39; });
    recs = step(st, []);
    ok(has(recs, 'flight', r => r.to === 'hand' && r.from === 'deck'), 'FX14: a draw flies from the deck pile into the hand');

    // synchro + generic method mapping (stateless check through fresh pair)
    fx.reset();
    step(fakeState());
    st = fakeState(s => { s.players[1].mzone[0] = mon(SYNCHRO); });
    recs = step(st, [{ kind: 'spsummon', code: SYNCHRO, con: 1 }]);
    ok(has(recs, 'portal', r => r.method === 'synchro'), 'FX15: synchro summon spawns the converging-ring portal');
    st = fakeState(s => { s.players[1].mzone[0] = mon(SYNCHRO); s.players[1].mzone[1] = mon(NORMAL); });
    recs = step(st, [{ kind: 'summon', code: NORMAL, con: 1 }]);
    ok(has(recs, 'place', r => r.how === 'summon'), 'FX16: a normal summon is only a small placement beat (no portal)');
    ok(fx.error === null, 'FX17: fxError stayed null through every synthetic step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 2: live duels =================
  if (process.env.FX_SYNTH_ONLY) { console.log(failures === 0 ? 'ALL FX SYNTHETIC CHECKS PASSED' : failures + ' FAILED'); process.exit(failures ? 1 : 0); }
  const tally = {};
  for (let run = 0; run < 2; run++) {
    const window = await boot();
    const doc = window.document;
    doc.getElementById('startbtn').click();
    const obs = await playDuel(window, { timeoutMs: 420000 });
    const fx = window.__fx;
    for (const r of fx.log) tally[r.kind + (r.method ? ':' + r.method : '')] = (tally[r.kind + (r.method ? ':' + r.method : '')] || 0) + 1;
    console.log('  live run ' + (run + 1) + ':', JSON.stringify({ result: obs.resultTitle || null, fxError: fx.error, fxRecords: fx.log.length }));
    ok(!!obs.resultTitle, 'FXL' + (run + 1) + ': live duel ' + (run + 1) + ' reaches the result screen with the FX layer active');
    ok(fx.error === null, 'FXL' + (run + 1) + 'e: fxError stayed null in live duel ' + (run + 1));
    window.close();
  }
  console.log('  live FX tally:', JSON.stringify(tally));
  ok((tally.phase || 0) > 0, 'FXL3: phase banners fired in live duels');
  ok((tally.place || 0) > 0, 'FXL4: placement beats fired in live duels');
  ok((tally.flight || 0) > 0, 'FXL5: movement flights fired in live duels');
  ok(Object.keys(tally).some(k => k.startsWith('portal')), 'FXL6: summon portals fired in live duels');

  console.log(failures === 0 ? 'ALL FX CHECKS PASSED' : failures + ' FX CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
