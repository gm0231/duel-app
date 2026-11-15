'use strict';
/* test-recipe-classic1.js — the classic decks round 2-4 (2026-11-15):
   Lightsworn / Fire King / Chaos join the CLASSIC category next to
   Monarch (data.json decks.lightsworn / .fireking / .chaos), 69 cards
   newly implemented in the pool (165 -> 234). Each recipe was costed
   card by card against the bundled 202610 Genesis list
   (~/workspace/yugioh/recipe_lightsworn_v1.txt,
    recipe_fireking_v1.txt, recipe_chaos_v1.txt).
   Contract under test:
   - deck composition card for card against the adopted recipes;
   - each deck validates Genesis-legal (98 / 100 / 92 pt) under the
     bundled 202610 list and is fully pool-supported;
   - every one of the 69 new cards carries CDB data, a verbatim
     script, a Japanese name and a Japanese text in data.json;
   - Lightsworn's signature mill line runs for real: a mill effect
     sends 《ライトロード・ビースト ウルフ》 to the graveyard and it
     special-summons itself;
   - full bot duels on the real decks (each new deck vs Ishizu, both
     directions) complete cleanly with zero policy exceptions, the
     bot operating each new deck actually activates its cards, and
     each deck's signature boss hits the field.               */
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

const EXPECT = {
  lightsworn: {
    pt: 98,
    main: { 57774843: 2, 58996430: 3, 95503687: 3, 22624373: 3, 96235275: 3, 44178886: 2, 21502796: 2, 77558536: 2, 59019082: 2, 94381039: 2, 7183277: 1, 4906301: 2, 33420078: 1, 67441435: 1, 94886282: 2, 691925: 3, 53129443: 1, 12580477: 1, 5318639: 1, 14087893: 1, 44095762: 1, 22201234: 1 },
    extra: { 30100551: 2, 4779823: 2, 73580471: 1, 44508094: 1 },
  },
  fireking: {
    pt: 100,
    main: { 23015896: 3, 69000994: 3, 66413481: 3, 96594609: 3, 54149433: 2, 61441708: 3, 38910263: 2, 22993208: 3, 59388357: 3, 57103969: 2, 57554544: 3, 74845897: 1, 53129443: 1, 5318639: 1, 10719350: 1, 34460239: 2, 53582587: 1, 44095762: 1, 38798785: 2 },
    extra: { 95169481: 1, 46772449: 1, 12014404: 1, 48739166: 1 },
  },
  chaos: {
    pt: 92,
    main: { 82301904: 1, 72989439: 1, 9596126: 3, 40737112: 1, 71413901: 1, 26202165: 1, 78010363: 1, 31560081: 1, 7572887: 2, 37043180: 1, 88240808: 2, 34853266: 1, 8131171: 1, 33184167: 1, 23205979: 2, 74131780: 1, 76922029: 1, 55144522: 1, 71044499: 2, 97169186: 2, 87910978: 1, 4031928: 1, 46411259: 2, 12580477: 1, 53129443: 1, 14087893: 1, 83764718: 1, 18144506: 1, 53582587: 1, 44095762: 1, 97077563: 1, 83555666: 1 },
    extra: { 63519819: 2 },
  },
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
const sameCount = (a, b) => JSON.stringify(count(a)) === JSON.stringify(b);

// ---------- 1. deck composition + legality ----------
NeuronLib.setData(genesys);
const pool = new Set(Object.keys(data.cards).map(Number));
for (const key of Object.keys(EXPECT)) {
  const d = data.decks[key], e = EXPECT[key];
  ok(!!d && d.category === 'classic', 'C1.' + key + ': decks.' + key + ' exists with category classic');
  ok(sameCount(d.main, e.main) && d.main.length === 40, 'C2.' + key + ': main = the adopted 40-card recipe, card for card');
  ok(sameCount(d.extra, e.extra), 'C3.' + key + ': extra = the adopted recipe, card for card');
  const val = NeuronLib.validateGenesis({ main: d.main, extra: d.extra, side: [], names: data.names });
  ok(val.ok && val.totalPt === e.pt, 'C4.' + key + ': validateGenesis — legal at ' + e.pt + 'pt under the bundled 202610 list (got ' + val.totalPt + 'pt, ok=' + val.ok + ')');
  const pc = NeuronLib.poolCheck({ main: d.main, extra: d.extra }, pool);
  ok(pc.ok && pc.unsupported.length === 0, 'C5.' + key + ': every recipe card is pool-supported');
}
ok(data.decks.ishizu.main.length === 45 && data.decks.monarch.main.length === 40,
  'C6: the existing decks are untouched (ishizu 45, monarch 40)');

// ---------- 2. the 69 new cards are fully implemented ----------
const OLD_POOL = 165;
const allDeckCodes = new Set();
for (const key of Object.keys(EXPECT)) { data.decks[key].main.forEach(c => allDeckCodes.add(c)); data.decks[key].extra.forEach(c => allDeckCodes.add(c)); }
const NEW_CODES = [...allDeckCodes].filter(c => ![30100551, 44508094, 12580477, 14087893, 83764718].includes(c));
ok(Object.keys(data.cards).length === 234, 'C7: the pool is now 234 cards (165 + 69 classic implementations; got ' + Object.keys(data.cards).length + ')');
ok(NEW_CODES.length === 69, 'C8: the three recipes span 69 newly implemented cards (got ' + NEW_CODES.length + ')');
for (const pc of NEW_CODES) {
  const c = data.cards[pc];
  ok(!!c && !!data.scripts['c' + pc + '.lua'] && !!data.names[pc] && !!data.texts[pc] && !!data.texts[pc].text,
    'C9.' + pc + ': data + script + name + text present (' + (data.names[pc] || '?') + ')');
}

// ---------- helpers ----------
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
const rep = (code, n) => Array(n).fill(code);
function countedBot(mem, counter) {
  return (prompt, state) => {
    try { return Engine.botAnswer(prompt, state, data, mem); }
    catch (e) { counter.n++; counter.first = counter.first || e.message; return undefined; }
  };
}

(async () => {

// ---------- 3. scripted signature lines ----------
// Wulf cannot be Normal Summoned; the only way it reaches the field
// is its own effect when sent from the Deck to the GY (an 'spsummon'
// event). Policy activates the mill spells whenever offered and
// chains Wulf's trigger whenever it is offered.
const WULF = 58996430, CHARGE = 94886282, SOLAR = 691925;
{
  let landed = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !landed; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem0 = Engine.makeBotMemory(), mem1 = Engine.makeBotMemory();
    const policy0 = (prompt, state) => {
      if (prompt.name === 'SELECT_CHAIN') {
        const wi = (prompt.entries || []).findIndex(e => e.code === WULF);
        if (wi >= 0) return i32resp(wi);
      }
      if (prompt.name === 'SELECT_IDLECMD') {
        const ai = (prompt.activate || []).findIndex(e => e.code === CHARGE || e.code === SOLAR);
        if (ai >= 0) return cmdResp(5, ai);
        if ((prompt.summon || []).length) return cmdResp(0, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return Engine.botAnswer(prompt, state, data, mem0);
    };
    let sawWulf = false;
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: [...rep(WULF, 12), ...rep(CHARGE, 3), ...rep(SOLAR, 3), ...rep(22624373, 22)], extra: [] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if ((state.events || []).some(e => e.kind === 'spsummon' && e.code === WULF && e.con === 0)) sawWulf = true;
        return policy0(prompt, state);
      },
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem1),
    });
    try {
      const stats = await duel.run();
      if (sawWulf && duel.over && stats.retries === 0) { landed = true; console.log('signature scenario: Wulf milled and self-summoned on seed ' + seed); }
    } catch (e) { console.log('signature scenario seed', seed, 'threw:', e.message); }
  }
  ok(landed, 'C10: Lightsworn mill -> 《ライトロード・ビースト ウルフ》 self-summon runs for real');
}

