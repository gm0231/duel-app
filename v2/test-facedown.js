'use strict';
/* test-facedown.js — face-down special summons must not lose their card
 * identity in the state mirror (fix round 3).
 *
 * Defect (traced in fix round 2's B2 determination): for a face-down
 * special summon, the monster's MSG_MOVE into its zone carries the true
 * code and the mirror records it; the following MSG_SPSUMMONING carries
 * code 0 (the core zeroes the code for face-down summons) and
 * GameState.apply case 62 overwrote the known code with 0; a later
 * MSG_POS_CHANGE carries the true code again but case 53 only filled the
 * code when it was `null`, so 0 stuck forever. Live signatures: Medusa
 * Worm, Keldo the Sacred Protector (mirror=0, materials=0).
 *
 * Method: deterministic exploratory duels (seeded shuffle via fake
 * crypto + fixed core seed; same explore policy and stats seeds as
 * test-phase2 section B). An independent WIRE MODEL tracks the true code
 * of every main-monster-zone slot purely from raw messages (any non-zero
 * code announced for that slot: MOVE in, SUMMONING/SPSUMMONING/
 * FLIPSUMMONING/SET, POS_CHANGE; MOVE out clears; SWAP exchanges). At
 * every prompt, every occupied mzone slot's mirror code must equal the
 * wire model's code, and the live core query (refreshFieldStats +
 * queryCard, as in test-phase2 B2) must agree with the mirror.
 *
 * Non-vacuity gates: the batch must actually contain face-down special
 * summons announced with code 0 (SPSUMMONING, face-down position, wire
 * model already knowing the true code from the preceding MOVE), and at
 * least one such monster must later be observed face-up. If a run
 * contains none, this test FAILS as vacuous instead of passing silently.
 *
 * Seed note (GG contact-fusion fix, see NOTES): with the contact fusions
 * restored, the seat-1 Gate Guardian policy takes different lines and
 * the original four seeds stopped producing Morphing Jar 2 flips at all
 * (fdss 0, correctness checks still 0 violations). Seed 7 exercises the
 * scenario under the new behaviour (fdss 4, SHUFFLE_SET_CARD 2), so it
 * was ADDED to the batch; the original seeds and all gates are unchanged.
 */
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
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp, Reader } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// Explore policy: identical to test-phase2.js (the duels that produced
// the B2 failures).
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

// ------------------------------------------------------------ wire model
// True code per mzone slot, rebuilt from raw messages only. A slot's code
// is whatever the last non-zero announcement for that slot said; code 0
// announcements never erase it (that is precisely the invariant the
// mirror must satisfy).
class WireIdentity {
  constructor() {
    this.exp = [Array(7).fill(null), Array(7).fill(null)];
    this.fdssZero = 0;        // SPSUMMONING code=0, face-down, wire knew the code
    this.fdssExamples = [];
    this.shuffleEvents = 0;   // MSG_SHUFFLE_SET_CARD seen (permutation undisclosed on the wire)
  }
  apply(m, data) {
    const t = m[0]; const r = new Reader(m, 1);
    if (t === 50) { // MOVE
      const code = r.u32(); const from = r.locInfo(); const to = r.locInfo(); r.u32();
      if (code === 0) return;
      if (from.loc === 0x04) this.exp[from.con][from.seq] = null;
      if (to.loc === 0x04) this.exp[to.con][to.seq] = code;
    } else if (t === 54 || t === 60 || t === 62 || t === 64) { // SET/SUMMONING/SPSUMMONING/FLIPSUMMONING
      const code = r.u32(); const li = r.locInfo();
      if (li.loc !== 0x04) return;
      if (code !== 0) { this.exp[li.con][li.seq] = code; return; }
      if (t === 62 && (li.pos & 0xA) && this.exp[li.con][li.seq]) {
        this.fdssZero++;
        const nm = data.names[this.exp[li.con][li.seq]];
        if (this.fdssExamples.length < 6) this.fdssExamples.push(nm + ' (code ' + this.exp[li.con][li.seq] + ', P' + li.con + ' zone ' + li.seq + ', pos 0x' + li.pos.toString(16) + ')');
      }
    } else if (t === 53) { // POS_CHANGE
      const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u8(); r.u8(); r.u8();
      if (loc === 0x04 && code !== 0) this.exp[con][seq] = code;
    } else if (t === 55) { // SWAP
      r.u32(); const i1 = r.locInfo(); r.u32(); const i2 = r.locInfo();
      if (i1.loc === 0x04 && i2.loc === 0x04) {
        const tmp = this.exp[i1.con][i1.seq];
        this.exp[i1.con][i1.seq] = this.exp[i2.con][i2.seq];
        this.exp[i2.con][i2.seq] = tmp;
      }
    } else if (t === 36) { // SHUFFLE_SET_CARD: loc, count, from-loc_infos, to-loc_infos
      // The core permutes the set cards among the named slots but does not
      // disclose the permutation (to-entries are empty loc_infos except for
      // Xyz-material hosts). Model honestly: exact pairs move; every other
      // affected slot's identity becomes unknown (the mirror must do the
      // same and re-identify via the live query).
      r.u8(); const ct = r.u8();
      const froms = []; for (let i = 0; i < ct; i++) froms.push(r.locInfo());
      const tos = []; for (let i = 0; i < ct; i++) tos.push(r.locInfo());
      this.shuffleEvents++;
      const staged = froms.map(li => li.loc === 0x04 ? this.exp[li.con][li.seq] : undefined);
      for (let i = 0; i < ct; i++) if (froms[i].loc === 0x04 && !(tos[i] && tos[i].loc !== 0)) this.exp[froms[i].con][froms[i].seq] = null;
      for (let i = 0; i < ct; i++) if (froms[i].loc === 0x04 && tos[i] && tos[i].loc === 0x04) this.exp[tos[i].con][tos[i].seq] = staged[i];
    }
  }
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const SEEDS = [11, 222, 33, 44, 7];
  let violations = 0, queryMismatch = 0, checks = 0, fdFlipsChecked = 0, retries = 0, completed = 0, shuffleTotal = 0;
  const violationExamples = [];
  let fdssTotal = 0; const fdssExamplesAll = [];

