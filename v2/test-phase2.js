'use strict';
/* test-phase2.js — Phase 2 engine-level checks:
   A. isDeclarable port matches the core's rule for Gravekeeper's Trap's
      ANNOUNCE_CARD opcodes (declared card must NOT be an Extra-Deck type):
      declarable <=> !(type & TYPE_EXTRA mask 0x4802040), for all 63 pool cards.
   B. Live query (item 2): during exploratory duels, at every prompt boundary
      refreshFieldStats() must agree with the mirror's codes, produce integer
      ATK/DEF, and observe at least one effect-modified ATK or DEF across the
      runs (Titanocider / Lost Wind are in these decks).
   C. Prompt context (item 1): every ANNOUNCE_CARD prompt carries
      context.code === 98715423 (Gravekeeper's Trap).
   D. Seat swap (item 5): a duel with seat 0 = Gate Guardian, seat 1 = Ishizu,
      humanTeam = 1 completes with correct per-seat card totals. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp, u64resp } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
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

function scriptedAnswer(prompt, state, data) {
  switch (prompt.name) {
    case 'SELECT_CHAIN': return i32resp(prompt.forced ? 0 : -1);
    case 'SELECT_IDLECMD': return prompt.toEP ? cmdResp(7, 0) : (prompt.toBP ? cmdResp(6, 0) : cmdResp(7, 0));
    case 'SELECT_BATTLECMD': return prompt.toEP ? cmdResp(3, 0) : (prompt.toM2 ? cmdResp(2, 0) : cmdResp(3, 0));
    case 'SELECT_POSITION': { const bits = [1, 2, 4, 8].filter(b => prompt.mask & b); return i32resp(bits[0]); }
    case 'SELECT_CARD': return cardsResp(prompt.cards.map((_, i) => i).slice(0, prompt.min));
    case 'SELECT_TRIBUTE': {
      const order = prompt.cards.map((c, i) => i).sort((a, b) => prompt.cards[b].releaseParam - prompt.cards[a].releaseParam);
      const picks = []; let sum = 0;
      for (const i of order) { if (sum >= prompt.min || picks.length >= prompt.max) break; picks.push(i); sum += prompt.cards[i].releaseParam; }
      return cardsResp(picks);
    }
    case 'SELECT_UNSELECT_CARD': return (prompt.finishable || prompt.cancelable) ? cancelResp() : unselectToggleResp(0);
    case 'SELECT_SUM': {
      const chosen = [];
      const dfs = (k) => { if (Engine.sumSelectionValid(prompt, chosen)) return true;
        for (let j = k; j < prompt.cards.length; j++) { chosen.push(j); if (dfs(j + 1)) return true; chosen.pop(); } return false; };
      dfs(0); return cardsResp(chosen);
    }
    case 'SELECT_COUNTER': {
      const amounts = prompt.cards.map(() => 0); let rem = prompt.count;
      prompt.cards.forEach((c, i) => { const t = Math.min(rem, c.count); amounts[i] = t; rem -= t; });
      return counterResp(amounts);
    }
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
      const avail = (~prompt.flag) >>> 0; const cells = [];
      const zones = [[prompt.player, 0x04, 1, 7], [prompt.player, 0x08, 0x100, 5], [1 - prompt.player, 0x04, 0x10000, 7], [1 - prompt.player, 0x08, 0x1000000, 5]];
      for (const [con, loc, base, n] of zones) for (let s = 0; s < n; s++) if (avail & (base << s)) cells.push({ con, loc, seq: s });
      return placeResp(cells.slice(0, prompt.count));
    }
    case 'SELECT_YESNO': case 'SELECT_EFFECTYN': return i32resp(1);
    case 'SELECT_OPTION': return i32resp(0);
    case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
    case 'SORT_CHAIN': return cancelResp();
    case 'ROCK_PAPER_SCISSORS': return i32resp(1);
    case 'ANNOUNCE_RACE': { let lo = 0, hi = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) { if (prompt.availLo & (1 << b)) { lo |= (1 << b); need--; } }
      for (let b = 0; b < 32 && need > 0; b++) { if (prompt.availHi & (1 << b)) { hi |= (1 << b); need--; } }
      return u64resp(lo, hi); }
    case 'ANNOUNCE_ATTRIB': { let mask = 0, need = prompt.count;
      for (let b = 0; b < 32 && need > 0; b++) { if (prompt.avail & (1 << b)) { mask |= (1 << b); need--; } }
      return i32resp(mask); }
    case 'ANNOUNCE_CARD': return i32resp(data.decks.ishizu.main[0]);
    case 'ANNOUNCE_NUMBER': return i32resp(0);
  }
  return i32resp(0);
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

  // ---- A. isDeclarable — opcode stream order follows the script's argument
  // list: (TYPE_EXTRA value, OPCODE_ISTYPE, OPCODE_NOT). In this core
  // TYPE_EXTRA = TYPE_FUSION|TYPE_SYNCHRO|TYPE_XYZ|TYPE_LINK = 0x4802040.
  const TYPE_EXTRA_MASK = 0x4802040;
  const GK_OPS = [0x4802040n, 0x4000010200000000n, 0x4000000700000000n];
  const declCheck = (ops) => {
    let bad = 0;
    for (const [code, cd] of Object.entries(data.cards)) {
      const want = !(cd.type & TYPE_EXTRA_MASK);
      const got = Engine.isDeclarable({ code: +code, ...cd }, ops);
      if (got !== want) { bad++; console.log('  declarable mismatch', data.names[code], 'type=0x' + cd.type.toString(16), 'want', want, 'got', got); }
    }
    return bad;
  };
  ok(declCheck(GK_OPS) === 0, 'A: isDeclarable == !(type & TYPE_EXTRA) for all 63 pool cards (script-order opcodes)');

  // ---- B + C. exploratory duels with live-query cross-checks
  let queryChecks = 0, queryCodeMismatch = 0, queryBadValues = 0, modifiedSightings = 0;
  const modifiedExamples = [];
  let announceSeen = 0, announceCtxBad = 0, realOps = null;
  for (const seed of [11, 222]) {
    const R = rng(seed * 104729);
    let duelRef = null;
    const answerer = (prompt, state) => {
      if (prompt.name === 'ANNOUNCE_CARD') {
        announceSeen++;
        if (!prompt.context || prompt.context.code !== 98715423) announceCtxBad++;
        if (!realOps) realOps = prompt.opcodes;
      }
      if (duelRef) {
        duelRef.refreshFieldStats();
        for (let p = 0; p < 2; p++) for (let s = 0; s < 7; s++) {
          const cell = state.players[p].mzone[s];
          if (!cell) continue;
          queryChecks++;
          const q = duelRef.queryCard(p, 0x04, s);
          if (!q || q.code !== cell.code) { queryCodeMismatch++; continue; }
          const cd = data.cards[cell.code];
          if (!Number.isInteger(q.atk) || !Number.isInteger(q.def) || q.atk < -100000 || q.def < -100000) queryBadValues++;
          if (cd && (q.atk !== cd.atk || q.def !== cd.def)) {
            modifiedSightings++;
            if (modifiedExamples.length < 5) modifiedExamples.push(data.names[cell.code] + ' printed ' + cd.atk + '/' + cd.def + ' -> live ' + q.atk + '/' + q.def);
          }
        }
      }
      return exploreAnswer(prompt, state, data, R);
    };
    const duel = new Engine.Duel(M, data, {
      seed: 20261102, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      humanAnswerer: answerer, botAnswerer: answerer,
    });
    duelRef = duel;
    const s = await duel.run();
    console.log('  explore duel (stats seed ' + seed + '): turns', s.turns, 'retries', s.retries, 'winner', duel.state.winner);
    ok(s.retries === 0, 'B0: explore duel retries == 0 (seed ' + seed + ')');
  }
  ok(queryChecks > 100, 'B1: live query cross-checked on ' + queryChecks + ' occupied-zone observations');
  ok(queryCodeMismatch === 0, 'B2: query code always matches the state mirror code');
  ok(queryBadValues === 0, 'B3: query ATK/DEF always sane integers');
  ok(modifiedSightings > 0, 'B4: effect-modified ATK/DEF observed live (' + modifiedSightings + ' sightings) e.g. ' + modifiedExamples.join(' ; '));
  ok(announceSeen >= 1 && announceCtxBad === 0, 'C: ANNOUNCE_CARD prompts (' + announceSeen + ') all carry Gravekeeper\'s Trap context');
  ok(realOps !== null && declCheck(realOps) === 0, 'A2: isDeclarable with the REAL prompt opcode stream [' + (realOps || []).map(o => '0x' + o.toString(16)).join(', ') + '] matches for all 63 cards');

  // ---- D. seat swap: seat0 = GG deck, seat1 = Ishizu deck, human = seat 1
  {
    let totalsBad = 0, promptsSeen = 0;
    const ans = (prompt, state) => {
      promptsSeen++;
      if (state.totalCards(0) !== 55 || state.totalCards(1) !== 58) totalsBad++;
      return scriptedAnswer(prompt, state, data);
    };
    const duel = new Engine.Duel(M, data, {
      seed: 20261102, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: data.decks.gg, deckP1: data.decks.ishizu, humanTeam: 1,
      humanAnswerer: ans, botAnswerer: (p, st) => scriptedAnswer(p, st, data),
    });
    const s = await duel.run();
    console.log('  seat-swap duel: turns', s.turns, 'retries', s.retries, 'winner', duel.state.winner, 'humanPrompts(seat1)', s.humanPrompts, 'botPrompts(seat0)', s.botPrompts);
    ok(duel.state.winner === 0 || duel.state.winner === 1, 'D1: seat-swapped duel completes with a winner');
    ok(s.retries === 0, 'D2: seat-swapped duel retries == 0');
    ok(totalsBad === 0 && promptsSeen > 50, 'D3: per-seat totals stay 55 (GG seat0) / 58 (Ishizu seat1) at all ' + promptsSeen + ' prompts');
    ok(s.humanPrompts > 0 && s.botPrompts > 0, 'D4: prompts routed to both seats (human seat 1 answered ' + s.humanPrompts + ')');
  }

  console.log(failures === 0 ? 'ALL PHASE2 CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
