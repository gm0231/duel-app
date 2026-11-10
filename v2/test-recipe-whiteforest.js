'use strict';
/* test-recipe-whiteforest.js — the White Forest deck addition
   (2026-11-08): the 4th-place list from the official 2026-08-08
   GENESYS event (Elfennotes + White Forest + /Buster), rebuilt
   from 151pt to 100pt under the current 2026-10-01 list by
   cutting the /Buster axis, 《燿ける聖詩の獄神精》 and the
   Elfennotes compression, and adding the White Forest S/T
   circulation cards (the frozen recipe and the full rationale
   are ~/workspace/yugioh/recipe_whiteforest_v2.txt; the base
   list is recipe_whiteforest_v1.txt). Adopted as a
   Genesys-category built-in (data.json decks.whiteforest,
   category 'genesys'), 33 distinct cards of which 31 are newly
   implemented in the pool (89 -> 144 together with Elfennotes).
   The 33pt signature 《白き森の魔女》 is kept at 1 copy.
   Contract under test:
   - deck composition card for card against the frozen recipe
     (main 40 / extra 15);
   - the deck validates Genesis-legal at 100pt under the bundled
     202610 list and is fully pool-supported;
   - every distinct recipe card carries CDB data, a verbatim
     script, a Japanese name and a Japanese text in data.json;
   - the new scripts actually run: 《白き森の魔女》 is activated
     for real, a scripted Synchro summon of 《白き森の魔性
     ルシエラ》 from 《白き森のシルヴィ》 + 《白き森のリゼット》,
     exploratory-policy duels that put the deck's Synchro
     monsters on the field and activate the Witch on the real
     deck, and full bot duels on the real decks (both
     directions + cross-matchups + mirror) completing cleanly. */
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

// ---------- 1. deck composition (the frozen recipe) ----------
const EXPECT_MAIN = {
  4398189: 1, 61980241: 3, 25592142: 3, 98385955: 2, 24779554: 2,
  60145298: 2, 23151193: 1, 13597785: 2, 59581480: 1, 85976588: 1,
  29726552: 3, 64491754: 2, 99289828: 2, 35778533: 3, 3496543: 3,
  24092792: 1, 50590801: 1, 62995268: 1, 18158393: 2, 94192409: 2,
  29401950: 2,
};
const EXPECT_EXTRA = {
  5914858: 2, 77313225: 2, 5800323: 1, 41924516: 1, 50954680: 1,
  821049: 1, 70913714: 1, 21281085: 1, 44508094: 1, 72444406: 1,
  64880894: 2, 82633039: 1,
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
const wf = data.decks.whiteforest;
ok(!!wf && wf.category === 'genesys', 'S1: decks.whiteforest exists with category genesys');
ok(JSON.stringify(count(wf.main)) === JSON.stringify(EXPECT_MAIN) && wf.main.length === 40,
  'S2: whiteforest main = the frozen 40-card recipe, card for card');
ok(JSON.stringify(count(wf.extra)) === JSON.stringify(EXPECT_EXTRA) && wf.extra.length === 15,
  'S3: whiteforest extra = the frozen 15-card recipe, card for card');
ok(data.decks.ishizu.main.length === 45 && data.decks.ishizu.extra.length === 15 &&
   data.decks.gg.main.length === 40 && data.decks.gg.extra.length === 15 &&
   data.decks.superquant.main.length === 40 && data.decks.superquant.extra.length === 11 &&
   data.decks.elfennotes.main.length === 40 && data.decks.elfennotes.extra.length === 15,
  'S4: the pre-existing decks are untouched (45/15, 40/15, 40/11, 40/15)');

// ---------- 2. Genesis legality + pool support ----------
NeuronLib.setData(genesys);
{
  const val = NeuronLib.validateGenesis({ main: wf.main, extra: wf.extra, side: [], names: data.names });
  ok(val.ok && val.totalPt === 100, 'S5: validateGenesis — legal at 100pt under the bundled 202610 list (got ' + val.totalPt + 'pt, ok=' + val.ok + ')');
  const pool = new Set(Object.keys(data.cards).map(Number));
  const pc = NeuronLib.poolCheck({ main: wf.main, extra: wf.extra }, pool);
  ok(pc.ok && pc.unsupported.length === 0, 'S6: every recipe card is pool-supported');
}

// ---------- 3. every distinct recipe card is fully implemented ----------
const DISTINCT = [...new Set([...wf.main, ...wf.extra])];
ok(DISTINCT.length === 33, 'S7: the recipe spans 33 distinct cards (got ' + DISTINCT.length + ')');
ok(Object.keys(data.cards).length === 147, 'S8: the pool is now 147 cards (was 89; 144 after this deck, 146 with the Ishizu v12 additions, 147 with the v13 Magic Card printing)');
for (const pc of DISTINCT) {
  const c = data.cards[pc];
  ok(!!c && !!data.scripts['c' + pc + '.lua'] && !!data.names[pc] && !!data.texts[pc] && !!data.texts[pc].text,
    'S9.' + pc + ': data + script + name + text present (' + (data.names[pc] || '?') + ')');
}

// ---------- helpers (same approach as test-recipe-superquant) ----------
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

// ---------- 4a. scripted: 《白き森の魔女》 activation ----------
const WITCH = 4398189;
{
  let fired = false;
  const M = await factory();
  for (let seed = 1; seed <= 20 && !fired; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    let saw = false;
    const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
      if ((state.events || []).some(e => e.kind === 'activate' && e.code === WITCH && e.con === 0)) saw = true;
      if (prompt.name === 'SELECT_IDLECMD') {
        const ai = prompt.activate.findIndex(e => e.code === WITCH);
        if (ai >= 0) return cmdResp(5, ai); // activate the Witch from hand
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return undefined;
    });
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: rep(WITCH, 40), extra: [] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => policy(0)(prompt, state),
      botAnswerer: (prompt, state) => policy(1)(prompt, state),
    });
    try {
      const stats = await duel.run();
      if (saw && duel.over && stats.retries === 0) { fired = true; console.log('witch scenario: 《白き森の魔女》 activation observed on seed ' + seed); }
    } catch (e) { console.log('witch scenario seed', seed, 'threw:', e.message); }
  }
  ok(fired, 'S10a: 《白き森の魔女》 is activated from the hand for real (field-spell activation + its resolution run clean)');
}

