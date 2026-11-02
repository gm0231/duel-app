'use strict';
/* test-cpu.js — CPU policy verification (CPU phase, v2/NOTES.md).
 *
 * 1. FAIR-VIEW unit checks: on a captured live state, Engine.botView must
 *    mask the opponent's hand codes and face-down card codes while keeping
 *    the bot's own and all public information.
 * 2. MIRROR MATCHES: the NEW policy (Engine.botAnswer) vs the OLD legality-
 *    only policy (verbatim copy below, harness-only — it is NOT part of
 *    engine.js anymore), 40 duels: {new at seat 0, new at seat 1} x
 *    {decks normal, decks swapped}, 10 seeds each. Both seats get live
 *    stats refreshed before answering, so neither side has an information
 *    edge. Reports win rates, average turns, and per-policy activity
 *    (summons / attacks declared / effect activations per duel), enforces
 *    a per-duel prompt budget, MSG_RETRY == 0 and exact card conservation.
 */
const fs = require('fs');
const path = require('path');

const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp, sumSelectionValid, POS, LOC, Reader } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// Deterministic deck shuffles per duel (same scheme as test-overlay.js):
// the core seed alone does not fix the client-side shuffle.
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => {
    for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; }
    return a;
  } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

// ---------------------------------------------------------------- old policy
// Verbatim copy of the pre-CPU-phase botAnswer/makeBotMemory from
// engine.js@a28cf9d (only the two function names are prefixed). Kept ONLY
// as the mirror-match baseline; the shipped policy is Engine.botAnswer.
function oldMakeBotMemory() { return { summonedYet: false }; }
function oldBotAnswer(prompt, state, data, mem) {
  const cards = data.cards;
  switch (prompt.name) {
    case 'SELECT_CHAIN':
      return i32resp(prompt.forced ? 0 : -1);
    case 'SELECT_IDLECMD': {
      if (!mem.summonedYet) {
        const idx = prompt.summon.findIndex(e => (cards[e.code] && (cards[e.code].level || 0) <= 4));
        if (idx >= 0) { mem.summonedYet = true; return cmdResp(0, idx); }
      }
      if (prompt.toEP) return cmdResp(7, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      return cmdResp(7, 0);
    }
    case 'SELECT_BATTLECMD': {
      if (prompt.attack.length) return cmdResp(1, 0);
      if (prompt.toEP) return cmdResp(3, 0);
      if (prompt.toM2) return cmdResp(2, 0);
      return cmdResp(3, 0);
    }
    case 'SELECT_POSITION': {
      for (const p of [POS.FU_ATK, POS.FU_DEF, POS.FD_ATK, POS.FD_DEF]) if (prompt.mask & p) return i32resp(p);
      return i32resp(prompt.mask);
    }
    case 'SELECT_CARD': case 'SELECT_TRIBUTE': {
      if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
      let picks = [];
      if (prompt.name === 'SELECT_TRIBUTE') {
        const order = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[a].releaseParam - prompt.cards[b].releaseParam);
        let sum = 0;
        for (const i of order) { if (sum >= prompt.min) break; picks.push(i); sum += prompt.cards[i].releaseParam; }
      } else {
        for (let i = 0; i < Math.min(prompt.min, prompt.cards.length); i++) picks.push(i);
      }
      return cardsResp(picks);
    }
    case 'SELECT_UNSELECT_CARD': {
      if (prompt.finishable || prompt.cancelable) return cancelResp();
      return unselectToggleResp(0);
    }
    case 'SELECT_SUM': {
      // greedy DFS for a valid subset (small n in practice)
      const n = prompt.cards.length;
      const chosen = [];
      const dfs = (start) => {
        if (sumSelectionValid(prompt, chosen)) return true;
        if (chosen.length >= Math.min(prompt.max || n, n) && prompt.mode === 'exact') return false;
        for (let i = start; i < n; i++) {
          chosen.push(i);
          if (dfs(i + 1)) return true;
          chosen.pop();
        }
        return false;
      };
      dfs(0);
      return cardsResp(chosen);
    }
    case 'SELECT_COUNTER': {
      const amounts = prompt.cards.map(() => 0);
      let remaining = prompt.count;
      prompt.cards.forEach((c, i) => { const take = Math.min(remaining, c.count); amounts[i] = take; remaining -= take; });
      return counterResp(amounts);
    }
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
      const avail = (~prompt.flag) >>> 0;
      const zones = [];
      const order = [2, 3, 1, 4, 0, 5, 6];
      for (const s of order) { if (zones.length >= prompt.count) break; if (avail & (1 << s)) zones.push({ con: prompt.player, loc: LOC.MZONE, seq: s }); }
      for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x100 << s)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: s });
      for (const s of order) { if (zones.length >= prompt.count) break; if (avail & (0x10000 << s)) zones.push({ con: 1 - prompt.player, loc: LOC.MZONE, seq: s }); }
      for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x1000000 << s)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: s });
      // pendulum-zone bits (own 14/15 -> szone 6/7, opp 30/31)
      if (zones.length < prompt.count && (avail & 0x4000)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: 6 });
      if (zones.length < prompt.count && (avail & 0x8000)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: 7 });
      if (zones.length < prompt.count && (avail & 0x40000000)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: 6 });
      if (zones.length < prompt.count && (avail & 0x80000000)) zones.push({ con: 1 - prompt.player, loc: LOC.SZONE, seq: 7 });
      return placeResp(zones.slice(0, prompt.count));
    }
    case 'SELECT_YESNO': case 'SELECT_EFFECTYN': return i32resp(0);
    case 'SELECT_OPTION': return i32resp(0);
    case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
    case 'SORT_CHAIN': return cancelResp();
    case 'ROCK_PAPER_SCISSORS': return i32resp(1);
    case 'ANNOUNCE_RACE': {
      let lo = 0, hi = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.availLo & (1 << b)) { lo |= (1 << b); need--; }
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.availHi & (1 << b)) { hi |= (1 << b); need--; }
      return u64resp(lo, hi);
    }
    case 'ANNOUNCE_ATTRIB': {
      let mask = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) if (prompt.avail & (1 << b)) { mask |= (1 << b); need--; }
      return i32resp(mask);
    }
    case 'ANNOUNCE_CARD': return i32resp(data.decks.ishizu.main[0]);
    case 'ANNOUNCE_NUMBER': return i32resp(0);
  }
  return i32resp(0);
}

