'use strict';
/* test-overlay.js — Xyz overlay-material accounting of the state mirror.
 *
 * Background (wire facts, edo9300/ygopro-core): overlay units have no
 * location of their own; a unit's loc_info is (controller, host_loc |
 * LOCATION_OVERLAY, host_seq) — it always names its host's CURRENT location.
 *   - attach during an inherent Xyz summon: MOVE unit MZONE -> 0xc0
 *     (EXTRA|OVERLAY, seq = host's Extra-Deck index), reason 0x200008
 *   - the host then MOVEs EXTRA[idx] -> MZONE[seq] (reason 0x800); the core
 *     sends NO per-unit follow-up messages
 *   - detach from a live field host: MOVE unit 0x84 (MZONE|OVERLAY, seq =
 *     host's zone) -> GRAVE, reason 0x80
 *   - host destroyed: MOVE host MZONE -> GRAVE, then each unit MOVEs
 *     0x90 (GRAVE|OVERLAY, seq = host's grave index) -> GRAVE, reason 0x600
 * The mirror's Extra-Deck order is deck-list order (the pre-registration
 * shuffle is never reported), so overlay counts are credited by core index
 * and claimed by index when the host leaves the Extra Deck.
 *
 * Checks (deterministic: seeded shuffle via fake crypto + fixed core seed):
 *   H. hunter batch — seat 0 forces Xyz lines; per-prompt conservation must
 *      be EXACT for both seats, final totals included; the batch must
 *      contain summons, attaches and a grave-release (host destroyed).
 *      (Neither policy in this batch activates spells, so no card ever
 *      changes controller and per-seat zone counts must equal deck sizes
 *      at every prompt.)
 *   W. wire model — an independent per-host material count rebuilt purely
 *      from MSG_MOVE must equal the mirror's per-entry `materials` at every
 *      prompt (this is what the board's material badges render).
 *   A. activator batch — Xyz effects are activated so detach lines occur.
 *      The exploratory policies also activate control-changing effects
 *      (e.g. Monster Reborn on the opponent's graveyard), which move a card
 *      into the other seat's zones legitimately; per-seat zone counts then
 *      differ from deck sizes until the card settles back into its owner's
 *      piles, so this batch gates on the control-invariant COMBINED total
 *      at every prompt plus exact per-seat FINAL totals, and reports the
 *      per-seat deviation count as a metric.
 * All batches: MSG_RETRY must be 0 and every duel must complete. */
const fs = require('fs');
const path = require('path');

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => {
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
    return a;
  } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, sortResp, unselectToggleResp, u64resp, Reader } = Engine;

