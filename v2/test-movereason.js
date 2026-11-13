'use strict';
/* test-movereason.js — BU-71: move-reason classification contracts
 * (design: fx-design-2026-11-13-movereason.md §5/§6/§8/§10).
 *
 * Part A (fixture): the engine's pure classifier is pinned against
 * test-movereason-fixture.json — 109 distinct input tuples covering
 * all 7,925 MOVEs the design probe captured from the real core,
 * with expected classes from an INDEPENDENT reference
 * implementation of the §5 table (gen-fixture.py, which also
 * asserts the grave-arrival counts equal the counts published in
 * §5: 2,958 arrivals, zero unclassified).
 * Part B (synthetic GameState): hand-built core messages drive
 * GameState.apply to pin the CONTEXT half of the classifier —
 * the pending-summon slot match (R1; a same-name card at another
 * slot must NOT inherit it — the probe's Minerva trap), the
 * chain-link slot match for MSG 75/76 (R2..R5), the pending
 * state's clearing (SUMMONED / own MOVE / CHAIN_END / NEW_TURN),
 * R6's bit pattern, unknown reasons falling back to the current
 * generic history wording, the non-graveyard destinations the
 * 2026-11-13 steer added (banish forms, bounce, spin, fusion
 * returns, redirect modifier), and the movecls event's shape.
 * Part C (jsdom client): fabricated state pairs + movecls events
 * through the real fx pipeline pin the pairing (multiset on
 * con/code/from/to), the (con, from, to, cls) group split, R21's
 * history-only normalization, the destroy presentation's reason
 * override, and the set-card secrecy boundary (a code-less
 * registration never pairs, so no reason — and no name — leaks).
 */
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const LOOKUP = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64 };

// ================= Part A: fixture =================
{
  const fx = JSON.parse(fs.readFileSync(path.join(V2, 'test-movereason-fixture.json'), 'utf8'));
  ok(fx.totalMoves === 7925 && fx.graveMoves === 2958, 'A0: fixture covers 7,925 probe MOVEs / 2,958 grave arrivals');
  let bad = 0, covered = 0;
  const graveCounts = {};
  for (const t of fx.tuples) {
    covered += t.n;
    const res = E.classifyMoveReason({ reason: t.reason, from: LOOKUP[t.from], to: LOOKUP[t.to],
      fromOverlay: t.ovl, neg: t.neg, dis: t.dis, pend: t.pend });
    const cls = res ? res.cls : null;
    const red = res ? res.redirect : !!(t.reason & 0x4000000);
    const dis2 = res ? res.discard : !!(t.reason & 0x4000);
    if (cls !== t.cls || red !== t.redirect || dis2 !== t.discard) {
      bad++;
      if (bad <= 5) console.log('  mismatch:', JSON.stringify(t), '-> got', cls, red, dis2);
    }
    if (t.to === 'GRAVE' && cls) graveCounts[cls] = (graveCounts[cls] || 0) + t.n;
  }
  ok(covered === 7925, 'A1: tuple counts sum to all 7,925 moves (got ' + covered + ')');
  ok(bad === 0, 'A2: classifier matches the independent §5 reference on every tuple (' + bad + ' mismatches)');
  const pinned = { R1: 4, R2: 12, R3: 2, R4: 4, R5: 5, R6: 10, R7: 287, R8: 9, R9: 9, R10: 220,
    R11: 45, R12: 11, R14: 379, R15: 56, R16: 4, R17: 762, R18: 28, R19: 61, R20: 41, R21: 620, R22: 389 };
  ok(JSON.stringify(graveCounts) === JSON.stringify(Object.fromEntries(Object.entries(pinned).sort())) ||
     Object.keys(pinned).every(k => graveCounts[k] === pinned[k]) && Object.keys(graveCounts).length === Object.keys(pinned).length,
     'A3: grave-arrival class counts equal design §5 exactly (incl. zero unclassified)');
  // spot pins from §5/§6: the shapes that motivated the design
  const one = (reason, from, to, extra) => E.classifyMoveReason(Object.assign(
    { reason, from: LOOKUP[from], to: LOOKUP[to], fromOverlay: false, neg: false, dis: false, pend: false }, extra || {}));
  ok(one(0x4500, 'HAND', 'GRAVE').cls === 'R6', 'A4: R6 — hand-limit discard is the 0x4500 bit pattern alone');
  ok(one(0x4000021, 'MZONE', 'REMOVED').cls === 'R7' && one(0x4000021, 'MZONE', 'REMOVED').redirect === true,
     'A5: M — a redirected battle destruction keeps its class and gains the modifier');
  ok(one(0x8a, 'MZONE', 'GRAVE').cls === 'R15', 'A6: 0x8a (RELEASE|MATERIAL|COST) is a cost release (R15), not a summon tribute');
  ok(one(0x200008, 'MZONE', 'MZONE') === null, 'A7: a field arrival (Xyz attach) classifies to nothing');
  ok(one(0x8000000, 'MZONE', 'GRAVE') === null && one(0x2, 'MZONE', 'GRAVE') === null,
     'A8: unknown / reason-less bit patterns fall back to generic (null)');
}