// ---------------------------------------------------------------- harness
const PROMPT_BUDGET = 6000;

async function runMirrorDuel(M, data, cfg) {
  // cfg: { newSeat: 0|1, swap: bool, seed: number }
  installSeededCrypto(cfg.seed * 2654435761 % 4294967296);
  const deckP0 = cfg.swap ? data.decks.gg : data.decks.ishizu;
  const deckP1 = cfg.swap ? data.decks.ishizu : data.decks.gg;
  const expected = [deckP0.main.length + deckP0.extra.length, deckP1.main.length + deckP1.extra.length];
  const policies = [null, null];
  policies[cfg.newSeat] = { name: 'new', answer: Engine.botAnswer, mem: Engine.makeBotMemory() };
  policies[1 - cfg.newSeat] = { name: 'old', answer: oldBotAnswer, mem: oldMakeBotMemory() };
  const act = { new: { summons: 0, attacks: 0, activations: 0 }, old: { summons: 0, attacks: 0, activations: 0 } };
  const prompts = [0, 0];
  let duelRef = null;
  const onMessage = (m) => {
    const t = m[0];
    if (t === 54 || t === 60 || t === 62 || t === 64) { // SET / SUMMONING / SPSUMMONING / FLIPSUMMONING
      const r = new Reader(m, 1); r.u32(); const li = r.locInfo();
      act[policies[li.con].name].summons++;
    } else if (t === 70) { // CHAINING
      const r = new Reader(m, 1); r.u32(); const li = r.locInfo();
      act[policies[li.con].name].activations++;
    } else if (t === 110) { // ATTACK
      const r = new Reader(m, 1); const li = r.locInfo();
      act[policies[li.con].name].attacks++;
    }
  };
  const answerFor = (seat) => (prompt, state) => {
    prompts[seat]++;
    if (prompts[0] + prompts[1] > PROMPT_BUDGET) throw new Error('prompt budget exceeded');
    if (duelRef) { try { duelRef.refreshFieldStats(); } catch (e) {} }
    const p = policies[seat];
    return p.answer(prompt, state, data, p.mem);
  };
  const duel = new Engine.Duel(M, data, {
    seed: cfg.seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    deckP0, deckP1, humanTeam: 0,
    onLog: () => {}, onMessage,
    humanAnswerer: async (prompt, state) => answerFor(0)(prompt, state),
    botAnswerer: (prompt, state) => answerFor(1)(prompt, state),
  });
  duelRef = duel;
  let stats = null, error = null;
  try { stats = await duel.run(); } catch (e) { error = e; }
  const totalsOk = duel.state.totalCards(0) === expected[0] && duel.state.totalCards(1) === expected[1];
  // A control-changed card (e.g. Monster Reborn on the opponent's grave)
  // legitimately sits in the other seat's zones at duel end: per-seat
  // totals then deviate by that card while the COMBINED total stays exact
  // (same reasoning as test-overlay's ACTIVATOR batch). Gate on combined;
  // per-seat exactness is reported as a metric.
  const combinedOk = duel.state.totalCards(0) + duel.state.totalCards(1) === expected[0] + expected[1];
  return {
    over: duel.over, winner: duel.state.winner, turns: stats ? stats.turns : duel.state.turnCount,
    retries: stats ? stats.retries : 0, prompts: prompts[0] + prompts[1], act,
    totalsOk, combinedOk, error: error ? String(error && error.message || error) : null,
    stopReason: stats ? stats.stopReason : null,
  };
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

  // ---- 1. fair-view unit checks on a captured live state
  {
    installSeededCrypto(424242 * 2654435761 % 4294967296);
    let snapshot = null;
    const duel = new Engine.Duel(M, data, {
      seed: 424242, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if (!snapshot) {
          for (let p = 0; p < 2 && !snapshot; p++) {
            const P = state.players[p];
            const fd = P.mzone.some(c => c && !(c.pos & 0x5) && c.code) || P.szone.some(c => c && !(c.pos & 0x5) && c.code);
            if (fd && P.hand.length >= 2) snapshot = { state: structuredClone(state), seat: 1 - p, holder: p };
          }
        }
        return Engine.botAnswer(prompt, state, data, Engine.makeBotMemory());
      },
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()),
    });
    await duel.run();
    ok(!!snapshot, 'FAIR: captured a live state with opponent face-down cards and a hand');
    if (snapshot) {
      const { state, seat, holder } = snapshot;
      const view = Engine.botView(state, seat, data);
      const raw = state.players[holder];
      ok(view.hand[holder].every(h => h.code === null), 'FAIR: opponent hand codes are all masked in botView');
      ok(view.hand[seat].every((h, i) => h.code === state.players[seat].hand[i].code), 'FAIR: own hand codes visible in botView');
      let fdMasked = true, fuKept = true;
      for (const loc of ['mzone', 'szone']) {
        raw[loc].forEach((c, s) => {
          if (!c) return;
          const v = view.zones[holder][loc][s];
          if (!(c.pos & 0x5)) { if (!v || v.code !== null) fdMasked = false; }
          else if (!v || v.code !== c.code) fuKept = false;
        });
      }
      ok(fdMasked, 'FAIR: opponent face-down codes masked in botView');
      ok(fuKept, 'FAIR: opponent face-up codes preserved in botView');
      ok(view.grave[holder].join() === raw.grave.join() && view.removed[holder].join() === raw.removed.join(),
         'FAIR: opponent grave/removed (public) preserved in botView');
    }
  }

  // ---- 2. mirror matches: new vs old, 40 duels
  const blocks = [];
  const agg = { newWins: 0, oldWins: 0, duels: 0, turns: 0, turnsNewWin: 0, turnsOldWin: 0,
                maxPrompts: 0, retries: 0, notOver: 0, totalsBad: 0, seatExact: 0, errors: 0,
                act: { new: { summons: 0, attacks: 0, activations: 0 }, old: { summons: 0, attacks: 0, activations: 0 } } };
  for (const newSeat of [0, 1]) for (const swap of [false, true]) {
    const b = { newSeat, swap, w: 0, l: 0, turns: 0 };
    for (let i = 0; i < 10; i++) {
      const r = await runMirrorDuel(M, data, { newSeat, swap, seed: 77000 + (newSeat * 2 + (swap ? 1 : 0)) * 100 + i });
      agg.duels++;
      agg.turns += r.turns; agg.retries += r.retries;
      agg.maxPrompts = Math.max(agg.maxPrompts, r.prompts);
      if (!r.over) agg.notOver++;
      if (!r.combinedOk) agg.totalsBad++;
      if (r.totalsOk) agg.seatExact++;
      if (r.error) { agg.errors++; console.log('  duel error:', r.error); }
      for (const k of ['summons', 'attacks', 'activations']) { agg.act.new[k] += r.act.new[k]; agg.act.old[k] += r.act.old[k]; }
      if (r.winner === newSeat) { agg.newWins++; b.w++; agg.turnsNewWin += r.turns; }
      else if (r.winner === 1 - newSeat) { agg.oldWins++; b.l++; agg.turnsOldWin += r.turns; }
      b.turns += r.turns;
    }
    blocks.push(b);
    console.log('  block newSeat=' + newSeat + ' swap=' + swap + ': new ' + b.w + ' - ' + b.l + ' old, avg turns ' + (b.turns / 10).toFixed(1));
  }
  const n = agg.duels;
  console.log('MIRROR: new ' + agg.newWins + ' - ' + agg.oldWins + ' old over ' + n + ' duels' +
    ' | avg turns ' + (agg.turns / n).toFixed(1) +
    ' (new wins ' + (agg.newWins ? (agg.turnsNewWin / agg.newWins).toFixed(1) : '-') +
    ', old wins ' + (agg.oldWins ? (agg.turnsOldWin / agg.oldWins).toFixed(1) : '-') + ')' +
    ' | max prompts/duel ' + agg.maxPrompts + ' | retries ' + agg.retries);
  console.log('ACTIVITY per duel: new summons ' + (agg.act.new.summons / n).toFixed(2) +
    ' attacks ' + (agg.act.new.attacks / n).toFixed(2) + ' activations ' + (agg.act.new.activations / n).toFixed(2) +
    ' | old summons ' + (agg.act.old.summons / n).toFixed(2) +
    ' attacks ' + (agg.act.old.attacks / n).toFixed(2) + ' activations ' + (agg.act.old.activations / n).toFixed(2));
  ok(agg.notOver === 0 && agg.errors === 0, 'MIRROR: all ' + n + ' duels completed, no stalls (budget ' + PROMPT_BUDGET + ')');
  ok(agg.retries === 0, 'MIRROR: MSG_RETRY == 0 across all duels');
  ok(agg.totalsBad === 0, 'MIRROR: final card conservation (combined) exact in all duels; per-seat exact in ' + agg.seatExact + '/' + n + ' (rest = control-changed card at duel end)');
  ok(agg.newWins >= 28, 'MIRROR: new policy wins the large majority (' + agg.newWins + '/' + n + ' >= 70%)');
  ok(agg.act.new.summons / n >= 3 && agg.act.new.attacks / n >= 3 && agg.act.new.activations / n >= 5,
     'ACTIVITY: new policy is active (summons/attacks/activations per duel above floor)');

  console.log(failures ? failures + ' CHECK(S) FAILED' : 'ALL CPU CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
