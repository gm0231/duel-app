'use strict';
/* test-cpu-classic1.js — cpu-classic1-1117 regression pins.
 *
 * The generic policy played the two classic decks structurally
 * wrong (diagnosis on fresh seeds, 120 games per deck):
 *   - Inzektor: its Xyz bosses print ATK 1000 / 800, so the flat
 *     spsummon model priced every conversion out of reach
 *     (Exa-Beetle offered 14 times in 40 games, chosen 0;
 *     Xyz summons 0.050 / game).
 *   - Gladiator Beast: Gyzarus lost all 32 shared fusion offers to
 *     the vanilla Essedarii on printed ATK (boss summons 0 / game),
 *     and no battle plan ever bought a tag-out against a defense
 *     wall (tag-out prompts 0.41 / game).
 * The profiles (pickSpsummon theme pricing, GB tag-out battle
 * plans, GB tag-in ranking) moved the counters on the same seeds to:
 * Xyz 0.108 / game with Beetle + Stag landing; boss fusions
 * 0.31 / game; tag-out prompts 0.57 / game.
 *
 * This test re-runs that fixed seed set and pins the counters with
 * margin. It is a REGRESSION pin only — adoption was decided on the
 * fresh-seed bench in cpu-classic1-1117, never on this set.
 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const XYZ_CODES = new Set([44505297, 26211048, 47805931, 581014, 37926346]);
const BOSS_CODES = new Set([48156348, 27346636]); // Gyzarus, Heraklinos
const FUSION_CODES = new Set([48156348, 27346636, 73285669, 29357956, 33652635]);
const GB_MAIN = new Set([41470137, 78868776, 25924653, 57731460, 5975022, 612115, 2619149, 90582719, 77642288, 7573135]);

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
function i32of(resp) { if (!resp || resp.length < 4) return null; return new DataView(resp.buffer, resp.byteOffset, 4).getInt32(0, true); }

async function runSet(M, theme, foes, perDirection, seedStart) {
  const C = { games: 0, xyz: 0, xyzBoss: 0, fusions: 0, boss: 0, tagYnYes: 0, incomplete: 0, exceptions: 0 };
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
            if (XYZ_CODES.has(ev.code)) { C.xyz++; if (ev.code === 44505297 || ev.code === 26211048) C.xyzBoss++; }
            if (FUSION_CODES.has(ev.code)) { C.fusions++; if (BOSS_CODES.has(ev.code)) C.boss++; }
          }
        };
        const ans = (seat) => (prompt, state) => {
          drain();
          let resp;
          try { resp = Engine.botAnswer(prompt, state, data, mem[seat]); } catch (e) { exc++; return undefined; }
          if (seat === themeSeat && prompt.name === 'SELECT_EFFECTYN' && GB_MAIN.has(prompt.code) && i32of(resp) === 1) C.tagYnYes++;
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
      }
    }
  }
  C.endSeed = seed;
  return C;
}

(async () => {
  const M = await factory();
  const inz = await runSet(M, 'inzektor', ['ishizu', 'gg'], 30, 20271117);
  console.log('inzektor:', JSON.stringify(inz));
  ok(inz.incomplete === 0 && inz.exceptions === 0, 'C1: inzektor set completes with zero exceptions');
  ok(inz.xyz >= 8, 'C2: inzektor Xyz summons >= 8 / 120 games (baseline 6, profile 13)');
  ok(inz.xyzBoss >= 2, 'C3: Exa-Beetle + Exa-Stag land (baseline 0, profile 4)');

  const gb = await runSet(M, 'gladiator', ['ishizu', 'gg'], 30, inz.endSeed);
  console.log('gladiator:', JSON.stringify(gb));
  ok(gb.incomplete === 0 && gb.exceptions === 0, 'C4: gladiator set completes with zero exceptions');
  ok(gb.boss >= 15, 'C5: GB boss fusions (Gyzarus/Heraklinos) >= 15 / 120 games (baseline 0)');
  ok(gb.fusions >= 100, 'C6: GB contact fusions >= 100 / 120 games (baseline 146, profile 188)');
  ok(gb.tagYnYes >= 35, 'C7: GB tag-outs accepted >= 35 / 120 games (baseline 49, profile 68)');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CPU-CLASSIC1 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