const TYPE_XYZ = 0x800000;
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---------------------------------------------------------------- wire model
// Independent per-host overlay counts, rebuilt from MSG_MOVE alone.
class WireModel {
  constructor() { this.pendingExtra = [new Map(), new Map()]; this.fieldHosts = [new Map(), new Map()]; }
  apply(m) {
    if (m[0] !== 50) return;
    const r = new Reader(m, 1);
    const code = r.u32(); const from = r.locInfo(); const to = r.locInfo(); r.u32();
    if (code === 0) return;
    const base = (li) => li.loc & ~0x80;
    const dec = (map, k) => { const v = (map.get(k) || 0) - 1; if (v <= 0) map.delete(k); else map.set(k, v); };
    if (from.loc & 0x80) { // a unit leaves its host
      if (base(from) === 0x40) dec(this.pendingExtra[from.con], from.seq);
      else if (base(from) === 0x04) dec(this.fieldHosts[from.con], from.seq);
      // host in grave/removed/etc: units were already un-counted at host exit
    }
    if (to.loc & 0x80) { // a unit joins a host
      if (base(to) === 0x40) this.pendingExtra[to.con].set(to.seq, (this.pendingExtra[to.con].get(to.seq) || 0) + 1);
      else if (base(to) === 0x04) this.fieldHosts[to.con].set(to.seq, (this.fieldHosts[to.con].get(to.seq) || 0) + 1);
      return; // unit moves never move a host count
    }
    if (from.loc & 0x80) return; // unit moved to a plain location — done
    // host move (a card carrying units changes location)
    if (base(from) === 0x40 && base(to) === 0x04) {
      const v = this.pendingExtra[from.con].get(from.seq) || 0;
      this.pendingExtra[from.con].delete(from.seq);
      if (v) this.fieldHosts[to.con].set(to.seq, v);
    } else if (base(from) === 0x04 && base(to) === 0x40) {
      const v = this.fieldHosts[from.con].get(from.seq) || 0;
      this.fieldHosts[from.con].delete(from.seq);
      if (v) this.pendingExtra[to.con].set(to.seq, v);
    } else if (base(from) === 0x04 && base(to) === 0x04 && from.con !== to.con) {
      const v = this.fieldHosts[from.con].get(from.seq) || 0;
      this.fieldHosts[from.con].delete(from.seq);
      if (v) this.fieldHosts[to.con].set(to.seq, v);
    } else if (base(from) === 0x04) {
      this.fieldHosts[from.con].delete(from.seq); // host left the field; units release separately
    } else if (base(from) === 0x40) {
      this.pendingExtra[from.con].delete(from.seq); // host left the Extra Deck elsewhere
    }
  }
  mismatches(state) {
    const bad = [];
    for (let p = 0; p < 2; p++) {
      const P = state.players[p];
      for (let s = 0; s < 7; s++) {
        const want = this.fieldHosts[p].get(s) || 0;
        const got = P.mzone[s] ? (P.mzone[s].materials || 0) : 0;
        if (want !== got) bad.push('P' + p + ' mzone[' + s + '] wire=' + want + ' mirror=' + got);
      }
      for (let i = 0; i < P.extra.length; i++) {
        const want = this.pendingExtra[p].get(i) || 0;
        const got = P.extra[i].materials || 0;
        if (want !== got) bad.push('P' + p + ' extra[' + i + '] wire=' + want + ' mirror=' + got);
      }
      for (const k of this.pendingExtra[p].keys())
        if (k >= P.extra.length) bad.push('P' + p + ' extra[' + k + '] wire=' + this.pendingExtra[p].get(k) + ' mirror=(no entry)');
    }
    return bad;
  }
}

