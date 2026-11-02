'use strict';
/* test-node.js — drives a full duel in Node through the SAME engine.js code
   paths the browser UI uses (parsePrompt / encoders / GameState / Duel).
   Seat 0 ("human") is answered by the bot policy standing in for a person;
   seat 1 is the CPU bot. Asserts: duel completes, 0 MSG_RETRY, and card
   conservation at every prompt boundary.
   Conservation rule (corrected in the mirror-totals investigation — see
   NOTES.md): the mirror counts cards by CONTROLLER, so a raw per-seat
   total legitimately deviates from the owner's deck size while a control
   change lasts (e.g. Monster Reborn taking the opponent's monster — this
   was the intermittent "P0 59 / P1 54" failure here). The strict rule that
   IS valid at every prompt: (1) the combined total equals the pool, and
   (2) each seat's deviation equals its foreign-card balance (cards of the
   other pool in this seat's zones, minus the reverse). The two pools are
   disjoint, so the balance is computed exactly from the mirror's zone
   entries; overlay units are counted through their host entry. A deck can
   hold no foreign card in this pool (no effect places one there), and the
   deck is count-only in the mirror, so deck counts are covered by (1). */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

function foreignCounts(state, pools) {
  const foreign = [0, 0];
  for (let p = 0; p < 2; p++) {
    const P = state.players[p];
    const scan = (entries, withMats) => {
      for (const e of entries) {
        if (!e) continue;
        const code = typeof e === 'object' ? e.code : e;
        if (code && pools[1 - p].has(code)) { foreign[p]++; if (withMats) foreign[p] += (e.materials || 0); }
      }
    };
    scan(P.hand, false); scan(P.grave, false); scan(P.removed, false);
    scan(P.extra, true); scan(P.mzone, true); scan(P.szone, false);
  }
  return foreign;
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  const pools = [new Set(data.decks.ishizu.main.concat(data.decks.ishizu.extra)),
                 new Set(data.decks.gg.main.concat(data.decks.gg.extra))];
  let violations = 0, checks = 0;
  const check = (state, where) => {
    checks++;
    const foreign = foreignCounts(state, pools);
    let bad = state.totalCards(0) + state.totalCards(1) !== expected[0] + expected[1];
    for (let p = 0; p < 2; p++)
      if (state.totalCards(p) - expected[p] !== foreign[p] - foreign[1 - p]) bad = true;
    if (bad) {
      violations++;
      if (violations <= 5) console.log('CONSERVATION VIOLATION at ' + where + ': totals=' +
        state.totalCards(0) + '/' + state.totalCards(1) + ' expected=' + expected.join('/') +
        ' foreignBalance=' + (foreign[0] - foreign[1]) + '/' + (foreign[1] - foreign[0]));
    }
  };
  const humanMem = Engine.makeBotMemory();
  const duel = new Engine.Duel(M, data, {
    seed: 20261102,
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    onLog: (l) => console.log('[core]', l),
    humanAnswerer: async (prompt, state) => {
      check(state, 'human prompt ' + prompt.name);
      return Engine.botAnswer(prompt, state, data, humanMem);
    },
    botAnswerer: (prompt, state, d, mem) => {
      check(state, 'bot prompt ' + prompt.name);
      return Engine.botAnswer(prompt, state, d, mem);
    },
  });
  const stats = await duel.run();
  check(duel.state, 'final state'); // the end state must satisfy the same rule
  const st = duel.state;
  console.log('--- result ---');
  console.log(JSON.stringify(stats, null, 1));
  console.log('winner:', st.winner, 'reason:', st.winReason, '(1=LP, 2=deck-out)');
  console.log('final LP:', st.players[0].lp, '/', st.players[1].lp);
  console.log('final totals:', st.totalCards(0), '/', st.totalCards(1), 'expected', expected.join('/'));
  console.log('conservation checks:', checks, 'violations:', violations);
  const ok = duel.over && stats.retries === 0 && violations === 0;
  console.log(ok ? 'TEST PASS' : 'TEST FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
