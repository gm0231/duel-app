'use strict';
/* test-loghist.js — regression for the dead 履歴 (log history)
   button (user report 2026-11-03: 履歴のログが見れない／ボタンを
   押しても何も起きない).
   Root cause found by triage: openLogHistory() opened with
   `if (currentPrompt || !logHist.length) return;` — but
   SELECT_IDLECMD / SELECT_BATTLECMD stay open for the player's
   whole turn, so the tap was silently swallowed at every moment
   it would actually be used. It only ever worked in the brief
   no-prompt processing gaps (which is how it passed its original
   B-10 verification). Live repro (cap-loghist.js): at the human's
   own main phase, elementFromPoint === the button itself and
   logHist.length > 0, yet a real tap changed nothing; the same
   call in a no-prompt gap opened the sheet.
   Fix: the guard no longer blocks on currentPrompt (a view sheet
   is read-only and never answers the pending prompt — pile sheets
   already open over a live prompt the same way); it still blocks
   while a sheet or the dock owns the screen. The whole log strip
   (履歴 button + prevlog text + the #logline) opens the sheet.
   This test (jsdom; skipped when jsdom is unresolvable) boots the
   real client, plays to the human's first SELECT_IDLECMD with a
   non-empty log, and clicks the DOM like a user. */
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

async function main() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); return; }
  const V2 = __dirname;
  const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
  const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
  const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  window.Audio = class { constructor(src) { this.src = src; } play() { return Promise.resolve(); } pause() {} };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => String(url).includes('ocgcore.wasm')
    ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
    : { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  const inject = (file) => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    doc.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('client.js');
  const ev = (src) => window.eval(src);
  for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'L0: client booted');
  ev('window.__mem = Engine.makeBotMemory()');
  doc.getElementById('startbtn').click();
  // drive with the bot policy until MY first idle prompt with a log
  let held = false;
  for (let i = 0; i < 400 && !held; i++) {
    held = ev(`(() => {
      if (typeof currentPrompt === 'undefined' || !currentPrompt) return false;
      if (currentPrompt.prompt.name === 'SELECT_IDLECMD' && duelState && duelState.turnPlayer === HP && logHist.length >= 1) return true;
      try { finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem)); } catch (e) {}
      return false;
    })()`);
    if (!held) await new Promise(r => setTimeout(r, 60));
  }
  ok(held, 'L1: reached the human SELECT_IDLECMD with log entries (the exact state that was dead)');
  if (!held) { window.close(); return; }
  const btn = doc.querySelector('#loghistbtn');
  ok(!!btn, 'L2: 履歴 button is rendered in the idle chain bar');
  ok(ev('logHist.length') >= 1, 'L3: log history is non-empty (guard was not about emptiness)');
  btn.click();
  await new Promise(r => setTimeout(r, 80));
  ok(doc.getElementById('sheetwrap').className === 'on', 'L4: tapping 履歴 during SELECT_IDLECMD opens the sheet');
  ok(doc.getElementById('sheet').textContent.includes('対戦の履歴'), 'L5: sheet is the log history');
  ok(doc.querySelectorAll('#sheet .loghistrow').length >= 1, 'L6: history rows are rendered');
  // close via 閉じる (W-28: the history sheet is a pure viewer) —
  // the pending prompt must survive untouched
  doc.getElementById('sheet-cancel').click();
  await new Promise(r => setTimeout(r, 400)); // sheetClose lands at 185 ms
  ok(doc.getElementById('sheetwrap').className === '', 'L7: 閉じる closes the sheet');
  ok(ev('!!currentPrompt && currentPrompt.prompt.name === "SELECT_IDLECMD"'), 'L8: the idle prompt is still pending after viewing history');
  // the log line itself is also a target now
  doc.getElementById('logline').click();
  await new Promise(r => setTimeout(r, 80));
  ok(doc.getElementById('sheetwrap').className === 'on' && doc.getElementById('sheet').textContent.includes('対戦の履歴'),
    'L9: tapping the log line opens the history too');
  doc.getElementById('sheetx').click(); // view-sheet ×
  await new Promise(r => setTimeout(r, 400));
  ok(doc.getElementById('sheetwrap').className === '', 'L10: × closes the sheet');
  // and the duel still answers and moves on
  const before = ev('duelState.turnCount');
  ev('finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem))');
  let moved = false;
  for (let i = 0; i < 100 && !moved; i++) {
    moved = ev('!!currentPrompt || duelState.turnCount !== ' + before);
    if (!moved) {
      ev('if (currentPrompt) { try { finishPrompt(Engine.botAnswer(currentPrompt.prompt, duel.state, DATA, window.__mem)); } catch (e) {} }');
      await new Promise(r => setTimeout(r, 60));
    }
  }
  ok(moved, 'L11: the duel continues after the history round-trip');
  window.close();
}

(async () => {
  await main();
  console.log(failures === 0 ? 'ALL LOGHIST CHECKS PASSED' : failures + ' LOGHIST CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
