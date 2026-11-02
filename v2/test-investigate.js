'use strict';
/* test-investigate.js — Phase 2 item 1 investigation.
   Question: in browser runs, an ANNOUNCE_CARD prompt (カードの宣言) appeared in
   the human UI at the opponent's draw phase with no source context, and card
   movements around it looked unexplained.
   This harness runs exploratory duels (both seats, legal pseudo-random
   answers) with a raw message tap, and for every ANNOUNCE_CARD prompt records:
     - prompt.player (whose prompt the core says it is),
     - the message ring before it (is a CHAINING of Gravekeeper's Trap 98715423
       the immediately preceding chain event?),
     - both players' hands before the prompt and at the next prompt (diff),
     - every MOVE out of a hand during the surrounding window (explained?),
     - card conservation at both boundaries.
   Exit 0 if >=2 announce events were captured and analyzed. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp, Reader, LOC } = Engine;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// exploratory answer policy (same family as test-explore.js)
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
      const order = prompt.cards.map((c, i) => i).sort(() => R() - 0.5);
      const chosen = [];
      const dfs = (k) => {
        if (Engine.sumSelectionValid(prompt, chosen)) return true;
        for (let j = k; j < order.length; j++) { chosen.push(order[j]); if (dfs(j + 1)) return true; chosen.pop(); }
        return false;
      };
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
      const avail = (~prompt.flag) >>> 0;
      const all = [];
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

const LOCNAME = { 1: 'DECK', 2: 'HAND', 4: 'MZONE', 8: 'SZONE', 16: 'GRAVE', 32: 'REMOVED', 64: 'EXTRA' };
function summarizeMsg(m, data) {
  const t = m[0]; const r = new Reader(m, 1);
  switch (t) {
    case 70: { const code = r.u32(); const li = r.locInfo(); return 'CHAINING ' + data.names[code] + ' (' + code + ') by P' + li.con + ' @' + (LOCNAME[li.loc] || li.loc) + li.seq; }
    case 50: { const code = r.u32(); const f = r.locInfo(); const to = r.locInfo(); const reason = r.u32(); return 'MOVE ' + data.names[code] + ' P' + f.con + ' ' + (LOCNAME[f.loc] || f.loc) + ' -> P' + to.con + ' ' + (LOCNAME[to.loc] || to.loc) + ' reason=0x' + reason.toString(16); }
    case 90: { const p = r.u8(); const n = r.u32(); return 'DRAW P' + p + ' x' + n; }
    case 33: { const p = r.u8(); const n = r.u32(); return 'SHUFFLE_HAND P' + p + ' (' + n + ')'; }
    case 2: { const ht = r.u8(); const p = r.u8(); return 'HINT type=' + ht + ' player=' + p; }
    case 40: return 'NEW_TURN';
    case 41: return 'NEW_PHASE 0x' + r.u16().toString(16);
    case 60: case 62: case 64: { const code = r.u32(); return 'SUMMONING(' + t + ') ' + data.names[code]; }
    case 110: return 'ATTACK';
    default: return 'MSG' + t;
  }
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  const events = [];
  let duels = 0;
  const seeds = [11, 222, 3333, 7, 42, 99, 1234, 5555, 777, 9001, 31415, 2718, 161, 2001, 60606, 8080, 12321, 5150, 999, 31337];
  for (const seed of seeds) {
    if (events.length >= 3) break;
    duels++;
    const R = rng(seed * 7919);
    const ring = [];
    let pendingEvent = null;
    let violations = 0;
    const handSnap = (state) => state.players.map(P => P.hand.map(c => c.code));
    const diff = (a, b) => {
      const cnt = (arr) => arr.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
      const ca = cnt(a), cb = cnt(b); const out = { removed: [], added: [] };
      for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
        const d = (cb[k] || 0) - (ca[k] || 0);
        if (d < 0) out.removed.push([data.names[k] || k, -d]);
        if (d > 0) out.added.push([data.names[k] || k, d]);
      }
      return out;
    };
    const answerer = (prompt, state) => {
      for (let p = 0; p < 2; p++) if (state.totalCards(p) !== expected[p]) violations++;
      if (pendingEvent) { // close out the previous announce event at this next prompt boundary
        pendingEvent.handAfter = handSnap(state);
        pendingEvent.diffP0 = diff(pendingEvent.handBefore[0], pendingEvent.handAfter[0]);
        pendingEvent.diffP1 = diff(pendingEvent.handBefore[1], pendingEvent.handAfter[1]);
        pendingEvent.conservationOk = violations === pendingEvent.violationsAtStart;
        events.push(pendingEvent);
        pendingEvent = null;
      }
      if (prompt.name === 'ANNOUNCE_CARD') {
        pendingEvent = {
          seed, turn: state.turnCount, turnPlayer: state.turnPlayer, phase: state.phaseName,
          promptPlayer: prompt.player,
          contextFromEngine: prompt.context ? (data.names[prompt.context.code] + ' (' + prompt.context.code + ')') : null,
          ringBefore: ring.slice(-14),
          handBefore: handSnap(state),
          violationsAtStart: violations,
          ringAfter: [],
        };
      }
      return exploreAnswer(prompt, state, data, R);
    };
    const duel = new Engine.Duel(M, data, {
      seed: 20261102, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      humanAnswerer: answerer, botAnswerer: answerer,
      onMessage: (m) => {
        const s = summarizeMsg(m, data);
        ring.push(s); if (ring.length > 60) ring.shift();
        if (pendingEvent) { pendingEvent.ringAfter.push(s); if (pendingEvent.ringAfter.length > 40) pendingEvent.ringAfter.shift(); }
      },
    });
    const s = await duel.run();
    console.log('duel seed', seed, '-> turns', s.turns, 'retries', s.retries, 'winner', duel.state.winner, 'conservation violations:', violations, '| announce events so far:', events.length + (pendingEvent ? 1 : 0));
    if (pendingEvent) { pendingEvent.handAfter = null; pendingEvent.note = 'duel ended before next prompt'; events.push(pendingEvent); pendingEvent = null; }
  }
  console.log('\n================ ANNOUNCE_CARD EVENTS ================');
  for (const ev of events) {
    console.log(JSON.stringify(ev, null, 1));
  }
  console.log('captured', events.length, 'announce events in', duels, 'duels');
  process.exit(events.length >= 2 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
