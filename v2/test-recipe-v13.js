'use strict';
/* test-recipe-v13.js — the v13 Ishizu recipe candidate (user's
   package, 2026-11-10): 《丘と芽吹の春化精》 out, classic 《死者蘇生》
   swapped for the Magic Card "Monster Reborn" printing (28958464,
   a Quick-Play whose revived monster cannot attack or activate its
   effects that turn, one activation per turn by card name),
   《宿神像ケルドウ》 3->2, 《花と野原の春化精》 2->3,
   《トランザクション・ロールバック》 in. 45 cards / 100 points.
 *
 * Outcome: implemented and benched over 480 games against the
 * round-11 v11 baseline (213W, exactly reproduced by the control
 * runs). The candidate measured 191W — a clear deterioration — and
 * the split runs attributed it mostly to the Oka-out/Hana-in swap
 * (-14) with the Reborn-slot swap itself near-neutral (-2), Keldo
 * 3->2 free (214W alone) and a small negative residual for the
 * Rollback slot. Per the adoption rule the DECK change was rolled
 * back to v11; the card implementation (pool 147) and the bot rules
 * stay, usable by imported decks. Full record:
 * ~/workspace/yugioh/ishizu-v13-check/DESIGN.md.
 * This file now guards both halves: the printing fully implemented
 * (verbatim official script, STD_ART delivery, a real engine
 * resolution proving the rider and the name limit), and the
 * shipped deck state.
 * Epilogue (v14, 2026-11-11): the user's follow-up package kept
 * this file's base (Magic Card printing in, Keldo 3->2, Rollback
 * in) but replaced the Oka-out/Hana-in swap with Mudora 3->2 plus
 * Oka 1->2; it benched 206W against the same 213W baseline with
 * the mechanism indicators intact and was ADOPTED as v14, so
 * section 1 below now pins the v14 deck state (see
 * ~/workspace/yugioh/ishizu-v14-check/DESIGN.md).
 * Engine scenarios use scripted policies over rigged test decks and
 * scan deterministic seeds until the flow is observed (the same
 * calibration approach as test-recipe-v11/v12).                 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cmdResp, cardsResp } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

const MC_REBORN = 28958464, REBORN = 83764718, OKA = 9350312, KELDO = 63542003,
      HANA = 62133026, ROLLBACK = 6351147, COROLLA = 14108995, CARBON = 15079028,
      LUCE = 45409943, MUDORA = 99937011;

// ---------- 1. the shipped deck state (v14 since 2026-11-11) ----------
{
  const main = data.decks.ishizu.main;
  const n = (c) => main.filter(x => x === c).length;
  ok(main.length === 45 && n(MC_REBORN) === 1 && n(REBORN) === 0 && n(OKA) === 2 &&
     n(KELDO) === 2 && n(MUDORA) === 2 && n(HANA) === 2 && n(ROLLBACK) === 1 && n(COROLLA) === 1 && n(CARBON) === 3,
    'R1: the shipped Ishizu deck is the v14 recipe (v13 candidate rolled back; v14 adopted after its 480-game bench: Magic Card Reborn x1, Oka x2, Keldo x2, Mudora x2, Rollback x1, Hana x2, 45 cards)');
  ok(data.decks.ishizu.extra.length === 15 && data.decks.ishizu.extra.filter(c => c === LUCE).length === 3,
    'R2: the Extra deck is untouched (15 cards, Luce x3)');
}

// ---------- 2. the Magic Card printing is fully in the pool ----------
{
  const off = fs.readFileSync(path.join(__dirname, '..', '..', 'ocgcore-poc', 'scripts-repo', 'official', 'c' + MC_REBORN + '.lua'), 'utf8');
  ok(!!(data.cards[MC_REBORN] && data.names[MC_REBORN] && data.texts[MC_REBORN] && data.texts[MC_REBORN].text) &&
     data.scripts['c' + MC_REBORN + '.lua'] === off,
    'R3: 28958464 (' + data.names[MC_REBORN] + ') is in the pool with name/text and the verbatim official script');
  ok(data.cards[MC_REBORN].type === 65538, 'R4: 28958464 is a Quick-Play Spell (type 65538)');
  ok(Object.keys(data.cards).length === 147, 'R5: the pool is 147 cards (146 + the Magic Card printing)');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fxmap.json'), 'utf8'));
  ok(fx[MC_REBORN] && fx[MC_REBORN].n === 1, 'R6: fxmap describes the printing\'s single numbered effect');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
  ok(clientSrc.includes("28958464: 'std-28958464'"), 'R7: STD_ART registers the Magic Card printing');
  for (const suf of ['.jpg', '-s.jpg']) {
    const p = path.join(__dirname, '..', 'assets', 'card-art-std-28958464' + suf);
    ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'R8: card-art-std-28958464' + suf + ' delivered (>10KB)');
  }
}

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

(async () => {

// ---------- 3. Magic Card "Monster Reborn": resolves, and the rider holds ----------
// Seat 0 mills with Mori until a Mori sits in its grave, then fires
// the Magic Card printing on it. Mori is the probe on purpose: its
// (2) is a field ignition, so "the revived monster cannot activate
// its effects this turn" is observable as the ABSENCE of that
// activation offer — and "cannot attack" as the absence of its seq
// from the same turn's attack list, with at least one Battle Phase
// prompt witnessed after the revival so the absence is not vacuous.
// The once-per-turn name limit is observed the same way: after the
// firing, no later same-turn prompt may offer the second copy.
const MORI = 36745317, KELBEK = 25926710, ZOLGA = 31525442;
{
  const decks = [mkDeck([...rep(MC_REBORN, 6), ...rep(MORI, 17), ...rep(KELBEK, 17)]),
                 mkDeck(rep(ZOLGA, 40))];
  const policy = (seat, seen) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
    const P = state.players[0];
    const myTurn = state.turnPlayer === 0;
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    // rider watch: once the revival is on the field, scan every
    // prompt of the revival turn for a forbidden offer.
    if (seen.revivedTurn !== undefined && state.turnCount === seen.revivedTurn && myTurn) {
      for (const e of (prompt.activate || []))
        if (e.code === seen.revivedCode && e.loc === 0x04 && e.seq === seen.revivedSeq) seen.riderViolated = 'effect offered';
      for (const e of (prompt.attack || []))
        if (e.seq === seen.revivedSeq) seen.riderViolated = 'attack offered';
      if (prompt.name === 'SELECT_BATTLECMD') seen.bpAfterRevival = true;
    }
    // oath watch: after firing, the second copy must not be offered
    // again during the firing turn.
    if (seen.firedTurn !== undefined && state.turnCount === seen.firedTurn) {
      for (const e of (prompt.activate || []))
        if (e.code === MC_REBORN) seen.oathViolated = true;
    }
    if (prompt.name === 'SELECT_IDLECMD') {
      const i = prompt.activate.findIndex(e => e.code === MC_REBORN);
      if (i >= 0 && seen.firedTurn === undefined && P.grave.includes(MORI)) {
        seen.fired = true; seen.firedTurn = state.turnCount;
        // remember which Mori already stand on the field: the
        // revived one is the NEW face-up Mori after resolution
        // (an earlier Mori special summoned by Mori (1) is
        // unrestricted and must not be mistaken for the revival).
        seen.preMoriSeqs = P.mzone.map((c, s) => (c && c.code === MORI && (c.pos & 0x5)) ? s : -1).filter(s => s >= 0);
        return cmdResp(5, i);
      }
      const mi = prompt.activate.findIndex(e => e.code === MORI && e.loc === 0x02);
      if (mi >= 0 && !seen.fired) return cmdResp(5, mi); // mill until Mori is in the grave
      if (prompt.toBP) return cmdResp(6, 0);
      if (prompt.toEP) return cmdResp(7, 0);
      return undefined;
    }
    if (prompt.name === 'SELECT_CARD' && prompt.context && prompt.context.code === MC_REBORN) {
      const mori = prompt.cards.findIndex(c => c.loc === 0x10 && c.code === MORI);
      if (mori >= 0) return cardsResp([mori]); // revive Mori itself
    }
    if (prompt.name === 'SELECT_CARD' && prompt.context && prompt.context.code === MORI) {
      const kel = prompt.cards.findIndex(c => c.code === KELBEK);
      if (kel >= 0) return cardsResp([kel]); // cost / deck-send / revive picks all prefer Kelbek
    }
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      const P = state.players[0];
      if (seen.fired && seen.revivedTurn === undefined) {
        for (let seq = 0; seq < 5; seq++) {
          const cell = P.mzone[seq];
          if (cell && cell.code === MORI && (cell.pos & 0x5) && !(seen.preMoriSeqs || []).includes(seq)) {
            seen.revivedTurn = state.turnCount; seen.revivedSeq = seq; seen.revivedCode = MORI;
          }
        }
      }
      if (seen.fired && P.grave.includes(MC_REBORN)) seen.mcInGrave = true;
    },
    done: (seen) => !!(seen.fired && seen.revivedTurn !== undefined && seen.mcInGrave &&
                       seen.bpAfterRevival && !seen.riderViolated && !seen.oathViolated),
  };
  ok(await runScenario('MCReborn', decks, policy, observe, 60),
    'R9: マジックカード「死者蘇生」 revives a graveyard monster; the revived monster is offered neither an attack nor its field effect that turn, and no second copy is offered that turn (name limit)');
}

console.log(failures ? failures + ' RECIPE-V13 CHECK(S) FAILED' : 'ALL RECIPE-V13 CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