// ================= Part B: synthetic GameState =================
const MON = (() => { for (const c of data.decks.ishizu.main) if (data.cards[c] && (data.cards[c].type & 1)) return c; })();
const MON2 = (() => { for (const c of data.decks.gg.main) if (data.cards[c] && (data.cards[c].type & 1)) return c; })();
const SPELL = (() => { for (const c of data.decks.ishizu.main) if (data.cards[c] && (data.cards[c].type & 2)) return c; })();
const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
const li = (con, loc, seq, pos) => { const b = new Uint8Array(10); b[0] = con; b[1] = loc; const dv = new DataView(b.buffer); dv.setUint32(2, seq, true); dv.setUint32(6, pos || 0, true); return b; };
const cat = (...ps) => { const out = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of ps) { out.set(p, o); o += p.length; } return out; };
const MZ = E.LOC.MZONE, SZ = E.LOC.SZONE, HD = E.LOC.HAND, GR = E.LOC.GRAVE, RM = E.LOC.REMOVED, DK = E.LOC.DECK, EX = E.LOC.EXTRA, OV = E.LOC.OVERLAY;
const move = (code, f, t, reason) => cat(new Uint8Array([50]), u32le(code), li(f[0], f[1], f[2], f[3]), li(t[0], t[1], t[2], t[3]), u32le(reason));
const spsummoning = (code, con, seq) => cat(new Uint8Array([62]), u32le(code), li(con, MZ, seq, 1));
const spsummoned = (code, con, seq) => cat(new Uint8Array([63]), u32le(code), li(con, MZ, seq, 1));
const chaining = (code, con, loc, seq) => cat(new Uint8Array([70]), u32le(code), li(con, loc, seq, 5), new Uint8Array([con]), new Uint8Array([loc]), u32le(seq), new Uint8Array(8), u32le(0));
const fresh = () => { const st = new E.GameState(data); st.events.length = 0; st.dlog.length = 0; st.log.length = 0; return st; };
const mcEv = (st) => st.events.filter(e => e.kind === 'movecls');
const dlogHas = (st, sub) => st.dlog.some(e => e.s && e.s.includes(sub));

