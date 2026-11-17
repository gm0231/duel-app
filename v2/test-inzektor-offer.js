'use strict';
/* test-inzektor-offer.js — inzektor-offer-1117 regression pins.
 *
 * The round-1 profile fixed Xyz pricing, but the offer itself stayed
 * rare (198/1,440 games). Diagnosis on the tuning seed set
 * (20271137 / 20271139, 480 games each, see inzektor-offer-1117)
 * found the break in pair formation, not in conversion — a pair
 * standing was ALWAYS offered (49/49) — with three decision
 * blockages:
 *   - Damsel face-up Normal Summoned 0 times in 480 games (the
 *     wall rule skipped her outright and the set gain 1440/1690
 *     beat her 1000-ATK summon gain; a set Damsel cannot fire (1),
 *     so the SS engine never started).
 *   - Grulf (1) scored 0 in 379/379 offers and the level-raise 0
 *     in 479/479 (fxKinds has no equip verb; the Lv5 path to
 *     Exa-Stag was dead — Stag offered 4x in 480 games).
 *   - Hornet pop scored 0 in 352/448 offers (the generic destroy
 *     branch gates on the opponent's best monster, but a Hornet
 *     equip is always on Damsel/Centipede, so the pop ALWAYS fires
 *     the host's (2) on top of the destruction).
 *   - Emeral lost 22/22 shared offers to Roach (1800+500 vs
 *     1900+450).
 * After the fix (same seed set, 480 games): Damsel NS 0 -> 279,
 * Grulf (1) 0 -> 98, Hornet pop 84 -> 250, Xyz offers 75 -> 112,
 * Xyz summons 59 -> 89, Emeral 0 -> 21, wins 72 -> 99.
 *
 * This test re-runs a fixed seed set (the first 30/direction of
 * the tuning set) and pins the counters with margin. It is a
 * REGRESSION pin only — adoption was decided on the fresh-seed
 * bench in inzektor-offer-1117, never on this set.
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

const DAMSEL = 68184115, HORNET = 69207766, GRULF = 2461031;
const XYZ = { BEETLE: 44505297, STAG: 26211048, EMERAL: 581014, BRILLIANT: 47805931, ROACH: 37926346 };
// prompt.activate entries carry the ocgcore LOCATION bitmask
// (MZONE=0x04, SZONE=0x08, HAND=0x02, GRAVE=0x10), not 1/2.
const LOC = { MZONE: 4, SZONE: 8 };
async function runSet(M, theme, foes, perDirection, seedStart) {
  const C = { games: 0, wins: 0, incomplete: 0, exceptions: 0, sps: {}, damselNS: 0, grulfFx: 0, hornetPop: 0, grulfHornetPicks: 0 };
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
            if (Object.values(XYZ).includes(ev.code)) C.sps[ev.code] = (C.sps[ev.code] || 0) + 1;
          }
        };
        const ans = (seat) => (prompt, state) => {
          drain();
          let resp;
          try { resp = Engine.botAnswer(prompt, state, data, mem[seat]); } catch (e) { exc++; return undefined; }
          // All idle-command picks (summon / set / activate / spsummon)
          // come back through the one SELECT_IDLECMD prompt: type picks
          // the list (0=summon, 1=spsummon, 3=mset, 5=activate), idx
          // picks inside it. There is no separate SELECT_SUMMON prompt.
          if (seat === themeSeat && prompt.name === 'SELECT_IDLECMD') {
            const v = i32of(resp);
            const type = v == null ? -1 : (v & 0xffff);
            const idx = v == null ? -1 : (v >> 16);
            if (type === 0 && prompt.summon && prompt.summon[idx] && prompt.summon[idx].code === DAMSEL) C.damselNS++;
            if (type === 5 && prompt.activate && prompt.activate[idx]) {
              const a = prompt.activate[idx];
              if (a.code === GRULF && a.loc === LOC.MZONE) C.grulfFx++;
              if (a.code === HORNET && a.loc === LOC.SZONE) C.hornetPop++;
            }
          }
          if (seat === themeSeat && prompt.name === 'SELECT_CARD' && prompt.context && prompt.context.code === GRULF) {
            for (const c of cardPicks(resp, prompt.cards || [])) if (c === HORNET) C.grulfHornetPicks++;
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
        else if (duel.state.winner === themeSeat) C.wins++;
      }
    }
  }
  C.endSeed = seed;
  return C;
}

(async () => {
  const M = await factory();
  const iz = await runSet(M, 'inzektor', ['ishizu', 'gg'], 30, 20271137);
  console.log('inzektor:', JSON.stringify(iz));
  ok(iz.incomplete === 0 && iz.exceptions === 0, 'I1: inzektor set completes with zero exceptions');
  const xyzTotal = (iz.sps[XYZ.BEETLE] || 0) + (iz.sps[XYZ.STAG] || 0) + (iz.sps[XYZ.EMERAL] || 0) + (iz.sps[XYZ.BRILLIANT] || 0) + (iz.sps[XYZ.ROACH] || 0);
  ok(xyzTotal >= 12, 'I2: Xyz summons >= 12 / 120 games (xyz=' + xyzTotal + ')');
  ok((iz.sps[XYZ.BEETLE] || 0) >= 4, 'I3: Exa-Beetle summons >= 4 / 120 games (sps=' + (iz.sps[XYZ.BEETLE] || 0) + ')');
  ok((iz.sps[XYZ.EMERAL] || 0) >= 1, 'I4: Emeral summons >= 1 / 120 games (sps=' + (iz.sps[XYZ.EMERAL] || 0) + ')');
  ok(iz.damselNS >= 30, 'I5: Damsel face-up Normal Summons >= 30 / 120 games (ns=' + iz.damselNS + ')');
  ok(iz.grulfFx >= 7, 'I6: Grulf (1) activations >= 7 / 120 games (fx=' + iz.grulfFx + ')');
  ok(iz.hornetPop >= 25, 'I7: Hornet pop activations >= 25 / 120 games (fx=' + iz.hornetPop + ')');
  ok(iz.grulfHornetPicks >= 2, 'I8: Grulf (1) equips Hornet >= 2 times (picks=' + iz.grulfHornetPicks + ')');
  ok(iz.wins >= 12, 'I9: wins >= 12 / 120 games (wins=' + iz.wins + ')');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL INZEKTOR-OFFER CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
