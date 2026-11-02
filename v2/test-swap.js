'use strict';
/* test-swap.js — regression test for the mirror's MSG_SWAP_GRAVE_DECK
   handling and for batch-boundary overlay transit accounting.
   Background (see NOTES.md "Mirror totals investigation"):
     - MSG_SWAP_GRAVE_DECK (35) swaps a player's deck and graveyard in ONE
       message (Exchange of the Spirit). The mirror used to ignore it, so
       deckCount kept the pre-swap value: pile counts were wrong at once,
       and as the real deck drained past the stale count, deckCount clamped
       at 0 while cards kept arriving elsewhere — totals inflated for the
       rest of the duel (deterministic reproduction: seed 99 below ended
       [59,58] instead of [58,55] on the old code).
     - When an Xyz host leaves for an entry-less pile (grave/removed/deck/
       hand), the core releases its units with separate MOVEs a few batches
       later; the mirror used to drop the count in between (batch-level dip).
       engine.js now parks the count in transit[] until the releases land.
   Duel A (seed 99, exploratory policy both seats, deterministic shuffle):
   Exchange of the Spirit resolves for both players mid-duel. At EVERY
   prompt the mirror is cross-checked against the core itself (pile sizes
   and grave identities via Duel.queryCard scans) and totals must satisfy
   combined == pool and the control-adjusted per-seat rule.
   Duel B (seed 3): the combined total must equal the pool at EVERY batch
   boundary (onUpdate), not just at prompts — this is the transit gate
   (the old code dipped below the pool in 2 batches of this duel). */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp } = Engine;
const LOC = Engine.LOC;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  ok   ' : '  FAIL ') + label); if (!cond) failures++; };

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => {
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
    return a;
  } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Exploratory policy (same approach as test-genesis.js).
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
      const total = prompt.select.length + prompt.unselect.length;
      return unselectToggleResp(Math.floor(R() * total));
    }
    case 'SELECT_SUM': {
      const order = prompt.cards.map((c, i) => i).sort(() => R() - 0.5);
      const chosen = [];
      const dfs = (k) => { if (Engine.sumSelectionValid(prompt, chosen)) return true; for (let j = k; j < order.length; j++) { chosen.push(order[j]); if (dfs(j + 1)) return true; chosen.pop(); } return false; };
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
  return Engine.botAnswer(prompt, state, data, Engine.makeBotMemory());
}

