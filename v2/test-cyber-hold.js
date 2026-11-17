'use strict';
/* test-cyber-hold.js — cyber-hold-1118 regression pins.
 *
 * Classic2 made the Cyber conversions happen at scale (Nova 71 -> 660,
 * Infinity 0 -> 381) but wins did not follow (16.9% -> 15.3%): the two
 * Lv5 bodies became a revival/negation stand the Ishizu mill-lock and
 * GG's 3750-wall matchups reward less than raw pressure. Diagnosis on
 * the tuning seed set (20271145, 480 games/arm, same seed stream run
 * twice — profile vs generic hold) found the decision blockage in the
 * board state at the first Nova/Infinity offer:
 *   - weak/far (max opp face-up ATK < 2100, nothing face-down): holding
 *     wins 45.0% vs converting 30.0% (paired delta -6 on n=40,
 *     holdOnly 8 vs profOnly 2) — the two 2100 bodies run everything
 *     over and the conversion halves the damage clock.
 *   - wall/far: converting wins 10.3% vs holding 5.9% (delta +3 on
 *     n=68) — Nova's detach-revive fired in 55/68 games there.
 *   - clear/far and fd/far are a wash (-1 each): the gate is narrowly
 *     "weak", NOT "board clear" — the classic2 guess is measured and
 *     rejected.
 * A second blockage in the same line: Infinity's effects never fired.
 * (3) negate offered 142x, chosen 0x; (2) attach 0 activations in 120
 * games. Infinity had no case in chainEntryValue/newChainValue or in
 * activationScore/newThemeActivation, and the generic tails return 0
 * (no search/draw/ss verb; fxKinds has no attach verb). The conversion
 * line's advertised payoff was never collected.
 *
 * After the fix (same seed set): weak/far holds 106/112 with 41.1%
 * wins, wall/far still converts 211/219, the negate fires 611/983
 * chain offers, the attach fires 146 times in 1,440 games.
 *
 * This test re-runs a fixed seed set (the first 30/direction of the
 * tuning set, 120 games) and pins the counters with margin. It is a
 * REGRESSION pin only — adoption was decided on the fresh-seed bench
 * (20271147, 1,440 games, 21.4% wins vs 15.3% classic2), never on
 * this set.
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

const NOVA = 58069384, INFINITY = 10443957;
async function runSet(M, theme, foes, perDirection, seedStart) {
  const D = Engine.debug;
  const C = { games: 0, wins: 0, incomplete: 0, exceptions: 0, novaSummons: 0, infSummons: 0,
    weakFar: { games: 0, convNova: 0, hold: 0 }, wallFar: { games: 0, convNova: 0, hold: 0 },
    infChainOffers: 0, infChainChosen: 0, infActs: 0, novaActs: 0 };
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
        const rec = { firstOffer: null };
        let duelRef = null;
        const drain = () => {
          if (!duelRef || !duelRef.state) return;
          for (const ev of duelRef.state.events.splice(0, duelRef.state.events.length)) {
            if (ev.con !== themeSeat || ev.kind !== 'spsummon') continue;
            if (ev.code === NOVA) C.novaSummons++;
            if (ev.code === INFINITY) C.infSummons++;
          }
        };
        const ans = (seat) => (prompt, state) => {
          let snap = null;
          // First Nova/Infinity offer of the game: classify the board
          // the same way the diagnosis did (weak = max opp face-up
          // ATK < 2100, no face-down; wall = max >= 2100; far = opp
          // LP > 4200). Summons come back through SELECT_IDLECMD —
          // there is no separate SELECT_SUMMON prompt.
          if (seat === themeSeat && prompt.name === 'SELECT_IDLECMD' && state && !rec.firstOffer) {
            const sp = prompt.spsummon || [];
            if (sp.some(e => e.code === NOVA || e.code === INFINITY)) {
              try {
                const view = D.botView(state, prompt.player, data);
                const me = view.me, opp = view.opp;
                const oppFU = D.faceUpMons(view, opp);
                const oppFD = view.zones[opp].mzone.filter(c => c && !c.faceUp).length;
                const oppMon = view.zones[opp].mzone.filter(c => c).length;
                const oppMaxAtk = oppFU.length ? Math.max(...oppFU.map(c => c.curAtk || 0)) : 0;
                let cls;
                if (oppMon === 0) cls = 'clear';
                else if (oppFD > 0 && oppMaxAtk < 2100) cls = 'fd';
                else if (oppMaxAtk < 2100) cls = 'weak';
                else cls = 'wall';
                const lpB = view.lp[opp] <= 2100 ? 'lethal1' : view.lp[opp] <= 4200 ? 'lethal2' : 'far';
                snap = { cls, lpB };
              } catch (e) { /* test only */ }
            }
          }
          let resp;
          try { resp = Engine.botAnswer(prompt, state, data, mem[seat]); } catch (e) { exc++; return undefined; }
          if (seat === themeSeat && prompt.name === 'SELECT_CHAIN') {
            const v = i32of(resp);
            if (v != null && v >= 0 && prompt.entries[v] && prompt.entries[v].code === INFINITY) C.infChainChosen++;
            (prompt.entries || []).forEach((e) => { if (e.code === INFINITY) C.infChainOffers++; });
          }
          if (snap) {
            const v = i32of(resp);
            const type = v == null ? -1 : (v & 0xffff);
            const idx = v == null ? -1 : (v >> 16);
            snap.decision = (type === 1 && prompt.spsummon[idx]) ? (prompt.spsummon[idx].code === NOVA ? 'nova' : prompt.spsummon[idx].code === INFINITY ? 'infinity' : 'other') : 'hold';
            rec.firstOffer = snap;
          }
          if (seat === themeSeat && prompt.name === 'SELECT_IDLECMD') {
            const v = i32of(resp);
            const type = v == null ? -1 : (v & 0xffff);
            const idx = v == null ? -1 : (v >> 16);
            if (type === 5 && prompt.activate[idx]) {
              if (prompt.activate[idx].code === INFINITY) C.infActs++;
              if (prompt.activate[idx].code === NOVA) C.novaActs++;
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
        if (!duel.over) { C.incomplete++; continue; }
        if (duel.state.winner === themeSeat) C.wins++;
        if (rec.firstOffer && rec.firstOffer.lpB === 'far') {
          const t = rec.firstOffer.cls === 'weak' ? C.weakFar : rec.firstOffer.cls === 'wall' ? C.wallFar : null;
          if (t) {
            t.games++;
            if (rec.firstOffer.decision === 'nova') t.convNova++;
            else t.hold++;
          }
        }
      }
    }
  }
  return C;
}

