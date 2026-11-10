'use strict';
/* test-recipe-v14.js — the v14 Ishizu recipe (adopted 2026-11-11
   after the user's "final decision" bench on funding
   《トランザクション・ロールバック》): on the v13 base (classic
   《死者蘇生》 swapped for the Magic Card printing 28958464,
   《宿神像ケルドウ》 3->2, Rollback in), 《剣神官ムドラ》 3->2 funds
   the Rollback slot and 《丘と芽吹の春化精》 1->2 doubles the card
   the v13 split runs proved strongest. 45 cards / 99 points.
   Benched 480 games against the round-11 v11 baseline (213W,
   exactly reproduced by the control runs): 206W with the
   mechanism indicators intact or improved (Xyz 322, mill depth
   7.93, 15-card arrivals 43, Luce arrivals 231, lock win rate
   65.6%) — inside the error band per the adoption rule, so the
   deck ships as v14. The Mori-trimming twin candidate measured
   201W and was dropped. Full record:
   ~/workspace/yugioh/ishizu-v14-check/DESIGN.md.
   This file pins the v14 composition and re-runs the v11-era
   implementation scenarios (Hills, classic Agido, classic Reborn
   — all still in the pool — plus full bot duels on the shipped
   decks and the classic-Reborn no-rider client check).
   Engine scenarios use scripted policies over rigged test decks
   and scan deterministic seeds until the flow is observed (the
   same calibration approach as test-swap).                       */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cmdResp, cardsResp } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

// ---------- 1. deck composition (the decided recipe) ----------
const EXPECT_MAIN = {
  99937011: 2, 63542003: 2, 25926710: 1, 31525442: 1, 16135253: 1, 86605515: 3,
  36745317: 3, 9350312: 2, 62133026: 2, 15079028: 3, 46148485: 1, 79106360: 2,
  55702233: 2, 16435215: 1, 35726888: 2, 28958464: 1, 6351147: 1, 71593652: 2, 38699854: 1,
  14087893: 1, 51612489: 1, 14108995: 1, 17484499: 1, 98715423: 3, 51208877: 2,
  46652477: 1, 78625592: 1, 67037924: 1,
};
const EXPECT_EXTRA = {
  36898537: 2, 37706769: 2, 21368273: 1, 63101468: 1, 45409943: 3,
  82633039: 3, 30100551: 2, 62967433: 1,
};
const count = (arr) => { const m = {}; for (const c of arr) m[c] = (m[c] || 0) + 1; return m; };
ok(JSON.stringify(count(data.decks.ishizu.main)) === JSON.stringify(EXPECT_MAIN) && data.decks.ishizu.main.length === 45,
  'R1: ishizu main = the decided v14 45-card recipe, card for card');
ok(JSON.stringify(count(data.decks.ishizu.extra)) === JSON.stringify(EXPECT_EXTRA) && data.decks.ishizu.extra.length === 15,
  'R2: ishizu extra = the decided 15-card recipe, card for card');
ok(data.decks.gg.main.length === 40 && data.decks.gg.extra.length === 15, 'R3: GG deck untouched (40/15)');
// 28958464 (the Magic Card printing) IS in the shipped deck since
// v14; the classic printing 83764718 stays in the pool (section 4
// and 6 below still verify it) for imported decks.
for (const gone of [12332865, 62320425])
  ok(!(gone in data.cards) && !(gone in data.names) && !(gone in data.scripts), 'R4: ' + gone + ' fully out of the pool');

// ---------- helpers for the engine scenarios ----------
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
const rep = (code, n) => Array(n).fill(code);
const mkDeck = (main) => ({ main, extra: [] });
const botOr = (fn) => (prompt, state) => {
  const r = fn(prompt, state);
  return r !== undefined ? r : Engine.botAnswer(prompt, state, data, Engine.makeBotMemory());
};

async function runScenario(name, decks, makePolicy, observe, maxSeed) {
  const M = await factory();
  for (let seed = 1; seed <= maxSeed; seed++) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const seen = { events: 0 };
    const duel = new Engine.Duel(M, data, {
      seed, deckP0: decks[0], deckP1: decks[1],
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => { observe.poll(state, seen); return makePolicy(0, seen)(prompt, state); },
      botAnswerer: (prompt, state) => { observe.poll(state, seen); return makePolicy(1, seen)(prompt, state); },
    });
    let stats;
    try { stats = await duel.run(); } catch (e) { console.log(name, 'seed', seed, 'threw:', e.message); continue; }
    if (observe.done(seen) && stats.retries === 0 && duel.over) {
      console.log(name + ': flow observed on seed ' + seed + ' (turns=' + stats.turns + ')');
      return true;
    }
  }
  return false;
}
// drain new state events into `seen` (kind-filtered helper)
function drainEvents(state, seen) {
  const evs = state.events || [];
  for (; seen.events < evs.length; seen.events++) {
    const e = evs[seen.events];
    if (e.kind === 'spsummon') (seen.spsummoned = seen.spsummoned || []).push(e);
  }
}

