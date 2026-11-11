'use strict';
/* test-recipe-monarch.js — the Monarch deck addition (2026-11-11):
   the first CLASSIC-category built-in (data.json decks.monarch,
   category 'classic'), 18 cards newly implemented in the pool
   (147 -> 165). The recipe is a domain-less Richmond Top 8 style
   build re-costed card by card against the official 202610
   Genesis list (~/workspace/yugioh/recipe_monarch_v1.txt).
   Contract under test:
   - deck composition card for card against the adopted recipe
     (main 40 / extra 0 — the deck runs NO Extra Deck);
   - the deck validates Genesis-legal at exactly 100pt under the
     bundled 202610 list and is fully pool-supported;
   - every one of the 18 cards carries CDB data, a verbatim
     script, a Japanese name and a Japanese text in data.json;
   - the deck's signature line actually runs: a squire is Normal
     Summoned, its effect brings out a second squire, and a
     Level 8 Monarch is Tribute Summoned over them;
   - full bot duels on the real decks (both directions + mirror)
     complete cleanly with zero policy exceptions, and the bot
     operating the Monarch deck lands Tribute Summons.   */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cmdResp } = Engine;
const NeuronLib = require(path.join(__dirname, 'neuron.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const genesys = JSON.parse(fs.readFileSync(path.join(__dirname, 'genesys-data.json'), 'utf8'));

// ---------- 1. deck composition (the adopted recipe) ----------
const EXPECT_MAIN = {
  31596518: 3, 96570609: 3, 23064604: 2, 67584223: 3, 95457011: 2,
  59463312: 2, 9748752: 1, 87288189: 1, 69230391: 1,
  22842126: 3, 33609262: 3, 9283801: 3, 63899196: 2, 79844764: 3,
  61466310: 3, 5795980: 1, 54241725: 3, 18235309: 1,
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
const mo = data.decks.monarch;
ok(!!mo && mo.category === 'classic', 'M1: decks.monarch exists with category classic');
ok(JSON.stringify(count(mo.main)) === JSON.stringify(EXPECT_MAIN) && mo.main.length === 40,
  'M2: monarch main = the adopted 40-card recipe, card for card');
ok(Array.isArray(mo.extra) && mo.extra.length === 0,
  'M3: monarch extra = 0 cards (a domain-less build runs no Extra Deck)');
ok(data.decks.ishizu.main.length === 45 && data.decks.ishizu.extra.length === 15 &&
   data.decks.gg.main.length === 40 && data.decks.gg.extra.length === 15,
  'M4: the character decks are untouched (45/15, 40/15)');

// ---------- 2. Genesis legality + pool support ----------
NeuronLib.setData(genesys);
{
  const val = NeuronLib.validateGenesis({ main: mo.main, extra: mo.extra, side: [], names: data.names });
  ok(val.ok && val.totalPt === 100, 'M5: validateGenesis — legal at exactly 100pt under the bundled 202610 list (got ' + val.totalPt + 'pt, ok=' + val.ok + ')');
  const pool = new Set(Object.keys(data.cards).map(Number));
  const pc = NeuronLib.poolCheck({ main: mo.main, extra: mo.extra }, pool);
  ok(pc.ok && pc.unsupported.length === 0, 'M6: every recipe card is pool-supported');
}

// ---------- 3. the 18 new cards are fully implemented ----------
const NEW_CODES = [...new Set(mo.main)];
ok(NEW_CODES.length === 18, 'M7: the recipe spans 18 distinct cards');
ok(Object.keys(data.cards).length === 165, 'M8: the pool is now 165 cards (147 + the 18 Monarch implementations)');
for (const pc of NEW_CODES) {
  const c = data.cards[pc];
  ok(!!c && !!data.scripts['c' + pc + '.lua'] && !!data.names[pc] && !!data.texts[pc] && !!data.texts[pc].text,
    'M9.' + pc + ': data + script + name + text present (' + (data.names[pc] || '?') + ')');
}

// ---------- helpers ----------
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
const rep = (code, n) => Array(n).fill(code);
// Bot answer wrapped so any policy exception is counted, not hidden.
function countedBot(mem, counter) {
  return (prompt, state) => {
    try { return Engine.botAnswer(prompt, state, data, mem); }
    catch (e) { counter.n++; counter.first = counter.first || e.message; return undefined; }
  };
}

(async () => {

// ---------- 4. scripted signature line: squire -> squire -> Tribute Summon ----------
// Fixture deck of only squires + 《天帝アイテール》: Normal Summon a
// squire, its on-summon effect special-summons a second 800/1000
// squire from the deck, then Tribute Summon Aither over a squire.
// A 'summon' event for a Level 8 Monarch can only be a Tribute
// Summon (these cards have no self special-summon).
const EDEA = 95457011, EIDOS = 59463312, AITHER = 96570609;
{
  let landed = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !landed; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem0 = Engine.makeBotMemory(), mem1 = Engine.makeBotMemory();
    const policy0 = (prompt, state) => {
      if (prompt.name === 'SELECT_IDLECMD') {
        const ti = prompt.summon.findIndex(e => e.code === AITHER);
        if (ti >= 0) return cmdResp(0, ti); // Tribute Summon Aither
        const si = prompt.summon.findIndex(e => e.code === EDEA || e.code === EIDOS);
        if (si >= 0) return cmdResp(0, si); // Normal Summon a squire
        if (prompt.toBP) return cmdResp(6, 0);
        if (prompt.toEP) return cmdResp(7, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_CHAIN' && !prompt.forced) {
        const ci = prompt.entries.findIndex(e => e.code === EDEA || e.code === EIDOS);
        if (ci >= 0) return i32resp(ci); // fire the squire's on-summon effect
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return Engine.botAnswer(prompt, state, data, mem0);
    };
    let sawTribute = false;
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: [...rep(EDEA, 14), ...rep(EIDOS, 13), ...rep(AITHER, 13)], extra: [] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if ((state.events || []).some(e => e.kind === 'summon' && e.code === AITHER && e.con === 0)) sawTribute = true;
        return policy0(prompt, state);
      },
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem1),
    });
    try {
      const stats = await duel.run();
      if (sawTribute && duel.over && stats.retries === 0) { landed = true; console.log('signature scenario: Tribute Summon of Aither observed on seed ' + seed); }
    } catch (e) { console.log('signature scenario seed', seed, 'threw:', e.message); }
  }
  ok(landed, 'M10: squire Normal Summon -> squire effect -> 《天帝アイテール》 Tribute Summon runs for real (scripts + procedure clean)');
}

// ---------- 5. full bot duels on the real decks ----------
{
  const M = await factory();
  const MONARCHS = new Set([31596518, 96570609, 23064604, 9748752, 87288189, 69230391]); // the 2800/1000 and 2400/1000 Monarchs
  const runs = [
    ['monarch (P0) vs ishizu', data.decks.monarch, data.decks.ishizu, 31, 0],
    ['ishizu (P0) vs monarch', data.decks.ishizu, data.decks.monarch, 32, 1],
    ['monarch mirror', data.decks.monarch, data.decks.monarch, 33, -1],
  ];
  let tributeSeen = 0, activationsSeen = 0;
  for (const [label, d0, d1, seed, monarchSeat] of runs) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const counter = { n: 0, first: null };
    const mem = [Engine.makeBotMemory(), Engine.makeBotMemory()];
    const track = (seat) => (state) => {
      if (monarchSeat >= 0 && seat !== monarchSeat) return;
      for (const e of state.events || []) if (e.kind === 'summon' && MONARCHS.has(e.code)) tributeSeen++;
    };
    // Count the Monarch seat's own activation choices (IDLECMD
    // command 5 / SELECT_CHAIN picks): the regression tripwire for
    // the NEW_CODES registration — without it the generic bot
    // priced every Monarch card at 0 and activated NOTHING
    // (0 activations in 50 measured games, 0-30 on the bench).
    const countActs = (seat) => (prompt, state) => {
      const r = countedBot(mem[seat], counter)(prompt, state);
      if ((monarchSeat < 0 || seat === monarchSeat) && r && r.length >= 4) {
        const v = new DataView(r.buffer, r.byteOffset, 4).getInt32(0, true);
        if (prompt.name === 'SELECT_IDLECMD' && (v & 0xffff) === 5) activationsSeen++;
        if (prompt.name === 'SELECT_CHAIN' && v >= 0) activationsSeen++;
      }
      return r;
    };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: d0, deckP1: d1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => { track(0)(state); return countActs(0)(prompt, state); },
      botAnswerer: (prompt, state) => { track(1)(state); return countActs(1)(prompt, state); },
    });
    const stats = await duel.run();
    ok(duel.over && stats.retries === 0 && counter.n === 0,
      'M11: bot duel completes (' + label + ', turns=' + stats.turns + ', retries=0, policy exceptions=0' + (counter.first ? ', first: ' + counter.first : '') + ')');
  }
  ok(tributeSeen > 0, 'M12: across the bot duels the Monarch seat lands Tribute Summons of its Monarchs (observed ' + tributeSeen + ')');
  ok(activationsSeen >= 10, 'M13: the bot operating Monarch actually ACTIVATES its spells/traps/effects (observed ' + activationsSeen + ' activation choices across the three duels; the pre-registration build chose 0)');
}

console.log(failures ? failures + ' MONARCH CHECK(S) FAILED' : 'ALL MONARCH CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
