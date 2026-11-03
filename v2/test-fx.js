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
  inject('duel-worker.js');
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
      else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet)); // a disabled optbtn (e.g. an effect that cannot fire now) must not shadow #sheet-cancel — clicking it loops forever
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

  // ================= Part 1B: round-B synthetic grammar =================
  {
    const window = await boot();
    const doc = window.document;
    const E = window.Engine;
    const fx = window.__fx;
    fx.reset();
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const ACE = 8505920; // 合体魔神－ゲート・ガーディアン (fusion; BGM key card + cut-in roster)
    const TRIB = (() => { for (const [code, c] of Object.entries(data.cards)) if ((c.type & 0x1) && !(c.type & 0x4802040) && c.level >= 7) return +code; return null; })();

    ok(!!fx.settings && fx.settings.cutin === true && fx.settings.resp === 'auto', 'FXB0: round-B settings surface with defaults (cutin on, resp auto)');
    ok(!!doc.getElementById('seg-cutin') && !!doc.getElementById('seg-resp') && !!doc.getElementById('fxbtn'), 'FXB0b: settings controls exist (start-screen segs + in-duel button)');

    // baseline: one monster each
    let st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].mzone[0] = mon(NORMAL2); });
    step(st);

    // attack declaration: line to the target + attribute impact
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].mzone[0] = mon(NORMAL2); });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: { con: 1, loc: E.LOC.MZONE, seq: 0 } };
    let recs = step(st, [{ kind: 'attack', code: NORMAL, con: 0, direct: false }]);
    ok(has(recs, 'attackline', r => r.direct === false), 'FXB1: an attack declaration fires the attack line');
    ok(has(recs, 'impact'), 'FXB1b: the attribute impact lands on the target');

    // direct attack: banner + LP change for the counter count
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 5000; });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
    recs = step(st, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 3000 }]);
    ok(has(recs, 'directattack'), 'FXB2: a direct attack raises the DIRECT ATTACK banner');
    ok(has(recs, 'lpchange', r => r.player === 1 && r.to === 5000), 'FXB2b: the LP change is recorded for the counter count');
    await new Promise(r => setTimeout(r, 1100));
    ok(doc.getElementById('oppLp').textContent === '5000', 'FXB2c: the LP counter counted down to the exact state value (got ' + doc.getElementById('oppLp').textContent + ')');
    ok(fx.lpShown(1) === 5000, 'FXB2d: __fx.lpShown tracks the settled counter');

    // heal: counts up + floats the only floating number in the grammar
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 5600; });
    recs = step(st, [{ kind: 'recover', player: 1, amount: 600 }]);
    ok(has(recs, 'healfloat', r => r.amount === 600), 'FXB3: a heal floats a blue number at the counter');

    // finisher: the duel-ending attack washes the whole screen
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; s.winner = 0; });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
    recs = step(st, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 5600 }]);
    ok(has(recs, 'finisher'), 'FXB4: the duel-ending attack fires the finisher wash');

    // finisher, trailing-batch form: the core delivers MSG_WIN in
    // its own step AFTER the lethal damage — the wash must still fire
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 300; }));
    let recs2 = step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; }), [{ kind: 'damage', player: 1, amount: 300 }]);
    ok(!has(recs2, 'finisher'), 'FXB4b: damage alone (no winner yet) does not fire the wash');
    recs2 = step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 0; s.winner = 0; }), []);
    ok(has(recs2, 'finisher'), 'FXB4c: MSG_WIN trailing the lethal damage still fires the finisher');

    // chain: every new link pops forward, numbered; set S/T activation
    // tips into the presentation; solving is tracked for the bar glow
    fx.reset();
    step(fakeState());
    const link = (code, con) => ({ code, con: con || 0, loc: E.LOC.HAND, seq: 0, negated: false, disabled: false, solved: false });
    st = fakeState(s => { s.chain = [link(NORMAL)]; });
    recs = step(st, [{ kind: 'activate', code: NORMAL, con: 0, loc: E.LOC.HAND }]);
    ok(has(recs, 'chainpop', r => r.n === 1), 'FXB5: the first link pops in the foreground with its number');
    st = fakeState(s => { s.chain = [link(NORMAL), link(NORMAL2, 1)]; });
    recs = step(st, [{ kind: 'activate', code: NORMAL2, con: 1, loc: E.LOC.SZONE }]);
    ok(has(recs, 'chainpop', r => r.n === 2 && r.via === 'tilt'), 'FXB5b: a set S/T link merges its pop into the tilt (number rides the card)');
    ok(has(recs, 'setactivate', r => r.code === NORMAL2), 'FXB6: a set S/T activation tips into the presentation (tilt pop)');
    st = fakeState(s => { s.chain = [link(NORMAL), link(NORMAL2)]; s.solvingLink = 2; });
    recs = step(st, []);
    ok(has(recs, 'chainsolving', r => r.n === 2), 'FXB6b: solving is tracked for the bar glow');

    // cut-in: an ace summon fires it; OFF silences it (portal unaffected)
    fx.reset();
    step(fakeState());
    st = fakeState(s => { s.players[1].mzone[0] = mon(ACE); });
    recs = step(st, [{ kind: 'spsummon', code: ACE, con: 1 }]);
    ok(has(recs, 'cutin', r => r.code === ACE), 'FXB7: summoning an ace (key card) fires the cut-in');
    ok(fx.cutinOn() === true, 'FXB7b: the cut-in layer is showing');
    fx.settings.cutin = false;
    fx.reset(); step(fakeState());
    st = fakeState(s => { s.players[1].mzone[0] = mon(ACE); });
    recs = step(st, [{ kind: 'spsummon', code: ACE, con: 1 }]);
    ok(!has(recs, 'cutin'), 'FXB7c: cut-in OFF silences the cut-in');
    ok(has(recs, 'portal', r => r.method === 'fusion'), 'FXB7d: the round-A portal is unaffected by the cut-in toggle');
    fx.settings.cutin = true;

    // advance summon: tributes converge like materials, never fly
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].mzone[1] = mon(NORMAL2); }));
    st = fakeState(s => { s.players[0].mzone[2] = mon(TRIB); s.players[0].grave = [NORMAL, NORMAL2]; });
    recs = step(st, [{ kind: 'summon', code: TRIB, con: 0 }]);
    ok(has(recs, 'advance', r => r.code === TRIB), 'FXB8: a level>=5 normal summon is an advance summon');
    ok(recs.filter(r => r.kind === 'converge' && r.how === 'tribute').length === 2, 'FXB8b: both tributes converge like materials');
    ok(!recs.some(r => r.kind === 'flight' && (r.code === NORMAL || r.code === NORMAL2)), 'FXB8c: tributes do NOT fly to the graveyard');

    // flips and position changes
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = { code: NORMAL, pos: 8, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def }; }));
    st = fakeState(s => { s.players[0].mzone[0] = { code: NORMAL, pos: 4, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def }; });
    recs = step(st, []);
    ok(has(recs, 'flip', r => r.code === NORMAL), 'FXB9: a face-down monster flipping face-up flashes + edge-flips');
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); });
    recs = step(st, []);
    ok(has(recs, 'poschange', r => r.to === 'atk'), 'FXB9b: defense -> attack is a rotation beat');
    ok(fx.error === null, 'FXB10: fxError stayed null through every round-B synthetic step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1C: FX coverage — summon callouts =================
  // Every summon that no bigger scene owns names its card: a normal
  // summon was only a puff, a generic special summon / revival only a
  // portal glow. The callout record fixes the coverage; fusion / Xyz
  // (converge + portal), the ace scene and face-down arrivals must
  // NOT gain one (owned elsewhere / not public information).
  {
    const window = await boot();
    const fx = window.__fx;
    fx.reset();
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));

    step(fakeState()); // silent baseline

    // own normal summon: placement beat + callout
    let st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); });
    let recs = step(st, [{ kind: 'summon', code: NORMAL, con: 0 }]);
    ok(has(recs, 'place', r => r.how === 'summon'), 'FXC1: a normal summon keeps its placement beat');
    ok(has(recs, 'summoncall', r => r.how === 'summon' && r.code === NORMAL && r.con === 0), 'FXC1b: a normal summon names its card (callout)');

    // opponent normal summon: callout on their seat too
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[1].mzone[0] = mon(NORMAL2); });
    recs = step(st, [{ kind: 'summon', code: NORMAL2, con: 1 }]);
    ok(has(recs, 'summoncall', r => r.how === 'summon' && r.con === 1), 'FXC2: an opponent normal summon names its card');

    // generic special summon from the hand: portal + callout
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].mzone[1] = mon(NORMAL2); s.players[1].mzone[0] = mon(NORMAL2); });
    recs = step(st, [{ kind: 'spsummon', code: NORMAL2, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'generic'), 'FXC3: a generic special summon keeps its portal');
    ok(has(recs, 'summoncall', r => r.how === 'spsummon' && r.code === NORMAL2), 'FXC3b: a generic special summon names its card');

    // revival from the grave: portal + callout
    fx.reset();
    step(fakeState(s => { s.players[0].grave = [NORMAL]; }));
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); });
    recs = step(st, [{ kind: 'spsummon', code: NORMAL, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'revive'), 'FXC4: a revival keeps its revive portal');
    ok(has(recs, 'summoncall', r => r.how === 'revive'), 'FXC4b: a revival names its card');

    // fusion summon: converge + portal own it — no callout on top
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].mzone[1] = mon(NORMAL2); }));
    st = fakeState(s => { s.players[0].mzone[2] = mon(FUSION); s.players[0].grave = [NORMAL, NORMAL2]; });
    recs = step(st, [{ kind: 'spsummon', code: FUSION, con: 0 }]);
    ok(has(recs, 'portal', r => r.method === 'fusion'), 'FXC5: a fusion summon keeps its portal');
    ok(!recs.some(r => r.kind === 'summoncall'), 'FXC5b: a fusion summon gets NO callout (converge + portal own it)');

    // set monster: placement beat only, never a callout (not public)
    fx.reset();
    step(fakeState());
    st = fakeState(s => { s.players[0].mzone[0] = { code: NORMAL, pos: 8, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def }; });
    recs = step(st, [{ kind: 'set', code: NORMAL, con: 0, loc: 4 }]);
    ok(has(recs, 'place', r => r.how === 'set'), 'FXC6: a set monster keeps its placement beat');
    ok(!recs.some(r => r.kind === 'summoncall'), 'FXC6b: a set monster gets NO callout (face-down is not public)');

    // face-down special-summon arrival: no callout either
    st = fakeState(s => {
      s.players[0].mzone[0] = { code: NORMAL, pos: 8, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def };
      s.players[0].mzone[1] = { code: NORMAL2, pos: 8, materials: 0, curAtk: data.cards[NORMAL2].atk, curDef: data.cards[NORMAL2].def };
    });
    recs = step(st, [{ kind: 'spsummon', code: NORMAL2, con: 0 }]);
    ok(!recs.some(r => r.kind === 'summoncall'), 'FXC7: a face-down special summon gets NO callout');

    // flip summon: the flip beat + the callout
    st = fakeState(s => {
      s.players[0].mzone[0] = mon(NORMAL);
      s.players[0].mzone[1] = { code: NORMAL2, pos: 8, materials: 0, curAtk: data.cards[NORMAL2].atk, curDef: data.cards[NORMAL2].def };
    });
    recs = step(st, [{ kind: 'flipsummon', code: NORMAL, con: 0 }]);
    ok(has(recs, 'flip', r => r.code === NORMAL), 'FXC8: a flip summon keeps its flip beat');
    ok(has(recs, 'summoncall', r => r.how === 'flipsummon' && r.code === NORMAL), 'FXC8b: a flip summon names its card');
    ok(fx.error === null, 'FXC9: fxError stayed null through every coverage step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1C: synchro grammar (proposal S) =================
  {
    const window = await boot();
    const doc = window.document;
    const fx = window.__fx;
    fx.reset();
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const TUNER = 55702233;   // 生きる偲びのシルキィ: Lv2 tuner (type & 0x1000)
    const NONTUN = 25926710;  // 古尖兵ケルベク: Lv4 non-tuner
    const SYNC = 21368273;    // マナドゥム・トリロスークタ: Lv6 synchro, NOT on the cut-in roster
    const HORUS = 36898537;   // メタファイズ・ホルス・ドラゴン: Lv6 synchro ON the cut-in roster
    ok(!!data.cards[TUNER] && (data.cards[TUNER].type & 0x1000) !== 0 && data.cards[TUNER].level === 2, 'FXS0: tuner fixture is a Lv2 tuner in the pool');
    ok(!!data.cards[SYNC] && (data.cards[SYNC].type & 0x2000) !== 0 && !(window.__fx && [8505920, 97783338, 34904525, 61398234, 26746975, 45409943, 46148485, 36898537].includes(SYNC)), 'FXS0b: synchro fixture is a non-cutin Lv6 synchro');

    // own synchro: tuner Lv2 + non-tuner Lv4 -> Lv6, materials to grave
    step(fakeState(s => { s.players[0].mzone[1] = mon(TUNER); s.players[0].mzone[3] = mon(NONTUN); }));
    let st = fakeState(s => { s.players[0].mzone[2] = mon(SYNC); s.players[0].grave = [TUNER, NONTUN]; });
    let recs = step(st, [{ kind: 'spsummon', code: SYNC, con: 0 }]);
    ok(has(recs, 'synchro', r => r.code === SYNC && r.total === 6), 'FXS1: synchro summon records the level total (2+4=6)');
    ok(has(recs, 'synchro', r => Array.isArray(r.tunerCodes) && r.tunerCodes.length === 1 && r.tunerCodes[0] === TUNER), 'FXS1b: the synchro record names the tuner code');
    ok(recs.filter(r => r.kind === 'converge').length === 2, 'FXS2: both synchro materials are consumed as materials (converge x2)');
    ok(!recs.some(r => r.kind === 'flight' && (r.code === TUNER || r.code === NONTUN)), 'FXS3: synchro materials do NOT fly to the graveyard individually');
    ok(!has(recs, 'portal', r => r.code === SYNC), 'FXS3b: the synchro scene replaces the generic portal');
    ok(!!doc.querySelector('.fx3-synring'), 'FXS4: the stone ring node is in #fxlayer');
    ok(!!doc.querySelector('.fx3-syntuner') && !!doc.querySelector('.fx3-syngold'), 'FXS4b: tuner wears lapis, non-tuner wears gold');
    ok(doc.querySelectorAll('.fx3-synpip').length >= 6, 'FXS4c: level pips + stone outlines are in #fxlayer (got ' + doc.querySelectorAll('.fx3-synpip').length + ')');
    const tag = doc.querySelector('.fx3-syntag');
    ok(!!tag && tag.textContent === 'チューナー', 'FXS4d: the tuner tag reads チューナー');

    // opponent synchro: the same scene fires on the other side
    fx.reset();
    step(fakeState(s => { s.players[1].mzone[0] = mon(TUNER); s.players[1].mzone[1] = mon(NONTUN); }));
    st = fakeState(s => { s.players[1].mzone[2] = mon(SYNC); s.players[1].grave = [TUNER, NONTUN]; });
    recs = step(st, [{ kind: 'spsummon', code: SYNC, con: 1 }]);
    ok(has(recs, 'synchro', r => r.code === SYNC && r.total === 6), 'FXS5: opponent synchro summon gets the same scene (total=6)');
    ok(!recs.some(r => r.kind === 'flight' && (r.code === TUNER || r.code === NONTUN)), 'FXS5b: opponent materials do not fly individually either');

    // fallback: a material whose level cannot be read (unknown code,
    // e.g. a token) — no invented total, generic portal, materials fly
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = mon(TUNER); s.players[0].mzone[1] = { code: 99999999, pos: 1, materials: 0, curAtk: 0, curDef: 0 }; }));
    st = fakeState(s => { s.players[0].mzone[2] = mon(SYNC); s.players[0].grave = [TUNER, 99999999]; });
    recs = step(st, [{ kind: 'spsummon', code: SYNC, con: 0 }]);
    ok(!has(recs, 'synchro'), 'FXS6: unreadable material level -> NO synchro record (no invented total)');
    ok(has(recs, 'portal', r => r.method === 'synchro' && r.code === SYNC), 'FXS6b: fallback is the generic synchro portal');
    ok(recs.some(r => r.kind === 'flight' && r.code === TUNER) && recs.some(r => r.kind === 'flight' && r.code === 99999999), 'FXS6c: fallback materials fly to the graveyard individually, as before');

    // ace path: a cut-in synchro (Horus) keeps its cut-in and gains
    // the level grammar on the zone side (pips in the layer, no
    // second synchro scene, no standalone 'synchro' record)
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[1] = mon(TUNER); s.players[0].mzone[3] = mon(NONTUN); }));
    st = fakeState(s => { s.players[0].mzone[2] = mon(HORUS); s.players[0].grave = [TUNER, NONTUN]; });
    recs = step(st, [{ kind: 'spsummon', code: HORUS, con: 0 }]);
    ok(has(recs, 'cutin', r => r.code === HORUS && r.via === 'acescene'), 'FXS7: cut-in synchro still fires its ace scene');
    ok(!has(recs, 'synchro'), 'FXS7b: no standalone synchro scene/record on the ace path (no double presentation)');
    ok(doc.querySelectorAll('.fx3-synpip').length >= 6, 'FXS7c: level pips ride the ace scene zone phase (got ' + doc.querySelectorAll('.fx3-synpip').length + ')');
    ok(!!doc.querySelector('.fx3-syntuner'), 'FXS7d: the ace-path tuner wears the lapis ring');
    ok(fx.error === null, 'FXS8: fxError stayed null through every synchro step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1D: redesign A — attack causality (F1/F2/F3) =================
  {
    const window = await boot();
    const doc = window.document;
    const E = window.Engine;
    const fx = window.__fx;
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const oppLpEl = doc.getElementById('oppLp'), myLpEl = doc.getElementById('myLp');
    fx.reset();

    // --- F1/F2: my direct attack, opponent LP 8000 -> 7100.
    // render(trigger) reproduces the production stomp: it writes the
    // FINAL value (7100) because no count scene exists yet. The FX
    // pass must pin the counter back to the start value at scene
    // creation and hold it until the scheduled count begins.
    let st = fakeState(s => { s.log = []; s.players[0].mzone[0] = mon(NORMAL); });
    render(st); step(st);
    st = fakeState(s => { s.log = []; s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 7100; });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
    render(st);
    ok(oppLpEl.textContent === '7100', 'FXA0: setup — render() alone shows the final value first (the F1 trigger)');
    step(st, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 900 }]);
    ok(oppLpEl.textContent === '8000', 'FXA1: F1 — the counter is pinned to the start value the moment the LP scene is created (got ' + oppLpEl.textContent + ')');
    const lpScene = fx.scenes().find(s => s.kind === 'lpcount');
    ok(!!lpScene && lpScene.dur >= 1000, 'FXA1b: F1 — the count keeps its attack+400ms scheduling (lpcount dur=' + (lpScene ? lpScene.dur : 'none') + ', want 1020)');
    const oppNum = doc.querySelector('.fx3-dmgnum');
    ok(!!oppNum && oppNum.classList.contains('fx3-dmgnum--down'), 'FXA2: F2 — the opponent damage number is generated with the downward variant (class=' + (oppNum ? oppNum.className : 'none') + ')');
    ok(!!oppNum && oppNum.textContent === '−900', 'FXA2b: F2 — the opponent damage number reads −900');
    // sample the DOM while the scene drives: hold at 8000 through
    // the delay, then a monotonic decrease to exactly 7100 — any
    // final-value preview or jump-back breaks monotonicity.
    const samples = [parseInt(oppLpEl.textContent, 10)];
    const tEnd = Date.now() + 2600;
    while (Date.now() < tEnd) {
      await new Promise(r => setTimeout(r, 25));
      const v = parseInt(oppLpEl.textContent, 10);
      if (!Number.isNaN(v)) samples.push(v);
      if (v === 7100 && fx.lpShown(1) === 7100) break;
    }
    ok(samples.slice(0, 6).every(v => v === 8000), 'FXA3: F1 — the counter holds the start value through the pre-impact delay (first samples: ' + samples.slice(0, 6).join(',') + ')');
    ok(samples.every((v, i) => i === 0 || v <= samples[i - 1]), 'FXA3b: F1 — the LP display is monotonic non-increasing for the whole count (distinct: ' + samples.filter((v, i) => i === 0 || v !== samples[i - 1]).join('>') + ')');
    ok(samples[samples.length - 1] === 7100 && fx.lpShown(1) === 7100, 'FXA3c: F1 — the count settles exactly on the state value 7100');

    // --- F2 contrast: damage to ME keeps the upward variant, and
    // the F1 pin applies to my counter too.
    fx.reset();
    st = fakeState(s => { s.log = []; s.players[1].mzone[0] = mon(NORMAL2); });
    render(st); step(st);
    st = fakeState(s => { s.log = []; s.players[1].mzone[0] = mon(NORMAL2); s.players[0].lp = 7100; });
    st.lastAttack = { attacker: { con: 1, loc: E.LOC.MZONE, seq: 0 }, target: null };
    render(st); step(st, [{ kind: 'attack', code: NORMAL2, con: 1, direct: true }, { kind: 'damage', player: 0, amount: 900 }]);
    ok(myLpEl.textContent === '8000', 'FXA4: F1 — my counter is pinned to the start value at scene creation too (got ' + myLpEl.textContent + ')');
    const myNum = doc.querySelector('.fx3-dmgnum');
    ok(!!myNum && !myNum.classList.contains('fx3-dmgnum--down'), 'FXA4b: F2 — my damage number keeps the upward variant (class=' + (myNum ? myNum.className : 'none') + ')');
    await new Promise(r => setTimeout(r, 1300));
    ok(myLpEl.textContent === '7100' && fx.lpShown(0) === 7100, 'FXA4c: my LP count settles exactly on 7100 (got ' + myLpEl.textContent + ')');

    // --- F3: a destroying attack generates the silhouette layer
    // (white rectangle + gold rim + name band, CSS .fx3-silhouette)
    // and it is visibly up inside the shifted 430-490ms peak window.
    fx.reset();
    const SANGA = 25955164, ZOLGA = 31525442; // audit-fx fixture: 2600 -> 1700, 900 damage, battle destruction
    st = fakeState(s => { s.log = []; s.players[0].mzone[0] = mon(SANGA); s.players[1].mzone[0] = mon(ZOLGA); });
    render(st); step(st);
    st = fakeState(s => { s.log = []; s.players[0].mzone[0] = mon(SANGA); s.players[1].grave = [ZOLGA]; s.players[1].lp = 7100; });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: { con: 1, loc: E.LOC.MZONE, seq: 0 } };
    render(st); step(st, [{ kind: 'attack', code: SANGA, con: 0, direct: false }, { kind: 'destroy', code: ZOLGA, con: 1, battle: true }, { kind: 'damage', player: 1, amount: 900 }]);
    const sil = doc.querySelector('.fx3-silhouette');
    ok(!!sil, 'FXA5: F3 — a destroying attack generates the silhouette layer');
    ok(!!sil && !!sil.querySelector('.nm') && sil.querySelector('.nm').textContent === '予見者ゾルガ', 'FXA5b: F3 — the silhouette carries the target name band (got ' + (sil && sil.querySelector('.nm') ? sil.querySelector('.nm').textContent : 'none') + ')');
    let frozeAt = null;
    const fDeadline = Date.now() + 4000;
    while (Date.now() < fDeadline) { const n = fx.now(); if (n >= 438 && n <= 482) { fx.hitStop(1500); frozeAt = n; break; } await new Promise(r => setTimeout(r, 4)); }
    await new Promise(r => setTimeout(r, 150));
    const silOp = sil ? parseFloat(sil.style.opacity || '0') : 0;
    ok(frozeAt != null && silOp > 0.2, 'FXA5c: F3 — the silhouette is up in the shifted peak window (froze at ' + (frozeAt == null ? 'never' : Math.round(frozeAt) + 'ms') + ', opacity ' + silOp.toFixed(2) + ')');
    ok(fx.error === null, 'FXA6: fxError stayed null through every redesign-A step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1E: redesign B — chain unification (p2a/p2b/p2c, audit C3) =================
  {
    const window = await boot();
    const doc = window.document;
    const E = window.Engine;
    const fx = window.__fx;
    fx.reset();
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const link = (code, con, loc, seq) => ({ code, con: con || 0, loc: loc == null ? E.LOC.HAND : loc, seq: seq || 0, negated: false, disabled: false, solved: false });
    const THUNDER = 12580477, MOON = 14087893, SOLEMN = 40605147; // サンダー・ボルト / 月の書 / 神の通告 (proto 案2 fixtures)
    ok(!!data.cards[THUNDER] && !!data.cards[MOON] && !!data.cards[SOLEMN], 'FXCH0: redesign-B fixtures are in the pool');

    // --- fix 1 (p2a): the pop bundle lifts until its bottom edge
    // clears the chain bar's top edge by 4px. jsdom geometry is all
    // zero, so the app / bar rects are stubbed to the prototype's
    // capture geometry (390x620, bar top at 228): base cy = 620*.34
    // = 210.8, card bottom = 281.8, lift = ceil(281.8 - (228-4)) = 58.
    let st = fakeState(s => { s.log = []; s.chain = [link(THUNDER, 0)]; });
    step(st);
    st = fakeState(s => { s.log = []; s.chain = [link(THUNDER, 0), link(MOON, 1)]; });
    render(st);
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    doc.getElementById('app').getBoundingClientRect = () => rect(0, 0, 390, 620);
    doc.getElementById('chainbar').getBoundingClientRect = () => rect(0, 228, 390, 21);
    let recs = step(st, [{ kind: 'activate', code: MOON, con: 1, loc: E.LOC.HAND }]);
    ok(has(recs, 'chainlift', r => r.n === 2 && r.lift === 58), 'FXCH1: p2a — the lift branch fires and computes the lift from the measured overlap (lift=' + (recs.find(r => r.kind === 'chainlift') || {}).lift + ', want 58)');
    const popGhost = doc.querySelector('#fxlayer .fx-ghost');
    ok(!!popGhost && popGhost.dataset.chainLift === '58' && Math.abs(parseFloat(popGhost.style.top) - 81.8) < 0.6, 'FXCH1b: p2a — the pop node itself is placed at the lifted position (top=' + (popGhost ? popGhost.style.top : 'none') + ', want ~81.8px = 210.8-58-71)');
    ok(!!doc.querySelector('#fxlayer .fx3-chainword'), 'FXCH1c: p2a — the CHAIN word rides the lifted bundle');

    // --- fix 2 (p2b): with the landed flag set, render()'s bar
    // output carries the gold-absorption classes (the flag lives
    // module-side, so it survives the bar's innerHTML rebuild)
    fx.markChainLanded(2, MOON);
    ok(fx.chainLanded().join(',') === '2', 'FXCH2: p2b — the landed flag stands for link 2');
    render(st);
    const lbl = doc.querySelector('#chainbar .chainlbl');
    ok(!!lbl && lbl.classList.contains('landed'), 'FXCH2b: p2b — render() paints the CHAIN label with the landed (gold) class');
    const chips = doc.querySelectorAll('#chainbar .link');
    ok(chips.length === 2 && chips[1].classList.contains('landed') && !chips[0].classList.contains('landed'), 'FXCH2c: p2b — only the landed chip carries the landed (gold frame) class');
    render(fakeState(s => { s.log = []; s.chain = []; }));
    ok(fx.chainLanded().length === 0, 'FXCH2d: p2b — an empty chain clears the landed flags');

    // --- fix 3 (p2c / C3): a set trap becoming link 2 gets the
    // CHAIN word + a gold frame over its own (flipped) tile
    fx.reset(); // wipes the FX layer, so the nodes below can only come from this step
    let st3 = fakeState(s => { s.log = []; s.players[1].szone[0] = { code: SOLEMN, pos: 10 }; s.chain = [link(THUNDER, 0)]; });
    step(st3);
    st3 = fakeState(s => { s.log = []; s.players[1].szone[0] = { code: SOLEMN, pos: 5 }; s.chain = [link(THUNDER, 0), link(SOLEMN, 1, E.LOC.SZONE, 0)]; });
    render(st3);
    recs = step(st3, [{ kind: 'activate', code: SOLEMN, con: 1, loc: E.LOC.SZONE }]);
    ok(has(recs, 'setactivate', r => r.code === SOLEMN), 'FXCH3: p2c — the set trap activation still tips into the presentation');
    ok(has(recs, 'setactivatechain', r => r.n === 2 && r.frame === true && r.targetKey === '1:' + E.LOC.SZONE + ':0'), 'FXCH3b: p2c — the set-link record names link 2 and its own tile as the gold-frame target (got ' + JSON.stringify(recs.find(r => r.kind === 'setactivatechain') || null) + ')');
    ok(!!doc.querySelector('#fxlayer .fx3-chainword'), 'FXCH3c: p2c — the CHAIN word stands for a set trap at link 2');
    ok(!!doc.querySelector('#fxlayer .fx3-goldframe'), 'FXCH3d: p2c — a gold frame node sits over the flipped trap tile');
    ok(fx.error === null, 'FXCH4: fxError stayed null through every redesign-B step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1F: redesign I(1) — deck -> grave flights =================
  {
    const window = await boot();
    const doc = window.document;
    const fx = window.__fx;
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const deckFlights = (recs) => recs.filter(r => r.kind === 'flight' && r.from === 'deck' && r.to === 'grave');
    const graveFlights = (recs) => recs.filter(r => r.kind === 'flight' && r.to === 'grave');
    const MILL3 = (() => { let n = 0; for (const [code, c] of Object.entries(data.cards)) if (isMainMonster(c) && ++n === 3) return +code; return null; })();
    ok(!!MILL3 && MILL3 !== NORMAL && MILL3 !== NORMAL2, 'FXI0: third mill fixture is a distinct main-deck monster');

    // (1) deck -> grave only: the deck-origin flight fires, face-up
    fx.reset();
    let st = fakeState(s => { s.log = []; s.players[0].deckCount = 40; });
    render(st); step(st);
    st = fakeState(s => { s.log = []; s.players[0].deckCount = 39; s.players[0].grave = [NORMAL]; });
    render(st);
    let recs = step(st);
    ok(deckFlights(recs).length === 1 && deckFlights(recs)[0].code === NORMAL, 'FXI1: a deck->grave-only batch records exactly one deck-origin flight for the fallen card (got ' + JSON.stringify(deckFlights(recs)) + ')');
    ok(graveFlights(recs).length === 1, 'FXI1b: no other grave flight fires in a deck->grave-only batch');
    const ghost = doc.querySelector('#fxlayer .fx-ghost');
    ok(!!ghost && !ghost.classList.contains('back'), 'FXI1c: the deck->grave ghost is face-UP (graveyard is public; what fell must be readable)');
    ok(!!ghost && !!ghost.querySelector('.nm') && ghost.querySelector('.nm').textContent === data.names[NORMAL], 'FXI1d: the face-up ghost carries the fallen card name (got ' + (ghost && ghost.querySelector('.nm') ? ghost.querySelector('.nm').textContent : 'none') + ')');

    // (1b) multiple cards fall together (mill): one flight per card
    fx.reset();
    step(fakeState(s => { s.players[0].deckCount = 40; }));
    st = fakeState(s => { s.players[0].deckCount = 37; s.players[0].grave = [NORMAL, NORMAL2, MILL3]; });
    recs = step(st);
    ok(deckFlights(recs).length === 3 && [NORMAL, NORMAL2, MILL3].every(c => deckFlights(recs).some(r => r.code === c)), 'FXI1e: a 3-card mill records one deck-origin flight per fallen card (got ' + deckFlights(recs).length + ')');

    // (2) hand -> grave and deck -> grave in the SAME batch: each
    // flies exactly once, from its own origin — no double flight
    fx.reset();
    step(fakeState(s => { s.players[0].hand = [{ code: NORMAL }]; s.players[0].deckCount = 40; }));
    st = fakeState(s => { s.players[0].hand = []; s.players[0].deckCount = 39; s.players[0].grave = [NORMAL, NORMAL2]; });
    recs = step(st);
    const handFlights = recs.filter(r => r.kind === 'flight' && r.from === 'hand' && r.to === 'grave');
    ok(handFlights.length === 1 && handFlights[0].code === NORMAL, 'FXI2: the hand discard flies once from the hand (got ' + JSON.stringify(handFlights) + ')');
    ok(deckFlights(recs).length === 1 && deckFlights(recs)[0].code === NORMAL2, 'FXI2b: the deck card flies once from the deck — the hand card is NOT re-flown as a deck card (got ' + JSON.stringify(deckFlights(recs)) + ')');
    ok(graveFlights(recs).length === 2, 'FXI2c: exactly two grave flights in total for the mixed batch (no double flight)');

    // (2b) same CODE from the field and from the deck in one batch
    // (two copies): the multiset subtraction consumes the field
    // copy, so the deck copy still flies — exactly once each
    fx.reset();
    step(fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); s.players[0].deckCount = 40; }));
    st = fakeState(s => { s.players[0].deckCount = 39; s.players[0].grave = [NORMAL, NORMAL]; });
    recs = step(st);
    ok(deckFlights(recs).length === 1 && deckFlights(recs)[0].code === NORMAL, 'FXI2d: with two copies in the grave (field + deck), the deck copy still gets its one deck flight');
    ok(graveFlights(recs).length === 2, 'FXI2e: field copy + deck copy = exactly two grave flights for the duplicated code');

    // (3) grave grows but the deck does NOT shrink (hand discard
    // only): no deck flight may appear
    fx.reset();
    step(fakeState(s => { s.players[0].hand = [{ code: NORMAL }]; s.players[0].deckCount = 40; }));
    st = fakeState(s => { s.players[0].hand = []; s.players[0].deckCount = 40; s.players[0].grave = [NORMAL]; });
    recs = step(st);
    ok(deckFlights(recs).length === 0, 'FXI3: no deck flight when the deck count did not decrease (hand discard only)');
    ok(recs.filter(r => r.kind === 'flight' && r.from === 'hand' && r.to === 'grave').length === 1, 'FXI3b: the hand discard itself still flies from the hand');

    // (3b) opponent deck -> grave works for the other seat too
    fx.reset();
    step(fakeState(s => { s.players[1].deckCount = 40; }));
    st = fakeState(s => { s.players[1].deckCount = 38; s.players[1].grave = [NORMAL, NORMAL2]; });
    recs = step(st);
    ok(deckFlights(recs).length === 2, 'FXI3c: an opponent mill records deck-origin flights for both fallen cards (got ' + deckFlights(recs).length + ')');
    ok(fx.error === null, 'FXI4: fxError stayed null through every redesign-I step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1G: redesign F — non-battle LP changes =================
  {
    const window = await boot();
    const doc = window.document;
    const E = window.Engine;
    const fx = window.__fx;
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const myLpEl = doc.getElementById('myLp'), oppLpEl = doc.getElementById('oppLp');
    const base = (mut) => { fx.reset(); const st = fakeState(s => { s.log = []; if (mut) mut(s); }); render(st); step(st); };

    // --- engine surface: MSG_PAY_LPCOST (case 100) now pushes a
    // 'pay' event with the amount, and the LP arithmetic is unchanged
    {
      const gs = new E.GameState(data);
      const lp0 = gs.players[0].lp;
      gs.apply(new Uint8Array([100, 0, 0xDC, 0x05, 0x00, 0x00])); // player 0, 1500 (u32 LE)
      ok(gs.players[0].lp === lp0 - 1500, 'FXF0: engine PAY_LPCOST still subtracts exactly the amount (lp ' + lp0 + ' -> ' + gs.players[0].lp + ')');
      ok(gs.events.some(e => e.kind === 'pay' && e.player === 0 && e.amount === 1500), 'FXF0b: engine PAY_LPCOST pushes a {kind:pay, player, amount} event (got ' + JSON.stringify(gs.events) + ')');
    }

    // --- F-pay: my LP cost -> gold chip + a monotonic count, and
    // NO battle damage number
    base();
    let st = fakeState(s => { s.log = []; s.players[0].lp = 6500; });
    render(st);
    let recs = step(st, [{ kind: 'pay', player: 0, amount: 1500 }]);
    ok(has(recs, 'lpchip', r => r.chip === 'pay' && r.player === 0 && r.amount === 1500 && r.signed === -1500), 'FXF1: a pay event records a gold pay chip for the amount (got ' + JSON.stringify(recs.filter(r => r.kind === 'lpchip')) + ')');
    ok(has(recs, 'lpchange', r => r.player === 0 && r.to === 6500), 'FXF1b: the LP change itself is still recorded');
    const payChip = doc.querySelector('.fx3-lpchip--pay');
    ok(!!payChip && payChip.textContent === '−1500' && payChip.dataset.lpKind === 'pay', 'FXF1c: the pay chip node reads −1500 and is marked as a pay chip (got ' + (payChip ? payChip.textContent + '/' + payChip.className : 'none') + ')');
    ok(!doc.querySelector('.fx3-dmgnum'), 'FXF1d: a pay drop spawns NO battle damage number (the chip is the only presentation)');
    ok(myLpEl.textContent === '8000', 'FXF1e: the counter is pinned to the start value at chip/count creation (got ' + myLpEl.textContent + ')');
    const paySamples = [parseInt(myLpEl.textContent, 10)];
    const payEnd = Date.now() + 1600;
    while (Date.now() < payEnd) {
      await new Promise(r => setTimeout(r, 25));
      const v = parseInt(myLpEl.textContent, 10);
      if (!Number.isNaN(v)) paySamples.push(v);
      if (v === 6500 && fx.lpShown(0) === 6500) break;
    }
    ok(paySamples.every((v, i) => i === 0 || v <= paySamples[i - 1]), 'FXF1f: the pay count is monotonic non-increasing (distinct: ' + paySamples.filter((v, i) => i === 0 || v !== paySamples[i - 1]).join('>') + ')');
    ok(paySamples[paySamples.length - 1] === 6500 && fx.lpShown(0) === 6500, 'FXF1g: the pay count settles exactly on 6500');

    // --- F-damage: effect damage to the opponent -> red chip with
    // the downward (anti-clip) variant, NO battle damage number
    base();
    st = fakeState(s => { s.log = []; s.players[1].lp = 7100; });
    render(st);
    recs = step(st, [{ kind: 'damage', player: 1, amount: 900 }]);
    ok(has(recs, 'lpchip', r => r.chip === 'damage' && r.player === 1 && r.amount === 900 && r.down === true), 'FXF2: effect damage records a damage chip (opponent = downward variant)');
    const dmgChip = doc.querySelector('.fx3-lpchip--damage');
    ok(!!dmgChip && dmgChip.textContent === '−900' && dmgChip.classList.contains('fx3-lpchip--down') && dmgChip.dataset.direction === 'down', 'FXF2b: the effect-damage chip node reads −900 and carries the downward variant (class=' + (dmgChip ? dmgChip.className : 'none') + ')');
    ok(!doc.querySelector('.fx3-dmgnum'), 'FXF2c: effect damage spawns NO battle damage number');

    // --- F-heal (mine): + chip in gold; the float node IS the chip
    base();
    st = fakeState(s => { s.log = []; s.players[0].lp = 8600; });
    render(st);
    recs = step(st, [{ kind: 'recover', player: 0, amount: 600 }]);
    ok(has(recs, 'lpchip', r => r.chip === 'heal' && r.player === 0 && r.amount === 600 && r.signed === 600 && r.variant === 'mine'), 'FXF3: my heal records a heal chip with the mine (gold) variant');
    ok(has(recs, 'healfloat', r => r.amount === 600), 'FXF3b: the legacy healfloat record still fires for a heal');
    const myHeal = doc.querySelector('.fx-healfloat');
    ok(!!myHeal && myHeal.textContent === '+600' && myHeal.classList.contains('fx3-lpchip--heal') && myHeal.classList.contains('fx3-lpchip--mine') && !myHeal.classList.contains('fx-healfloat--down') && myHeal.dataset.direction === 'up', 'FXF3c: my heal node is the +600 gold chip and keeps the upward float (class=' + (myHeal ? myHeal.className : 'none') + ')');

    // --- F-heal (opponent): + chip in lapis-white, and the float
    // becomes the DOWNWARD variant (audit F2 remainder)
    base();
    st = fakeState(s => { s.log = []; s.players[1].lp = 8600; });
    render(st);
    recs = step(st, [{ kind: 'recover', player: 1, amount: 600 }]);
    ok(has(recs, 'lpchip', r => r.chip === 'heal' && r.player === 1 && r.variant === 'opp' && r.down === true), 'FXF4: opponent heal records a heal chip with the opp (lapis-white) variant, downward');
    const oppHeal = doc.querySelector('.fx-healfloat');
    ok(!!oppHeal && oppHeal.textContent === '+600' && oppHeal.classList.contains('fx-healfloat--down') && oppHeal.classList.contains('fx3-lpchip--opp') && oppHeal.dataset.direction === 'down', 'FXF4b: the opponent heal float node is the downward lapis chip variant (class=' + (oppHeal ? oppHeal.className : 'none') + ', direction=' + (oppHeal ? oppHeal.dataset.direction : 'none') + ')');

    // --- F-mixed: pay + effect damage in ONE batch -> one chip per
    // kind, summing to the net loss
    base();
    st = fakeState(s => { s.log = []; s.players[0].lp = 6000; });
    render(st);
    recs = step(st, [{ kind: 'pay', player: 0, amount: 1500 }, { kind: 'damage', player: 0, amount: 500 }]);
    ok(has(recs, 'lpchip', r => r.chip === 'pay' && r.amount === 1500) && has(recs, 'lpchip', r => r.chip === 'damage' && r.amount === 500), 'FXF5: a mixed pay+damage batch records one chip per kind (got ' + JSON.stringify(recs.filter(r => r.kind === 'lpchip')) + ')');
    ok(doc.querySelectorAll('.fx3-lpchip').length === 2, 'FXF5b: the mixed batch shows exactly two chip nodes (got ' + doc.querySelectorAll('.fx3-lpchip').length + ')');

    // --- F-suppression: an attack batch's battle damage gets NO
    // F chip at all — the battle grammar (damage number + scheduled
    // count) stays the only presentation
    base(s => { s.players[0].mzone[0] = mon(NORMAL); });
    st = fakeState(s => { s.log = []; s.players[0].mzone[0] = mon(NORMAL); s.players[1].lp = 7100; });
    st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
    render(st);
    recs = step(st, [{ kind: 'attack', code: NORMAL, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 900 }]);
    ok(!recs.some(r => r.kind === 'lpchip'), 'FXF6: an attack batch records NO lpchip (no double presentation)');
    ok(!doc.querySelector('.fx3-lpchip'), 'FXF6b: an attack batch shows NO chip node');
    ok(!!doc.querySelector('.fx3-dmgnum'), 'FXF6c: the battle damage number itself is intact for the attack batch');
    ok(fx.error === null, 'FXF7: fxError stayed null through every redesign-F step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1H: redesign D — opponent-turn presentation (p4a/p4b) =================
  {
    const window = await boot();
    const doc = window.document;
    const E = window.Engine;
    const fx = window.__fx;
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const tag = () => doc.querySelector('#fxlayer .fx-oppnametag');
    const fresh = () => { fx.reset(); step(fakeState()); }; // reset + silent baseline snapshot
    const NAME = data.names[NORMAL], NAME2 = data.names[NORMAL2];
    ok(!!NAME && !!NAME2 && NAME !== NAME2, 'FXD0: redesign-D fixtures resolve to two distinct card names');

    // --- opponent normal summon: the tag names the card
    fresh();
    let st = fakeState(s => { s.players[1].mzone[0] = mon(NORMAL); });
    let recs = step(st, [{ kind: 'summon', code: NORMAL, con: 1 }]);
    ok(has(recs, 'oppnametag', r => r.how === 'summon' && r.code === NORMAL), 'FXD1: an opponent normal summon records a name tag for the card');
    ok(!!tag() && tag().textContent === '相手：《' + NAME + '》を召喚', 'FXD1b: the tag reads 相手：《' + NAME + '》を召喚 (got ' + (tag() ? tag().textContent : 'none') + ')');
    ok(fx.oppTagText() === '相手：《' + NAME + '》を召喚', 'FXD1c: __fx.oppTagText exposes the live tag wording');

    // --- opponent special summon: named, with the special-summon verb
    fresh();
    st = fakeState(s => { s.players[1].mzone[1] = mon(NORMAL2); });
    recs = step(st, [{ kind: 'spsummon', code: NORMAL2, con: 1 }]);
    ok(!!tag() && tag().textContent === '相手：《' + NAME2 + '》を特殊召喚', 'FXD2: an opponent special summon tag names the card (got ' + (tag() ? tag().textContent : 'none') + ')');

    // --- opponent flip summon: named, with the flip-summon verb
    fresh();
    st = fakeState(s => { s.players[1].mzone[0] = { code: NORMAL, pos: 8, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def }; });
    step(st);
    st = fakeState(s => { s.players[1].mzone[0] = mon(NORMAL); });
    recs = step(st, [{ kind: 'flipsummon', code: NORMAL, con: 1 }]);
    ok(!!tag() && tag().textContent === '相手：《' + NAME + '》を反転召喚', 'FXD3: an opponent flip summon tag names the card (got ' + (tag() ? tag().textContent : 'none') + ')');

    // --- opponent monster SET: a tag may appear, but the hidden
    // card's name must NOT — generic wording only (the set event
    // itself carries the real code; leaking it here is the bug
    // this item exists to prevent)
    fresh();
    st = fakeState(s => { s.players[1].mzone[0] = { code: NORMAL, pos: 8, materials: 0, curAtk: data.cards[NORMAL].atk, curDef: data.cards[NORMAL].def }; });
    recs = step(st, [{ kind: 'set', code: NORMAL, con: 1, loc: E.LOC.MZONE }]);
    ok(!!tag() && tag().textContent === '相手：モンスターをセット', 'FXD4: an opponent monster set is announced generically (got ' + (tag() ? tag().textContent : 'none') + ')');
    ok(!!tag() && !tag().textContent.includes(NAME), 'FXD4b: the set tag does NOT contain the face-down card name');
    ok(!has(recs, 'oppnametag', r => r.code === NORMAL), 'FXD4c: the set tag record carries no card code either');

    // --- opponent S/T set: generic too, still no name
    fresh();
    st = fakeState(s => { s.players[1].szone[0] = { code: NORMAL, pos: 10 }; });
    recs = step(st, [{ kind: 'set', code: NORMAL, con: 1, loc: E.LOC.SZONE }]);
    ok(!!tag() && tag().textContent === '相手：カードをセット' && !tag().textContent.includes(NAME), 'FXD4d: an opponent S/T set is generic and nameless (got ' + (tag() ? tag().textContent : 'none') + ')');

    // --- the human's OWN summon: no tag at all
    fresh();
    st = fakeState(s => { s.players[0].mzone[0] = mon(NORMAL); });
    recs = step(st, [{ kind: 'summon', code: NORMAL, con: 0 }]);
    ok(!tag(), 'FXD5: my own normal summon raises NO opponent name tag');
    ok(!has(recs, 'oppnametag'), 'FXD5b: no oppnametag record for my own summon');

    // --- opponent chain activation: no tag (the chain pop owns it)
    fresh();
    step(fakeState(s => { s.players[1].mzone[0] = mon(NORMAL2); }));
    recs = step(fakeState(s => { s.players[1].mzone[0] = mon(NORMAL2); }), [{ kind: 'activate', code: NORMAL2, con: 1, loc: E.LOC.HAND }]);
    ok(!tag() && !has(recs, 'oppnametag'), 'FXD5c: an opponent chain activation raises NO name tag');

    // --- breathing air (p4a): render() stands the class on the
    // opponent's turn and drops it on mine; both preset layers
    // exist inside their fields (board dimensions untouched)
    ok(!!doc.querySelector('#oppField .turnbreathe'), 'FXD6: the breathing rim layer is preset inside #oppField');
    ok(!!doc.querySelector('#myField .turndim'), 'FXD6b: the dim layer is preset inside #myField');
    render(fakeState(s => { s.log = []; s.turnPlayer = 1; }));
    ok(doc.getElementById('app').classList.contains('opp-turn'), 'FXD6c: the opp-turn class stands during the opponent turn');
    render(fakeState(s => { s.log = []; s.turnPlayer = 0; }));
    ok(!doc.getElementById('app').classList.contains('opp-turn'), 'FXD6d: the opp-turn class is gone on my turn');
    ok(fx.error === null, 'FXD7: fxError stayed null through every redesign-D step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 1I: redesign C / E / G — result chip, phase sweep settle, finisher result gate =================
  {
    const window = await boot();
    const doc = window.document;
    const $ = (id) => doc.getElementById(id);
    const E = window.Engine;
    const fx = window.__fx;
    const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
    const render = (st) => window.render(st); // production order: render() first, then fx.process()
    const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
    const SANGA = 25955164, ZOLGA = 31525442;
    // render() reads state.log / state.lastAttack (engine states
    // always carry them); the shared fakeState omits both, so wrap it
    const FS = (mut) => fakeState(s => { s.log = []; s.lastAttack = null; if (mut) mut(s); });
    const chipNodes = () => [...doc.querySelectorAll('#fxlayer .fx3-resultchip')];
    const clearChips = () => chipNodes().forEach(n => n.remove());

    // --- C1: battle destruction (the destroy event's battle
    // flag) leaves the engraved 破壊 chip beside the zone
    fx.reset(); clearChips();
    let before = FS(s => { s.players[1].mzone[0] = mon(ZOLGA); });
    render(before); fx.process([], before);
    let after = FS(s => { s.players[1].grave = [ZOLGA]; });
    render(after);
    let recs = step(after, [{ kind: 'destroy', code: ZOLGA, con: 1, battle: true }]);
    ok(has(recs, 'resultchip', r => r.code === ZOLGA), 'FXI-C1: battle destruction records the result chip');
    ok(chipNodes().length === 1 && chipNodes()[0].textContent === '破壊' && chipNodes()[0].dataset.code === String(ZOLGA),
      'FXI-C1b: exactly one 破壊 chip node stands in the FX layer');

    // --- C2: EFFECT destruction gets NO chip (battle flag clear,
    // no attack scene in the batch) — its grammar stays the flash
    fx.reset(); clearChips();
    before = FS(s => { s.players[1].mzone[0] = mon(ZOLGA); });
    render(before); fx.process([], before);
    after = FS(s => { s.players[1].grave = [ZOLGA]; });
    render(after);
    recs = step(after, [{ kind: 'destroy', code: ZOLGA, con: 1, battle: false }]);
    ok(has(recs, 'destroyflash', r => r.code === ZOLGA), 'FXI-C2: effect destruction still flashes (sanity)');
    ok(!has(recs, 'resultchip'), 'FXI-C2b: effect destruction records NO result chip');
    ok(chipNodes().length === 0, 'FXI-C2c: effect destruction leaves NO chip node');

    // --- C3: destruction via the batch's ATTACK SCENE also gets
    // the chip, even when the destroy event carries no battle flag
    fx.reset(); clearChips();
    before = FS(s => { s.players[0].mzone[0] = mon(SANGA); s.players[1].mzone[0] = mon(ZOLGA); });
    render(before); fx.process([], before);
    after = FS(s => {
      s.players[0].mzone[0] = mon(SANGA); s.players[1].grave = [ZOLGA];
      s.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: { con: 1, loc: E.LOC.MZONE, seq: 0 } };
    });
    render(after);
    recs = step(after, [
      { kind: 'attack', code: SANGA, con: 0, direct: false },
      { kind: 'destroy', code: ZOLGA, con: 1, battle: false },
    ]);
    ok(has(recs, 'resultchip', r => r.code === ZOLGA && r.via === 'scene'), 'FXI-C3: attack-scene destruction records the chip (via scene)');
    ok(chipNodes().length === 1, 'FXI-C3b: attack-scene destruction leaves the chip node');

    // --- E: the transition runs the gold sweep over the mid bar;
    // at settle the hairline remains and the phase name sits gold
    // + bold in #phaseinfo (the fx-seated class)
    fx.reset();
    before = FS(s => { s.turnCount = 2; s.phaseName = ''; });
    render(before); fx.process([], before);
    ok(!fx.phaseSeated(), 'FXI-E0: no seated phase before any transition');
    after = FS(s => { s.turnCount = 2; s.phaseName = 'BATTLE'; });
    render(after);
    recs = step(after, []);
    ok(has(recs, 'phase', r => r.phase === 'battle'), 'FXI-E1: the battle transition still records the phase');
    const banner = doc.querySelector('#fxlayer .fx-phase');
    ok(!!banner && banner.textContent.includes('バトルフェイズ'), 'FXI-E2: the engraved phase name stands at board centre');
    ok(!!doc.querySelector('#fxlayer .fx-phase-sweep'), 'FXI-E3: the sweep segment node exists over the mid bar');
    ok(!!doc.querySelector('#midbar .fx-phase-hairline'), 'FXI-E4: the hairline node exists on the mid bar');
    ok(!fx.phaseSeated(), 'FXI-E5: the phase is not seated while the sweep is still running');
    const deadline = Date.now() + 5000;
    while (!fx.phaseSeated() && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    ok(fx.phaseSeated() && $('phaseinfo').classList.contains('fx-seated'), 'FXI-E6: after settling, #phaseinfo carries the seated class');
    const hair = doc.querySelector('#midbar .fx-phase-hairline');
    ok(!!hair && hair.style.opacity === '0.3', 'FXI-E7: the settled hairline remains at opacity 0.30');
    ok(!doc.querySelector('#fxlayer .fx-phase') && !doc.querySelector('#fxlayer .fx-phase-sweep'),
      'FXI-E8: banner and sweep are gone after settling (only the hairline + seated name remain)');

    // --- G: the finisher result gate is t0+2450 — strictly after
    // the wash's last paint at 2400 (audit A-07) — and 0 without
    // a finisher, so the result handler's wait-then-show order
    // (the existing verification path) is unchanged in shape
    fx.reset();
    ok(fx.finisherGateMs() === 0, 'FXI-G1: no finisher scene -> gate 0 (the result is never delayed without one)');
    step(FS(s => { s.players[0].mzone[0] = mon(SANGA); s.players[1].lp = 5600; }));
    after = FS(s => { s.players[0].mzone[0] = mon(SANGA); s.players[1].lp = 0; s.winner = 0; });
    after.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
    recs = step(after, [{ kind: 'attack', code: SANGA, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 5600 }]);
    ok(has(recs, 'finisher'), 'FXI-G2: the duel-ending attack still fires the finisher (sanity)');
    const gate = fx.finisherGateMs();
    ok(gate === 2450, 'FXI-G3: with the finisher just fired, the result gate reads exactly 2450 ms (got ' + gate + ')');
    ok(gate > 2400, 'FXI-G4: the gate is strictly after the wash fully disappears (2400 ms)');
    ok(fx.error === null, 'FXI-Z: fxError stayed null through every redesign-C/E/G step (got: ' + fx.error + ')');
    window.close();
  }

  // ================= Part 2: live duels =================
  if (process.env.FX_SYNTH_ONLY) { console.log(failures === 0 ? 'ALL FX SYNTHETIC CHECKS PASSED' : failures + ' FAILED'); process.exit(failures ? 1 : 0); }
  const tally = {};
  for (let run = 0; run < 2; run++) {
    const window = await boot();
    const doc = window.document;
    // run 2 plays the whole duel with response mode 'off' (round B,
    // B11): every non-forced chain prompt auto-passes — the duel must
    // still complete, which proves the mode only changes presentation
    if (run === 1) window.__fx.settings.resp = 'off';
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
  ok((tally.attackline || 0) > 0, 'FXL7: attack lines fired in live duels (round B)');
  console.log('  round-B live tallies: cutin=' + (tally.cutin || 0) + ' chainpop=' + (tally.chainpop || 0) +
    ' finisher=' + (tally.finisher || 0) + ' directattack=' + (tally.directattack || 0) +
    ' advance=' + (tally.advance || 0) + ' flip=' + (tally.flip || 0) + ' setactivate=' + (tally.setactivate || 0));

  console.log(failures === 0 ? 'ALL FX CHECKS PASSED' : failures + ' FX CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
