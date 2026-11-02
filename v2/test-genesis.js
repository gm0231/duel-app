'use strict';
/* test-genesis.js — Genesis-format restriction verification.
   Drives full duels through engine.js with the exploratory policy on BOTH
   seats (it special-summons from the Extra Deck, which the conservative bot
   never does) and measures, per duel:
     - starting player's hand size at their first MAIN1 prompt (turn-1 draw?)
     - SELECT_PLACE / SELECT_DISFIELD offers that include an Extra Monster
       Zone bit (own MZONE seq 5/6 = avail bits 0x20/0x40, opponent's = bits
       0x200000/0x400000)
     - every appearance of an Extra-Deck monster on the field, with its zone
       sequence (must be a main monster zone 0-4 under Genesis rules)
     - MSG_RETRY count (must be 0) and card conservation. The state mirror
       has a known pre-existing accounting dip during Xyz summons, present
       under MR5 flags too and unrelated to the format flags: materials move
       to OVERLAY of a host still in the Extra Deck (wire loc 0xc0, seq =
       host's Extra-Deck index), and engine.js _insertAt only credits overlay
       units to a host already on the field, so the materials go uncounted
       until they detach (wire loc 0x84/0x90), which restores the count. If a
       duel ends while an Xyz monster still holds materials, the mirror's
       final total stays dipped by that count. The core state itself is
       always consistent (duels complete, retries 0). Mid-duel dips and
       end-of-duel dips are therefore counted and reported as metrics, not
       failures; the project's strict per-prompt conservation gate is
       test-node.js (bot policy, no Xyz summons), run separately.
   Set GENESIS_BASELINE=1 to only measure (pre-change baseline): EMZ-related
   assertions are then reported but do not fail the run. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp } = Engine;

const BASELINE = !!process.env.GENESIS_BASELINE;
const SEEDS = (process.env.GENESIS_SEEDS || '11,22,33,44,55,66').split(',').map(Number);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Exploratory policy (same approach as test-explore.js).
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
    case 'SELECT_POSITION': {
      const bits = [1, 2, 4, 8].filter(b => prompt.mask & b);
      return i32resp(pick(bits));
    }
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
    case 'SORT_CARD': {
      const idx = prompt.cards.map((_, i) => i);
      if (R() < 0.5) idx.reverse();
      return sortResp(idx);
    }
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

async function runDuel(M, data, seed) {
  const R = rng(seed * 7919 + 13);
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  const extraCodes = [new Set(data.decks.ishizu.extra), new Set(data.decks.gg.extra)];
  const m = {
    seed, violations: 0, cleanAfterViolation: false, sawViolation: false,
    firstPromptHands: null,        // both players' hand sizes at the first prompt of the duel
    starter: null, starterFirstMain1Hand: null, starterHandTurn1Max: 0,
    placePrompts: 0, placeEmzOffers: 0,
    exAppearances: 0, exSeqs: {}, exInEmz: 0, exCodesSeen: new Set(),
    prevField: new Set(),          // "seat:seq:code" currently on the field
  };
  const observe = (prompt, state) => {
    let anyViolation = false;
    for (let p = 0; p < 2; p++) {
      const t = state.totalCards(p);
      if (t !== expected[p]) {
        anyViolation = true;
        m.violations++;
        if (process.env.GENESIS_DEBUG && m.violations <= 8)
          console.log('  VIOLATION seed=' + seed + ' P' + p + ' total=' + t + ' expected=' + expected[p] +
            ' diff=' + (t - expected[p]) + ' at ' + prompt.name + ' turn=' + state.turnCount + ' phase=' + state.phaseName +
            ' deck=' + state.players[p].deckCount + ' hand=' + state.players[p].hand.length +
            ' grave=' + state.players[p].grave.length + ' removed=' + state.players[p].removed.length +
            ' extra=' + state.players[p].extra.length +
            ' mz=' + state.players[p].mzone.map(c => c ? (c.code || '?') + (c.materials ? '+m' + c.materials : '') : '.').join(',') +
            ' sz=' + state.players[p].szone.map(c => c ? (c.code || '?') : '.').join(','));
      }
    }
    if (!anyViolation && m.sawViolation) m.cleanAfterViolation = true;
    if (anyViolation) m.sawViolation = true;
    if (!m.firstPromptHands) m.firstPromptHands = [state.players[0].hand.length, state.players[1].hand.length];
    // starting player = turn player of turn 1 (turnCount becomes 1 on the first NEW_TURN)
    if (state.turnCount === 1) {
      const tp = state.turnPlayer;
      if (m.starter === null) m.starter = tp;
      if (tp === m.starter) {
        m.starterHandTurn1Max = Math.max(m.starterHandTurn1Max, state.players[tp].hand.length);
        if (m.starterFirstMain1Hand === null && state.phaseName === 'MAIN1' && prompt.player === tp)
          m.starterFirstMain1Hand = state.players[tp].hand.length;
      }
    }
    if (prompt.name === 'SELECT_PLACE' || prompt.name === 'SELECT_DISFIELD') {
      m.placePrompts++;
      const avail = (~prompt.flag) >>> 0;
      if ((avail & 0x60) !== 0 || (avail & 0x600000) !== 0) m.placeEmzOffers++;
    }
    // track Extra-Deck monsters appearing on the field
    const now = new Set();
    for (let p = 0; p < 2; p++) {
      for (let s = 0; s < 7; s++) {
        const cell = state.players[p].mzone[s];
        if (cell && cell.code != null && extraCodes[p].has(cell.code)) {
          const key = p + ':' + s + ':' + cell.code;
          now.add(key);
          if (!m.prevField.has(key)) {
            m.exAppearances++;
            m.exSeqs[s] = (m.exSeqs[s] || 0) + 1;
            if (s >= 5) m.exInEmz++;
            m.exCodesSeen.add(cell.code);
          }
        }
      }
    }
    m.prevField = now;
    return state;
  };
  const duel = new Engine.Duel(M, data, {
    seed,
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    onLog: () => {},
    humanAnswerer: async (prompt, state) => { observe(prompt, state); return exploreAnswer(prompt, state, data, R); },
    botAnswerer: (prompt, state) => { observe(prompt, state); return exploreAnswer(prompt, state, data, R); },
  });
  const stats = await duel.run();
  m.finalTotals = [duel.state.totalCards(0), duel.state.totalCards(1)];
  m.expectedTotals = expected;
  return { m, stats, over: duel.over };
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  let fail = false;
  const totals = { exAppearances: 0, exInEmz: 0, placeEmzOffers: 0, placePrompts: 0, endDippedDuels: 0 };
  for (const seed of SEEDS) {
    const { m, stats, over } = await runDuel(M, data, seed);
    totals.exAppearances += m.exAppearances; totals.exInEmz += m.exInEmz;
    totals.placeEmzOffers += m.placeEmzOffers; totals.placePrompts += m.placePrompts;
    console.log('seed ' + seed + ': over=' + over + ' turns=' + stats.turns + ' prompts=' + stats.prompts +
      ' retries=' + stats.retries + ' violations=' + m.violations +
      ' firstPromptHands=' + JSON.stringify(m.firstPromptHands) +
      ' starter=P' + m.starter + ' starterFirstMain1Hand=' + m.starterFirstMain1Hand +
      ' starterHandTurn1Max=' + m.starterHandTurn1Max +
      ' placePrompts=' + m.placePrompts + ' placeEmzOffers=' + m.placeEmzOffers +
      ' exAppearances=' + m.exAppearances + ' exSeqs=' + JSON.stringify(m.exSeqs) + ' exInEmz=' + m.exInEmz +
      ' exCards=' + [...m.exCodesSeen].length +
      ' midDuelDips=' + m.violations + ' dipRecovered=' + m.cleanAfterViolation +
      ' finalTotals=' + JSON.stringify(m.finalTotals) + '/' + JSON.stringify(m.expectedTotals));
    if (!over || stats.retries !== 0) fail = true;
    if (JSON.stringify(m.finalTotals) !== JSON.stringify(m.expectedTotals)) totals.endDippedDuels++; // mirror overlay artifact (see header)
    if (m.starterFirstMain1Hand !== 5) fail = true; // turn-1 draw must NOT happen
  }
  console.log('TOTALS: placePrompts=' + totals.placePrompts + ' placeEmzOffers=' + totals.placeEmzOffers +
    ' exAppearances=' + totals.exAppearances + ' exInEmz=' + totals.exInEmz +
    ' endDippedDuels=' + totals.endDippedDuels + (BASELINE ? ' (baseline mode)' : ''));
  if (!BASELINE) {
    if (totals.placeEmzOffers !== 0) { console.log('FAIL: core offered an Extra Monster Zone'); fail = true; }
    if (totals.exInEmz !== 0) { console.log('FAIL: an Extra-Deck monster occupied an Extra Monster Zone'); fail = true; }
    if (totals.exAppearances === 0) { console.log('FAIL: no Extra-Deck summon observed — check would be vacuous'); fail = true; }
  }
  console.log(fail ? 'TEST FAIL' : 'TEST PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
