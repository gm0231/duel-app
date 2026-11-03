'use strict';
/* test-keycardact.js — regression for the keycard spell/trap
   activation cut-in (user, 2026-11-04: key S/T get the same
   grade of presentation as key monsters).
   Contract under test:
   - The trigger is the BGM ladder's own: an 'activate' event
     whose code is in KEYCARD_ACTIVATE_CODES (the keycard
     definitions — 98715423 《墓守の罠》 / 17484499 《現世と冥界の
     逆転》 at the time of writing) fires fxKeycardCutin, recorded
     as 'keycardact' + a 'cutin' record via 'keycardact', with a
     'keycardact' scene live and the #fxcutin stage up (big card
     + name banner).
   - The presentation OWNS the activation: the generic
     fxSetActivate tilt ('setactivate') does NOT also fire for
     the same event (no stacking).
   - A non-key trap activation keeps the generic presentation
     only: 'setactivate' fires, no 'keycardact', no cut-in stage.
   - Either seat's key S/T fires it (the ladder is symmetric).
   - With the cut-in setting OFF, the key activation falls back
     to the generic presentation (nothing is swallowed).
   Method: boot the real client in jsdom (harness as test-fx),
   drive window.__fx.process with fabricated states + activate
   events, assert the fx log / scene registry / DOM. */
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

const KEY1 = 98715423;   // 《墓守の罠》 — keycard, fires on activation
const KEY2 = 17484499;   // 《現世と冥界の逆転》 — keycard, fires on activation
const PLAIN = 10026986;  // (resolved below if absent) a non-key trap

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
  // pick a real non-key trap from the pool for the control case
  const plainTrap = Object.keys(data.cards).map(Number).find(c => (data.cards[c].type & 0x4) && c !== KEY1 && c !== KEY2 && data.decks.ishizu.main.includes(c));
  ok(!!plainTrap, 'KA0: a non-key pool trap exists for the control case (' + (data.names[plainTrap] || plainTrap) + ')');

  const window = await boot();
  const doc = window.document;
  const E = window.Engine;
  const fx = window.__fx;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'KA0b: client boots');
  ok(!!fx && typeof fx.process === 'function', 'KA0c: window.__fx surface exists');

  // the derivation source: the FX trigger reads the same set the
  // BGM ladder reads — both key S/T, nothing else
  const setCodes = window.eval('[...KEYCARD_ACTIVATE_CODES].sort((a, b) => a - b)');
  ok(JSON.stringify(setCodes) === JSON.stringify([KEY2, KEY1].sort((a, b) => a - b)), 'KA1: KEYCARD_ACTIVATE_CODES is exactly the two key traps (the shared BGM/FX trigger source)');

  const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const base = () => ({ players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null, deckTop: [null, null] });
  const stCard = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
  const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
  const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));

  const activateTrap = (code, con) => {
    fx.reset();
    const st0 = base(); st0.players[con].szone[0] = stCard(code, 0xa); // set
    step(st0);
    const st1 = base(); st1.players[con].szone[0] = stCard(code, 0x5); // flipped face-up
    st1.chain = [{ code, con, loc: E.LOC.SZONE, seq: 0, desc: 0 }];
    st1.turnPlayer = con;
    return step(st1, [{ kind: 'activate', code, con, loc: E.LOC.SZONE }]);
  };

  // ---- key trap activation (opponent seat): the stage fires ----
  {
    const recs = activateTrap(KEY1, 1);
    ok(has(recs, 'keycardact', r => r.code === KEY1), 'KA2: activating 《墓守の罠》 fires the keycard presentation');
    ok(has(recs, 'cutin', r => r.code === KEY1 && r.via === 'keycardact'), 'KA2b: the presentation records as a cut-in via keycardact');
    ok(!has(recs, 'setactivate', r => r.code === KEY1), 'KA2c: the generic tilt does NOT stack on the same activation');
    ok(fx.scenes().some(s => s.kind === 'keycardact'), 'KA2d: a keycardact scene is live');
    ok(fx.cutinOn(), 'KA2e: the cut-in stage is up');
    const bc = doc.querySelector('#fxcutin .bigcard');
    ok(!!bc && bc.textContent.includes(data.names[KEY1]), 'KA2f: the big card on stage is the trap itself');
    ok(!!bc && bc.style.backgroundImage.includes('card-art-hakamori.jpg') && bc.style.backgroundPosition === 'center top', 'KA2i: the stage art resolves through CARD_ART — the trap\'s own BIG illustration (18th delivery), top-anchored');
    const bn = doc.querySelector('#fxcutin .banner .cn');
    ok(!!bn && bn.textContent === data.names[KEY1], 'KA2g: the banner names the trap');
    ok(fx.error === null, 'KA2h: fxError stayed null (got: ' + fx.error + ')');
  }

  // ---- the other key trap, human seat ----
  {
    const recs = activateTrap(KEY2, 0);
    ok(has(recs, 'keycardact', r => r.code === KEY2), 'KA3: activating 《現世と冥界の逆転》 fires the keycard presentation (human seat)');
    ok(!has(recs, 'setactivate', r => r.code === KEY2), 'KA3b: no generic stacking on this seat either');
  }

  // ---- control: a non-key trap keeps the generic presentation ----
  {
    const recs = activateTrap(plainTrap, 1);
    ok(has(recs, 'setactivate', r => r.code === plainTrap), 'KA4: a non-key trap activation gets the generic tilt presentation');
    ok(!has(recs, 'keycardact'), 'KA4b: a non-key trap gets NO keycard presentation');
    ok(!fx.cutinOn(), 'KA4c: the cut-in stage stays down for a non-key trap');
  }

  // ---- cut-in setting off: the generic presentation takes over ----
  {
    fx.settings.cutin = false;
    const recs = activateTrap(KEY1, 1);
    ok(!has(recs, 'keycardact'), 'KA5: with cut-ins off, no keycard stage fires');
    ok(has(recs, 'setactivate', r => r.code === KEY1), 'KA5b: with cut-ins off, the key activation falls back to the generic presentation');
    fx.settings.cutin = true;
  }

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