(async () => {

// ---------- 2. Hills: search + special summon via the helper ----------
const HILLS = 9350312, MORI = 36745317, KARVON = 15079028, KALDAN = 86605515;
{
  const decks = [mkDeck([...rep(HILLS, 10), ...rep(MORI, 10), ...rep(KARVON, 10), ...rep(KALDAN, 10)]),
                 mkDeck(rep(31525442, 40))];
  const handCodes = (state) => state.players[0].hand.map(c => (typeof c === 'object' ? c.code : c));
  const policy = (seat, seen) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
    if (prompt.name === 'SELECT_IDLECMD') {
      const i = prompt.activate.findIndex(e => e.code === HILLS);
      if (i >= 0) { seen.moriAtActivation = handCodes(state).filter(c => c === MORI).length; return cmdResp(5, i); }
      if (prompt.toEP) return cmdResp(7, 0);
      if (prompt.toBP) return cmdResp(6, 0);
      return cmdResp(7, 0);
    }
    if (prompt.name === 'SELECT_BATTLECMD') { if (prompt.toEP) return cmdResp(3, 0); if (prompt.toM2) return cmdResp(2, 0); return undefined; }
    if (prompt.name === 'SELECT_CARD') {
      const cost = prompt.cards.findIndex(c => c.code === KARVON || c.code === KALDAN);
      if (cost >= 0 && prompt.cards.some(c => c.code === HILLS)) return cardsResp([cost]); // the hand cost step
      const search = prompt.cards.findIndex(c => c.code === MORI);
      if (search >= 0) return cardsResp([search]); // the deck search step
    }
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      drainEvents(state, seen);
      const P = state.players[0];
      if (P.grave.includes(HILLS)) seen.resolved = true;
      if (seen.moriAtActivation !== undefined && P.hand.map(c => (typeof c === 'object' ? c.code : c)).filter(c => c === MORI).length > seen.moriAtActivation) seen.searched = true;
      if ((seen.spsummoned || []).some(e => e.con === 0)) seen.summoned = true;
    },
    done: (seen) => !!(seen.resolved && seen.searched && seen.summoned),
  };
  ok(await runScenario('Hills', decks, policy, observe, 40),
    'R5: 《丘と芽吹の春化精》 activates, discards, searches a Vernusylph card and special-summons the discarded EARTH monster');
}

