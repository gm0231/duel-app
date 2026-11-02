'use strict';
/* test-ggfusion.js — regression for the GG contact fusions (see NOTES
   "GG contact fusions: root cause").
 *
 * Root cause pinned by this file's rig: Extra Deck cards were registered
   with pos=1 (face-up). The core stores the position verbatim, and the
   contact-fusion procedure condition (proc_fusion.lua Fusion.ContactCon)
   requires the fusion monster to be IsFacedown() — so every contact
   fusion was silently never offered, while Xyz/Synchro (whose procedure
   conditions do not check IsFacedown) worked. Fix: register the Extra
   Deck face-down (POS.FD_DEF) in Duel.run's addDeck.
 *
 * Method: CHEAT PLACEMENT, labeled — guardian pieces are injected with
 * poc_new_card in the instant before poc_start (not played from hand),
 * everything else is the shipped Duel / data / policy stack. Assertions
 * use direct core queries (poc_query_card) at prompt boundaries, not the
 * JS state mirror. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { LOC } = Engine;

const SANGA = 25955164, KAZEJIN = 62340868, SUIJIN = 98434877;
const F_TW = 34904525, F_COMB = 8505920; // 雷風魔神 / 合体魔神
const FILLER = 45223540;
const POS_FU_ATK = 1, POS_FACEUP = 5, POS_FD_DEF = 0x8;

let failures = 0;
function assert(cond, label) {
  console.log((cond ? '  ok  ' : '  FAIL') + ' ' + label);
  if (!cond) failures++;
}

async function runRig(M, data, variant) {
  const realCcall = M.ccall.bind(M);
  let duelHandle = 0, injected = false;
  M.ccall = function (name, ...rest) {
    if (name === 'poc_start' && duelHandle && !injected) {
      injected = true;
      for (const c of variant.cheat) {
        realCcall('poc_new_card', null,
          ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
          [duelHandle, 0, 0, c.code, c.con, c.loc, c.seq, c.pos]);
      }
    }
    const r = realCcall(name, ...rest);
    if (name === 'poc_create') duelHandle = r;
    return r;
  };

  const offers = [];       // every spsummon code offered to P0, in order
  const probes = [];       // core-query snapshots at each P0 IDLECMD
  const mem = Engine.makeBotMemory();
  const duel = new Engine.Duel(M, data, {
    seed: 424242,
    deckP0: { main: Array(40).fill(FILLER), extra: [F_TW, 61398234, 97783338, F_COMB, 99551425] },
    deckP1: { main: Array(5).fill(FILLER), extra: [] }, // P1 decks out on its 2nd turn, ending the rig
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    humanAnswerer: async (prompt, state) => {
      if (prompt.name === 'SELECT_IDLECMD' && prompt.player === 0) {
        const q = (loc, seq) => duel.queryCard(0, loc, seq);
        const snap = { ex: {}, mz: [], banished: [] };
        for (let s = 0; s < 5; s++) { const r = q(LOC.EXTRA, s); if (r) snap.ex[r.code] = r.pos; }
        for (let s = 0; s < 5; s++) { const r = q(LOC.MZONE, s); if (r) snap.mz.push(r.code); }
        for (let s = 0; s < 8; s++) { const r = q(LOC.REMOVED, s); if (r) snap.banished.push(r.code); }
        probes.push(snap);
        for (const e of prompt.spsummon) offers.push(e.code);
        if (variant.take) {
          const idx = prompt.spsummon.findIndex(e => e.code === variant.take);
          if (idx >= 0) return Engine.cmdResp(1, idx);
        }
        return Engine.cmdResp(7, 0); // to EP
      }
      return Engine.botAnswer(prompt, state, data, mem);
    },
    botAnswerer: (prompt, state, d, m2) => Engine.botAnswer(prompt, state, d, m2),
  });
  let stats = null, err = null;
  try { stats = await duel.run(); } catch (e) { err = e; }
  M.ccall = realCcall;
  return { offers, probes, stats, err, over: duel.over };
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const MZ = (code, seq) => ({ code, con: 0, loc: LOC.MZONE, seq, pos: POS_FU_ATK });
  const SZ = (code, seq) => ({ code, con: 0, loc: LOC.SZONE, seq, pos: POS_FU_ATK });

  console.log('== MZ2: Sanga+Kazejin face-up in MZONE (cheat placement)');
  let r = await runRig(M, data, { cheat: [MZ(SANGA, 0), MZ(KAZEJIN, 1)] });
  assert(r.probes.length > 0 && r.probes[0].ex[F_TW] === POS_FD_DEF,
    'extra deck fusion is registered face-down (pos=' + (r.probes[0] && r.probes[0].ex[F_TW]) + ')');
  assert(r.offers.includes(F_TW), 'two-piece contact fusion 34904525 is offered');
  assert(r.over && r.stats.retries === 0, 'duel completes, MSG_RETRY 0');

  console.log('== SZ2: Sanga+Kazejin face-up in SZONE (cheat placement)');
  r = await runRig(M, data, { cheat: [SZ(SANGA, 0), SZ(KAZEJIN, 1)] });
  assert(r.offers.includes(F_TW), 'contact fusion offered from S/T-zone pieces (the deck\'s real line)');
  assert(r.over && r.stats.retries === 0, 'duel completes, MSG_RETRY 0');

  console.log('== MZ2_TAKE: take the two-piece fusion');
  r = await runRig(M, data, { take: F_TW, cheat: [MZ(SANGA, 0), MZ(KAZEJIN, 1)] });
  const lastM = r.probes[r.probes.length - 1] || { mz: [], banished: [] };
  assert(lastM.mz.includes(F_TW), 'fusion monster is on the field after the summon');
  assert(lastM.banished.includes(SANGA) && lastM.banished.includes(KAZEJIN),
    'both materials were banished as cost');
  assert(r.over && r.stats.retries === 0, 'duel completes, MSG_RETRY 0');

  console.log('== ALL3_TAKE: Sanga MZ + Kazejin MZ + Suijin GRAVE, take Combined');
  r = await runRig(M, data, {
    take: F_COMB,
    cheat: [MZ(SANGA, 0), MZ(KAZEJIN, 1), { code: SUIJIN, con: 0, loc: LOC.GRAVE, seq: 0, pos: POS_FACEUP }],
  });
  const lastA = r.probes[r.probes.length - 1] || { mz: [], banished: [] };
  assert(r.offers.includes(F_COMB), 'three-piece Combined 8505920 is offered (hand/field/GY materials)');
  assert(lastA.mz.includes(F_COMB), 'Combined is on the field after the summon');
  assert([SANGA, KAZEJIN, SUIJIN].every(c => lastA.banished.includes(c)),
    'all three materials banished, including Suijin from the GY');
  assert(r.over && r.stats.retries === 0, 'duel completes, MSG_RETRY 0');

  console.log(failures === 0 ? 'TEST PASS' : 'TEST FAIL (' + failures + ' failures)');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