// ---------------------------------------------------------------- policies
function hunterAnswer(prompt, state, data) {
  const cards = data.cards;
  const isXyz = (code) => cards[code] && (cards[code].type & TYPE_XYZ);
  switch (prompt.name) {
    case 'SELECT_IDLECMD': {
      const xi = prompt.spsummon.findIndex(e => isXyz(e.code));
      if (xi >= 0) return cmdResp(1, xi);
      const s4 = prompt.summon.findIndex(e => cards[e.code] && cards[e.code].level === 4);
      if (s4 >= 0) return cmdResp(0, s4);
      if (prompt.spsummon.length) return cmdResp(1, 0);
      if (prompt.summon.length) return cmdResp(0, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      if (prompt.toEP) return cmdResp(7, 0);
      return cmdResp(7, 0);
    }
    case 'SELECT_BATTLECMD': {
      if (prompt.attack.length) return cmdResp(1, 0);
      if (prompt.toM2) return cmdResp(2, 0);
      if (prompt.toEP) return cmdResp(3, 0);
      return cmdResp(3, 0);
    }
    case 'SELECT_POSITION': {
      for (const p of [0x4, 0x1, 0x8, 0x2]) if (prompt.mask & p) return i32resp(p);
      return i32resp(prompt.mask);
    }
    case 'SELECT_UNSELECT_CARD': { // Xyz material selection in this core
      if (prompt.unselect.length >= prompt.min && (prompt.finishable || prompt.cancelable)) return cancelResp();
      if (prompt.select.length) return unselectToggleResp(0);
      return cancelResp();
    }
    default:
      return Engine.botAnswer(prompt, state, data, Engine.makeBotMemory());
  }
}

function activatorAnswer(prompt, state, data, R) {
  const cards = data.cards;
  const isXyz = (code) => cards[code] && (cards[code].type & TYPE_XYZ);
  if (prompt.name === 'SELECT_IDLECMD') {
    const ai = prompt.activate.findIndex(e => e.loc === 0x04 && isXyz(e.code)); // Xyz ignition effect -> detach
    if (ai >= 0) return cmdResp(5, ai);
    const xi = prompt.spsummon.findIndex(e => isXyz(e.code));
    if (xi >= 0) return cmdResp(1, xi);
  }
  if (prompt.name === 'SELECT_UNSELECT_CARD') {
    if (prompt.unselect.length >= prompt.min && (prompt.finishable || prompt.cancelable)) return cancelResp();
    if (prompt.select.length) return unselectToggleResp(0);
    return cancelResp();
  }
  return exploreAnswer(prompt, state, data, R);
}

// Exploratory policy (same approach as test-genesis.js), used by the
// activator batch for everything except the steered choices above.
function exploreAnswer(prompt, state, data, R) {
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  switch (prompt.name) {
    case 'SELECT_CHAIN': {
      if (prompt.forced) return i32resp(0);
      if (prompt.entries.length && R() < 0.3) return i32resp(Math.floor(R() * prompt.entries.length));
      return i32resp(-1);
    }
    case 'SELECT_IDLECMD': {
      const acts = [];
      prompt.summon.forEach((e, i) => acts.push(() => cmdResp(0, i)));
      prompt.spsummon.forEach((e, i) => acts.push(() => cmdResp(1, i)));
      prompt.repos.forEach((e, i) => acts.push(() => cmdResp(2, i)));
      prompt.mset.forEach((e, i) => acts.push(() => cmdResp(3, i)));
      prompt.sset.forEach((e, i) => acts.push(() => cmdResp(4, i)));
      prompt.activate.forEach((e, i) => acts.push(() => cmdResp(5, i)));
      if (prompt.canShuffle) acts.push(() => cmdResp(8, 0));
      if (acts.length && R() < 0.75) return pick(acts)();
      if (prompt.toBP && R() < 0.7) return cmdResp(6, 0);
      if (prompt.toEP) return cmdResp(7, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      if (acts.length) return pick(acts)();
      return cmdResp(7, 0);
    }
    case 'SELECT_BATTLECMD': {
      if (prompt.attack.length && R() < 0.8) return cmdResp(1, Math.floor(R() * prompt.attack.length));
      if (prompt.activate.length && R() < 0.3) return cmdResp(0, Math.floor(R() * prompt.activate.length));
      if (prompt.toM2 && R() < 0.5) return cmdResp(2, 0);
      if (prompt.toEP) return cmdResp(3, 0);
      if (prompt.toM2) return cmdResp(2, 0);
      return cmdResp(1, 0);
    }
    case 'SELECT_POSITION': { const bits = [1, 2, 4, 8].filter(b => prompt.mask & b); return i32resp(pick(bits)); }
    case 'SELECT_CARD': {
      const n = prompt.cards.length;
      const want = prompt.min + Math.floor(R() * (Math.min(prompt.max, n) - prompt.min + 1));
      const idx = new Set();
      while (idx.size < want) idx.add(Math.floor(R() * n));
      return cardsResp([...idx]);
    }
    case 'SELECT_TRIBUTE': {
      const order = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[b].releaseParam - prompt.cards[a].releaseParam);
      const picks = []; let sum = 0;
      for (const i of order) { if (sum >= prompt.min || picks.length >= prompt.max) break; picks.push(i); sum += prompt.cards[i].releaseParam; }
      return cardsResp(picks);
    }
    case 'SELECT_UNSELECT_CARD': {
      if ((prompt.finishable || prompt.cancelable) && (prompt.unselect.length >= prompt.min || R() < 0.4)) return cancelResp();
      return unselectToggleResp(Math.floor(R() * (prompt.select.length + prompt.unselect.length)));
    }
    case 'SELECT_SUM': {
      const chosen = [];
      const dfs = (k) => { if (Engine.sumSelectionValid(prompt, chosen)) return true;
        for (let j = k; j < prompt.cards.length; j++) { chosen.push(j); if (dfs(j + 1)) return true; chosen.pop(); } return false; };
      dfs(0);
      return cardsResp(chosen);
    }
    case 'SELECT_COUNTER': {
      const amounts = prompt.cards.map(() => 0);
      let remaining = prompt.count;
      const order = prompt.cards.map((c, i) => i).sort(() => R() - 0.5);
      for (const i of order) { const take = Math.min(remaining, prompt.cards[i].count); amounts[i] = take; remaining -= take; }
      return counterResp(amounts);
    }
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
      const avail = (~prompt.flag) >>> 0; const all = [];
      for (let s = 0; s < 7; s++) if (avail & (1 << s)) all.push({ con: prompt.player, loc: 0x04, seq: s });
      for (let s = 0; s < 5; s++) if (avail & (0x100 << s)) all.push({ con: prompt.player, loc: 0x08, seq: s });
      if (avail & 0x4000) all.push({ con: prompt.player, loc: 0x08, seq: 6 });
      if (avail & 0x8000) all.push({ con: prompt.player, loc: 0x08, seq: 7 });
      for (let s = 0; s < 7; s++) if (avail & (0x10000 << s)) all.push({ con: 1 - prompt.player, loc: 0x04, seq: s });
      for (let s = 0; s < 5; s++) if (avail & (0x1000000 << s)) all.push({ con: 1 - prompt.player, loc: 0x08, seq: s });
      if (avail & 0x40000000) all.push({ con: 1 - prompt.player, loc: 0x08, seq: 6 });
      if (avail & 0x80000000) all.push({ con: 1 - prompt.player, loc: 0x08, seq: 7 });
      all.sort(() => R() - 0.5);
      return placeResp(all.slice(0, prompt.count));
    }
    case 'SELECT_YESNO': case 'SELECT_EFFECTYN': return i32resp(R() < 0.5 ? 1 : 0);
    case 'SELECT_OPTION': return i32resp(Math.floor(R() * prompt.options.length));
    case 'SORT_CARD': { const idx = prompt.cards.map((_, i) => i); if (R() < 0.5) idx.reverse(); return sortResp(idx); }
    case 'SORT_CHAIN': return R() < 0.5 ? cancelResp() : sortResp(prompt.cards.map((_, i) => i));
    case 'ROCK_PAPER_SCISSORS': return i32resp(1 + Math.floor(R() * 3));
    case 'ANNOUNCE_RACE': {
      const bits = [];
      for (let b = 0; b < 32; b++) if (prompt.availLo & (1 << b)) bits.push([b, 0]);
      for (let b = 0; b < 32; b++) if (prompt.availHi & (1 << b)) bits.push([b, 1]);
      bits.sort(() => R() - 0.5);
      let lo = 0, hi = 0;
      bits.slice(0, prompt.count).forEach(([b, h]) => { if (h) hi |= (1 << b); else lo |= (1 << b); });
      return u64resp(lo, hi);
    }
    case 'ANNOUNCE_ATTRIB': {
      const bits = [];
      for (let b = 0; b < 32; b++) if (prompt.avail & (1 << b)) bits.push(b);
      bits.sort(() => R() - 0.5);
      let mask = 0; bits.slice(0, prompt.count).forEach(b => { mask |= (1 << b); });
      return i32resp(mask);
    }
    case 'ANNOUNCE_CARD': return i32resp(pick(data.decks.ishizu.main.concat(data.decks.gg.main)));
    case 'ANNOUNCE_NUMBER': return i32resp(Math.floor(R() * prompt.options.length));
  }
  return i32resp(0);
}

