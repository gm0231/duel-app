'use strict';
/* test-minerva.js — minerva-1118 regression pins.
 *
 * cpu-classic3-1117 left a visible tradeoff: Minerva's bonus (1000)
 * beat Stardust by 100 on equal cost (2000+150+1000 vs 2500+150+400),
 * so Minerva won the shared offers and Stardust fell 0.263 -> 0.067
 * per game (Michael 0.061 -> 0.019) while wins stayed flat. The
 * classic3 RECORD named the lever: 900 ties Stardust on equal cost
 * (3050 = 3050).
 *
 * Diagnosis on the tuning seed set (480 games, seed base 20271151,
 * pristine cea347f vs the 900 build, same seed stream):
 *   pristine: wins 98 (20.4%), Minerva 0.700/game, Stardust 0.067,
 *     Michael 0.029, JD 0.485, Black Rose 0.033.
 *   900:      wins 96 (20.0%), Minerva 0.544/game, Stardust 0.138,
 *     Michael 0.033, JD 0.467, Black Rose 0.035.
 * The protection line (Stardust) doubles while the mill engine
 * (Minerva 0.544, JD 0.467) and wins stay flat.
 *
 * This test re-runs the fixed seed set (first 30/direction of
 * 20271151, 120 games) and pins the counters with margin. It is a
 * REGRESSION pin only — adoption was decided on the fresh-seed bench
 * in minerva-1118, never on this set. Pin values on this set:
 *   900 build: wins 27, Minerva 60, Stardust 20, Michael 3, JD 60.
 *   1000 build: wins 26, Minerva 79, Stardust 9, Michael 2, JD 61.
 * M3/M4 discriminate the two: Stardust >= 12 (1000 build: 9) and
 * Minerva <= 72 (1000 build: 79).
 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

const SPS_WATCH = new Set([
  30100551, 4779823, 73580471, 44508094, 57774843, // LS: Minerva, Michael, Black Rose, Stardust, JD
]);
async function runSet(M, theme, foes, perDirection, seedStart) {
  const C = { games: 0, wins: 0, incomplete: 0, exceptions: 0, sps: {} };
  let seed = seedStart;
  for (const foe of foes) {
    for (const dir of [0, 1]) {
      const a = dir === 0 ? theme : foe, b = dir === 0 ? foe : theme;
      const themeSeat = dir === 0 ? 0 : 1;
      for (let g = 0; g < perDirection; g++) {
        seed += 17;
        installSeededCrypto((seed * 2654435761) % 4294967296);
        const mem = [Engine.makeBotMemory(), Engine.makeBotMemory()];
        let exc = 0;
        let duelRef = null;
        const drain = () => {
          if (!duelRef || !duelRef.state) return;
          for (const ev of duelRef.state.events.splice(0, duelRef.state.events.length)) {
            if (ev.con !== themeSeat || ev.kind !== 'spsummon') continue;
            if (SPS_WATCH.has(ev.code)) C.sps[ev.code] = (C.sps[ev.code] || 0) + 1;
          }
        };
        const ans = (seat) => (prompt, state) => {
          drain();
          let resp;
          try { resp = Engine.botAnswer(prompt, state, data, mem[seat]); } catch (e) { exc++; return undefined; }
          drain();
          return resp;
        };
        const duel = new Engine.Duel(M, data, {
          seed, deckP0: data.decks[a], deckP1: data.decks[b],
          pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(), onLog: () => {},
          humanAnswerer: async (p, s) => ans(0)(p, s),
          botAnswerer: (p, s) => ans(1)(p, s),
        });
        duelRef = duel;
        try { await duel.run(); } catch (e) { C.incomplete++; continue; }
        drain();
        C.games++;
        C.exceptions += exc;
        if (!duel.over) C.incomplete++;
        else if (duel.state && duel.state.winner === themeSeat) C.wins++;
      }
    }
  }
  C.endSeed = seed;
  return C;
}

(async () => {
  const M = await factory();
  const ls = await runSet(M, 'lightsworn', ['ishizu', 'gg'], 30, 20271151);
  console.log('lightsworn:', JSON.stringify(ls));
  ok(ls.incomplete === 0 && ls.exceptions === 0, 'M1: lightsworn set completes with zero exceptions');
  ok((ls.sps[30100551] || 0) >= 40, 'M2: Minerva summons >= 40 / 120 games (sps=' + (ls.sps[30100551] || 0) + ')');
  ok((ls.sps[44508094] || 0) >= 12, 'M3: Stardust summons >= 12 / 120 games (sps=' + (ls.sps[44508094] || 0) + ')');
  ok((ls.sps[30100551] || 0) <= 72, 'M4: Minerva summons <= 72 / 120 games — no longer crowds out Stardust at the old rate (sps=' + (ls.sps[30100551] || 0) + ')');
  ok((ls.sps[57774843] || 0) >= 30, 'M5: Judgment Dragon still lands >= 30 / 120 games (sps=' + (ls.sps[57774843] || 0) + ')');
  ok(ls.wins >= 15, 'M6: wins >= 15 / 120 games (wins=' + ls.wins + ')');
  ok((ls.sps[4779823] || 0) >= 1, 'M7: Michael still lands >= 1 / 120 games (sps=' + (ls.sps[4779823] || 0) + ')');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL MINERVA CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
