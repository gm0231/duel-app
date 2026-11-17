'use strict';
/* test-cpu-classic3.js — cpu-classic3-1117 regression pins.
 *
 * The generic policy played all four classic decks structurally
 * wrong (diagnosis on the tuning seed set, offer-level
 * instrumentation; see cpu-classic3-1117):
 *   - Lightsworn: Minerva offered 1423 / chosen 88 (two Lv4 bodies
 *     out-attack the flat 500 table bonus; her mill+draw engine
 *     never priced); Black Rose offered 53 / chosen 3 (lost every
 *     shared offer to Michael; the field wipe never priced);
 *     Raiden (1) offered 518 / chosen 0 (no mill verb in fxKinds,
 *     so the generic fallback scored 0); Lyla (1) offered 377 /
 *     chosen 143 (the destroy branch gates on monster power while
 *     she answers S/T); JD (1) fired 14 times with 1700+ of our
 *     own board standing (the generic destroy gate never looks at
 *     our side).
 *   - Fire King: the whole Rank-4 shelf dead — Dire Wolf /
 *     Delteros / Cowboy / Ark Knight offered 467 each / chosen 0
 *     (two Lv4 1800 bodies out-attack the flat 200 conversion
 *     price); Onslaught scored 0 in 17/57 offers (its End Phase
 *     destruction reads as a removal verb); 真炎の爆発 scored 0
 *     in 2/7 (its End Phase banish reads as a removal verb);
 *     Yaksha (2) picked the Island 11 times, 6 with our monsters
 *     standing (cheapest-loss pricing; the Island's (3) then wipes
 *     our own field).
 *   - Chaos: boss procedures offered in only 111/480 games — Sangan
 *     / Witch fetch by raw ATK and never take the Magician of Faith
 *     (the deck runs three LIGHT cards in total; the procedures
 *     sit dead in hand for want of a LIGHT monster in the grave);
 *     CED (1) offered 8 / chosen 0 (its summon-condition 除外
 *     reads as a banish verb); Brain Control / Change of Heart
 *     fire at the flat Spell 550 with no board judgment, including
 *     Main 2 where the stolen monster cannot attack.
 *   - Gadget: Limiter Removal offered 760 / chosen 0 (the
 *     self-destruction guard returns 0 on the End Phase destruction
 *     of our own Machines — the cost, not the effect); Gear Gigant X
 *     offered 854 / chosen 94 (lost 116 shared offers to Castel,
 *     whose 650 stands with nothing worth bouncing); Emeral offered
 *     436 / chosen 2 (lost to Castel and Gigant at the 200 default).
 *
 * This test re-runs a fixed seed set and pins the counters with
 * margin. It is a REGRESSION pin only — adoption was decided on the
 * fresh-seed bench in cpu-classic3-1117, never on this set.
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

const SPS_WATCH = new Set([
  30100551, 73580471, 57774843, 4779823, 44508094, // LS: Minerva, Black Rose, JD, Michael, Stardust
  95169481, 46772449, 12014404, 48739166, 23015896, 61441708, // FK: Dire Wolf, Delteros, Cowboy, Ark, Garunix, Phoenix
  82301904, 72989439, 9596126, 63519819, // Chaos: CED, BLS, Sorcerer, Thousand-Eyes
  28912357, 581014, 82633039, 5556499, // Gadget: Gigant X, Emeral, Castel, Fortress
]);
const SANGAN = 26202165, WITCH = 78010363, FAITH = 31560081;
async function runSet(M, theme, foes, perDirection, seedStart) {
  const C = { games: 0, incomplete: 0, exceptions: 0, sps: {}, limiterFx: 0, cedFx: 0, faithPicks: 0, searchPicks: 0 };
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
            if (type === 5 && prompt.activate && prompt.activate[idx]) {
              if (prompt.activate[idx].code === 23171610) C.limiterFx++;
              if (prompt.activate[idx].code === 82301904) C.cedFx++;
            }
          }
          if (seat === themeSeat && prompt.name === 'SELECT_CARD' && prompt.context &&
              (prompt.context.code === SANGAN || prompt.context.code === WITCH)) {
            for (const c of cardPicks(resp, prompt.cards || [])) {
              C.searchPicks++;
              if (c === FAITH) C.faithPicks++;
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
  const ls = await runSet(M, 'lightsworn', ['ishizu', 'gg'], 30, 20271127);
  console.log('lightsworn:', JSON.stringify(ls));
  ok(ls.incomplete === 0 && ls.exceptions === 0, 'L1: lightsworn set completes with zero exceptions');
  ok((ls.sps[30100551] || 0) >= 50, 'L2: Minerva summons >= 50 / 120 games (sps=' + (ls.sps[30100551] || 0) + ')');
  ok((ls.sps[73580471] || 0) >= 2, 'L3: Black Rose summons >= 2 / 120 games (sps=' + (ls.sps[73580471] || 0) + ')');
  ok((ls.sps[57774843] || 0) >= 30, 'L4: Judgment Dragon still lands >= 30 / 120 games (sps=' + (ls.sps[57774843] || 0) + ')');
  ok((ls.sps[44508094] || 0) >= 3, 'L5: Stardust still lands >= 3 / 120 games (sps=' + (ls.sps[44508094] || 0) + ')');

  const fk = await runSet(M, 'fireking', ['ishizu', 'gg'], 30, ls.endSeed);
  console.log('fireking:', JSON.stringify(fk));
  ok(fk.incomplete === 0 && fk.exceptions === 0, 'F1: fireking set completes with zero exceptions');
  const fkXyz = (fk.sps[95169481] || 0) + (fk.sps[46772449] || 0) + (fk.sps[12014404] || 0) + (fk.sps[48739166] || 0);
  ok(fkXyz >= 30, 'F2: Fire King Xyz summons >= 30 / 120 games (xyz=' + fkXyz + ')');
  ok((fk.sps[23015896] || 0) >= 250, 'F3: Garunix still lands >= 250 / 120 games (sps=' + (fk.sps[23015896] || 0) + ')');
  ok((fk.sps[61441708] || 0) >= 40, 'F4: Phoenix still lands >= 40 / 120 games (sps=' + (fk.sps[61441708] || 0) + ')');

  const ch = await runSet(M, 'chaos', ['ishizu', 'gg'], 30, fk.endSeed);
  console.log('chaos:', JSON.stringify(ch));
  ok(ch.incomplete === 0 && ch.exceptions === 0, 'C1: chaos set completes with zero exceptions');
  const chBoss = (ch.sps[82301904] || 0) + (ch.sps[72989439] || 0) + (ch.sps[9596126] || 0) + (ch.sps[63519819] || 0);
  ok(chBoss >= 25, 'C2: Chaos boss summons >= 25 / 120 games (boss=' + chBoss + ')');
  ok((ch.sps[72989439] || 0) >= 6, 'C3: BLS summons >= 6 / 120 games (sps=' + (ch.sps[72989439] || 0) + ')');
  ok(ch.faithPicks >= 3, 'C4: Sangan/Witch fetch Magician of Faith >= 3 times (picks=' + ch.faithPicks + '/' + ch.searchPicks + ')');

  const gd = await runSet(M, 'gadget', ['ishizu', 'gg'], 30, ch.endSeed);
  console.log('gadget:', JSON.stringify(gd));
  ok(gd.incomplete === 0 && gd.exceptions === 0, 'G1: gadget set completes with zero exceptions');
  ok((gd.sps[28912357] || 0) >= 30, 'G2: Gear Gigant X summons >= 30 / 120 games (sps=' + (gd.sps[28912357] || 0) + ')');
  ok(gd.limiterFx >= 5, 'G3: Limiter Removal activations >= 5 / 120 games (fx=' + gd.limiterFx + ')');
  ok((gd.sps[5556499] || 0) >= 100, 'G4: Fortress still lands >= 100 / 120 games (sps=' + (gd.sps[5556499] || 0) + ')');
  ok((gd.sps[82633039] || 0) >= 25, 'G5: Castel still lands >= 25 / 120 games (sps=' + (gd.sps[82633039] || 0) + ')');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CPU-CLASSIC3 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
