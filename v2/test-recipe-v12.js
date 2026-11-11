'use strict';
/* test-recipe-v12.js — the v12 candidate cards' implementation
   checks (《死者転生》 74848038 and 《トランザクション・ロールバック》
   6351147, added to the pool 2026-11-10 with verbatim official
   scripts), plus the ROLLED-BACK deck state.
 *
 * History: the user's v12 recipe (Reborn -> Reincarnation, Carvon
 * 3 -> 2, + Rollback) was implemented and benched over 480 games
 * against the round-11 v11 baseline (213W). It measured 175W with
 * the new bot rules and 179W with the round-11 bot ignoring the new
 * cards — a clear deterioration driven by the composition itself
 * (the bot's play was built around Monster Reborn for 11 rounds),
 * so per the adoption rule the DECK change was rolled back while
 * the card implementation stays in the pool (usable by imported
 * decks, ready for a future re-adoption). Full record:
 * ~/workspace/yugioh/ishizu-v12-check/DESIGN.md.
 * Epilogue (v13, 2026-11-10): the user's follow-up package put
 * Rollback into the deck alongside the Magic Card "Monster Reborn"
 * printing; it benched at 191W against the same 213W baseline and
 * was rolled back the same way, so R1/R2 pinned the v11 deck state
 * again and the implementation scenarios were unchanged.
 * Epilogue (v14, 2026-11-11): the final funding package (Magic
 * Card printing in, Keldo 3->2, Mudora 3->2, Oka 1->2, Rollback
 * in) benched 206W with the mechanism indicators intact and was
 * ADOPTED, so R1/R2 now pin the v14 deck state: Rollback is in
 * the shipped deck at x1, 《死者転生》 stays out (see
 * ~/workspace/yugioh/ishizu-v14-check/DESIGN.md).
 * The shipped deck composition itself is pinned by
 * test-recipe-v11.js; this file pins that neither v12 card is in
 * the shipped deck, and that both cards resolve for real. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cmdResp, cardsResp } = Engine;

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const REINCARNATION = 74848038, ROLLBACK = 6351147, REBORN = 83764718, CARBON = 15079028;

// ---------- 1. deck state across the v12 / v13 / v14 rounds ----------
// v12 and v13 were both rolled back after their benches; v14
// (2026-11-11) adopted Rollback into the shipped deck at x1.
// 《死者転生》 remains out; its implementation stays in the pool.
ok(!data.decks.ishizu.main.includes(REINCARNATION) &&
   data.decks.ishizu.main.filter(c => c === ROLLBACK).length === 1,
  'R1: the shipped Ishizu deck runs Rollback x1 (adopted in v14) and still no 《死者転生》');
ok(!data.decks.ishizu.main.includes(REBORN) &&
   data.decks.ishizu.main.filter(c => c === 28958464).length === 1 &&
   data.decks.ishizu.main.filter(c => c === CARBON).length === 3 && data.decks.ishizu.main.length === 45,
  'R2: the shipped deck is the v14 recipe state (Magic Card Reborn x1, no classic Reborn, Carvon x3, 45 cards)');

// ---------- 2. both cards are fully in the pool ----------
for (const c of [REINCARNATION, ROLLBACK]) {
  const off = fs.readFileSync(path.join(__dirname, '..', '..', 'ocgcore-poc', 'scripts-repo', 'official', 'c' + c + '.lua'), 'utf8');
  ok(!!(data.cards[c] && data.names[c] && data.texts[c] && data.texts[c].text) && data.scripts['c' + c + '.lua'] === off,
    'R3: ' + c + ' (' + data.names[c] + ') is in the pool with name/text and the verbatim official script');
}
ok(Object.keys(data.cards).length === 147, 'R4: the pool is 147 cards (144 + the two v12 implementations + the v13 Magic Card printing)');

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

// ---------- 3. Monster Reincarnation: discard, target, back to HAND ----------
const MORI = 36745317, KELBEK = 25926710, ZOLGA = 31525442;
{
  const decks = [mkDeck([...rep(REINCARNATION, 12), ...rep(MORI, 14), ...rep(KELBEK, 14)]),
                 mkDeck(rep(ZOLGA, 40))];
  const handCodes = (state) => state.players[0].hand.map(c => (typeof c === 'object' ? c.code : c));
  const policy = (seat, seen) => seat !== 0 ? botOr(() => undefined) : botOr((prompt, state) => {
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    if (prompt.name === 'SELECT_IDLECMD') {
      const P = state.players[0];
      const gyMon = P.grave.find(c => data.cards[c] && (data.cards[c].type & 1));
      const i = prompt.activate.findIndex(e => e.code === REINCARNATION);
      if (i >= 0 && gyMon !== undefined && P.hand.length >= 2) {
        seen.target = P.grave.includes(KELBEK) ? KELBEK : gyMon;
        seen.handTargetAtFire = handCodes(state).filter(c => c === seen.target).length;
        seen.fired = true;
        return cmdResp(5, i);
      }
      const mi = prompt.activate.findIndex(e => e.code === MORI);
      if (mi >= 0 && handCodes(state).includes(KELBEK)) return cmdResp(5, mi); // mill the grave full
      if (prompt.toBP) return cmdResp(6, 0);
      if (prompt.toEP) return cmdResp(7, 0);
      return undefined;
    }
    if (prompt.name === 'SELECT_BATTLECMD') { if (prompt.toEP) return cmdResp(3, 0); if (prompt.toM2) return cmdResp(2, 0); return undefined; }
    if (prompt.name === 'SELECT_CARD') {
      const ctx = prompt.context && prompt.context.code;
      if (ctx === REINCARNATION) {
        const gravePick = prompt.cards.findIndex(c => c.loc === 0x10 && c.code === seen.target);
        if (gravePick >= 0) return cardsResp([gravePick]); // the salvage target
        const anyGrave = prompt.cards.findIndex(c => c.loc === 0x10);
        if (anyGrave >= 0) { seen.target = prompt.cards[anyGrave].code; return cardsResp([anyGrave]); }
        const cost = prompt.cards.findIndex(c => c.loc === 0x02 && c.code === MORI);
        if (cost >= 0) return cardsResp([cost]); // the discard cost: never the target
        const anyHand = prompt.cards.findIndex(c => c.loc === 0x02 && c.code !== seen.target);
        if (anyHand >= 0) return cardsResp([anyHand]);
      }
      if (ctx === MORI) {
        const kel = prompt.cards.findIndex(c => c.code === KELBEK);
        if (kel >= 0) return cardsResp([kel]); // cost / deck-send / revive picks all prefer Kelbek
      }
    }
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      const P = state.players[0];
      if (seen.fired && P.grave.includes(REINCARNATION) &&
          P.hand.map(c => (typeof c === 'object' ? c.code : c)).filter(c => c === seen.target).length > (seen.handTargetAtFire || 0)) {
        seen.salvaged = true;
      }
    },
    done: (seen) => !!(seen.fired && seen.salvaged),
  };
  ok(await runScenario('Reincarnation', decks, policy, observe, 60),
    'R5: 《死者転生》 discards a card and returns the targeted graveyard monster to the HAND (salvage, not a summon)');
}

// ---------- 4. Transaction Rollback (2): copy Exchange from the grave ----------
// Both seats mill with Kelbek/Mori until both graveyards hold 15+;
// seat 0 then fires Rollback from its graveyard targeting Exchange.
// The swap signature is a one-step deck<->grave size exchange.
const EXCHANGE = 17484499;
{
  const decks = [mkDeck([...rep(KELBEK, 14), ...rep(MORI, 10), ...rep(EXCHANGE, 8), ...rep(ROLLBACK, 8)]),
                 mkDeck([...rep(KELBEK, 20), ...rep(MORI, 20)])];
  const policy = (seat, seen) => botOr((prompt, state) => {
    if (prompt.name === 'SELECT_YESNO' || prompt.name === 'SELECT_EFFECTYN') return i32resp(1);
    if (seat === 0 && prompt.name === 'SELECT_IDLECMD') {
      const P = state.players[0], O = state.players[1];
      const i = prompt.activate.findIndex(e => e.code === ROLLBACK && e.loc === 0x10);
      if (i >= 0 && P.grave.includes(EXCHANGE) && P.grave.length >= 15 && O.grave.length >= 15) {
        seen.rbFired = true;
        return cmdResp(5, i);
      }
    }
    if (seat === 0 && prompt.name === 'SELECT_CHAIN') {
      const P = state.players[0], O = state.players[1];
      const i = prompt.entries.findIndex(e => e.code === ROLLBACK && e.loc === 0x10);
      if (i >= 0 && P.grave.includes(EXCHANGE) && P.grave.length >= 15 && O.grave.length >= 15) {
        seen.rbFired = true;
        return i32resp(i);
      }
    }
    if (seat === 0 && prompt.name === 'SELECT_CARD' && prompt.context && prompt.context.code === ROLLBACK) {
      const ex = prompt.cards.findIndex(c => c.code === EXCHANGE);
      if (ex >= 0) return cardsResp([ex]); // copy Exchange, nothing else
    }
    return undefined;
  });
  const observe = {
    poll(state, seen) {
      const P = state.players[0];
      if (seen.prevDeck !== undefined && seen.rbFired) {
        if (seen.prevDeck - P.deckCount >= 5 && P.grave.length - seen.prevGrave >= 5) seen.swapped = true;
      }
      seen.prevDeck = P.deckCount; seen.prevGrave = P.grave.length;
    },
    done: (seen) => !!(seen.rbFired && seen.swapped),
  };
  ok(await runScenario('RollbackExchange', decks, policy, observe, 60),
    'R6: 《トランザクション・ロールバック》(2) banishes itself from the grave and copies 《現世と冥界の逆転》 — deck and graveyard swap at 15+15');
}

// ---------- 5. client / fxmap registration of the two new cards ----------
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fxmap.json'), 'utf8'));
  ok(fx[ROLLBACK] && fx[ROLLBACK].n === 2, 'R7: fxmap describes both of Rollback\'s numbered effects');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
  ok(clientSrc.includes("74848038: 'std-74848038'") && !clientSrc.includes("6351147: 'std-6351147'") && clientSrc.includes("6351147: 'rollback'"),
    'R8: STD_ART still registers Reincarnation; Rollback\'s std registration was retired by the 36th art delivery (2026-11-11) — it resolves through CARD_ART now');
  for (const c of [REINCARNATION]) {
    for (const suf of ['.jpg', '-s.jpg']) {
      const p = path.join(__dirname, '..', 'assets', 'card-art-std-' + c + suf);
      ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'R9: card-art-std-' + c + suf + ' delivered (>10KB)');
    }
  }
  for (const suf of ['.jpg', '-s.jpg']) {
    const p = path.join(__dirname, '..', 'assets', 'card-art-std-' + ROLLBACK + suf);
    ok(!fs.existsSync(p), 'R9b: card-art-std-' + ROLLBACK + suf + ' retired with the 36th art delivery (the user painting replaces it)');
  }
}

console.log(failures ? failures + ' RECIPE-V12 CHECK(S) FAILED' : 'ALL RECIPE-V12 CHECKS PASSED');
process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
