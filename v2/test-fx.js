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