// 《裁きの龍》: special-summoned from the hand once the graveyard
// holds 4+ differently-named Lightsworns. The fixture mills hard
// (Charge / Solar Exchange / the monsters' own end-phase mills) and
// the policy takes the Judgment Dragon offer the moment it appears.
const JD = 57774843;
{
  let landed = false;
  const M = await factory();
  const fixture = [...rep(JD, 3), ...rep(CHARGE, 3), ...rep(SOLAR, 3), ...rep(95503687, 3), ...rep(22624373, 5),
    ...rep(44178886, 3), ...rep(96235275, 3), ...rep(WULF, 3), ...rep(21502796, 2), ...rep(4906301, 2),
    ...rep(94381039, 2), ...rep(33420078, 2), ...rep(67441435, 2), ...rep(77558536, 2), ...rep(59019082, 2)];
  for (let seed = 1; seed <= 60 && !landed; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem0 = Engine.makeBotMemory(), mem1 = Engine.makeBotMemory();
    const policy0 = (prompt, state) => {
      if (prompt.name === 'SELECT_IDLECMD') {
        const ji = (prompt.spsummon || []).findIndex(e => e.code === JD);
        if (ji >= 0) return cmdResp(1, ji);
        const ai = (prompt.activate || []).findIndex(e => e.code === CHARGE || e.code === SOLAR);
        if (ai >= 0) return cmdResp(5, ai);
        if ((prompt.summon || []).length) return cmdResp(0, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return Engine.botAnswer(prompt, state, data, mem0);
    };
    let sawJD = false;
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: fixture, extra: [] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if ((state.events || []).some(e => e.kind === 'spsummon' && e.code === JD && e.con === 0)) sawJD = true;
        return policy0(prompt, state);
      },
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem1),
    });
    try {
      const stats = await duel.run();
      if (sawJD && duel.over && stats.retries === 0) { landed = true; console.log('signature scenario: Judgment Dragon summoned on seed ' + seed); }
    } catch (e) { console.log('JD scenario seed', seed, 'threw:', e.message); }
  }
  ok(landed, 'C10b: 《裁きの龍》 special summon from a milled graveyard runs for real');
}

