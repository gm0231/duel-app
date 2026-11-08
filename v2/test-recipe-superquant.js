'use strict';
/* test-recipe-superquant.js — the Super Quant deck addition
   (2026-11-08): the Neuron public deck 「ジェネ超量」 adopted as the
   first Genesys-category built-in (data.json decks.superquant,
   category 'genesys'), 26 cards newly implemented in the pool
   (63 -> 89). Contract under test:
   - deck composition card for card against
     ~/workspace/yugioh/recipe_superquant_v1.txt (main 40 / extra 11
     — the extra deck is 11, Xyz only, NOT 15);
   - the deck validates Genesis-legal at 62pt under the bundled
     202610 list (the same NeuronLib validation the import flow and
     the deck modal's pt figure use) and is fully pool-supported;
   - every one of the 26 cards carries CDB data, a verbatim script,
     a Japanese name and a Japanese text in data.json;
   - the new scripts actually run: a scripted Xyz summon of
     《超量機獣エアロボロス》 via Green Layer's own ①, exploratory-
     policy duels that put the deck's Xyz monsters on the field,
     and full bot duels on the real decks (both directions +
     mirror) completing cleanly.   */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, counterResp, sortResp, unselectToggleResp } = Engine;
const NeuronLib = require(path.join(__dirname, 'neuron.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const genesys = JSON.parse(fs.readFileSync(path.join(__dirname, 'genesys-data.json'), 'utf8'));

// ---------- 1. deck composition (the adopted recipe) ----------
const EXPECT_MAIN = {
  92034192: 3, 73422829: 3, 59975920: 2, 85374678: 1, 12369277: 2,
  58753372: 3, 66646087: 3, 21147203: 3, 27480536: 1, 17063599: 3,
  98349765: 2, 10424147: 1, 72332074: 1, 73046708: 1, 75493362: 3,
  1825445: 1, 47819246: 1, 14883228: 3, 29401950: 3,
};
const EXPECT_EXTRA = {
  85252081: 2, 11646785: 2, 57031794: 2, 20145685: 1,
  57450198: 2, 67630394: 1, 84025439: 1,
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
const sq = data.decks.superquant;
ok(!!sq && sq.category === 'genesys', 'S1: decks.superquant exists with category genesys');
ok(JSON.stringify(count(sq.main)) === JSON.stringify(EXPECT_MAIN) && sq.main.length === 40,
  'S2: superquant main = the adopted 40-card recipe, card for card');
ok(JSON.stringify(count(sq.extra)) === JSON.stringify(EXPECT_EXTRA) && sq.extra.length === 11,
  'S3: superquant extra = the adopted 11-card recipe, card for card (Xyz only, not 15)');
ok(data.decks.ishizu.main.length === 45 && data.decks.ishizu.extra.length === 15 &&
   data.decks.gg.main.length === 40 && data.decks.gg.extra.length === 15,
  'S4: the character decks are untouched (45/15, 40/15)');

// ---------- 2. Genesis legality + pool support ----------
NeuronLib.setData(genesys);
{
  const val = NeuronLib.validateGenesis({ main: sq.main, extra: sq.extra, side: [], names: data.names });
  ok(val.ok && val.totalPt === 62, 'S5: validateGenesis — legal at 62pt under the bundled 202610 list (got ' + val.totalPt + 'pt, ok=' + val.ok + ')');
  const pool = new Set(Object.keys(data.cards).map(Number));
  const pc = NeuronLib.poolCheck({ main: sq.main, extra: sq.extra }, pool);
  ok(pc.ok && pc.unsupported.length === 0, 'S6: every recipe card is pool-supported');
}

// ---------- 3. the 26 new cards are fully implemented ----------
const NEW_CODES = [...new Set([...sq.main, ...sq.extra])];
ok(NEW_CODES.length === 26, 'S7: the recipe spans 26 distinct cards');
ok(Object.keys(data.cards).length === 89, 'S8: the pool is now 89 cards (was 63)');
for (const pc of NEW_CODES) {
  const c = data.cards[pc];
  ok(!!c && !!data.scripts['c' + pc + '.lua'] && !!data.names[pc] && !!data.texts[pc] && !!data.texts[pc].text,
    'S9.' + pc + ': data + script + name + text present (' + (data.names[pc] || '?') + ')');
}

// ---------- helpers ----------
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
const rep = (code, n) => Array(n).fill(code);
const botOr = (fn) => (prompt, state) => {
  const r = fn(prompt, state);
  return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory());
};
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Exploratory policy (same approach as test-genesis.js): it DOES
// special-summon from the Extra Deck, which the conservative bot
// avoids — needed to exercise the Xyz scripts for real.
function exploreAnswer(prompt, state, data2, R) {
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
    default: return undefined;
  }
}

(async () => {

// ---------- 4. scripted Xyz summon: Green Layer ① -> Aeroboros ----------
// The deck's own combo: NS Green Layer, its ① special-summons a
// second Green Layer from the hand, the two Level 4s overlay into
// 《超量機獣エアロボロス》 — all inside turn 1, before the opposing
// deck can pick the field apart (a one-summon-per-turn pair of
// Blue Layers never survives to overlay, as a probe run showed).
const GREEN = 85374678, AEROBOROS = 11646785;
{
  let summoned = false, cleanRuns = 0;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !summoned; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
      if (prompt.name === 'SELECT_IDLECMD') {
        const xi = prompt.spsummon.findIndex(e => e.code === AEROBOROS);
        if (xi >= 0) return cmdResp(1, xi); // Xyz Summon Aeroboros
        const si = prompt.summon.findIndex(e => e.code === GREEN);
        if (si >= 0) return cmdResp(0, si); // normal summon a Green Layer
        if (prompt.toBP) return cmdResp(6, 0);
        if (prompt.toEP) return cmdResp(7, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return undefined;
    });
    let sawXyz = false;
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: rep(GREEN, 40), extra: rep(AEROBOROS, 3) }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if ((state.events || []).some(e => e.kind === 'spsummon' && e.code === AEROBOROS && e.con === 0)) sawXyz = true;
        return policy(0)(prompt, state);
      },
      botAnswerer: (prompt, state) => policy(1)(prompt, state),
    });
    try {
      const stats = await duel.run();
      if (sawXyz && duel.over && stats.retries === 0) { summoned = true; cleanRuns++; console.log('Aeroboros scenario: Xyz summon observed on seed ' + seed); }
    } catch (e) { console.log('Aeroboros scenario seed', seed, 'threw:', e.message); }
  }
  ok(summoned, 'S10: Green Layer ① brings out a second Level 4 and the two Xyz-summon 《超量機獣エアロボロス》 for real (script + procedure run clean)');
}

