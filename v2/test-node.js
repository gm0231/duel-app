'use strict';
/* test-node.js — drives a full duel in Node through the SAME engine.js code
   paths the browser UI uses (parsePrompt / encoders / GameState / Duel).
   Seat 0 ("human") is answered by the bot policy standing in for a person;
   seat 1 is the CPU bot. Asserts: duel completes, 0 MSG_RETRY, and card
   conservation per player at every prompt boundary. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const expected = [data.decks.ishizu.main.length + data.decks.ishizu.extra.length,
                    data.decks.gg.main.length + data.decks.gg.extra.length];
  let violations = 0, checks = 0;
  const check = (state, where) => {
    checks++;
    for (let p = 0; p < 2; p++) {
      const total = state.totalCards(p);
      if (total !== expected[p]) {
        violations++;
        if (violations <= 5) console.log('CONSERVATION VIOLATION at ' + where + ': P' + p + ' total=' + total + ' expected=' + expected[p]);
      }
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
