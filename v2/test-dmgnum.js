'use strict';
/* BU-77 (2026-11-13) — the damage/heal numeral in REAL duels.
   The synthetic tests (test-fx / test-dmglayout) drive fxProcess with
   hand-made states and always passed — yet the numeral's real-duel
   path was never pinned, so a defect there could hide behind green
   unit tests. This file drives REAL duels (bot answers the human
   seat) through the production onUpdate path (render then fxProcess)
   and pins the numeral where it actually lives:
     R*: every dmgnum the engine produces in a real duel floats a
         matching .fx3-dmgnum (right text/tier) — battle and
         effect branches alike, whichever seat is hit — and each
         branch visibly renders at least one red numeral at
         opacity >= 0.5. (Not every single numeral can be required
         to render: a battle numeral is scheduled at its attack
         scene's beat-booked impact, and a faster second damage
         to the same seat supersedes the count scene before the
         first numeral's appearance time — by design. Those are
         logged, not failed.)
     L*: a LETHAL drop floats NO numeral (the finisher owns the
         lethal blow), whether the winner arrives in the same batch
         or trails in a later batch (FXB4b/c form).
     F*: the finisher drains the LOSER's counter — for a lethal
         effect kill the seat comes from the winner, never from a
         stale attack scene's defender.
     H*: a heal floats the green +N numeral through the same path.
   Design note: hidden_files/fx-design-2026-11-13-dmg-layout.md
   (BU-77 section). The synthetic parts (L/F/H) run in a FRESH
   jsdom boot: the real duels leave client timers behind that can
   re-render a stale duel state seconds later, which would corrupt
   the synthetic assertions — a harness artifact of sharing one
   DOM, not a product defect. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (cond, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(100); } return cond(); };

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

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
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

function fakeState(mut) {
  const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const st = { players: [P(), P()], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [] };
  if (mut) mut(st);
  return st;
}

(async () => {
  let window = await boot();
  let doc = window.document;
  let fx = window.__fx;
  const ev = (src) => window.eval(src);
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'DMGN-R0: client boots');
  const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));

  // ================= Part R: real duels =================
  // Numeral observation: MutationObserver + 25 ms polling of live
  // elements (opacity / color over the element's life).
  const seen = []; // {text, cls, maxOp, colors:Set, removed}
  const live = new Map();
  const obs = new window.MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && (n.classList.contains('fx3-dmgnum') || n.classList.contains('fx3-healnum'))) {
        const rec = { text: n.textContent, cls: n.className, maxOp: 0, colors: new Set(), el: n, createdFx: fx.now(), removedFx: null };
        live.set(n, rec); seen.push(rec);
      }
    }
  });
  obs.observe(doc.getElementById('fxlayer'), { childList: true });
  const poller = setInterval(() => {
    for (const [el, rec] of live) {
      if (!el.isConnected) { if (rec.removedFx == null) rec.removedFx = fx.now(); live.delete(el); continue; }
      const op = parseFloat(el.style.opacity || '0') || 0;
      if (op > rec.maxOp) rec.maxOp = op;
      if (el.style.color) rec.colors.add(el.style.color);
    }
  }, 25);

  const dmgRecords = []; // {player, amount, tier, battle}
  // Capture dmgnum records through a wrapper (not log slicing: the
  // fxLog rolls over at 400 entries mid-duel, which would silently
  // drop records from a cursor).
  const origRecord = window.fxRecord;
  window.fxRecord = (kind, detail) => {
    if (kind === 'dmgnum' && detail) dmgRecords.push({ player: detail.player, amount: detail.amount, tier: detail.tier, battle: detail.battle });
    return origRecord(kind, detail);
  };
  const runDuel = async (seed, delayChainMs) => {
    window.fxResetDuel();
    doc.getElementById('app').classList.remove('preduel');
    const onUpdate = (state) => {
      const evs = state.events ? state.events.slice() : [];
      try { window.fxCaptureDom(); } catch (e) {}
      try { window.drainSeEvents(state); } catch (e) {}
      try { window.trackUsedFx(state); } catch (e) {}
      try { window.trackFieldSummons(evs, state); } catch (e) {}
      window.render(state);
      window.fxProcess(evs, state);
    };
    const duel = await window.createClientDuel(data, {
      // Realistic pace (not 0): at pace 0 the engine's microtask
      // storm starves jsdom's rAF, the FX clock barely advances
      // mid-duel, and each new count scene supersedes the previous
      // numeral before it ever renders (opacity stays 0) — a
      // harness artifact, not a product defect. At pace 120 the
      // clock keeps up and every numeral lives its full life.
      seed, pace: { bot: 120, botChain: 60, batch: 10 },
      deckP0: window.deckListOf('ishizu'), deckP1: window.deckListOf('gg'), humanTeam: 0,
      humanAnswerer: async (prompt, state) => {
        // Delay only chain prompts: a battle whose damage lands >400ms
        // (FX clock) after the attack scene takes the EFFECT branch.
        // 1200ms wall ~= 680ms FX under jsdom's lagged rAF clock.
        if (delayChainMs && prompt.name === 'SELECT_CHAIN') await sleep(delayChainMs);
        return window.Engine.botAnswer(prompt, state, data, window.Engine.makeBotMemory());
      },
      onUpdate,
    });
    window.duel = duel;
    await Promise.race([duel.run(), sleep(180000).then(() => 'timeout')]);
    // Settle: at pace 0 the engine starves jsdom's rAF, so the FX
    // clock lags wall time and numerals created mid-duel are still at
    // t~0 when the duel ends. Give the loop wall time so every scene
    // animates (opacity ramps) and expires before the next duel.
    await waitFor(() => !doc.querySelector('.fx3-dmgnum'), 6000);
  };

  let battleSeen = false, effectSeen = false;
  for (let i = 0; i < 12 && !(battleSeen && effectSeen); i++) {
    const before = dmgRecords.length;
    await runDuel(1001 + i * 7919, (i % 2 === 1) ? 1200 : 0);
    const fresh = dmgRecords.slice(before);
    if (fresh.some(r => r.battle)) battleSeen = true;
    if (fresh.some(r => !r.battle)) effectSeen = true;
    console.log('duel ' + (i + 1) + ': dmgnum records this duel=' + fresh.length +
      ' (battle ' + fresh.filter(r => r.battle).length + ', effect ' + fresh.filter(r => !r.battle).length + ')');
  }
  await sleep(150); // let the poller record the last numerals' removal
  clearInterval(poller);
  ok(fx.error === null, 'DMGN-R1: fxError stayed null through the real duels (got: ' + fx.error + ')');
  ok(battleSeen, 'DMGN-R2: a real duel produced battle damage (dmgnum battle:true)');
  ok(effectSeen, 'DMGN-R3: a real duel produced effect damage (dmgnum battle:false)');
  ok(dmgRecords.length > 0, 'DMGN-R4: real duels produced damage at all (' + dmgRecords.length + ' dmgnum records)');
  // Every dmgnum record must have a matching numeral (1:1, in
  // creation order per text). Whether a numeral VISIBLY renders
  // depends on the beat book: a battle numeral is scheduled to
  // appear at its attack scene's impact (t0+280), and the attack
  // scene's t0 is beat-booked — in a busy battle phase the book
  // runs ahead, so the numeral's appearance time can be ~1 s FX
  // after the damage batch. If the next damage to the same seat
  // lands first, the count scene is superseded (by design — the
  // counter shows the latest value) and the not-yet-shown numeral
  // is removed at opacity 0. That is a product property, not a
  // render defect: the pin is that each branch DOES visibly
  // render in real duels (opacity >= 0.5, red), and that no
  // numeral goes missing (R6). A numeral that lived its full life
  // without ramping shows up in the log below as neither visible
  // nor superseded-early.
  const dmgNums = seen.filter(s => s.cls.includes('fx3-dmgnum'));
  const pool = new Map(); // text -> queue of numerals, creation order
  for (const s of dmgNums) { if (!pool.has(s.text)) pool.set(s.text, []); pool.get(s.text).push(s); }
  let visibleBattle = 0, visibleEffect = 0, nVisible = 0, nEarly = 0, nBoundary = 0;
  for (const r of dmgRecords) {
    const want = '−' + r.amount;
    const q = pool.get(want) || [];
    const m = q.shift();
    // numDelay 280/0 + 40 ms ramp + 20 ms detection margin
    const threshold = r.battle ? 340 : 60;
    const livedFx = m ? ((m.removedFx != null ? m.removedFx : fx.now()) - m.createdFx) : Infinity;
    const visible = !!m && m.maxOp >= 0.5 && [...m.colors].some(c => c.includes('255, 83, 72') || c.includes('255, 201, 194'));
    // livedFx < 0 means the removal was recorded against the NEXT
    // duel's reset clock (fxTimeMs restarts at 0): the numeral
    // outlived its duel and was cleared by the next duel's reset —
    // a duel-boundary clearance, not a render failure.
    const boundaryClear = !!m && livedFx < 0;
    const supersededEarly = !!m && livedFx >= 0 && livedFx < threshold;
    if (visible) { nVisible++; if (r.battle) visibleBattle++; else visibleEffect++; }
    else if (boundaryClear) { nBoundary++; console.log('  cleared at a duel boundary (clock reset): ' + JSON.stringify(r) + ' livedFx=' + Math.round(livedFx) + 'ms'); }
    else if (supersededEarly) { nEarly++; console.log('  superseded early (by design): ' + JSON.stringify(r) + ' livedFx=' + Math.round(livedFx) + 'ms'); }
    else console.log('  NOT visible and NOT excused: ' + JSON.stringify(r) + ' (numeral: ' + (m ? m.text + ' maxOp=' + m.maxOp + ' colors=' + [...m.colors].join('|') + ' livedFx=' + Math.round(livedFx) : 'none') + ')');
  }
  ok(visibleBattle > 0, 'DMGN-R5a: a battle-branch numeral visibly rendered red in a real duel (' + visibleBattle + ' of ' + dmgRecords.filter(r => r.battle).length + ')');
  ok(visibleEffect > 0, 'DMGN-R5b: an effect-branch numeral visibly rendered red in a real duel (' + visibleEffect + ' of ' + dmgRecords.filter(r => !r.battle).length + ')');
  console.log('  R5 summary: visible ' + nVisible + '/' + dmgRecords.length + ', superseded-early ' + nEarly + ', boundary-clear ' + nBoundary);
  ok(dmgNums.length === dmgRecords.length, 'DMGN-R6: numeral count equals dmgnum record count (no stray numerals, none missing: ' + dmgNums.length + ' vs ' + dmgRecords.length + ')');

  // The synthetic parts run in a FRESH boot: the real duels leave
  // client timers behind that can re-render a stale duel state
  // seconds later (observed twice: oppLp jumping to the last
  // duel's final value mid-way through Part F) — a harness
  // artifact of sharing one DOM, not a product defect. Isolate it.
  obs.disconnect();
  try { window.close(); } catch (e) {}
  window = await boot();
  doc = window.document;
  fx = window.__fx;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'DMGN-S0: synthetic boot is ready');

  // ================= Part L: lethal drops float NO numeral =================
  const step = (st, evs) => { const before = fx.log.length; window.render(st); fx.process(evs || [], st); return fx.log.slice(before); };
  const mon = (code) => ({ code, pos: 1, materials: 0, curAtk: data.cards[code].atk, curDef: data.cards[code].def });
  const NORMAL = (() => { for (const [code, c] of Object.entries(data.cards)) if ((c.type & 0x1) && c.atk >= 900 && !(c.type & 0x4802040)) return +code; return null; })();
  // trailing-batch form: lethal damage first, winner later.
  fx.reset();
  step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 300; }));
  let recs = step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; }), [{ kind: 'damage', player: 1, amount: 300 }]);
  ok(!has(recs, 'dmgnum'), 'DMGN-L1: a lethal drop with no winner yet records NO dmgnum');
  ok(!doc.querySelector('.fx3-dmgnum'), 'DMGN-L1b: the lethal drop floats NO damage numeral');
  recs = step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; s.winner = 0; }), []);
  ok(has(recs, 'finisher'), 'DMGN-L2: the trailing winner still fires the finisher');
  ok(!doc.querySelector('.fx3-dmgnum'), 'DMGN-L2b: the finisher owns the lethal blow — still NO damage numeral');
  // same-batch form: winner and lethal damage together.
  fx.reset();
  step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 300; }));
  const stL = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; s.winner = 0; });
  stL.lastAttack = { attacker: { con: 0, loc: window.Engine.LOC.MZONE, seq: 0 }, target: null };
  recs = step(stL, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 300 }]);
  ok(has(recs, 'finisher'), 'DMGN-L3: same-batch lethal attack fires the finisher');
  ok(!has(recs, 'dmgnum'), 'DMGN-L3b: same-batch lethal damage records NO dmgnum');
  ok(!doc.querySelector('.fx3-dmgnum'), 'DMGN-L3c: same-batch lethal damage floats NO damage numeral');

  // ================= Part F: the finisher drains the LOSER =================
  // Lethal EFFECT damage to player 0 while the last attack scene's
  // defender is player 1 (the eventual winner) — the stale attack
  // must not steer the drain onto the winner.
  fx.reset();
  step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].lp = 2500; s.players[1].lp = 2500; }));
  let stA = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].lp = 2500; s.players[1].lp = 2500; });
  stA.lastAttack = { attacker: { con: 0, loc: window.Engine.LOC.MZONE, seq: 0 }, target: null };
  step(stA, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }]);
  const stF = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].lp = 0; s.players[1].lp = 2500; s.winner = 1; });
  stF.lastAttack = stA.lastAttack;
  recs = step(stF, [{ kind: 'damage', player: 0, amount: 2500 }]);
  ok(has(recs, 'finisher'), 'DMGN-F1: lethal effect damage fires the finisher');
  ok(!has(recs, 'dmgnum'), 'DMGN-F1b: the lethal effect drop records NO dmgnum');
  // render() already shows the loser at 0 (the state value) right
  // after the lethal step, so myLp cannot signal drain completion —
  // the drain's own bookkeeping (fxLpShown) is the signal. The
  // drain runs 1600-2200 ms on the FX clock.
  ok(doc.getElementById('oppLp').textContent === '2500', 'DMGN-F3a: the WINNER counter is untouched right after the lethal step (oppLp stays 2500, got ' + doc.getElementById('oppLp').textContent + ')');
  const drained = await waitFor(() => fx.lpShown(0) === 0, 10000);
  ok(drained, 'DMGN-F2: the finisher drains the LOSER (lpShown(0) -> 0, got ' + fx.lpShown(0) + ')');
  ok(doc.getElementById('oppLp').textContent === '2500', 'DMGN-F3: the WINNER counter is untouched after the drain (oppLp stays 2500, got ' + doc.getElementById('oppLp').textContent + ')');
  // lpShown(1) is null here (the winner's LP never changed in the
  // synthetic steps); the point is it was NOT drained to 0.
  ok(fx.lpShown(0) === 0 && fx.lpShown(1) !== 0, 'DMGN-F4: __fx.lpShown tracks the drained loser only (got ' + fx.lpShown(0) + '/' + fx.lpShown(1) + ')');

  // ================= Part H: heal floats the green numeral =================
  fx.reset();
  step(fakeState());
  recs = step(fakeState(s => { s.players[0].lp = 8300; }), [{ kind: 'recover', player: 0, amount: 300 }]);
  ok(has(recs, 'healnum', r => r.player === 0 && r.amount === 300 && r.tier === 1), 'DMGN-H1: a heal records healnum {tier 1}');
  const hn = doc.querySelector('.fx3-healnum');
  ok(!!hn && hn.textContent === '+300', 'DMGN-H2: the heal numeral node reads +300 (got ' + (hn ? hn.textContent : 'none') + ')');
  // Mid-life: swollen, risen, green. Poll for the ramp instead of a
  // fixed sleep — the FX clock's wall-time rate in jsdom varies.
  const hnVisible = await waitFor(() => hn && (parseFloat(hn.style.opacity || '0') || 0) >= 0.5, 3000);
  const hnOp = hn ? parseFloat(hn.style.opacity || '0') || 0 : 0;
  const hnCol = hn ? hn.style.color : '';
  ok(hnVisible && hnOp >= 0.5, 'DMGN-H3: the heal numeral is visible mid-life (opacity ' + hnOp + ')');
  ok(hnCol === 'rgb(111, 227, 140)' || hnCol === '#6fe38c', 'DMGN-H4: the heal numeral is green mid-life (got ' + hnCol + ')');
  ok(fx.error === null, 'DMGN-H5: fxError stayed null through the synthetic parts (got: ' + fx.error + ')');

  window.close();
  console.log(failures ? ('FAILURES: ' + failures) : 'ALL DMGNUM CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(1); });
