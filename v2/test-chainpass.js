'use strict';
/* test-chainpass.js — zero-option chain prompts (user report
   2026-11-04: "何も発動できるものなくても聞いてくるのは不毛").
   The core sends MSG_SELECT_CHAIN at every timing window even when
   the player has NOTHING chainable (measured: 983 of 1692 chain
   prompts to the human seat in bot duels carried 0 entries, 58%);
   passing is then the only legal answer and asking is pure
   friction. The guarantee pinned here:
     - zero live options (no entries at all, or every candidate
       dismissed for this chain / mixed with duel dismissals)
       -> auto-pass at the uiAnswer choke point, nothing shown;
     - every candidate duel-dismissed -> decision 'flash': uiChain's
       visible auto-pass (flash + short delay) owns it;
     - >= 1 live candidate, and ALL forced prompts -> shown.
   Part A unit-tests chainPassDecision (client.js in a stub DOM via
   vm, same technique as test-fxidentify). Part B runs real engine
   duels where the bot plays both seats' non-chain prompts and the
   REAL uiAnswer/uiChain answers every SELECT_CHAIN in the stub
   DOM, asserting decision-vs-display agreement for every one of
   several hundred prompts, 0 MSG_RETRY, and duel completion. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder, TextDecoder } = require('util');

const V2 = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

// ---- stub DOM shared by both parts (client.js load + uiChain draw)
function stubEl() {
  return {
    children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', className: '', disabled: false, volume: 1,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, click() {}, animate: () => ({}), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    setAttribute() {}, removeAttribute() {}, remove() {}, play: () => Promise.resolve(), pause() {}, load() {},
  };
}
const els = {};
const documentStub = {
  getElementById: (id) => els[id] || (els[id] = stubEl()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, createElement: () => stubEl(), body: stubEl(),
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON,
  TextEncoder, TextDecoder,
  document: documentStub,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Audio: class { constructor() {} play() { return Promise.resolve(); } pause() {} },
  fetch: async () => ({ ok: true, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) }),
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  location: { href: 'http://localhost/v2/', search: '' },
  navigator: { userAgent: 'node' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(V2, 'engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });
const trailer = '\n;globalThis.__T = { uiAnswer, chainPassDecision, chainKey,' +
  ' setDATA: (d) => { DATA = d; },' +
  ' setDuel: (d) => { duel = d; },' +
  ' setDismissed: (chains, duel) => { dismissedChains = chains; dismissedDuel = duel; },' +
  ' dismissedChainsSize: () => dismissedChains.size,' +
  ' setResp: (v) => { fxSettings.resp = v; },' +
  ' answerCurrent: (bytes) => { if (currentPrompt) { const cp = currentPrompt; currentPrompt = null; cp.resolve(bytes); } } };';
vm.runInContext(fs.readFileSync(path.join(V2, 'client.js'), 'utf8') + trailer, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
const E = sandbox.Engine;
T.setDATA(data);

// ================= Part A: chainPassDecision matrix =================
const A = { code: 99937011, con: 0, loc: 8, seq: 0, desc: 99937011 << 20 };
const B = { code: 63542003, con: 0, loc: 16, seq: 1, desc: 63542003 << 20 };
const kA = T.chainKey(A), kB = T.chainKey(B);
const chainState = { chain: [{}] };   // a chain is being built
const openState = { chain: [] };      // open game state window
const P = (forced, entries) => ({ name: 'SELECT_CHAIN', forced, entries });

T.setResp('auto');
T.setDismissed(new Set(), new Map());
ok(T.chainPassDecision(P(false, []), chainState) === 'pass', 'CP1: zero entries -> pass (no prompt)');
ok(T.chainPassDecision(P(true, []), chainState) === 'show', 'CP2: forced zero entries -> show (never auto-pass a forced prompt)');
ok(T.chainPassDecision(P(false, [A]), chainState) === 'show', 'CP3: one live candidate -> show');
ok(T.chainPassDecision(P(true, [A]), chainState) === 'show', 'CP4: forced with candidate -> show');

T.setDismissed(new Set(), new Map([[kA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(false, [A]), chainState) === 'flash', 'CP5: only candidate duel-dismissed -> flash (uiChain visible auto-pass)');
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A]), chainState) === 'pass', 'CP6: only candidate chain-dismissed -> silent pass');
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'show', 'CP7: one dismissed + one live -> show');
T.setDismissed(new Set([kB]), new Map([[kA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'pass', 'CP8: mixed dismissals leave zero live -> silent pass');
T.setDismissed(new Set(), new Map([[kA, { code: A.code, desc: A.desc }], [kB, { code: B.code, desc: B.desc }]]));
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'flash', 'CP9: all candidates duel-dismissed -> flash');
T.setDismissed(new Set(), new Map([[kA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(true, [A]), chainState) === 'show', 'CP10: forced beats dismissal -> show');

T.setResp('on'); // 毎回: dismissals are ignored by design
T.setDismissed(new Set([kA]), new Map([[kA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(false, [A]), chainState) === 'show', 'CP11: resp on ignores dismissals -> show');
ok(T.chainPassDecision(P(false, []), chainState) === 'pass', 'CP12: resp on still passes a zero-entry prompt (nothing to confirm)');
T.setResp('auto');

// per-chain dismissal reset: a finished chain's dismissals must not
// suppress the first prompt of an open-state window
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A]), openState) === 'show' && T.dismissedChainsSize() === 0,
  'CP13: empty chain resets per-chain dismissals before deciding');
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A]), chainState) === 'pass' && T.dismissedChainsSize() === 1,
  'CP14: mid-chain dismissals survive while the chain is live');
T.setDismissed(new Set(), new Map());

// ================= Part B: real duels, real uiAnswer =================
const factory = require(path.join(V2, 'build', 'ocgcore.js'));
const tick = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const M = await factory();
  T.setDuel({ refreshFieldStats: () => {} });
  const stats = { chain: 0, byDecision: {}, violations: [], retries: 0, completed: 0, forced: 0 };
  const configs = [
    { seed: 3, humanDeck: 'ishizu' }, { seed: 11, humanDeck: 'ishizu' }, { seed: 27, humanDeck: 'ishizu' },
    { seed: 5, humanDeck: 'gg' }, { seed: 19, humanDeck: 'gg' },
  ];
  for (const cfg of configs) {
    const mem = E.makeBotMemory();
    const duel = new E.Duel(M, data, {
      seed: cfg.seed * 977 + 13,
      deckP0: data.decks[cfg.humanDeck],
      deckP1: data.decks[cfg.humanDeck === 'gg' ? 'ishizu' : 'gg'],
      pace: { bot: 0, botChain: 0, batch: 0 },
      sleep: () => Promise.resolve(),
      humanAnswerer: async (prompt, state) => {
        if (prompt.name !== 'SELECT_CHAIN') return E.botAnswer(prompt, state, data, mem);
        stats.chain++;
        if (prompt.forced) stats.forced++;
        const decision = T.chainPassDecision(prompt, state);
        stats.byDecision[decision] = (stats.byDecision[decision] || 0) + 1;
        const dock = els.dock || (els.dock = stubEl());
        // The real client clears the dock after every answered
        // prompt (finishPrompt -> clearInteraction -> dockClose);
        // this harness answers via answerCurrent, bypassing that
        // cleanup, so mirror it here — otherwise a redrawn dock
        // with byte-identical HTML reads as "not drawn".
        dock.innerHTML = ''; dock.className = '';
        const beforeHTML = dock.innerHTML;
        const p = T.uiAnswer(prompt, state);
        let settled = false;
        p.then(() => { settled = true; }, () => { settled = true; });
        for (let i = 0; i < 30 && !settled; i++) await tick(10);
        const dockDrawn = dock.className === 'on' && dock.innerHTML !== beforeHTML;
        if (decision === 'pass') {
          if (!settled) stats.violations.push('seed' + cfg.seed + ': pass decision did not settle promptly');
          if (dockDrawn) stats.violations.push('seed' + cfg.seed + ': dock drawn for a pass decision');
        } else if (decision === 'flash') {
          if (dockDrawn) stats.violations.push('seed' + cfg.seed + ': dock drawn for a flash decision');
          for (let i = 0; i < 200 && !settled; i++) await tick(10);
          if (!settled) stats.violations.push('seed' + cfg.seed + ': flash decision never settled');
        } else { // show
          if (!dockDrawn) stats.violations.push('seed' + cfg.seed + ': show decision but dock not drawn (n=' + prompt.entries.length + ', forced=' + prompt.forced + ')');
          else {
            const n = (dock.innerHTML.match(/data-chain=/g) || []).length;
            if (n === 0) stats.violations.push('seed' + cfg.seed + ': dock drawn with zero candidate elements');
          }
          if (settled) stats.violations.push('seed' + cfg.seed + ': show decision settled before an answer was given');
          // a player must pick a candidate when forced (pass is
          // illegal there and the core retries); otherwise pass
          T.answerCurrent(prompt.forced ? E.i32resp(0) : E.i32resp(-1));
        }
        return p;
      },
    });
    const st = await duel.run();
    stats.retries += st.retries;
    if (st.stopReason.startsWith('duel ended')) stats.completed++;
    else stats.violations.push('seed' + cfg.seed + ': duel stopped abnormally: ' + st.stopReason);
    console.log('  duel seed=' + cfg.seed + ' human=' + cfg.humanDeck + ' stop=' + st.stopReason +
      ' chainDecisions=' + JSON.stringify(stats.byDecision));
  }
  ok(stats.completed === configs.length, 'CPB1: all ' + configs.length + ' duels completed (' + stats.completed + ')');
  ok(stats.retries === 0, 'CPB2: 0 MSG_RETRY across all duels (' + stats.retries + ')');
  ok(stats.violations.length === 0, 'CPB3: decision/display agreement for every chain prompt' +
    (stats.violations.length ? ' — violations: ' + stats.violations.slice(0, 5).join(' ; ') : ' (' + stats.chain + ' prompts)'));
  ok((stats.byDecision.pass || 0) > 0, 'CPB4: zero-option prompts occurred and auto-passed (' + (stats.byDecision.pass || 0) + ')');
  ok((stats.byDecision.show || 0) > 0, 'CPB5: live-option prompts occurred and were shown (' + (stats.byDecision.show || 0) + ')');
  console.log('  (forced chain prompts seen: ' + stats.forced + ' — decision/show behaviour for forced is pinned by CP2/CP4/CP10)');
  console.log(failures === 0 ? 'ALL CHAINPASS CHECKS PASSED' : failures + ' CHAINPASS CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