{ // B1: R1 — an unconfirmed special summon destroyed at its own slot
  const st = fresh();
  st.apply(spsummoning(MON, 1, 2));
  st.apply(move(MON, [1, MZ, 2, 1], [1, GR, 0, 0], 0x41));
  const ev = mcEv(st).find(e => e.code === MON);
  ok(ev && ev.cls === 'R1' && ev.from === 'field' && ev.to === 'grave', 'B1a: negated special summon classifies R1');
  ok(dlogHas(st, '特殊召喚が無効化され、破壊されて墓地へ送られた'), 'B1b: history names the negated summon (§6)');
}
{ // B2: the Minerva trap — same code, DIFFERENT slot must not inherit the pending state
  const st = fresh();
  st.apply(spsummoning(MON, 1, 2));
  st.apply(move(MON, [1, MZ, 3, 1], [1, GR, 0, 0], 0x41));
  const ev = mcEv(st).find(e => e.code === MON);
  ok(ev && ev.cls === 'R10', 'B2: slot mismatch (same code, other slot) is an ordinary effect destruction, not R1');
}
{ // B3: SUMMONED retires the pending state
  const st = fresh();
  st.apply(spsummoning(MON, 1, 2));
  st.apply(spsummoned(MON, 1, 2));
  st.apply(move(MON, [1, MZ, 2, 1], [1, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R10', 'B3: after SUMMONED, the same move is R10, never R1');
}
{ // B4/B5: NEW_TURN and CHAIN_END also retire it
  const st = fresh();
  st.apply(spsummoning(MON, 1, 2));
  st.apply(new Uint8Array([40, 0])); // NEW_TURN
  st.apply(move(MON, [1, MZ, 2, 1], [1, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R10', 'B4: NEW_TURN clears the pending summon');
  const st2 = fresh();
  st2.apply(spsummoning(MON, 1, 2));
  st2.apply(new Uint8Array([74])); // CHAIN_END
  st2.apply(move(MON, [1, MZ, 2, 1], [1, GR, 0, 0], 0x41));
  ok(mcEv(st2).find(e => e.code === MON).cls === 'R10', 'B5: CHAIN_END clears the pending summon');
}
{ // B6/B7: R2 / R3 — MSG 75 on the slot's link, with and without destruction
  const st = fresh();
  st.apply(chaining(SPELL, 0, SZ, 1));
  st.apply(new Uint8Array([75, 1])); // CHAIN_NEGATED link 1
  st.apply(move(SPELL, [0, SZ, 1, 5], [0, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === SPELL).cls === 'R2', 'B6a: negated + destroyed classifies R2');
  ok(dlogHas(st, 'の発動が無効化され、破壊されて墓地へ送られた'), 'B6b: history wording for R2');
  ok(st.dlog.some(e => e.k === 'neg'), 'B6c: the pre-existing neg line is kept (roles differ, §8)');
  const st2 = fresh();
  st2.apply(chaining(SPELL, 0, SZ, 1));
  st2.apply(new Uint8Array([75, 1]));
  st2.apply(move(SPELL, [0, SZ, 1, 5], [0, GR, 0, 0], 0x400));
  ok(mcEv(st2).find(e => e.code === SPELL).cls === 'R3', 'B7a: negated without destruction classifies R3');
  ok(dlogHas(st2, '墓地へ送られた（破壊はされていない）'), 'B7b: R3 history states the card was NOT destroyed (§6)');
}
{ // B8/B9: R4 / R5 — MSG 76 on the slot's link
  const st = fresh();
  st.apply(chaining(MON, 0, MZ, 0));
  st.apply(new Uint8Array([76, 1])); // CHAIN_DISABLED link 1
  st.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R4', 'B8: disabled + destroyed classifies R4');
  const st2 = fresh();
  st2.apply(chaining(SPELL, 0, SZ, 1));
  st2.apply(new Uint8Array([76, 1]));
  st2.apply(move(SPELL, [0, SZ, 1, 5], [0, GR, 0, 0], 0x400));
  ok(mcEv(st2).find(e => e.code === SPELL).cls === 'R5' && dlogHas(st2, 'の効果が無効化され、墓地へ送られた（破壊はされていない）'),
     'B9: disabled without destruction classifies R5 with the not-destroyed history wording');
}
{ // B10: link slot mismatch — a negated link at seq 1 does not explain seq 2's move
  const st = fresh();
  st.apply(chaining(SPELL, 0, SZ, 1));
  st.apply(new Uint8Array([75, 1]));
  st.apply(move(SPELL, [0, SZ, 2, 5], [0, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === SPELL).cls === 'R10', 'B10: negated link at another slot does not leak into this move');
}
{ // B11: R6 + B12: unknown reasons keep the current generic history
  const st = fresh();
  st.apply(move(MON, [0, HD, 0, 0], [0, GR, 0, 0], 0x4500));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R6' && dlogHas(st, '手札上限（6枚）のため捨てた'), 'B11: R6 hand-limit discard, bits alone');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ, 0, 1], [0, GR, 0, 0], 0x2)); // RELEASE alone: no certain class
  const ev2 = mcEv(st2).find(e => e.code === MON);
  ok(ev2 && ev2.cls === null && dlogHas(st2, 'は墓地へ送られた'), 'B12a: an unclassifiable move keeps the generic history wording');
  const st3 = fresh();
  st3.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x8000000)); // an undefined bit
  ok(mcEv(st3).find(e => e.code === MON).cls === null && dlogHas(st3, 'は除外された'), 'B12b: an undefined reason bit stays generic');
}
{ // B13..B15: banish forms — destroyed-and-banished, redirect modifier
  const st = fresh();
  st.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R24' && dlogHas(st, '効果で破壊され、除外された（墓地へは送られていない）'),
     'B13: R24 destroyed-and-banished (Bottomless form)');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x4000021));
  const ev2 = mcEv(st2).find(e => e.code === MON);
  ok(ev2.cls === 'R7' && ev2.redirect === true && dlogHas(st2, '戦闘で破壊され、墓地へは行かず除外された'),
     'B14: M — battle destruction redirected to the banished pile');
  const st3 = fresh();
  st3.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x4080008));
  ok(mcEv(st3).find(e => e.code === MON).cls === 'R11' && dlogHas(st3, 'シンクロ素材として送られ、墓地へは行かず除外された'),
     'B15: M — synchro material redirected to the banished pile');
}
{ // B16..B21: the non-graveyard destinations (2026-11-13 steer)
  const st = fresh();
  st.apply(move(MON, [0, HD, 0, 0], [0, RM, 0, 0], 0x44));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R23' && dlogHas(st, '効果で一時的に除外された'), 'B16: R23 temporary banish');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ, 0, 1], [0, HD, 0, 0], 0x40));
  ok(mcEv(st2).find(e => e.code === MON).cls === 'HB' && dlogHas(st2, '効果で手札に戻った'), 'B17: HB bounce');
  const st3 = fresh();
  st3.apply(move(MON, [0, MZ, 0, 1], [0, DK, 0, 0], 0x40));
  ok(mcEv(st3).find(e => e.code === MON).cls === 'R22' && dlogHas(st3, '効果でデッキに戻った'), 'B18: spin — effect return to the deck');
  const st4 = fresh();
  st4.apply(move(MON, [0, GR, 0, 0], [0, DK, 0, 0], 0x40048));
  st4.apply(move(MON2, [0, GR, 0, 0], [0, EX, 0, 0], 0x40048));
  ok(mcEv(st4).find(e => e.code === MON).cls === 'R13' && dlogHas(st4, '融合素材としてデッキに戻った'), 'B19a: R13 fusion material returned to the deck');
  ok(mcEv(st4).find(e => e.code === MON2).cls === 'R13' && dlogHas(st4, '融合素材としてEXデッキに戻った'), 'B19b: R13 fusion material returned to the Extra Deck');
  const st5 = fresh();
  st5.apply(move(MON, [0, MZ, 0, 1], [0, RM, 0, 0], 0x88));
  ok(mcEv(st5).find(e => e.code === MON).cls === 'R13' && dlogHas(st5, '融合素材として除外された'), 'B20: R13 contact-fusion material banished (0x88)');
  const st6 = fresh();
  st6.apply(move(MON, [0, DK, 0, 0], [0, HD, 0, 0], 0x40));
  st6.apply(move(MON2, [0, GR, 0, 0], [0, HD, 0, 0], 0x40));
  const st7 = fresh();
  st7.apply(move(MON, [0, RM, 0, 0], [0, HD, 0, 0], 0x40));
  ok(mcEv(st6).find(e => e.code === MON).cls === 'HS' && dlogHas(st6, '効果でデッキから手札に加えた'), 'B21a: HS search');
  ok(mcEv(st6).find(e => e.code === MON2).cls === 'HV' && dlogHas(st6, '効果で墓地から手札に加えた'), 'B21b: HV salvage');
  ok(mcEv(st7).find(e => e.code === MON).cls === 'HR' && dlogHas(st7, 'を効果で手札に加えた'), 'B21c: HR recovery from the banished pile');
}
{ // B22..B25: overlay units, activated spell/trap, grave cost
  const st = fresh();
  st.apply(move(MON, [0, MZ | OV, 0, 0], [0, GR, 0, 0], 0x80));
  const ev = mcEv(st).find(e => e.code === MON);
  ok(ev.cls === 'R19' && ev.from === 'overlay' && dlogHas(st, 'エクシーズ素材として取り除かれ、墓地へ送られた'), 'B22: R19 detach as cost');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ | OV, 0, 0], [0, GR, 0, 0], 0x600));
  ok(mcEv(st2).find(e => e.code === MON).cls === 'R20' && dlogHas(st2, 'ホストがフィールドを離れたため墓地へ送られた'), 'B23: R20 unit released by the host leaving');
  const st3 = fresh();
  st3.apply(move(SPELL, [0, SZ, 0, 5], [0, GR, 0, 0], 0x400));
  ok(mcEv(st3).find(e => e.code === SPELL).cls === 'R21' && dlogHas(st3, '墓地へ送られた（発動した魔法・罠）'), 'B24: R21 activated spell/trap rule send (history)');
  const st4 = fresh();
  st4.apply(move(MON, [0, GR, 0, 0], [0, RM, 0, 0], 0x80));
  ok(mcEv(st4).find(e => e.code === MON).cls === 'R17' && dlogHas(st4, 'コストで墓地から除外された'), 'B25: R17 graveyard cost banish');
}
{ // B26/B27: event emission boundaries
  const st = fresh();
  st.apply(move(MON, [0, EX, 0, 0], [0, MZ, 0, 1], 0x800));
  ok(mcEv(st).length === 0, 'B26: a field arrival emits no movecls record');
  const st2 = fresh();
  st2.apply(move(MON, [0, MZ, 1, 1], [0, MZ | OV, 0, 0], 0x200008));
  const ev2 = mcEv(st2).find(e => e.code === MON);
  ok(ev2 && ev2.to === 'gone' && ev2.cls === null, 'B27: becoming a material emits a record to "gone" with no class');
}
{ // B28: R2 from a hand activation keeps the hand-origin note (§6)
  const st = fresh();
  st.apply(chaining(MON, 0, HD, 0));
  st.apply(new Uint8Array([75, 1]));
  st.apply(move(MON, [0, HD, 0, 0], [0, GR, 0, 0], 0x41));
  ok(mcEv(st).find(e => e.code === MON).cls === 'R2' && dlogHas(st, '破壊されて墓地へ送られた（手札から発動）'), 'B28: hand-activated negation + destruction');
}