// ---------- 3. classic Agido: battle destruction -> dice -> revive ----------
// Scenario design: a normal summon in this core is always face-up
// attack (SummonRule fixes POS_FACEUP_ATTACK; there is no position
// prompt), so the wall is a SET Mori (face-down, DEF 1800) that
// Zolga (1700) can never break; every spare Zolga crashes into it
// for zero damage. P0 feeds one Agido per turn into Zolga by
// attacking with it (battle destruction on P0's own turn).
// NOTE on the dice: the core RNG is seeded from the duel seed, but
// the PoC driver fixes seed components 1..3, which makes the first
// six rolls of every duel land 1,1,1,3,x,1 (verified against the
// xoshiro sequence) — none matches a level-4 Fairy. The 7th roll
// is always 4 or 6, and 4 matches the level-4 Agidos in the grave,
// so the scenario accumulates seven battle deaths; the seed scan
// skips seeds whose 7th roll is 6 (no level-6+ Fairy in this rig).
// The trigger firing itself (TOSS_DICE messages) is asserted
// separately on a fixed seed below (R6a).
const AGIDO = 16135253, ZOLGA = 31525442;
{
  const decks = [mkDeck([...rep(AGIDO, 25), ...rep(MORI, 5), ...rep(KALDAN, 10)]), mkDeck(rep(ZOLGA, 40))];
  const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    if (prompt.name === 'SELECT_IDLECMD') {
      const wallUp = state.players[0].mzone.some(e => e && e.code === MORI);
      if (!wallUp) {
        const mi = prompt.mset.findIndex(e => e.code === MORI);
        if (mi >= 0) return cmdResp(3, mi); // set the wall face-down
      }
      const si = prompt.summon.findIndex(e => e.code === AGIDO);
      if (si >= 0) return cmdResp(0, si); // the attacker (always face-up attack in this core)
      if (prompt.toBP) return cmdResp(6, 0);
      if (prompt.toEP) return cmdResp(7, 0);
      return cmdResp(7, 0);
    }
    if (prompt.name === 'SELECT_BATTLECMD') {
      const ai = prompt.attack.findIndex(e => e.code === AGIDO);
      if (ai >= 0) return cmdResp(1, ai);
      if (prompt.toM2) return cmdResp(2, 0);
      if (prompt.toEP) return cmdResp(3, 0);
      return undefined;
    }
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      drainEvents(state, seen);
      if (state.players[0].grave.filter(c => c === AGIDO).length >= 7) seen.sevenDown = true;
      if ((seen.spsummoned || []).some(e => (e.code === AGIDO || e.code === MORI) && e.con === 0)) seen.revived = true;
    },
    done: (seen) => !!(seen.sevenDown && seen.revived),
  };
  ok(await runScenario('Agido', decks, policy, observe, 40),
    'R6: classic 《アギド》 destroyed by battle x7 — the dice trigger fires each time and a matching roll special-summons a Fairy from the grave');
  // R6a: the trigger itself, deterministically — battle destruction
  // of Agido produces TOSS_DICE messages and the duel stays clean.
  {
    const M = await factory();
    installSeededCrypto(1 * 2654435761 % 4294967296);
    let diceMsgs = 0;
    const duel = new Engine.Duel(M, data, {
      seed: 1, deckP0: mkDeck(rep(AGIDO, 40)), deckP1: mkDeck(rep(ZOLGA, 40)),
      pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      onMessage: (m) => { if (m[0] === 131) diceMsgs++; },
      humanAnswerer: async (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
      botAnswerer: (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
    });
    const stats = await duel.run();
    ok(diceMsgs >= 2 && duel.over && stats.retries === 0,
      'R6a: Agido battle destructions toss the die (TOSS_DICE x' + diceMsgs + '), duel clean');
  }
}

// ---------- 4. classic Monster Reborn: target and summon ----------
const REBORN = 83764718, MUDORA = 99937011;
{
  const decks = [mkDeck([...rep(REBORN, 15), ...rep(MUDORA, 25)]), mkDeck(rep(ZOLGA, 40))];
  const policy = (seat) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
    if (prompt.name === 'SELECT_POSITION' && (prompt.mask & 1)) return i32resp(1);
    if (prompt.name === 'SELECT_IDLECMD' && (state.players[0].grave.length || state.players[1].grave.length)) {
      const i = prompt.activate.findIndex(e => e.code === REBORN);
      if (i >= 0) return cmdResp(5, i);
    }
    if (prompt.name === 'SELECT_CARD' && prompt.min >= 1 && prompt.cards.length) {
      const gravePick = prompt.cards.findIndex(c => state.players[0].grave.includes(c.code) || state.players[1].grave.includes(c.code));
      if (gravePick >= 0) return cardsResp([gravePick]);
    }
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      drainEvents(state, seen);
      if (state.players[0].grave.includes(REBORN)) seen.activated = true;
      if (seen.activated && (seen.spsummoned || []).some(e => e.con === 0)) seen.summoned = true;
    },
    done: (seen) => !!(seen.activated && seen.summoned),
  };
  ok(await runScenario('Reborn', decks, policy, observe, 40),
    'R7: classic 《死者蘇生》 activates and special-summons a monster from a grave');
}

// ---------- 5. full bot duels on the real new decks ----------
{
  const M = await factory();
  for (const [label, d1, seed] of [['ishizu vs gg', data.decks.gg, 7], ['ishizu mirror', data.decks.ishizu, 8]]) {
    installSeededCrypto(seed * 2654435761 % 4294967296);
    const mem = [Engine.makeBotMemory(), Engine.makeBotMemory()];
    const duel = new Engine.Duel(M, data, {
      seed, deckP1: d1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
      humanAnswerer: async (prompt, state) => Engine.botAnswer(prompt, state, data, mem[0]),
      botAnswerer: (prompt, state) => Engine.botAnswer(prompt, state, data, mem[1]),
    });
    const stats = await duel.run();
    ok(duel.over && stats.retries === 0, 'R8: bot duel completes on the new recipe (' + label + ', turns=' + stats.turns + ', retries=0)');
  }
}

// ---------- 6. client: the classic Reborn arms NO revive rider ----------
{
  function stubEl() {
    return { children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
      addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      setAttribute() {}, play: () => Promise.resolve(), pause() {}, load() {} };
  }
  const els = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
    document: { getElementById: (id) => els[id] || (els[id] = stubEl()), querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, createElement: () => stubEl(), body: stubEl() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
    fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
    performance: { now: () => 0 }, requestAnimationFrame: () => 0,
    location: { href: 'http://localhost/v2/', search: '' }, navigator: { userAgent: 'node' },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.Engine = Engine;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8'), sandbox, { filename: 'client.js' });
  const PC = sandbox.__poolcov;
  ok(!!PC, 'R9: client test surface present');
  if (PC) {
    PC.reset();
    const st = { turnCount: 3, players: [{ mzone: [null, { code: 82633039 }, null, null, null] }, { mzone: [] }] };
    PC.noteRevive([{ kind: 'activate', code: REBORN, con: 0 }, { kind: 'spsummon', code: 82633039, con: 0 }], st);
    ok(PC.revivedReason(82633039, 4, 1, 3) === null,
      'R10: a monster revived by the CLASSIC 《死者蘇生》 gets NO cannot-attack / cannot-activate reason (the classic has no rider)');
  }
}

console.log(failures ? failures + ' RECIPE-V14 CHECK(S) FAILED' : 'ALL RECIPE-V14 CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
