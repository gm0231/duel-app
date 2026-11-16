'use strict';
/* test-lightconfirm.js — lightconfirm-1116.
 *
 * Target 1 (confirm lightening): MSG_CONFIRM_CARDS presentation.
 *   1-2 cards total -> NO blocking sheet; a non-modal float in
 *   #fxlayer (large art + name + group label) that dwells for a
 *   readable span (1 card ~2000ms, 2 cards ~2600ms) and then
 *   advances on its own. Tapping a card opens the detail pop;
 *   while the pop is open the countdown pauses, and at least
 *   ~800ms of dwell remains after it closes.
 *   3+ cards -> the existing sheet, unchanged (its three exits
 *   still settle the wait — also pinned by test-zolga C8-C10).
 *   CPU-seat confirms are still dropped by queueConfirmEvents,
 *   and lastConfirm (BU-58) survives a light presentation.
 *
 * Target 2 (BU-110): the FX settings sheet and the auto-pass
 *   manager open during an idle prompt (SELECT_IDLECMD /
 *   SELECT_BATTLECMD — the prompt that spans the player's whole
 *   turn) and stay closed during a modal prompt (SELECT_CHAIN).
 *   Closing the settings sheet leaves the idle prompt answerable.
 *
 * Target 3 (BU-111): the result button row fits the overlay's
 *   350px content box at 390px wide (CSS pins here; the painted
 *   measurement at 390x620 / 390x700 is in the round RECORD).
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- source pins ----------
ok(clientSrc.includes('function showLightConfirms(groups, total)'), 'LC-S1: light confirm presenter exists');
ok(clientSrc.includes('const CONFIRM_LIGHT_MS = { 1: 2000, 2: 2600 };'), 'LC-S2: light dwell is 2000ms (1 card) / 2600ms (2 cards)');
ok(clientSrc.includes('if (totalCards <= 2) return showLightConfirms(groups, totalCards);'), 'LC-S3: 1-2 cards route to the light form, 3+ keep the sheet');
ok(clientSrc.includes('const CONFIRM_LIGHT_AFTER_POP_MS = 800;'), 'LC-S4: at least 800ms of dwell remains after a detail pop closes');
ok(html.includes('.fx-confirm-light{'), 'LC-S5: light confirm styles exist');
ok(html.includes('.fx-confirm-light .fcl-art{') && html.includes('width:132px;height:150px'), 'LC-S6: light confirm art is large (132x150, not a thumbnail)');
ok(!clientSrc.includes('if (!fxSettings.notice) return showLightConfirms') && clientSrc.includes('fxSettings.notice does NOT gate them'), 'LC-S7: the light confirm is not gated by the notice setting (public information, like the sheet)');
// BU-110 source pins
ok(clientSrc.includes("function isIdlePromptName(name) { return name === 'SELECT_IDLECMD' || name === 'SELECT_BATTLECMD'; }"), 'LC-S8 (BU-110): idle prompt names are named as a class');
ok(clientSrc.includes('function promptBlocksViewSheets()'), 'LC-S9 (BU-110): a single modal-only gate exists');
ok(clientSrc.includes('if (promptBlocksViewSheets()) return; // during a MODAL prompt the dock itself carries the controls (BU-110: idle prompts do not block)'), 'LC-S10 (BU-110): the auto-pass manager uses the modal-only gate');
ok(clientSrc.includes('if (promptBlocksViewSheets()) return; // during a MODAL prompt the dock/sheet carries the interaction (BU-110: idle prompts do not block)'), 'LC-S11 (BU-110): FX settings use the modal-only gate');
// BU-111 source pins (CSS measurement by estimate; painted proof in RECORD)
ok(html.includes('.resultbtns{display:flex;gap:8px;width:100%;max-width:350px;'), 'LC-S12 (BU-111): result row is capped at the 350px content box with gap 8px');
ok(html.includes('.resultbtns .startbtn{min-height:53px;font-size:14px;padding:14px 8px;white-space:nowrap;}'), 'LC-S13 (BU-111): start button is 14px / padding 14px 8px');
ok(html.includes('.resultbtns .subbtn{background:var(--panel2);color:var(--txt);border:1px solid var(--tile-edge);border-radius:8px;font-size:13px;padding:14px 8px;cursor:pointer;white-space:nowrap;}'), 'LC-S14 (BU-111): sub buttons are 13px / padding 14px 8px');
{
  // full-width glyph estimate: 1 char == 1em. Labels are fixed in index.html.
  const est = (chars, fs, pad) => chars * fs + pad * 2;
  const total = est(9, 14, 8) + est(5, 13, 8) + est(7, 13, 8) + 8 * 2;
  ok(total <= 350, 'LC-S15 (BU-111): estimated row width ' + total + 'px fits the 350px content box (was ~390px)');
  ok(html.includes('同じ設定でもう1戦') && html.includes('履歴を見る') && html.includes('タイトルに戻る'), 'LC-S16 (BU-111): the three labels and their meanings are unchanged');
}

// ---------- live behaviour in jsdom ----------
async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const C = window.__confirm;
  ok(!!C && typeof C.queueEvents === 'function' && typeof C.last === 'function', 'LC0: confirm test surface exposes queueEvents/last');
  const gg = data.decks.gg.main;
  const codes = [...new Set(gg)].slice(0, 4);
  const HAND = 2, EXTRA = 64; // Engine.LOC.HAND / LOC.EXTRA
  const evOf = (list, shown) => ({ kind: 'confirm', shown: shown == null ? 0 : shown, cards: list });
  const card = (code, con, loc, seq) => ({ code, con, loc, seq: seq || 0 });
  const sheetOn = () => doc.getElementById('sheetwrap').classList.contains('on');
  const waitFor = async (fn, ms) => { for (let i = 0; i < (ms || 3000) / 50; i++) { if (fn()) return true; await sleep(50); } return fn(); };

  // ---- (4) CPU-seat confirms never queue ----
  window.eval('pendingConfirms = []');
  C.queueEvents([evOf([card(codes[0], 1, HAND, 0)], 1)]); // shown = CPU seat (HP is 0)
  ok(C.queue().length === 0, 'LC4: a CPU-seat confirm is dropped by queueConfirmEvents');
  C.queueEvents([evOf([card(codes[0], 1, HAND, 0)], 0)]); // shown = human seat
  ok(C.queue().length === 1, 'LC4b: a human-seat confirm queues');
  // drain the queued one through the light path so state is clean
  { let done = false; const p = C.show().then(() => { done = true; }); await waitFor(() => done, 3000); ok(done, 'LC4c: the queued human confirm presented and resolved'); }

  // ---- (1) 1 card: light, no sheet, auto-resolves, lastConfirm kept ----
  window.eval('pendingConfirms = []');
  C.queueEvents([evOf([card(codes[0], 1, HAND, 0)], 0)]);
  {
    let done = false; const p = C.show().then(() => { done = true; });
    await sleep(80);
    const light = doc.querySelector('.fx-confirm-light');
    ok(!!light, 'LC1a: 1 card shows the light float');
    ok(!sheetOn(), 'LC1b: 1 card does NOT open the sheet');
    ok(light && light.getAttribute('data-count') === '1' && light.getAttribute('data-duration') === '2000', 'LC1c: light carries count=1 / duration=2000');
    ok(light && light.textContent.includes('相手の手札') && light.textContent.includes(data.names[codes[0]]), 'LC1d: light shows the group label and the card name');
    ok(light && !!light.querySelector('.fcl-art'), 'LC1e: light carries a large art element');
    ok(!done, 'LC1f: light has not resolved instantly (it dwells to be read)');
    await waitFor(() => done, 3200);
    ok(done, 'LC1g: 1-card light auto-resolves with no tap');
    ok(!doc.querySelector('.fx-confirm-light'), 'LC1h: the light float is removed after resolving');
    const last = C.last();
    ok(!!last && last.cards.length === 1 && last.cards[0].code === codes[0], 'LC5: lastConfirm survives the light presentation (BU-58)');
    await p;
  }

  // ---- (2) 2 cards: light, no sheet, auto-resolves ----
  window.eval('pendingConfirms = []');
  C.push(evOf([card(codes[0], 1, EXTRA, 0), card(codes[1], 1, EXTRA, 1)]));
  {
    let done = false; const p = C.show().then(() => { done = true; });
    await sleep(80);
    const light = doc.querySelector('.fx-confirm-light');
    ok(!!light && light.getAttribute('data-count') === '2' && light.getAttribute('data-duration') === '2600', 'LC2a: 2 cards show the light float (count=2 / duration=2600)');
    ok(!sheetOn(), 'LC2b: 2 cards do NOT open the sheet');
    ok(light && light.querySelectorAll('.fcl-card').length === 2 && light.textContent.includes('相手のEXデッキ'), 'LC2c: both cards float with the EX group label (fusion-style reveal)');
    await waitFor(() => done, 3800);
    ok(done, 'LC2d: 2-card light auto-resolves with no tap');
    await p;
  }

  // ---- (3) 3+ cards: the sheet, and it waits for an exit ----
  window.eval('pendingConfirms = []');
  C.push(evOf([card(codes[0], 0, 1, 30), card(codes[1], 0, 1, 31), card(codes[2], 0, 1, 32)]));
  {
    let done = false; const p = C.show().then(() => { done = true; });
    await sleep(80);
    ok(sheetOn() && doc.getElementById('sheet').textContent.includes('カードの確認'), 'LC3a: 3 cards open the confirm sheet');
    ok(!doc.querySelector('.fx-confirm-light'), 'LC3b: 3 cards do NOT use the light float');
    await sleep(450);
    ok(!done, 'LC3c: the sheet wait does NOT auto-resolve');
    doc.getElementById('sheet-cancel').click();
    await waitFor(() => done, 1500);
    ok(done, 'LC3d: the sheet close button resolves the wait');
    await p;
    await sleep(260); // sheet close animation clears the wrap
  }
  // 3+ via the x exit as well (the guarantee must not narrow)
  window.eval('pendingConfirms = []');
  C.push(evOf([card(codes[0], 1, HAND, 0), card(codes[1], 1, HAND, 1), card(codes[2], 1, HAND, 2), card(codes[3], 1, HAND, 3)]));
  {
    let done = false; const p = C.show().then(() => { done = true; });
    await sleep(80);
    ok(sheetOn(), 'LC3e: 4 cards open the sheet');
    doc.getElementById('sheetx').click();
    await waitFor(() => done, 1500);
    ok(done, 'LC3f: the x button resolves the 3+ sheet wait');
    await p;
    await sleep(260);
  }

  // ---- (6) detail pop pauses the countdown ----
  window.eval('pendingConfirms = []');
  C.push(evOf([card(codes[1], 1, HAND, 0)]));
  {
    let done = false; const p = C.show().then(() => { done = true; });
    await sleep(80);
    const lightCard = doc.querySelector('.fx-confirm-light .fcl-card');
    ok(!!lightCard, 'LC6a: light card exists for the pop test');
    lightCard.click();
    await sleep(60);
    ok(doc.getElementById('infopop').className === 'on', 'LC6b: tapping the light card opens the detail pop');
    await sleep(2300); // past the full 2000ms dwell, pop still open
    ok(!done && !!doc.querySelector('.fx-confirm-light'), 'LC6c: while the pop is open the light does NOT advance');
    doc.getElementById('infopop-close').click();
    await sleep(250);
    ok(!done, 'LC6d: at least ~800ms of dwell remains right after the pop closes');
    await waitFor(() => done, 1800);
    ok(done, 'LC6e: the light resolves after the post-pop dwell');
    await p;
  }

  // ---- BU-110: idle prompt allows view sheets; modal prompt does not ----
  const anyCode = codes[0];
  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    duelState = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null, deckTop: [null, null] };
    render(duelState);
    fxSettings.resp = 'auto';
    return true;
  })()`);
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  // idle prompt
  window.eval(`(() => { window.__lcIdleDone = false;
    uiAnswer({ name: 'SELECT_IDLECMD', summon: [], spsummon: [], repos: [], mset: [], sset: [], activate: [], toBP: false, toEP: true, canShuffle: false }, duelState)
      .then(() => { window.__lcIdleDone = true; });
    return true; })()`);
  await sleep(200);
  ok(window.eval('!!currentPrompt && currentPrompt.prompt.name === "SELECT_IDLECMD"'), 'LC7a (BU-110): the idle prompt is live');
  ok(!doc.getElementById('fxbtn').classList.contains('inert'), 'LC7b (BU-110): the FX button is NOT inert during an idle prompt');
  ok(!doc.getElementById('autopass').classList.contains('inert'), 'LC7c (BU-110): the auto-pass chip is NOT inert during an idle prompt');
  window.eval('openFxSettings()');
  await sleep(60);
  ok(sheetOn() && doc.getElementById('sheet').textContent.includes('演出・応答の設定'), 'LC7d (BU-110): openFxSettings opens during SELECT_IDLECMD');
  click(doc.getElementById('sheet-cancel'));
  await sleep(300);
  ok(!sheetOn(), 'LC7e (BU-110): the settings sheet closed');
  ok(window.eval('window.__lcIdleDone') === false && window.eval('!!currentPrompt'), 'LC7f (BU-110): the idle prompt is still pending after viewing settings (not stranded, not answered)');
  click(doc.getElementById('phasebtn')); // the idle prompt's own phase action answers it
  await waitFor(() => window.eval('window.__lcIdleDone') === true, 2000);
  ok(window.eval('window.__lcIdleDone') === true, 'LC7g (BU-110): the idle prompt answers normally after the settings detour');
  // modal prompt (SELECT_CHAIN)
  window.eval(`(() => {
    duelState.chain = [{ code: ${anyCode}, con: 1, loc: 4, seq: 0, desc: 0 }];
    window.__lcChainDone = false;
    uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries: [{ code: ${anyCode}, con: 0, loc: 8, seq: 0, desc: ${anyCode} * 1048576 }] }, duelState)
      .then(() => { window.__lcChainDone = true; });
    return true; })()`);
  await waitFor(() => doc.getElementById('chainui').classList.contains('on') || doc.getElementById('dock').className === 'on', 2500);
  ok(doc.getElementById('fxbtn').classList.contains('inert'), 'LC8a (BU-110): the FX button IS inert during SELECT_CHAIN');
  window.eval('openFxSettings()');
  await sleep(60);
  ok(!sheetOn(), 'LC8b (BU-110): openFxSettings does NOT open during SELECT_CHAIN');
  window.eval('openDismissManager()');
  await sleep(60);
  ok(!sheetOn(), 'LC8c (BU-110): openDismissManager does NOT open during SELECT_CHAIN');
  const trayNo = doc.querySelector('#chaintray .ct-no');
  if (trayNo) click(trayNo); else click(doc.querySelector('#dock #chain-pass'));
  await waitFor(() => window.eval('window.__lcChainDone') === true, 2500);
  ok(window.eval('window.__lcChainDone') === true, 'LC8d (BU-110): the chain prompt resolved after the blocked attempts');
  await sleep(150);
  ok(!doc.getElementById('fxbtn').classList.contains('inert'), 'LC8e (BU-110): the FX button is live again once no modal prompt is open');

  console.log(failures === 0 ? 'ALL LIGHTCONFIRM CHECKS PASSED' : failures + ' LIGHTCONFIRM CHECK(S) FAILED');
  window.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e && e.stack || e); process.exit(2); });
