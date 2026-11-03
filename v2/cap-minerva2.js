'use strict';
/* cap-minerva2.js — deterministic engine-level capture of the
   prompt shape for Minerva's ② when she is destroyed by an
   opponent's card effect. Rigged decks (all-Keldo main for the
   human, all-Raigeki for the CPU) remove shuffle variance:
   T1/T2 summon Keldos, T3 Xyz Minerva, CPU fires Raigeki, and
   every prompt mentioning 30100551 is recorded verbatim.      */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

const MINERVA = 30100551, KELDO = 63542003, RAIGEKI = 12580477;
const captures = [];
function note(prompt, who) {
  const s = JSON.stringify(prompt, (k, v) => typeof v === 'bigint' ? String(v) : v);
  if (s.includes(String(MINERVA))) {
    captures.push({ who, name: prompt.name, code: prompt.code, loc: prompt.loc, desc: prompt.desc,
      context: prompt.context || null,
      entries: prompt.entries ? prompt.entries.map(e => ({ code: e.code, con: e.con, loc: e.loc, seq: e.seq, desc: e.desc })) : undefined });
    console.log('CAPTURE[' + who + ']', JSON.stringify(captures[captures.length - 1]));
  }
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const deckP0 = { main: Array(40).fill(KELDO), extra: [MINERVA, MINERVA, MINERVA] };
  const deckP1 = { main: Array(40).fill(RAIGEKI), extra: [] };
  const humanMem = Engine.makeBotMemory();
  const cpuMem = Engine.makeBotMemory();
  let raigekiFired = false;

  const humanAnswerer = async (prompt, state) => {
    note(prompt, 'human');
    if (prompt.name === 'SELECT_CHAIN' && prompt.entries) {
      const i = prompt.entries.findIndex(e => e.code === MINERVA);
      if (i >= 0) { console.log('human: activating Minerva chain entry', i); return Engine.i32resp(i); }
    }
    if (prompt.name === 'SELECT_EFFECTYN' && prompt.code === MINERVA) return Engine.i32resp(1);
    if (prompt.name === 'SELECT_IDLECMD') {
      const xs = (prompt.spsummon || []).findIndex(a => a.code === MINERVA);
      if (xs >= 0) { console.log('human: XYZ Minerva'); return Engine.cmdResp(1, xs); }
      const lv4 = state.players[0].mzone.filter(c => c && (c.pos & Engine.POS_FACEUP)).length;
      const si = (prompt.summon || []).findIndex(a => a.code === KELDO);
      if (si >= 0 && lv4 < 2) { console.log('human: NS Keldo'); return Engine.cmdResp(0, si); }
      if (prompt.toEP) return Engine.cmdResp(7, 0);
    }
    return Engine.botAnswer(prompt, state, data, humanMem);
  };
  const cpuAnswerer = (prompt, state, d, mem) => {
    note(prompt, 'cpu');
    if (prompt.name === 'SELECT_IDLECMD') {
      const minervaOut = state.players[0].mzone.some(c => c && c.code === MINERVA);
      const ri = (prompt.activate || []).findIndex(a => a.code === RAIGEKI);
      if (minervaOut && ri >= 0 && !raigekiFired) { raigekiFired = true; console.log('cpu: RAIGEKI'); return Engine.cmdResp(5, ri); }
      if (prompt.toEP) return Engine.cmdResp(7, 0);
      if (prompt.toBP) return Engine.cmdResp(6, 0);
    }
    return Engine.botAnswer(prompt, state, d, cpuMem);
  };

  const duel = new Engine.Duel(M, data, {
    seed: 20261103, deckP0, deckP1,
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    humanAnswerer, botAnswerer: cpuAnswerer,
  });
  const stats = await duel.run();
  console.log('--- duel over ---', JSON.stringify({ turns: duel.state.turnCount, winner: stats && stats.winner }));
  console.log('raigekiFired:', raigekiFired, '| captures:', captures.length);
  const grave = captures.filter(c => (c.entries || []).some(e => e.code === MINERVA && e.loc === 16) || (c.loc === 16 && c.code === MINERVA));
  console.log('MINERVA-②-SHAPE:', grave.length ? JSON.stringify(grave[0]) : 'NOT-CAPTURED');
  process.exit(grave.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
