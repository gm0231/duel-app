'use strict';
/* test-recipe-elfennotes.js — the Elfennotes deck addition
   (2026-11-08): the tournament list piloted by 綾霧 at the
   2026-09-23 Yokohama Genesis 100P event (Neuron public deck,
   dno=452), rebuilt from 109pt to 100pt under the current
   2026-10-01 list by dropping 《幽鬼うさぎ》 and adding a second
   《教導の騎士フルルドリス》 (the frozen recipe is
   ~/workspace/yugioh/recipe_elfennotes_v2.txt). Adopted as a
   Genesys-category built-in (data.json decks.elfennotes,
   category 'genesys'), 34 distinct cards of which 32 are newly
   implemented in the pool (89 -> 144 together with White Forest).
   Contract under test:
   - deck composition card for card against the frozen recipe
     (main 40 / extra 15);
   - the deck validates Genesis-legal at 100pt under the bundled
     202610 list and is fully pool-supported;
   - every distinct recipe card carries CDB data, a verbatim
     script, a Japanese name and a Japanese text in data.json;
   - the new scripts actually run: a scripted theme play
     (《耀聖の花詩ルキナ》 special-summons herself by her own ①
     procedure and Synchro-summons 《クリアウィング・シンクロ・
     ドラゴン》 with 《燿ける聖詩の獄神精》), exploratory-policy
     duels that put the deck's Fusion / Synchro monsters on the
     field, and full bot duels on the real decks (both directions
     + mirror) completing cleanly.                        */
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
  24508238: 3, 67750322: 3, 29726552: 3, 60303688: 3, 73355772: 3,
  69680031: 2, 62849088: 1, 51522296: 1, 12375297: 1, 13597785: 3,
  59581480: 3, 85976588: 1, 31002402: 1, 60921537: 1, 35569555: 3,
  64491754: 1, 59432181: 3, 82956214: 2, 24092792: 1, 50590801: 1,
};
const EXPECT_EXTRA = {
  80532587: 1, 41373230: 1, 76666602: 1, 85065943: 1, 17749468: 2,
  31924889: 1, 42302563: 1, 82044279: 1, 98506199: 1, 72444406: 1,
  78397661: 1, 50954680: 1, 5914858: 1, 53971455: 1,
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
const elf = data.decks.elfennotes;
ok(!!elf && elf.category === 'genesys', 'S1: decks.elfennotes exists with category genesys');
ok(JSON.stringify(count(elf.main)) === JSON.stringify(EXPECT_MAIN) && elf.main.length === 40,
  'S2: elfennotes main = the frozen 40-card recipe, card for card');
ok(JSON.stringify(count(elf.extra)) === JSON.stringify(EXPECT_EXTRA) && elf.extra.length === 15,
  'S3: elfennotes extra = the frozen 15-card recipe, card for card');
ok(data.decks.ishizu.main.length === 45 && data.decks.ishizu.extra.length === 15 &&
   data.decks.gg.main.length === 40 && data.decks.gg.extra.length === 15 &&
   data.decks.superquant.main.length === 40 && data.decks.superquant.extra.length === 11,
  'S4: the pre-existing decks are untouched (45/15, 40/15, 40/11)');

// ---------- 2. Genesis legality + pool support ----------
NeuronLib.setData(genesys);
{
  const val = NeuronLib.validateGenesis({ main: elf.main, extra: elf.extra, side: [], names: data.names });
  ok(val.ok && val.totalPt === 100, 'S5: validateGenesis — legal at 100pt under the bundled 202610 list (got ' + val.totalPt + 'pt, ok=' + val.ok + ')');
  const pool = new Set(Object.keys(data.cards).map(Number));
  const pc = NeuronLib.poolCheck({ main: elf.main, extra: elf.extra }, pool);
  ok(pc.ok && pc.unsupported.length === 0, 'S6: every recipe card is pool-supported');
}

// ---------- 3. every distinct recipe card is fully implemented ----------
const DISTINCT = [...new Set([...elf.main, ...elf.extra])];
ok(DISTINCT.length === 34, 'S7: the recipe spans 34 distinct cards (got ' + DISTINCT.length + ')');
ok(Object.keys(data.cards).length === 165, 'S8: the pool is now 165 cards (was 89; 144 after this deck, 147 with the v13 Magic Card printing, 165 with the Monarch deck)');
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

// ---------- 4. scripted theme play: Rukina procedure -> Clear Wing ----------
const RUKINA = 13597785, GOKUSHINSEI = 12375297, CLEARWING = 82044279;
{
  let done = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !done; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    let sawRukina = false, sawSynchro = false;
    const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
      for (const e of state.events || []) {
        if (e.kind === 'spsummon' && e.con === 0 && e.code === RUKINA) sawRukina = true;
        if (e.kind === 'spsummon' && e.con === 0 && e.code === CLEARWING) sawSynchro = true;
      }
      if (prompt.name === 'SELECT_IDLECMD') {
        const xi = prompt.spsummon.findIndex(e => e.code === CLEARWING);
        if (xi >= 0) return cmdResp(1, xi); // Synchro Summon Clear Wing
        const pi = prompt.spsummon.findIndex(e => e.code === RUKINA);
        if (pi >= 0) return cmdResp(1, pi); // Rukina's own ① procedure
        const si = prompt.summon.findIndex(e => e.code === GOKUSHINSEI);
        if (si >= 0) return cmdResp(0, si); // normal summon the Tuner
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return undefined;
    });
    const deck = [...rep(RUKINA, 20), ...rep(GOKUSHINSEI, 20)];
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: deck, extra: rep(CLEARWING, 3) }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => policy(0)(prompt, state),
      botAnswerer: (prompt, state) => policy(1)(prompt, state),
    });
    try {
      const stats = await duel.run();
      if (sawRukina && sawSynchro && duel.over && stats.retries === 0) { done = true; console.log('theme scenario: Rukina procedure + Clear Wing Synchro observed on seed ' + seed + ' (rukina=' + sawRukina + ')'); }
    } catch (e) { console.log('theme scenario seed', seed, 'threw:', e.message); }
  }
  ok(done, 'S10: Rukina special-summons herself by her own ① procedure and the pair Synchro-summons 《クリアウィング・シンクロ・ドラゴン》 for real');
}