  for (const seed of SEEDS) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const wire = new WireIdentity();
    const prevPos = [Array(7).fill(null), Array(7).fill(null)];
    const R = rng(seed * 104729);
    let duelRef = null;
    const answerer = (prompt, state) => {
      if (duelRef) {
        duelRef.refreshFieldStats();
        for (let p = 0; p < 2; p++) for (let s = 0; s < 7; s++) {
          const cell = state.players[p].mzone[s];
          if (!cell) { prevPos[p][s] = null; continue; }
          checks++;
          const exp = wire.exp[p][s];
          if (exp && cell.code !== exp) {
            violations++;
            if (violationExamples.length < 8)
              violationExamples.push('seed ' + seed + ' turn ' + state.turnCount + ' P' + p + ' zone ' + s + ': mirror=' + cell.code +
                ' wire=' + exp + ' (' + data.names[exp] + ') pos=0x' + (cell.pos || 0).toString(16));
          }
          const q = duelRef.queryCard(p, 0x04, s);
          if (!q || q.code !== cell.code) queryMismatch++;
          if (exp && prevPos[p][s] != null && (prevPos[p][s] & 0xA) && (cell.pos & 0x5)) fdFlipsChecked++;
          prevPos[p][s] = cell.pos;
        }
      }
      return exploreAnswer(prompt, state, data, R);
    };
    const duel = new Engine.Duel(M, data, {
      seed: 20261102, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      onLog: () => {}, onMessage: (m) => wire.apply(m, data),
      humanAnswerer: answerer, botAnswerer: answerer,
    });
    duelRef = duel;
    const s = await duel.run();
    retries += s.retries;
    if (duel.state.winner === 0 || duel.state.winner === 1) completed++;
    fdssTotal += wire.fdssZero;
    shuffleTotal += wire.shuffleEvents;
    fdssExamplesAll.push(...wire.fdssExamples);
    console.log('  duel seed ' + seed + ': turns', s.turns, 'retries', s.retries, 'winner', duel.state.winner,
      'fdss(code0)=' + wire.fdssZero, 'shuffleSet=' + wire.shuffleEvents);
  }

  console.log('  face-down SS announced with code 0 (wire knew true code):', fdssTotal, fdssExamplesAll.slice(0, 6).join(' ; '));
  console.log('  SHUFFLE_SET_CARD messages in this batch:', shuffleTotal, shuffleTotal === 0 ? '(deterministic batch does not exercise the set-shuffle; it is exercised by the randomized test-phase2 B duels)' : '');
  console.log('  occupied-zone observations:', checks, '| wire-vs-mirror violations:', violations, '| query-vs-mirror mismatches:', queryMismatch, '| fd->fu flips of wire-known monsters observed:', fdFlipsChecked);
  violationExamples.forEach(v => console.log('  VIOLATION', v));
  ok(completed === SEEDS.length, 'all ' + SEEDS.length + ' duels complete');
  ok(retries === 0, 'MSG_RETRY 0 across all duels');
  ok(fdssTotal > 0, 'non-vacuous: face-down special summons with code-0 SPSUMMONING occurred (' + fdssTotal + ')');
  ok(fdFlipsChecked > 0, 'non-vacuous: face-down wire-known monsters later observed face-up (' + fdFlipsChecked + ' transitions)');
  ok(violations === 0, 'mirror code == wire true code at every prompt for every occupied monster zone');
  ok(queryMismatch === 0, 'live query code == mirror code at every observation (B2 equivalent)');
  console.log(failures === 0 ? 'TEST PASS' : 'TEST FAIL');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