// Cards of the other pool currently sitting in a player's zones (control
// changes). The two pools are disjoint, so this is exact for zone entries;
// overlay units are counted through their host entry (a foreign host's
// units are the foreign player's cards in every flow in this pool).
function foreignCounts(state, pools) {
  const foreign = [0, 0];
  for (let p = 0; p < 2; p++) {
    const P = state.players[p];
    const scan = (entries, withMats) => {
      for (const e of entries) {
        if (!e) continue;
        const code = typeof e === 'object' ? e.code : e;
        if (code && pools[1 - p].has(code)) { foreign[p]++; if (withMats) foreign[p] += (e.materials || 0); }
      }
    };
    scan(P.hand, false); scan(P.grave, false); scan(P.removed, false);
    scan(P.extra, true); scan(P.mzone, true); scan(P.szone, false);
  }
  return foreign;
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  const pool = expected[0] + expected[1];
  const pools = [new Set(data.decks.ishizu.main.concat(data.decks.ishizu.extra)),
                 new Set(data.decks.gg.main.concat(data.decks.gg.extra))];

  // ---------------- Duel A: the swap duel (seed 99)
  {
    installSeededCrypto(99 * 2654435761 % 4294967296);
    const R = rng(99 * 7919 + 13);
    let swapMsgs = 0, censusBad = 0, totalsBad = 0, graveIdBad = 0, prompts = 0, firstBad = '';
    let duel;
    const scanCount = (p, loc, max) => {
      let n = 0;
      for (let s = 0; s < max; s++) { if (duel.queryCard(p, loc, s)) n++; else break; }
      return n;
    };
    const census = (prompt, state) => {
      prompts++;
      try { duel.refreshFieldStats(); } catch (e) {} // client path: resync before judging
      for (let p = 0; p < 2; p++) {
        const P = state.players[p];
        const core = { deck: scanCount(p, LOC.DECK, 60), hand: scanCount(p, LOC.HAND, 30),
                       grave: scanCount(p, LOC.GRAVE, 80), rem: scanCount(p, LOC.REMOVED, 40),
                       extra: scanCount(p, LOC.EXTRA, 20) };
        const mir = { deck: P.deckCount, hand: P.hand.length, grave: P.grave.length, rem: P.removed.length, extra: P.extra.length };
        for (const k of Object.keys(core)) {
          if (core[k] !== mir[k]) { censusBad++; if (!firstBad) firstBad = 'P' + p + ' ' + k + ' core=' + core[k] + ' mirror=' + mir[k] + ' at ' + prompt.name + ' turn=' + state.turnCount; }
        }
        // grave identities, per sequence (post-resync they must be the core's)
        for (let s = 0; s < P.grave.length; s++) {
          const q = duel.queryCard(p, LOC.GRAVE, s);
          if (!q || q.code !== P.grave[s]) graveIdBad++;
        }
      }
      const foreign = foreignCounts(state, pools);
      if (state.totalCards(0) + state.totalCards(1) !== pool) totalsBad++;
      for (let p = 0; p < 2; p++)
        if (state.totalCards(p) - expected[p] !== foreign[p] - foreign[1 - p]) totalsBad++;
    };
    duel = new Engine.Duel(M, data, {
      seed: 99, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      onMessage: (m) => { if (m[0] === 35) swapMsgs++; },
      humanAnswerer: async (prompt, state) => { census(prompt, state); return exploreAnswer(prompt, state, data, R); },
      botAnswerer: (prompt, state) => { census(prompt, state); return exploreAnswer(prompt, state, data, R); },
    });
    const stats = await duel.run();
    console.log('duel A (seed 99): swaps=' + swapMsgs + ' prompts=' + prompts + ' retries=' + stats.retries +
      ' censusBad=' + censusBad + ' totalsBad=' + totalsBad + ' graveIdBad=' + graveIdBad +
      ' final=' + JSON.stringify([duel.state.totalCards(0), duel.state.totalCards(1)]));
    if (firstBad) console.log('  first census divergence: ' + firstBad);
    ok(swapMsgs >= 2, 'A1: Exchange of the Spirit resolved for both players (MSG_SWAP_GRAVE_DECK x' + swapMsgs + ')');
    ok(censusBad === 0, 'A2: mirror pile sizes == core census at every prompt');
    ok(graveIdBad === 0, 'A3: mirror grave identities == core at every prompt (swap resync works)');
    ok(totalsBad === 0, 'A4: combined + control-adjusted per-seat totals exact at every prompt');
    ok(stats.retries === 0 && duel.over, 'A5: duel completes, MSG_RETRY == 0');
    ok(duel.state.totalCards(0) === expected[0] && duel.state.totalCards(1) === expected[1], 'A6: final totals exact (swapped deck drained without inflation)');
  }

  // ---------------- Duel B: batch-boundary transit gate (seed 3)
  {
    installSeededCrypto(3 * 2654435761 % 4294967296);
    const R = rng(3 * 7919 + 13);
    let badBatches = 0, batches = 0;
    const duel = new Engine.Duel(M, data, {
      seed: 3, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      onUpdate: (state) => { batches++; if (state.totalCards(0) + state.totalCards(1) !== pool) badBatches++; },
      humanAnswerer: async (prompt, state) => exploreAnswer(prompt, state, data, R),
      botAnswerer: (prompt, state) => exploreAnswer(prompt, state, data, R),
    });
    const stats = await duel.run();
    console.log('duel B (seed 3): batches=' + batches + ' badBatches=' + badBatches + ' retries=' + stats.retries);
    ok(badBatches === 0, 'B1: combined total == pool at every batch boundary (overlay transit)');
    ok(stats.retries === 0 && duel.over, 'B2: duel completes, MSG_RETRY == 0');
  }

  console.log(failures === 0 ? 'ALL SWAP CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