// ---------- 4b. scripted fusion line: Fusion Tag -> Azamina's procedure ----------
// The deck's only Fusion-monster route (per the frozen recipe's
// own notes): 《融合識別》 renames a monster to 《聖アザミナ》,
// and 《贖罪神女》 then special-summons herself from the Extra
// Deck by releasing that renamed monster and one opponent
// face-up monster. No Fusion Spell exists in the deck, so this
// procedure summon is how its Fusion monsters reach the field.
const TAG = 59432181, SAINT = 85065943, AZAMINA = 17749468;
{
  let done = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !done; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    let saw = false;
    const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
      if ((state.events || []).some(e => e.kind === 'spsummon' && e.con === 0 && e.code === AZAMINA)) saw = true;
      if (prompt.name === 'SELECT_IDLECMD') {
        const xi = prompt.spsummon.findIndex(e => e.code === AZAMINA);
        if (xi >= 0) return cmdResp(1, xi); // Azamina's release procedure
        const pi = prompt.spsummon.findIndex(e => e.code === RUKINA);
        if (pi >= 0) return cmdResp(1, pi); // Rukina procedure
        const ai = prompt.activate.findIndex(e => e.code === TAG);
        if (ai >= 0) return cmdResp(5, ai); // Fusion Tag
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_BATTLECMD') {
        if (prompt.toEP) return cmdResp(3, 0);
        if (prompt.toM2) return cmdResp(2, 0);
        return cmdResp(3, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return undefined;
    });
    const deck = [...rep(TAG, 15), ...rep(RUKINA, 25)];
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: deck, extra: [...rep(SAINT, 3), ...rep(AZAMINA, 3)] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => policy(0)(prompt, state),
      botAnswerer: (prompt, state) => policy(1)(prompt, state),
    });
    try {
      const stats = await duel.run();
      if (saw && duel.over && stats.retries === 0) { done = true; console.log('fusion scenario: Azamina procedure summon observed on seed ' + seed); }
    } catch (e) { console.log('fusion scenario seed', seed, 'threw:', e.message); }
  }
  ok(done, 'S10b: Fusion Tag renames Rukina to 《聖アザミナ》 and 《贖罪神女》 special-summons herself by her own release procedure (the deck\'s Fusion route runs for real)');
}

// ---------- 5. exploratory duels on the real deck: EX summons hit the field ----------
{
  const EX_CODES = new Set(Object.keys(EXPECT_EXTRA).map(Number));
  const M = await factory();
  let exSeen = false, kindsSeen = new Set(), cleanDuel = false;
  for (let seed = 1; seed <= 30 && !(exSeen && cleanDuel); seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const R = rng(seed * 97 + 13);
    let saw = false;
    const track = (state) => {
      for (const e of state.events || []) {
        if (e.kind === 'spsummon' && EX_CODES.has(e.code)) {
          saw = true;
          const t = data.cards[e.code].type;
          kindsSeen.add(t & 0x40 ? 'fusion' : t & 0x2000 ? 'synchro' : t & 0x800000 ? 'xyz' : 'other');
        }
      }
    };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: data.decks.elfennotes, deckP1: data.decks.ishizu,
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
      botAnswerer: (prompt, state) => { track(state); const r = exploreAnswer(prompt, state, data, R); return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory()); },
    });
    try {
      const stats = await duel.run();
      if (duel.over && stats.retries === 0) { cleanDuel = true; if (saw) exSeen = true; console.log('explore duel seed ' + seed + ': clean, turns=' + stats.turns + ', EX summon=' + saw + ', kinds so far=' + [...kindsSeen].join('/')); }
    } catch (e) { console.log('explore duel seed', seed, 'threw:', e.message); }
  }
  ok(cleanDuel, 'S11: exploratory duel on the real Elfennotes deck completes with 0 retries');
  ok(exSeen, 'S12: an exploratory duel puts one of the deck\'s Fusion / Synchro monsters on the field (kinds seen: ' + [...kindsSeen].join('/') + ')');
}

// ---------- 6. full bot duels on the real decks ----------
{
  const M = await factory();
  const runs = [
    ['elfennotes (P0) vs ishizu', data.decks.elfennotes, data.decks.ishizu, 31],
    ['ishizu (P0) vs elfennotes', data.decks.ishizu, data.decks.elfennotes, 32],
    ['elfennotes (P0) vs gg', data.decks.elfennotes, data.decks.gg, 33],
    ['superquant (P0) vs elfennotes', data.decks.superquant, data.decks.elfennotes, 34],
    ['elfennotes mirror', data.decks.elfennotes, data.decks.elfennotes, 35],
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

console.log(failures ? failures + ' ELFENNOTES CHECK(S) FAILED' : 'ALL ELFENNOTES CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