// Chaos envoys: special-summoned by banishing a LIGHT and a DARK
// from the graveyard. The fixture fields light/dark beaters whose
// battle losses stock the graveyard; the policy takes any envoy
// offer the moment it appears.
const ENVOYS = [82301904, 72989439, 9596126];
{
  let landed = false;
  const M = await factory();
  for (let seed = 1; seed <= 40 && !landed; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem0 = Engine.makeBotMemory(), mem1 = Engine.makeBotMemory();
    const policy0 = (prompt, state) => {
      if (prompt.name === 'SELECT_IDLECMD') {
        const si = (prompt.spsummon || []).findIndex(e => ENVOYS.includes(e.code));
        if (si >= 0) return cmdResp(1, si);
        if ((prompt.summon || []).length) return cmdResp(0, 0);
        if ((prompt.activate || []).length) return cmdResp(5, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
      return Engine.botAnswer(prompt, state, data, mem0);
    };
    let sawEnvoy = false;
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: { main: [...rep(9596126, 3), 82301904, 72989439, ...rep(44178886, 17), ...rep(23205979, 18)], extra: [] }, deckP1: { main: rep(31525442, 40), extra: [] },
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => {
        if ((state.events || []).some(e => e.kind === 'spsummon' && ENVOYS.includes(e.code) && e.con === 0)) sawEnvoy = true;
        return policy0(prompt, state);
      },
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem1),
    });
    try {
      const stats = await duel.run();
      if (sawEnvoy && duel.over && stats.retries === 0) { landed = true; console.log('signature scenario: a Chaos envoy summoned on seed ' + seed); }
    } catch (e) { console.log('envoy scenario seed', seed, 'threw:', e.message); }
  }
  ok(landed, 'C10c: a Chaos envoy (混沌帝龍 / 開闢 / カオス・ソーサラー) special summon runs for real');
}

// ---------- 4. full bot duels on the real decks ----------
{
  const M = await factory();
  const BOSS = {
    lightsworn: new Set([57774843]),                    // 《裁きの龍》
    fireking: new Set([23015896, 69000994]),             // 《炎王神獣 ガルドニクス》/《ネフティスの鳳凰神》
    chaos: new Set([82301904, 72989439, 9596126]),       // 混沌帝龍 / 開闢 / カオス・ソーサラー
  };
  for (const key of Object.keys(EXPECT)) {
    let bossSeen = 0, activationsSeen = 0;
    const runs = [
      [key + ' (P0) vs ishizu', data.decks[key], data.decks.ishizu, 41, 0],
      ['ishizu (P0) vs ' + key, data.decks.ishizu, data.decks[key], 42, 1],
      [key + ' mirror', data.decks[key], data.decks[key], 43, -1],
    ];
    for (const [label, d0, d1, seed, seat] of runs) {
      installSeededCrypto(seed * 2654435761 % 4294967296);
      const counter = { n: 0, first: null };
      const mem = [Engine.makeBotMemory(), Engine.makeBotMemory()];
      // state.events is the duel's CUMULATIVE history: count only
      // the events appended since the previous prompt (per-seat
      // cursors), or every summon is recounted at every prompt.
      const cursors = [0, 0];
      const track = (s) => (state) => {
        const evs = state.events || [];
        if (seat < 0 || s === seat) {
          for (let i = cursors[s]; i < evs.length; i++) {
            const e = evs[i];
            if ((e.kind === 'summon' || e.kind === 'spsummon') && BOSS[key].has(e.code) && (seat < 0 || e.con === seat)) bossSeen++;
          }
        }
        cursors[s] = evs.length;
      };
      const countActs = (s) => (prompt, state) => {
        const r = countedBot(mem[s], counter)(prompt, state);
        if ((seat < 0 || s === seat) && r && r.length >= 4) {
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
        'C11.' + key + ': bot duel completes (' + label + ', turns=' + stats.turns + ', retries=0, policy exceptions=0' + (counter.first ? ', first: ' + counter.first : '') + ')');
    }
    ok(activationsSeen >= 10, 'C12.' + key + ': the bot operating the deck actually ACTIVATES its cards (observed ' + activationsSeen + ' activation choices)');
    ok(bossSeen > 0, 'C13.' + key + ': the deck\'s signature boss hits the field across the bot duels (observed ' + bossSeen + ')');
  }
}

console.log(failures ? failures + ' CLASSIC1 CHECK(S) FAILED' : 'ALL CLASSIC1 CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
