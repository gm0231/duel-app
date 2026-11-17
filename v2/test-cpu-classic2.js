'use strict';
/* test-cpu-classic2.js — cpu-classic2-1117 regression pins.
 *
 * The generic policy played three of the four classic decks
 * structurally wrong (diagnosis on the tuning seed set, offer-level
 * instrumentation; see cpu-classic2-1117):
 *   - Six Samurai: Shi En converted whenever offered (9/9 in the
 *     diag sample) — the bottleneck was the bridge. Kageki (ATK 200)
 *     and Kagemusha (ATK 400) lost every Normal Summon to a bigger
 *     body, and Smoke Signal fetched the Kageki + Kagemusha pair
 *     0 times (Tsuyuharai / duplicate Mizuho instead).
 *   - Cyber: Nova offered 216 times in 40 diag games, policy-picked
 *     2 (two Lv5 bodies out-attack the flat conversion price);
 *     Infinity offered 24 times, picked 0 — the material model has
 *     no rank-up-over-Nova procedure, so its cost stayed null.
 *   - Agents: Gachi Gachi offered 142 times / picked 0 and Herald
 *     of Pure Light 71 / 0 — both lost every shared offer to
 *     Daigusto Phoenix, a 1500 body whose effect needs a WIND
 *     monster this deck never fields; Jupiter's activation scored
 *     0 in 28/28 offers (its grave-banish COST reads as a removal
 *     verb in fxKinds).
 *   - Junk Doppel: NO profile. The diagnosis found its core line
 *     (Librarian / Formula) already runs under the generic policy;
 *     its pins below only guard that nothing regressed.
 *
 * This test re-runs a fixed seed set and pins the counters with
 * margin. It is a REGRESSION pin only — adoption was decided on the
 * fresh-seed bench in cpu-classic2-1117, never on this set.
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
function i32of(resp) { if (!resp || resp.length < 4) return null; return new DataView(resp.buffer, resp.byteOffset, 4).getInt32(0, true); }
function cardPicks(resp, cards) {
  if (!resp || resp.length < 8) return [];
  const dv = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
  if (dv.getInt32(0, true) !== 2) return [];
  const n = dv.getUint32(4, true);
  const out = [];
  for (let i = 0; i < n && 8 + i < resp.length; i++) { const idx = resp[8 + i]; if (cards[idx]) out.push(cards[idx].code); }
  return out;
}

const SPS_WATCH = new Set([29981921, 58069384, 10443957, 10002346, 1249315, 2766877, 55794644, 90953320]);
async function runSet(M, theme, foes, perDirection, seedStart) {
  const C = { games: 0, incomplete: 0, exceptions: 0, sps: {}, jupiterFx: 0, signalPairPicks: 0, signalPicks: 0 };
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
          if (seat === themeSeat && prompt.name === 'SELECT_IDLECMD') {
            const v = i32of(resp);
            const type = v == null ? -1 : (v & 0xffff);
            const idx = v == null ? -1 : (v >> 16);
            if (type === 5 && prompt.activate && prompt.activate[idx] && prompt.activate[idx].code === 28573958) C.jupiterFx++;
          }
          if (seat === themeSeat && prompt.name === 'SELECT_CARD' && prompt.context && prompt.context.code === 54031490) {
            for (const c of cardPicks(resp, prompt.cards || [])) {
              C.signalPicks++;
              if (c === 2511717 || c === 1498130) C.signalPairPicks++;
            }
          }
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
  const six = await runSet(M, 'sixsam', ['ishizu', 'gg'], 30, 20271117);
  console.log('sixsam:', JSON.stringify(six));
  ok(six.incomplete === 0 && six.exceptions === 0, 'S1: sixsam set completes with zero exceptions');
  ok((six.sps[29981921] || 0) >= 40, 'S2: Shi En synchro summons >= 40 / 120 games (sps=' + (six.sps[29981921] || 0) + ')');
  ok(six.signalPairPicks >= 12, 'S3: Smoke Signal fetches Kageki/Kagemusha >= 12 times (picks=' + six.signalPairPicks + '/' + six.signalPicks + ')');

  const cyb = await runSet(M, 'cyber', ['ishizu', 'gg'], 30, six.endSeed);
  console.log('cyber:', JSON.stringify(cyb));
  ok(cyb.incomplete === 0 && cyb.exceptions === 0, 'C1: cyber set completes with zero exceptions');
  ok((cyb.sps[58069384] || 0) >= 25, 'C2: Nova Xyz summons >= 25 / 120 games (sps=' + (cyb.sps[58069384] || 0) + ')');
  ok((cyb.sps[10443957] || 0) >= 10, 'C3: Infinity rank-ups >= 10 / 120 games (sps=' + (cyb.sps[10443957] || 0) + ')');

  const agt = await runSet(M, 'agents', ['ishizu', 'gg'], 30, cyb.endSeed);
  console.log('agents:', JSON.stringify(agt));
  ok(agt.incomplete === 0 && agt.exceptions === 0, 'A1: agents set completes with zero exceptions');
  ok((agt.sps[10002346] || 0) >= 25, 'A2: Gachi Gachi summons >= 25 / 120 games (sps=' + (agt.sps[10002346] || 0) + ')');
  ok((agt.sps[1249315] || 0) >= 2, 'A3: Herald summons >= 2 / 120 games (sps=' + (agt.sps[1249315] || 0) + ')');
  ok(agt.jupiterFx >= 8, 'A4: Jupiter activations >= 8 / 120 games (fx=' + agt.jupiterFx + ')');
  ok((agt.sps[55794644] || 0) >= 70, 'A5: Hyperion still lands >= 70 / 120 games (sps=' + (agt.sps[55794644] || 0) + ')');

  const junk = await runSet(M, 'junkdoppel', ['ishizu', 'gg'], 30, agt.endSeed);
  console.log('junkdoppel:', JSON.stringify(junk));
  ok(junk.incomplete === 0 && junk.exceptions === 0, 'J1: junkdoppel set completes with zero exceptions (no profile; regression only)');
  ok((junk.sps[90953320] || 0) >= 40, 'J2: Librarian still lands >= 40 / 120 games (sps=' + (junk.sps[90953320] || 0) + ')');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CPU-CLASSIC2 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