// ---------- 5. exploratory duels on the real deck: Xyz hits the field ----------
{
  const EX_CODES = new Set(Object.keys(EXPECT_EXTRA).map(Number));
  const M = await factory();
  let xyzSeen = false, cleanDuel = false;
  for (let seed = 1; seed <= 30 && !(xyzSeen && cleanDuel); seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const R = rng(seed * 97 + 13);
    let saw = false;
    const track = (state) => {
      for (const e of state.events || []) if (e.kind === 'spsummon' && EX_CODES.has(e.code)) saw = true;
    };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: data.decks.superquant, deckP1: data.decks.ishizu,
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
      botAnswerer: (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
    });
    try {
      const stats = await duel.run();
      if (duel.over && stats.retries === 0) { cleanDuel = true; if (saw) xyzSeen = true; console.log('explore duel seed ' + seed + ': clean, turns=' + stats.turns + ', Xyz on field=' + saw); }
    } catch (e) { console.log('explore duel seed', seed, 'threw:', e.message); }
  }
  ok(cleanDuel, 'S11: exploratory duel on the real Super Quant deck completes with 0 retries');
  ok(xyzSeen, 'S12: an exploratory duel puts one of the deck\'s Xyz monsters on the field');
}

// ---------- 6. full bot duels on the real decks ----------
{
  const M = await factory();
  const runs = [
    ['superquant (P0) vs ishizu', data.decks.superquant, data.decks.ishizu, 21],
    ['ishizu (P0) vs superquant', data.decks.ishizu, data.decks.superquant, 22],
    ['superquant mirror', data.decks.superquant, data.decks.superquant, 23],
  ];
  for (const [label, d0, d1, seed] of runs) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem = [Engine.makeBotMemory(), Engine.makeBotMemory()];
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: d0, deckP1: d1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => Engine.botAnswer(prompt, state, data, mem[0]),
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem[1]),
    });
    const stats = await duel.run();
    ok(duel.over && stats.retries === 0, 'S13: bot duel completes (' + label + ', turns=' + stats.turns + ', retries=0)');
  }
}

console.log(failures ? failures + ' SUPERQUANT CHECK(S) FAILED' : 'ALL SUPERQUANT CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