(async () => {
  const M = await factory();
  const cy = await runSet(M, 'cyber', ['ishizu', 'gg'], 30, 20271145);
  console.log('cyber:', JSON.stringify(cy));
  ok(cy.incomplete === 0 && cy.exceptions === 0, 'H1: cyber set completes with zero exceptions');
  ok(cy.weakFar.games >= 8, 'H2: weak/far first offers >= 8 / 120 games (games=' + cy.weakFar.games + ')');
  ok(cy.weakFar.convNova <= 1, 'H3: weak/far Nova conversions <= 1 (conv=' + cy.weakFar.convNova + ' of ' + cy.weakFar.games + ' — the hold gate)');
  ok(cy.weakFar.hold >= 8, 'H4: weak/far holds >= 8 (hold=' + cy.weakFar.hold + ')');
  ok(cy.wallFar.games >= 12, 'H5: wall/far first offers >= 12 / 120 games (games=' + cy.wallFar.games + ')');
  ok(cy.wallFar.convNova >= 12, 'H6: wall/far Nova conversions >= 12 (conv=' + cy.wallFar.convNova + ' of ' + cy.wallFar.games + ' — converting stays right vs walls)');
  ok(cy.infChainChosen >= 30, 'H7: Infinity negate chosen >= 30 (chosen=' + cy.infChainChosen + ' of ' + cy.infChainOffers + ' offers)');
  ok(cy.infActs >= 5, 'H8: Infinity attach activations >= 5 (acts=' + cy.infActs + ')');
  ok(cy.novaSummons >= 40, 'H9: Nova summons >= 40 / 120 games (sps=' + cy.novaSummons + ')');
  ok(cy.infSummons >= 20, 'H10: Infinity summons >= 20 / 120 games (sps=' + cy.infSummons + ')');
  ok(cy.wins >= 20, 'H11: wins >= 20 / 120 games (wins=' + cy.wins + ')');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL CYBER-HOLD CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
