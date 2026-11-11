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
const trailer = '\n;globalThis.__T = { uiAnswer, chainPassDecision, chainKey, duelKey, openDismissManager,' +
  ' setDATA: (d) => { DATA = d; },' +
  ' setFXMAP: (m) => { FXMAP = m; },' +
  ' setDuel: (d) => { duel = d; },' +
  ' setDismissed: (chains, duel) => { dismissedChains = chains; dismissedDuel = duel; },' +
  ' dismissedChainsSize: () => dismissedChains.size,' +
  ' setResp: (v) => { fxSettings.resp = v; },' +
  ' answerCurrent: (bytes) => { if (currentPrompt) { const cp = currentPrompt; currentPrompt = null; cp.resolve(bytes); } } };';
vm.runInContext(fs.readFileSync(path.join(V2, 'client.js'), 'utf8') + trailer, sandbox, { filename: 'client.js' });
const T = sandbox.__T;
const E = sandbox.Engine;
T.setDATA(data);
T.setFXMAP(JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8')));

// ================= Part A: chainPassDecision matrix =================
// descs are real Stringids (code * 2^20 + idx, multiplication — a
// << shift overflows int32 and decodes to garbage)
const A = { code: 99937011, con: 0, loc: 8, seq: 0, desc: 99937011 * 1048576 };       // 剣神官ムドラ ①
const B = { code: 63542003, con: 0, loc: 16, seq: 1, desc: 63542003 * 1048576 };      // 宿神像ケルドウ ①
const kA = T.chainKey(A), kB = T.chainKey(B);   // per-chain (instance) keys
const dA = T.duelKey(A), dB = T.duelKey(B);     // duel (card+effect class) keys
const chainState = { chain: [{}] };   // a chain is being built
const openState = { chain: [] };      // open game state window
const P = (forced, entries) => ({ name: 'SELECT_CHAIN', forced, entries });

T.setResp('auto');
T.setDismissed(new Set(), new Map());
ok(T.chainPassDecision(P(false, []), chainState) === 'pass', 'CP1: zero entries -> pass (no prompt)');
ok(T.chainPassDecision(P(true, []), chainState) === 'show', 'CP2: forced zero entries -> show (never auto-pass a forced prompt)');
ok(T.chainPassDecision(P(false, [A]), chainState) === 'show', 'CP3: one live candidate -> show');
ok(T.chainPassDecision(P(true, [A]), chainState) === 'show', 'CP4: forced with candidate -> show');

T.setDismissed(new Set(), new Map([[dA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(false, [A]), chainState) === 'flash', 'CP5: only candidate duel-dismissed -> flash (uiChain visible auto-pass)');
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A]), chainState) === 'pass', 'CP6: only candidate chain-dismissed -> silent pass');
T.setDismissed(new Set([kA]), new Map());
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'show', 'CP7: one dismissed + one live -> show');
T.setDismissed(new Set([kB]), new Map([[dA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'pass', 'CP8: mixed dismissals leave zero live -> silent pass');
T.setDismissed(new Set(), new Map([[dA, { code: A.code, desc: A.desc }], [dB, { code: B.code, desc: B.desc }]]));
ok(T.chainPassDecision(P(false, [A, B]), chainState) === 'flash', 'CP9: all candidates duel-dismissed -> flash');
T.setDismissed(new Set(), new Map([[dA, { code: A.code, desc: A.desc }]]));
ok(T.chainPassDecision(P(true, [A]), chainState) === 'show', 'CP10: forced beats dismissal -> show');

T.setResp('on'); // 毎回: dismissals are ignored by design
T.setDismissed(new Set([kA]), new Map([[dA, { code: A.code, desc: A.desc }]]));
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

// ============ BU-04: duel dismissal is a card+effect class ============
// Ruling (user, 2026-11-05): the same card's same effect is never
// asked again this duel — location, copy and scene do not matter.
// A different effect number of the same card is a different class.
ok(dA === A.code + '|fx1' && dB === B.code + '|fx1', 'DK0: duel keys name card + resolved effect number');
const A2 = { code: A.code, con: 0, loc: 16, seq: 2, desc: A.desc };  // Mudora ① again: grave, another copy
ok(T.chainKey(A2) !== kA && T.duelKey(A2) === dA,
  'DK1: same card+effect across location/copy shares the duel class (instance keys differ)');
const Aeff2 = { code: A.code, con: 0, loc: 8, seq: 0, desc: A.code * 1048576 + 1 };  // Mudora ②
ok(T.duelKey(Aeff2) === A.code + '|fx2' && T.duelKey(Aeff2) !== dA,
  'DK2: a different effect number of the same card is a different class');
T.setDismissed(new Set(), new Map([[dA, { code: A.code, desc: A.desc, loc: A.loc }]]));
ok(T.chainPassDecision(P(false, [A2]), chainState) === 'flash',
  'DK3: dismissed effect auto-passes when it returns from another location/copy');
ok(T.chainPassDecision(P(false, [Aeff2]), chainState) === 'show',
  'DK4: the same card\'s other effect is still asked');
ok(T.chainPassDecision(P(false, [A2, Aeff2]), chainState) === 'show',
  'DK5: dismissed class + live effect of one card -> shown');
{ // un-dismiss (what the manager's 解除 button deletes) restores asking
  const m = new Map([[dA, { code: A.code, desc: A.desc, loc: A.loc }]]);
  T.setDismissed(new Set(), m); m.delete(dA);
  ok(T.chainPassDecision(P(false, [A2]), chainState) === 'show', 'DK6: un-dismissing the class restores the question');
}
// a desc-less Spell/Trap activation cannot pin an effect: the card
// alone is the class, shared by every copy
const ST = { code: 38699854, con: 0, loc: 2, seq: 0, desc: 0 };    // 太陽の書, hand copy 1
const ST2 = { code: 38699854, con: 0, loc: 2, seq: 1, desc: 0 };   // hand copy 2
ok(T.duelKey(ST) === ST.code + '|card' && T.duelKey(ST2) === T.duelKey(ST),
  'DK7: a desc-less card activation classes by the card alone');
T.setDismissed(new Set(), new Map([[T.duelKey(ST), { code: ST.code, desc: 0, loc: ST.loc }]]));
ok(T.chainPassDecision(P(false, [ST2]), chainState) === 'flash',
  'DK8: the other copy of a dismissed activation auto-passes');
T.setDismissed(new Set(), new Map());

// ================= Part B: real duels, real uiAnswer =================
const factory = require(path.join(V2, 'build', 'ocgcore.js'));
const tick = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const M = await factory();
  T.setDuel({ refreshFieldStats: () => {} });

  // ---- BU-04/BU-16 through the REAL uiAnswer/uiChain (stub DOM) ----
  const dockEl = els.dock || (els.dock = stubEl());
  const state1 = { chain: [{ code: A.code }], turnPlayer: 0, turnCount: 1, phaseName: 'MAIN1' };
  { // the duel-dismiss control names the new card+effect scope (BU-16)
    dockEl.innerHTML = ''; dockEl.className = '';
    const p = T.uiAnswer(P(false, [A]), state1);
    p.then(() => {}, () => {});
    for (let i = 0; i < 50 && dockEl.className !== 'on'; i++) await tick(10);
    ok(dockEl.innerHTML.includes('このデュエル中は聞かない（このカードのこの効果）'),
      'DK9: duel-dismiss button states the card+effect scope');
    ok(!dockEl.innerHTML.includes('この場所での'), 'DK10: old instance-scope wording is gone');
    T.answerCurrent(E.i32resp(-1));
  }
  { // fx-ui round 2 (F3): every live candidate carries an explicit
    // 発動する button of its own; a chain-dismissed candidate —
    // whose box tap is inert — carries none. (Click-through in a
    // real DOM is covered by test-ui's F3 probe.)
    T.setDismissed(new Set(), new Map());
    dockEl.innerHTML = ''; dockEl.className = '';
    const p = T.uiAnswer(P(false, [A, B]), state1);
    p.then(() => {}, () => {});
    for (let i = 0; i < 50 && dockEl.className !== 'on'; i++) await tick(10);
    const acts = [...dockEl.innerHTML.matchAll(/data-chainact="(\d+)"/g)].map(m => m[1]);
    ok(acts.length === 2 && acts[0] === '0' && acts[1] === '1' && (dockEl.innerHTML.match(/発動する/g) || []).length === 2,
      'DK15: F3 — both chain candidates carry an explicit 発動する button (got ' + JSON.stringify(acts) + ')');
    T.answerCurrent(E.i32resp(-1));
    T.setDismissed(new Set([kA]), new Map());
    dockEl.innerHTML = ''; dockEl.className = '';
    const p2 = T.uiAnswer(P(false, [A, B]), state1);
    p2.then(() => {}, () => {});
    for (let i = 0; i < 50 && dockEl.className !== 'on'; i++) await tick(10);
    const acts2 = [...dockEl.innerHTML.matchAll(/data-chainact="(\d+)"/g)].map(m => m[1]);
    ok(acts2.length === 1 && acts2[0] === '1', 'DK16: F3 — the chain-dismissed candidate gets no 発動する button (got ' + JSON.stringify(acts2) + ')');
    T.answerCurrent(E.i32resp(-1));
    T.setDismissed(new Set(), new Map());
  }
  { // a dismissed class returning from the grave (another copy, a
    // later scene) auto-passes through uiChain's flash path
    T.setDismissed(new Set(), new Map([[dA, { code: A.code, desc: A.desc, loc: A.loc }]]));
    dockEl.innerHTML = ''; dockEl.className = '';
    const apEl = els.autopass || (els.autopass = stubEl()); apEl.textContent = '';
    let settled = false;
    const p = T.uiAnswer(P(false, [A2]), { chain: [{ code: A2.code }], turnPlayer: 0, turnCount: 2, phaseName: 'MAIN1' });
    p.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 300 && !settled; i++) await tick(10);
    ok(settled && dockEl.className !== 'on', 'DK11: cross-location return auto-passes, no dock shown');
    ok(apEl.textContent.includes('自動パス') && apEl.textContent.includes('剣神官ムドラ の効果①'),
      'DK12: auto-pass flash names the dismissed card+effect');
    // the manager sheet states the new scope and carries the class key
    T.openDismissManager();
    const sheetHtml = (els.sheet || stubEl()).innerHTML;
    ok(sheetHtml.includes('置かれた場所・コピー・場面が変わっても聞きません'),
      'DK13: manager note states the location/copy/scene-free scope');
    ok(sheetHtml.includes('data-undismiss="' + dA + '"') && sheetHtml.includes('剣神官ムドラ の効果①'),
      'DK14: manager row un-dismisses by class key, named with its effect number');
  }
  T.setDismissed(new Set(), new Map());

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