// ---------- 4b. scripted Synchro: Silvi + Lizette -> Luciela ----------
// Lizette special-summons herself by her own ①, which costs an
// S/T sent to the GY — the rigged deck therefore carries
// 《白き森の罪宝》 as fodder (a monsters-only build can never
// field both materials on one turn, as a first probe showed).
const SILVI = 98385955, LIZETTE = 61980241, ZAIHOU = 3496543, LUCIELA = 77313225;
{
  let done = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !done; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    let sawSynchro = false;
    const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
      if ((state.events || []).some(e => e.kind === 'spsummon' && e.con === 0 && e.code === LUCIELA)) sawSynchro = true;
      if (prompt.name === 'SELECT_IDLECMD') {
        const xi = prompt.spsummon.findIndex(e => e.code === LUCIELA);
        if (xi >= 0) return cmdResp(1, xi); // Synchro Summon Luciela
        const li = prompt.activate.findIndex(e => e.code === LIZETTE);
        if (li >= 0) return cmdResp(5, li); // Lizette's hand ignition (SS herself)
        const si = prompt.summon.findIndex(e => e.code === SILVI || e.code === LIZETTE);
        if (si >= 0) return cmdResp(0, si); // normal summon a material
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return undefined;
    });
    const deck = [...rep(SILVI, 14), ...rep(LIZETTE, 14), ...rep(ZAIHOU, 12)];
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: deck, extra: rep(LUCIELA, 3) }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => policy(0)(prompt, state),
      botAnswerer: (prompt, state) => policy(1)(prompt, state),
    });
    try {
      const stats = await duel.run();
      if (sawSynchro && duel.over && stats.retries === 0) { done = true; console.log('synchro scenario: Luciela Synchro summon observed on seed ' + seed); }
    } catch (e) { console.log('synchro scenario seed', seed, 'threw:', e.message); }
  }
  ok(done, 'S10b: Silvi (Lv4 Tuner) + Lizette (Lv2) Synchro-summon 《白き森の魔性ルシエラ》 for real');
}

// ---------- 5. exploratory duels on the real deck ----------
{
  const EX_CODES = new Set(Object.keys(EXPECT_EXTRA).map(Number));
  const M = await factory();
  let exSeen = false, witchSeen = false, cleanDuel = false;
  for (let seed = 1; seed <= 30 && !(exSeen && witchSeen && cleanDuel); seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const R = rng(seed * 97 + 13);
    let sawEx = false, sawWitch = false;
    const track = (state) => {
      for (const e of state.events || []) {
        if (e.kind === 'spsummon' && EX_CODES.has(e.code)) sawEx = true;
        if (e.kind === 'activate' && e.code === WITCH) sawWitch = true;
      }
    };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: data.decks.whiteforest, deckP1: data.decks.ishizu,
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
      botAnswerer: (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
    });
    try {
      const stats = await duel.run();
      if (duel.over && stats.retries === 0) { cleanDuel = true; if (sawEx) exSeen = true; if (sawWitch) witchSeen = true; console.log('explore duel seed ' + seed + ': clean, turns=' + stats.turns + ', EX summon=' + sawEx + ', witch activation=' + sawWitch); }
    } catch (e) { console.log('explore duel seed', seed, 'threw:', e.message); }
  }
  ok(cleanDuel, 'S11: exploratory duel on the real White Forest deck completes with 0 retries');
  ok(exSeen, 'S12: an exploratory duel special-summons one of the deck\'s Extra Deck monsters (Synchro / Castel)');
  ok(witchSeen, 'S12b: an exploratory duel on the real deck activates 《白き森の魔女》');
}

// ---------- 6. full bot duels on the real decks ----------
{
  const M = await factory();
  const runs = [
    ['whiteforest (P0) vs ishizu', data.decks.whiteforest, data.decks.ishizu, 41],
    ['ishizu (P0) vs whiteforest', data.decks.ishizu, data.decks.whiteforest, 42],
    ['whiteforest (P0) vs elfennotes', data.decks.whiteforest, data.decks.elfennotes, 43],
    ['gg (P0) vs whiteforest', data.decks.gg, data.decks.whiteforest, 44],
    ['whiteforest mirror', data.decks.whiteforest, data.decks.whiteforest, 45],
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

console.log(failures ? failures + ' WHITEFOREST CHECK(S) FAILED' : 'ALL WHITEFOREST CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