// ---------------------------------------------------------------- batch runner
async function runBatch(M, data, label, seeds, makeAnswerers, mode) {
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  const agg = { duels: 0, retries: 0, violations: 0, seatDeviations: 0, wireBad: 0, wireExamples: [],
                attachExtra: 0, detachField: 0, releaseGrave: 0, xyzSummons: 0, endExact: 0, endCtlChanged: 0 };
  // The two deck pools are disjoint, so a card from the other pool present
  // in a player's zones at duel end is a control-changed card (e.g. taken
  // by "Monster Reborn") — the documented explanation for a per-seat final
  // total being off while the combined total stays exact.
  const pools = [new Set(data.decks.ishizu.main.concat(data.decks.ishizu.extra)),
                 new Set(data.decks.gg.main.concat(data.decks.gg.extra))];
  const poolsDisjoint = ![...pools[0]].some(c => pools[1].has(c));
  const hasForeignCard = (state) => {
    if (!poolsDisjoint) return false;
    for (let p = 0; p < 2; p++) {
      for (const zn of ['deck', 'hand', 'mzone', 'szone', 'grave', 'removed', 'extra']) {
        const z = state.players[p][zn];
        if (!Array.isArray(z)) continue;
        for (const c of z) if (c && c.code && pools[1 - p].has(c.code) && !pools[p].has(c.code)) return true;
      }
    }
    return false;
  };
  const xyzCodes = new Set(Object.keys(data.cards).filter(c => data.cards[c].type & TYPE_XYZ).map(Number));
  for (const seed of seeds) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const wire = new WireModel();
    const onMessage = (m) => {
      wire.apply(m);
      if (m[0] === 50) {
        const r = new Reader(m, 1);
        const code = r.u32(); const from = r.locInfo(); const to = r.locInfo(); r.u32();
        if (code === 0) return;
        if ((to.loc & 0x80) && (to.loc & ~0x80) === 0x40) agg.attachExtra++;
        if ((from.loc & 0x80) && (from.loc & ~0x80) === 0x04) agg.detachField++;
        if ((from.loc & 0x80) && (from.loc & ~0x80) === 0x10) agg.releaseGrave++;
        if (xyzCodes.has(code) && (from.loc & ~0x80) === 0x40 && (to.loc & ~0x80) === 0x04) agg.xyzSummons++;
      }
    };
    const check = (state) => {
      if (mode === 'strict') {
        for (let p = 0; p < 2; p++) if (state.totalCards(p) !== expected[p]) agg.violations++;
      } else { // 'combined': control-invariant total; per-seat deviations are a metric
        if (state.totalCards(0) + state.totalCards(1) !== expected[0] + expected[1]) agg.violations++;
        for (let p = 0; p < 2; p++) if (state.totalCards(p) !== expected[p]) agg.seatDeviations++;
      }
      const bad = wire.mismatches(state);
      agg.wireBad += bad.length;
      for (const b of bad) if (agg.wireExamples.length < 5) agg.wireExamples.push('seed ' + seed + ': ' + b);
    };
    const [humanAnswerer, botAnswerer] = makeAnswerers(seed);
    const duel = new Engine.Duel(M, data, {
      seed: 20261102, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      onLog: () => {}, onMessage,
      humanAnswerer: async (prompt, state) => { check(state); return humanAnswerer(prompt, state); },
      botAnswerer: (prompt, state) => { check(state); return botAnswerer(prompt, state); },
    });
    const stats = await duel.run();
    agg.duels++;
    agg.retries += stats.retries;
    if (duel.state.totalCards(0) === expected[0] && duel.state.totalCards(1) === expected[1]) agg.endExact++;
    else if (duel.state.totalCards(0) + duel.state.totalCards(1) === expected[0] + expected[1]
             && hasForeignCard(duel.state)) agg.endCtlChanged++;
    console.log('  ' + label + ' seed ' + seed + ': over=' + duel.over + ' turns=' + stats.turns + ' retries=' + stats.retries);
  }
  console.log(label + ' totals: ' + JSON.stringify(agg));
  ok(agg.retries === 0, label + ': MSG_RETRY == 0 across ' + agg.duels + ' duels');
  ok(agg.violations === 0, label + (mode === 'strict'
    ? ': per-prompt conservation exact per seat (0 violations)'
    : ': per-prompt COMBINED conservation exact (0 violations; per-seat deviations from control changes: ' + agg.seatDeviations + ')'));
  ok(agg.wireBad === 0, label + ': wire-model per-host materials == mirror at every prompt' +
     (agg.wireExamples.length ? ' — e.g. ' + agg.wireExamples.join(' ; ') : ''));
  // Final per-seat totals must be exact, except duels whose only mismatch
  // is a control-changed card still on the field/zones at the end (the
  // combined total is exact there — same reasoning as the combined-mode
  // conservation gate above and the test-cpu precedent). After the GG
  // contact-fusion fix, ACTIVATOR seed 22 ends with the GG seat's
  // Labyrinth Heavy Tank (35026117) under seat 0's control: P0=59/P1=54,
  // combined 113 exact, wire model exact.
  ok(agg.endExact + agg.endCtlChanged === agg.duels, label + ': final totals exact in all duels (' + agg.endExact + '/' + agg.duels + ' exact, ' + agg.endCtlChanged + ' explained by a control-changed card at end)');
  return agg;
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

  const hunter = await runBatch(M, data, 'HUNTER', [1, 2, 3, 4, 5, 6, 7, 8], () => [
    (prompt, state) => hunterAnswer(prompt, state, data),
    (prompt, state) => Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()),
  ], 'strict');
  // Exercise thresholds recalibrated for the CPU phase (see v2/NOTES.md):
  // the original >=12 / >=24 assumed the passive pre-CPU bot at seat 1.
  // The Gate Guardian deck has NO Xyz monster and no level-4 monster, so
  // every Xyz in this batch must come from the hunter — and a competent
  // seat-1 policy contests its level-4 pairs and ends duels sooner
  // (measured: 4 summons / 8 in-Extra attaches, deterministic under the
  // seeded shuffle). The machinery itself is additionally covered by the
  // ACTIVATOR batch below (10 Xyz / 20 attaches / 10 detaches, unchanged).
  // The correctness gates above (conservation, wire model, retries) are
  // NOT relaxed.
  ok(hunter.xyzSummons >= 3, 'HUNTER: Xyz summons exercised (' + hunter.xyzSummons + ')');
  ok(hunter.attachExtra >= 6, 'HUNTER: attaches to in-Extra hosts exercised (' + hunter.attachExtra + ')');
  ok(hunter.releaseGrave >= 1, 'HUNTER: grave-release after host destruction exercised (' + hunter.releaseGrave + ')');

  const act = await runBatch(M, data, 'ACTIVATOR', [21, 22, 23, 24, 25, 26], (seed) => {
    const R1 = rng(seed * 7919 + 13), R2 = rng(seed * 104729 + 7);
    return [
      (prompt, state) => activatorAnswer(prompt, state, data, R1),
      (prompt, state) => exploreAnswer(prompt, state, data, R2),
    ];
  }, 'combined');
  ok(act.xyzSummons >= 3, 'ACTIVATOR: Xyz summons exercised (' + act.xyzSummons + ')');
  ok(act.detachField >= 1, 'ACTIVATOR: detach from a live field host exercised (' + act.detachField + ')');

  console.log(failures === 0 ? 'ALL OVERLAY CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