// ================= Part C: jsdom client pairing =================
(async () => {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP Part C: jsdom not resolvable (set NODE_PATH)'); finish(); return; }
  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
  async function boot() {
    const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
    const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
    window.fetch = async (url) => String(url).includes('ocgcore.wasm')
      ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
      : { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
    const inject = (file) => { const s = window.document.createElement('script'); s.textContent = fs.readFileSync(path.join(V2, file), 'utf8'); window.document.body.appendChild(s); };
    inject('build/ocgcore.js');
    const origFactory = window.OcgCoreModule;
    window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
    inject('engine.js'); inject('duel-worker.js'); inject('client.js');
    for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
      await new Promise(r => setTimeout(r, 50));
    return window;
  }
  const P0 = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const fakeState = (mut) => { const st = { players: [P0(), P0()], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: null, turnPlayer: 0 }; if (mut) mut(st); return st; };
  const monE = (code, pos) => ({ code, pos: pos == null ? 1 : pos, materials: 0, curAtk: data.cards[code].atk, curDef: data.cards[code].def });
  const mc = (code, con, from, to, cls, extra) => Object.assign({ kind: 'movecls', code, con, from, to, cls, redirect: false, discard: false }, extra || {});

  const window = await boot();
  const fx = window.__fx;
  const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
  const notes = (recs) => recs.filter(r => r.kind === 'movenote');
  fx.reset();

  step(fakeState()); // baseline
  let recs = step(fakeState(s => { s.players[0].grave = [MON]; s.players[0].deckCount = 39; }),
    [mc(MON, 0, 'deck', 'grave', 'R22')]);
  ok(notes(recs).some(r => r.cls === 'R22' && r.text.includes('が効果で墓地へ送られた')),
     'C1: a mill paired with its R22 record floats the effect-send wording');

  fx.reset(); step(fakeState());
  recs = step(fakeState(s => { s.players[0].grave = [MON]; s.players[0].deckCount = 39; }), []);
  ok(notes(recs).some(r => r.cls === null && r.text.includes('が墓地へ送られた') && !r.text.includes('効果で墓地へ')),
     'C2: the same mill with NO record keeps the generic wording (no invented reason)');

  fx.reset(); step(fakeState(s => { s.players[0].szone[0] = { code: SPELL, pos: 5 }; }));
  recs = step(fakeState(s => { s.players[0].grave = [SPELL]; }), [mc(SPELL, 0, 'field', 'grave', 'R21')]);
  ok(notes(recs).some(r => r.cls === null && r.text.includes('が墓地へ送られた')),
     'C3: R21 pairs but normalizes to the generic float (history-only class)');

  fx.reset(); step(fakeState(s => { s.players[0].hand = [{ code: MON }, { code: MON2 }]; }));
  recs = step(fakeState(s => { s.players[0].grave = [MON, MON2]; }),
    [mc(MON, 0, 'hand', 'grave', 'R17', { discard: true }), mc(MON2, 0, 'hand', 'grave', 'R22')]);
  const hg = notes(recs).filter(r => r.from === 'hand' && r.to === 'grave');
  ok(hg.length === 2 && hg.some(r => r.cls === 'R17' && r.text.includes('をコストで捨てた')) &&
     hg.some(r => r.cls === 'R22' && r.text.includes('が効果で墓地へ送られた')),
     'C4: same-route moves with different reasons split into separate groups');

  fx.reset(); step(fakeState(s => { s.players[1].mzone[0] = monE(MON); }));
  recs = step(fakeState(s => { s.players[1].grave = [MON]; }),
    [{ kind: 'destroy', code: MON, con: 1, fromLoc: 4, battle: false }, mc(MON, 1, 'field', 'grave', 'R1')]);
  ok(recs.some(r => r.kind === 'notice' && r.text.includes('の召喚が無効化され、破壊された')),
     'C5a: the destroy presentation names the negated summon, not an effect destruction');
  ok(notes(recs).some(r => r.from === 'field' && r.to === 'grave' && r.cls === null && !r.text.includes('無効化')),
     'C5b: the grave-arrival note for a destroyed card stays generic — the reason is floated once, by the destroy presentation');
  fx.reset(); step(fakeState(s => { s.players[0].hand = [{ code: MON }]; }));
  recs = step(fakeState(s => { s.players[0].grave = [MON]; }), [mc(MON, 0, 'hand', 'grave', 'R2')]);
  ok(notes(recs).some(r => r.cls === 'R2' && r.text.includes('の発動が無効化され、破壊された')),
     'C5c: a negated hand activation has no destroy presentation — its note carries the reason');

  fx.reset(); step(fakeState(s => { s.players[1].mzone[0] = monE(MON, 10); }));
  recs = step(fakeState(s => { s.players[1].deckCount = 41; }), [mc(MON, 1, 'field', 'deck', 'R22')]);
  const sec = notes(recs).find(r => r.from === 'field' && r.to === 'deck');
  ok(sec && sec.cls === null && sec.text.includes('セットカード') && !sec.text.includes(data.names[MON]),
     'C6: a set card returned to the deck stays unnamed and reasonless (secrecy boundary)');

  fx.reset(); step(fakeState(s => { s.players[0].mzone[0] = monE(MON); }));
  recs = step(fakeState(s => { s.players[0].removed = [MON]; }), [mc(MON, 0, 'field', 'removed', 'R7', { redirect: true })]);
  ok(notes(recs).some(r => r.cls === 'R7' && r.redirect && r.text.includes('代わりに除外された')),
     'C7: the redirect modifier rewrites the float destination');

  ok(fx.error === null, 'C8: fxError stayed null through the pairing steps (got: ' + fx.error + ')');
  window.close();
  finish();
})().catch(e => { console.log('FAIL Part C threw: ' + ((e && e.stack) || e)); failures++; finish(); });

function finish() {
  console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
  process.exit(failures ? 1 : 0);
}
