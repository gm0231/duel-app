'use strict';
/* test-logdetail.js — the detailed history stream (state.dlog).
   User report (2026-11-03): the history log carried headlines
   only — which effect activated, what processing happened and
   what the outcome was (destroyed / sent / damaged / returned)
   was written nowhere. The mirror now keeps a structured detailed
   stream next to the headline log; this test drives full duels
   and asserts the stream actually reconstructs a duel:
     - activations arrive as structured chain entries (code+desc
       for the client's fx resolver), with solve headers,
     - outcome lines exist for the major result kinds (destroy,
       banish, mill/send to grave, LP deltas with before/after),
     - no placeholder garbage ('#0', 'undefined', 'NaN') in texts,
     - hidden information is not printed: the opponent's set cards
       stay generic and their draws stay count-only.
   Effect NUMBERS are resolved client-side (fxmap) and are covered
   by the jsdom history test + visual captures, not here. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

async function runDuel(M, data, seed) {
  const mem0 = Engine.makeBotMemory(), mem1 = Engine.makeBotMemory();
  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    humanAnswerer: async (prompt, state) => Engine.botAnswer(prompt, state, data, mem0),
    botAnswerer: (prompt, state, d, mem) => Engine.botAnswer(prompt, state, d, mem1),
  });
  await duel.run();
  return duel.state;
}

function renderPlain(state, e) {
  const who = e.con === 0 ? '自分' : '相手';
  const nm = (c) => state.names[c] || ('#' + c);
  if (e.k === 'act') return 'リンク' + e.link + '：' + who + ' の ' + nm(e.code) + ' の効果[desc idx ' + (e.desc ? e.desc % 1048576 : '-') + ']' + (e.tgt ? '（対象：' + e.tgt + '）' : '');
  if (e.k === 'solve') return '▼ 解決：リンク' + e.link + ' ' + nm(e.code);
  if (e.k === 'neg') return who + ' の ' + nm(e.code) + ' の発動が無効になった';
  if (e.k === 'dis') return who + ' の ' + nm(e.code) + ' の効果が無効になった';
  return e.s || '';
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const seeds = [20261102, 7, 99];
  let allAct = 0, allSolve = 0, allOutcome = 0, allDmg = [], sample = null;
  for (const seed of seeds) {
    const st = await runDuel(M, data, seed);
    const dl = st.dlog;
    ok(dl.length >= 25 && dl.length > st.log.length, 'seed ' + seed + ': detailed stream is substantial (' + dl.length + ' entries vs headline ' + st.log.length + ')');
    const acts = dl.filter(e => e.k === 'act'), solves = dl.filter(e => e.k === 'solve');
    allAct += acts.length; allSolve += solves.length;
    ok(acts.length >= 3, 'seed ' + seed + ': chain activations recorded (' + acts.length + ')');
    ok(acts.every(e => e.code && e.link >= 1 && e.cid >= 1), 'seed ' + seed + ': act entries carry code/link/episode');
    ok(solves.length >= 1, 'seed ' + seed + ': resolution headers recorded (' + solves.length + ')');
    ok(solves.every(e => acts.some(a => a.cid === e.cid && a.link === e.link)), 'seed ' + seed + ': every solve header matches an activation in its episode');
    const outcomes = dl.filter(e => e.s && /(破壊され|除外された|墓地へ送られた|デッキから墓地|手札に戻った|デッキに戻った|コントロールが)/.test(e.s));
    allOutcome += outcomes.length;
    ok(outcomes.length >= 3, 'seed ' + seed + ': outcome lines recorded (' + outcomes.length + ')');
    const dmgs = dl.filter(e => e.k === 'dmg');
    allDmg = allDmg.concat(dmgs);
    ok(dmgs.every(e => /LP \d+ → -?\d+/.test(e.s)), 'seed ' + seed + ': damage lines carry LP before/after (' + dmgs.length + ')');
    const texts = dl.map(e => renderPlain(st, e)).join('\n');
    ok(!/(#0|undefined|NaN|\[object)/.test(texts), 'seed ' + seed + ': no placeholder garbage in rendered texts');
    // hidden information: seat 1 is the opponent (humanPlayer = 0)
    const oppSets = dl.filter(e => e.k === 'info' && /相手：/.test(e.s || '') && /セット/.test(e.s || ''));
    ok(oppSets.every(e => e.s === '相手：カードをセット'), 'seed ' + seed + ': opponent set cards stay generic');
    const oppDraws = dl.filter(e => e.k === 'info' && /^相手：\d+ 枚ドロー$/.test(e.s || ''));
    const namedOppDraw = dl.some(e => e.k === 'info' && /^相手：ドロー（/.test(e.s || ''));
    ok(!namedOppDraw, 'seed ' + seed + ': opponent draws stay count-only (' + oppDraws.length + ' count lines)');
    if (!sample) sample = { st, dl };
  }
  // Deck order is shuffled per process (shuffledCopy), so an
  // individual seed's game is not reproducible across runs — a
  // mill-heavy game can legitimately end by deck-out with little
  // or no damage. Damage is therefore asserted in aggregate.
  ok(allDmg.length >= 3, 'totals across seeds: damage lines recorded (' + allDmg.length + ')');
  ok(allAct >= 15 && allSolve >= 5 && allOutcome >= 10, 'totals across seeds: act=' + allAct + ' solve=' + allSolve + ' outcomes=' + allOutcome);
  console.log('--- sample detailed stream (seed ' + seeds[0] + ', first 60 entries) ---');
  for (const e of sample.dl.slice(0, 60)) console.log('T' + e.turn + ' [' + (e.ph || '-') + ']' + (e.cid ? ' C' + e.cid : '') + (e.sol ? ' sol' + e.sol : '') + ' ' + renderPlain(sample.st, e));
  console.log(failures === 0 ? 'ALL LOGDETAIL CHECKS PASSED' : failures + ' LOGDETAIL CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
